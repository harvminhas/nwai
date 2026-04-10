"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseClient } from "@/lib/firebase";
import Link from "next/link";

type State = "loading" | "confirm" | "accepting" | "success" | "error" | "needs-login";

function InvitePageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const inviteToken = searchParams.get("token") ?? "";

  const [state, setState] = useState<State>("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [inviterName, setInviterName] = useState("");
  const [inviterEmail, setInviterEmail] = useState("");
  const [mutualConsent, setMutualConsent] = useState(false);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const loadedRef = useRef(false);

  // Step 1 — fetch invite info (no auth needed), then wait for auth state
  useEffect(() => {
    if (!inviteToken) { setState("error"); setErrorMsg("No invite token found."); return; }
    if (loadedRef.current) return;
    loadedRef.current = true;

    // Fetch invite info first so we can show inviter name on consent screen
    fetch(`/api/access/accept?token=${encodeURIComponent(inviteToken)}`)
      .then((r) => r.json())
      .then((json) => {
        if (json.error) { setState("error"); setErrorMsg(json.error); return; }
        setInviterName(json.initiatorName ?? "");
        setInviterEmail(json.initiatorEmail ?? "");

        // Now check auth state
        const { auth } = getFirebaseClient();
        const unsub = onAuthStateChanged(auth, async (user) => {
          if (!user) { setState("needs-login"); return; }
          const tok = await user.getIdToken();
          setAuthToken(tok);
          setState("confirm");
          unsub();
        });
      })
      .catch(() => { setState("error"); setErrorMsg("Failed to load invite. The link may be invalid."); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inviteToken]);

  // Step 2 — user clicks "Accept & Share"
  async function handleAccept() {
    if (!authToken || !mutualConsent) return;
    setState("accepting");
    try {
      const res = await fetch("/api/access/accept", {
        method: "POST",
        headers: { Authorization: `Bearer ${authToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ token: inviteToken }),
      });
      const json = await res.json();
      if (!res.ok) { setState("error"); setErrorMsg(json.error ?? "Failed to accept invite"); return; }
      setState("success");
      localStorage.setItem("nwai_active_profile", "partner");
      setTimeout(() => router.push("/account/dashboard"), 2000);
    } catch {
      setState("error");
      setErrorMsg("Something went wrong. Please try again.");
    }
  }

  if (state === "loading" || state === "accepting") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="text-center space-y-3">
          <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-purple-500 border-t-transparent" />
          <p className="text-sm text-gray-500">{state === "accepting" ? "Accepting invite…" : "Loading invite…"}</p>
        </div>
      </div>
    );
  }

  if (state === "needs-login") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
        <div className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-8 shadow-sm text-center space-y-4">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-purple-100">
            <svg className="h-6 w-6 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">
              {inviterName ? `${inviterName} invited you` : "You've been invited"}
            </h1>
            <p className="mt-1 text-sm text-gray-500">
              Sign in or create an account to review and accept this mutual finance share.
            </p>
          </div>
          <div className="flex flex-col gap-2 pt-2">
            <Link
              href={`/login?redirect=/invite?token=${inviteToken}`}
              className="rounded-xl bg-purple-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-purple-700 transition"
            >
              Sign in to continue
            </Link>
            <Link
              href={`/signup?redirect=/invite?token=${inviteToken}`}
              className="rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition"
            >
              Create account
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (state === "confirm") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
        <div className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-8 shadow-sm space-y-5">
          <div className="text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-purple-100">
              <svg className="h-6 w-6 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </div>
            <h1 className="text-xl font-bold text-gray-900">
              {inviterName || "Someone"} wants to share finances with you
            </h1>
            {inviterEmail && <p className="mt-0.5 text-xs text-gray-400">{inviterEmail}</p>}
          </div>

          {/* What this means */}
          <div className="rounded-xl bg-gray-50 border border-gray-100 p-4 space-y-2.5">
            <p className="text-xs font-semibold text-gray-700">By accepting:</p>
            {[
              `You will see ${inviterName || "their"}'s full financial data`,
              `${inviterName || "They"} will NOT see your data unless you also invite them`,
              "Either of you can unlink at any time from Settings → Account Sharing",
            ].map((line) => (
              <div key={line} className="flex items-start gap-2 text-xs text-gray-600">
                <svg className="mt-0.5 h-3.5 w-3.5 shrink-0 text-purple-500" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
                <span>{line}</span>
              </div>
            ))}
          </div>

          {/* Explicit consent */}
          <label className="flex items-start gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={mutualConsent}
              onChange={(e) => setMutualConsent(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 rounded border-gray-300 accent-purple-600"
            />
            <span className="text-xs text-gray-600 leading-relaxed">
              I understand I will see <strong>{inviterName || "their"}</strong>&apos;s finances. They will not see mine.
            </span>
          </label>

          <button
            onClick={handleAccept}
            disabled={!mutualConsent}
            className="w-full rounded-xl bg-purple-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-purple-700 transition disabled:opacity-40"
          >
            Accept &amp; Share
          </button>
          <Link href="/account/dashboard" className="block text-center text-xs text-gray-400 hover:text-gray-600">
            Decline
          </Link>
        </div>
      </div>
    );
  }

  if (state === "success") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
        <div className="w-full max-w-sm rounded-2xl border border-green-200 bg-white p-8 shadow-sm text-center space-y-4">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
            <svg className="h-6 w-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-gray-900">Access granted!</h1>
          <p className="text-sm text-gray-500">
            You can now view {inviterName || "their"}&apos;s finances. Redirecting to your dashboard…
          </p>
          <Link href="/account/dashboard" className="inline-block text-sm font-semibold text-purple-600 hover:underline">
            Go now →
          </Link>
        </div>
      </div>
    );
  }

  // error
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm rounded-2xl border border-red-200 bg-white p-8 shadow-sm text-center space-y-4">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
          <svg className="h-6 w-6 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </div>
        <h1 className="text-xl font-bold text-gray-900">Invalid invite</h1>
        <p className="text-sm text-gray-500">{errorMsg || "This invite link is invalid or has already been used."}</p>
        <Link href="/account/dashboard" className="inline-block text-sm font-semibold text-purple-600 hover:underline">
          Go to dashboard →
        </Link>
      </div>
    </div>
  );
}

export default function InvitePage() {
  return (
    <Suspense fallback={
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-purple-500 border-t-transparent" />
      </div>
    }>
      <InvitePageInner />
    </Suspense>
  );
}
