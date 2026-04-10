"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  signInWithPopup,
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  updateProfile,
  sendPasswordResetEmail,
} from "firebase/auth";
import { getFirebaseClient } from "@/lib/firebase";

type Mode = "login" | "signup";

/** Ensure the users/{uid} Firestore document exists. Safe to call on every sign-in.
 *  Returns true if the document was freshly created (i.e. brand-new user). */
async function ensureUserProfile(idToken: string): Promise<boolean> {
  try {
    const res = await fetch("/api/user/ensure-profile", {
      method: "POST",
      headers: { Authorization: `Bearer ${idToken}` },
    });
    if (res.ok) {
      const json = await res.json();
      return json.created === true;
    }
  } catch { /* non-critical */ }
  return false;
}

/** After sign-in, claim any anonymous statement the user uploaded before creating an account.
 *  Throws on failure so the caller can surface the error to the user. */
async function claimPendingStatement(idToken: string): Promise<void> {
  const sid = localStorage.getItem("nwai_claim_statement");
  if (!sid) return;

  const res = await fetch("/api/claim-statement", {
    method: "POST",
    headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ statementId: sid }),
  });

  // Always clear the stored ID — if the claim failed for a non-retryable reason
  // (not found, not ready) we don't want to block every future login attempt.
  localStorage.removeItem("nwai_claim_statement");

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    // Log but don't throw — a failed claim shouldn't block signup
    console.error("[claim-statement] failed:", res.status, body);
  }
}

function friendlyAuthError(code: string): string {
  switch (code) {
    case "auth/user-not-found":
    case "auth/wrong-password":
    case "auth/invalid-credential":
      return "Incorrect email or password.";
    case "auth/email-already-in-use":
      return "An account with this email already exists.";
    case "auth/weak-password":
      return "Password must be at least 6 characters.";
    case "auth/invalid-email":
      return "Please enter a valid email address.";
    case "auth/too-many-requests":
      return "Too many attempts. Please wait a moment and try again.";
    case "auth/popup-closed-by-user":
      return "Sign-in was cancelled.";
    default:
      return "Something went wrong. Please try again.";
  }
}

export default function AuthForm({ mode }: { mode: Mode }) {
  const router = useRouter();
  const isSignup = mode === "signup";

  const [email, setEmail]             = useState("");
  const [password, setPassword]       = useState("");
  const [name, setName]               = useState("");
  const [error, setError]             = useState<string | null>(null);
  const [existingUser, setExistingUser] = useState(false);
  const [loading, setLoading]         = useState(false);
  const [resetSent, setResetSent]     = useState(false);
  const [showReset, setShowReset]     = useState(false);

  async function afterSignIn(idToken: string, isNewAccount: boolean) {
    const isNewUser = await ensureUserProfile(idToken);
    if (isSignup && !isNewUser && !isNewAccount) {
      const { auth } = getFirebaseClient();
      await auth.signOut();
      setExistingUser(true);
      setError("An account with this email already exists.");
      return false;
    }
    if (isNewUser || isNewAccount) {
      await claimPendingStatement(idToken);
    } else {
      try { localStorage.removeItem("nwai_claim_statement"); } catch { /* ignore */ }
    }
    return true;
  }

  const handleGoogleSignIn = async () => {
    setError(null); setExistingUser(false); setLoading(true);
    try {
      const { auth } = getFirebaseClient();
      const cred = await signInWithPopup(auth, new GoogleAuthProvider());
      const idToken = await cred.user.getIdToken();
      const ok = await afterSignIn(idToken, false);
      if (ok) { router.push("/account/dashboard"); router.refresh(); }
    } catch (err: unknown) {
      const code = (err as { code?: string }).code ?? "";
      setError(friendlyAuthError(code));
    } finally { setLoading(false); }
  };

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null); setExistingUser(false); setLoading(true);
    try {
      const { auth } = getFirebaseClient();
      if (isSignup) {
        const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
        if (name.trim()) await updateProfile(cred.user, { displayName: name.trim() });
        const idToken = await cred.user.getIdToken();
        await afterSignIn(idToken, true);
      } else {
        const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
        const idToken = await cred.user.getIdToken();
        await afterSignIn(idToken, false);
      }
      router.push("/account/dashboard"); router.refresh();
    } catch (err: unknown) {
      const code = (err as { code?: string }).code ?? "";
      if (code === "auth/email-already-in-use") setExistingUser(true);
      setError(friendlyAuthError(code));
    } finally { setLoading(false); }
  };

  const handlePasswordReset = async () => {
    if (!email.trim()) { setError("Enter your email above first."); return; }
    setLoading(true);
    try {
      const { auth } = getFirebaseClient();
      await sendPasswordResetEmail(auth, email.trim());
      setResetSent(true); setShowReset(false);
    } catch (err: unknown) {
      const code = (err as { code?: string }).code ?? "";
      setError(friendlyAuthError(code));
    } finally { setLoading(false); }
  };

  return (
    <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-8 shadow-md">
      {/* Header */}
      <div className="mb-6 text-center">
        <p className="font-bold text-purple-600 text-xl tracking-tight">
          networth<span className="text-gray-400">.online</span>
        </p>
        <h1 className="mt-3 font-bold text-2xl text-gray-900">
          {isSignup ? "Create your free account" : "Welcome back"}
        </h1>
        <p className="mt-1.5 text-sm text-gray-500">
          {isSignup
            ? "Track your net worth, income, and spending over time."
            : "Sign in to access your financial dashboard."}
        </p>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 rounded-lg bg-red-50 px-4 py-2.5 text-sm text-red-600" role="alert">
          <p>{error}</p>
          {existingUser && (
            <a href="/login" className="mt-1 inline-block font-semibold underline hover:text-red-800">
              Log in instead →
            </a>
          )}
        </div>
      )}

      {resetSent && (
        <div className="mb-4 rounded-lg bg-green-50 px-4 py-2.5 text-sm text-green-700">
          Password reset email sent. Check your inbox.
        </div>
      )}

      {/* Google */}
      <button
        type="button"
        onClick={handleGoogleSignIn}
        disabled={loading}
        className="flex w-full items-center justify-center gap-3 rounded-xl border-2 border-gray-200 bg-white py-3 font-semibold text-gray-700 transition hover:border-gray-300 hover:bg-gray-50 disabled:opacity-50"
      >
        <svg width="20" height="20" viewBox="0 0 48 48">
          <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
          <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
          <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
          <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
        </svg>
        {loading ? "Please wait…" : "Continue with Google"}
      </button>

      {/* Divider */}
      <div className="my-5 flex items-center gap-3">
        <div className="flex-1 border-t border-gray-200" />
        <span className="text-xs text-gray-400">or</span>
        <div className="flex-1 border-t border-gray-200" />
      </div>

      {/* Email / password form */}
      <form onSubmit={handleEmailSubmit} className="space-y-3">
        {isSignup && (
          <input
            type="text"
            placeholder="Your name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm outline-none focus:border-purple-400 focus:ring-1 focus:ring-purple-300"
          />
        )}
        <input
          type="email"
          placeholder="Email address"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoComplete="email"
          className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm outline-none focus:border-purple-400 focus:ring-1 focus:ring-purple-300"
        />
        <input
          type="password"
          placeholder={isSignup ? "Create a password (6+ characters)" : "Password"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          autoComplete={isSignup ? "new-password" : "current-password"}
          className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm outline-none focus:border-purple-400 focus:ring-1 focus:ring-purple-300"
        />
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-xl bg-purple-600 py-3 font-semibold text-white transition hover:bg-purple-700 disabled:opacity-50"
        >
          {loading ? "Please wait…" : isSignup ? "Create account" : "Sign in"}
        </button>
      </form>

      {/* Forgot password */}
      {!isSignup && (
        <div className="mt-3 text-center">
          {showReset ? (
            <button
              onClick={handlePasswordReset}
              disabled={loading}
              className="text-xs text-purple-600 hover:underline disabled:opacity-50"
            >
              Send reset link to {email || "your email"}
            </button>
          ) : (
            <button
              onClick={() => setShowReset(true)}
              className="text-xs text-gray-400 hover:text-gray-600"
            >
              Forgot password?
            </button>
          )}
        </div>
      )}

      {/* Switch mode */}
      <p className="mt-6 text-center text-sm text-gray-500">
        {isSignup ? (
          <>Already have an account?{" "}
            <a href="/login" className="font-medium text-purple-600 hover:underline">Sign in</a>
          </>
        ) : (
          <>Don&apos;t have an account?{" "}
            <a href="/signup" className="font-medium text-purple-600 hover:underline">Create one free</a>
          </>
        )}
      </p>

      <p className="mt-4 text-center text-xs text-gray-400">
        By continuing, you agree to our{" "}
        <a href="/privacy" className="hover:underline">Privacy Policy</a>.
        We never access your bank accounts.
      </p>
    </div>
  );
}
