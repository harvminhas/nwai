"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signInWithPopup, GoogleAuthProvider } from "firebase/auth";
import { getFirebaseClient } from "@/lib/firebase";
import Link from "next/link";

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

async function claimPendingStatement(idToken: string): Promise<void> {
  const sid = localStorage.getItem("nwai_claim_statement");
  if (!sid) return;
  await fetch("/api/claim-statement", {
    method: "POST",
    headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ statementId: sid }),
  });
  localStorage.removeItem("nwai_claim_statement");
}

/** Shared Google button — used in both the mobile bottom bar and desktop left panel */
function GoogleButton({ loading, onClick }: { loading: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      className="flex w-full items-center justify-center gap-3 rounded-2xl border-2 border-gray-200 bg-white py-3.5 text-sm font-semibold text-gray-700 shadow-sm transition hover:border-gray-300 hover:bg-gray-50 disabled:opacity-60"
    >
      <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden>
        <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
        <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
        <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
        <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
      </svg>
      {loading ? "Signing in…" : "Continue with Google"}
    </button>
  );
}

const FAKE_ROWS = [
  { w: "w-28", amt: "-42.18",    neg: true  },
  { w: "w-20", amt: "-12.50",    neg: true  },
  { w: "w-36", amt: "+1,840.00", neg: false },
  { w: "w-24", amt: "-85.40",    neg: true  },
  { w: "w-16", amt: "-27.99",    neg: true  },
  { w: "w-32", amt: "-118.20",   neg: true  },
];

/** Statement card illustration shared between mobile + desktop panels */
function StatementCard() {
  return (
    <div className="relative w-64 sm:w-72">
      <div className="absolute -top-3 left-4 right-4 h-48 rounded-2xl bg-white/60 shadow-md" />
      <div className="relative rounded-2xl bg-white px-5 py-5 shadow-lg">
        <div className="mb-4 inline-flex items-center gap-1.5 rounded-full bg-purple-600 px-3 py-1 text-xs font-semibold text-white shadow">
          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
          Pattern detected
        </div>
        {FAKE_ROWS.map((row, i) => (
          <div key={i} className="flex items-center justify-between py-1.5 border-b border-gray-100 last:border-0">
            <div className={`h-2 rounded-full bg-gray-200 ${row.w}`} />
            <span className={`text-xs font-mono font-medium ${row.neg ? "text-gray-500" : "text-emerald-600 font-bold"}`}>
              {row.amt}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function LoginPage() {
  const router  = useRouter();
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  async function handleGoogle() {
    setError(null);
    setLoading(true);
    try {
      const { auth } = getFirebaseClient();
      const cred    = await signInWithPopup(auth, new GoogleAuthProvider());
      const idToken = await cred.user.getIdToken();
      const isNew   = await ensureUserProfile(idToken);
      if (isNew) await claimPendingStatement(idToken);
      router.push("/account/dashboard");
      router.refresh();
    } catch (err: unknown) {
      const code = (err as { code?: string }).code ?? "";
      if (code !== "auth/popup-closed-by-user") setError("Sign-in failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col lg:flex-row">

      {/* ── MOBILE: marketing panel fills the screen, button sticky at bottom ── */}
      <div className="relative flex flex-1 flex-col overflow-hidden bg-[#f5f0eb] pb-36 lg:hidden">
        {/* Logo */}
        <div className="px-6 pt-10">
          <Link href="/" className="font-bold text-purple-600 text-lg tracking-tight">
            networth<span className="text-gray-400">.online</span>
          </Link>
        </div>

        {/* Illustration */}
        <div className="mt-8 flex justify-center px-6">
          <StatementCard />
        </div>

        {/* Copy */}
        <div className="mt-10 px-6">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-[#d8cfc6] bg-white/70 px-3.5 py-1.5 text-xs font-medium text-gray-600 shadow-sm">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            No bank connections
          </div>
          <h1 className="text-3xl font-bold leading-tight text-gray-900">
            The first finance app that doesn&apos;t want your bank login.
          </h1>
          <p className="mt-3 text-sm text-gray-600 leading-relaxed">
            Upload your statements when you want. We read them, find the patterns, and stay out of the way.
          </p>
        </div>
      </div>

      {/* ── MOBILE: sticky bottom bar ────────────────────────────────────────── */}
      <div className="fixed bottom-0 left-0 right-0 z-20 border-t border-gray-200 bg-white px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-4 shadow-[0_-8px_32px_rgba(0,0,0,0.08)] lg:hidden">
        {error && (
          <p className="mb-3 text-center text-sm text-red-600">{error}</p>
        )}
        <GoogleButton loading={loading} onClick={handleGoogle} />
        <p className="mt-3 text-center text-xs text-gray-400 leading-relaxed">
          By continuing you agree to our{" "}
          <Link href="/terms" className="underline hover:text-gray-600">Terms</Link>
          {" "}and{" "}
          <Link href="/privacy" className="underline hover:text-gray-600">Privacy Policy</Link>.
        </p>
      </div>

      {/* ── DESKTOP: left sign-in panel ──────────────────────────────────────── */}
      <div className="hidden w-[420px] shrink-0 flex-col items-center justify-center border-r border-gray-100 bg-white px-8 py-12 lg:flex">
        <div className="w-full max-w-sm text-center">
          <Link href="/" className="mb-8 inline-block font-bold text-purple-600 text-xl tracking-tight">
            networth<span className="text-gray-400">.online</span>
          </Link>
          <h1 className="mb-1 text-3xl font-bold text-gray-900">Get started</h1>
          <p className="mb-8 text-sm text-gray-500">Your finances, only ever uploaded by you.</p>
          {error && (
            <div className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>
          )}
          <GoogleButton loading={loading} onClick={handleGoogle} />
          <p className="mt-6 text-xs text-gray-400 leading-relaxed">
            By continuing you agree to our{" "}
            <Link href="/terms" className="underline hover:text-gray-600">Terms</Link>
            {" "}and{" "}
            <Link href="/privacy" className="underline hover:text-gray-600">Privacy Policy</Link>.
          </p>
        </div>
      </div>

      {/* ── DESKTOP: right marketing panel ───────────────────────────────────── */}
      <div className="relative hidden flex-1 flex-col justify-between overflow-hidden bg-[#f5f0eb] px-12 py-14 lg:flex">
        <div className="flex items-center gap-2 self-start rounded-full border border-[#d8cfc6] bg-white/70 px-3.5 py-1.5 text-xs font-medium text-gray-600 shadow-sm backdrop-blur-sm">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          No bank connections
        </div>

        <div className="max-w-md">
          <h2 className="text-4xl font-bold leading-tight text-gray-900">
            The first finance app that doesn&apos;t want your bank login.
          </h2>
          <p className="mt-4 text-base text-gray-600 leading-relaxed">
            Upload your statements when you want. We read them, find the patterns, and stay out of the way.
          </p>
        </div>

        <div className="mt-10 self-center">
          <StatementCard />
        </div>

        <div className="flex justify-center">
          <div className="flex h-9 w-9 items-center justify-center rounded-full border border-[#d8cfc6] bg-white/70 text-gray-400 shadow-sm">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        </div>
      </div>

    </div>
  );
}
