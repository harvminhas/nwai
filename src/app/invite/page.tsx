"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseClient } from "@/lib/firebase";
import Link from "next/link";

type State = "loading" | "accepting" | "success" | "error" | "needs-login";

function InvitePageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const inviteToken = searchParams.get("token") ?? "";

  const [state, setState] = useState<State>("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [ownerUid, setOwnerUid] = useState("");
  const acceptedRef = { current: false };

  useEffect(() => {
    if (!inviteToken) { setState("error"); setErrorMsg("No invite token found."); return; }

    const { auth } = getFirebaseClient();

    const tryAccept = async (user: import("firebase/auth").User) => {
      if (acceptedRef.current) return;
      acceptedRef.current = true;
      setState("accepting");
      try {
        const token = await user.getIdToken();
        const res = await fetch("/api/access/accept", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ token: inviteToken }),
        });
        const json = await res.json();
        if (!res.ok) { setState("error"); setErrorMsg(json.error ?? "Failed to accept invite"); return; }
        setOwnerUid(json.partnerUid ?? json.ownerUid);
        setState("success");
        localStorage.setItem("nwai_active_profile", "partner");
        setTimeout(() => router.push("/account/dashboard"), 2000);
      } catch {
        setState("error");
        setErrorMsg("Something went wrong. Please try again.");
      }
    };

    const unsub = onAuthStateChanged(auth, (user) => {
      if (!user) { setState("needs-login"); return; }
      void tryAccept(user);
    });
    return () => unsub();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inviteToken]);

  if (state === "loading" || state === "accepting") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="text-center space-y-3">
          <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-teal-500 border-t-transparent" />
          <p className="text-sm text-gray-500">{state === "accepting" ? "Accepting invite…" : "Loading…"}</p>
        </div>
      </div>
    );
  }

  if (state === "needs-login") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
        <div className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-8 shadow-sm text-center space-y-4">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-teal-100">
            <svg className="h-6 w-6 text-teal-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-gray-900">You&apos;ve been invited</h1>
          <p className="text-sm text-gray-500">Sign in or create an account to accept this invite and view the shared finances.</p>
          <div className="flex flex-col gap-2 pt-2">
            <Link
              href={`/login?redirect=/invite?token=${inviteToken}`}
              className="rounded-xl bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-teal-700 transition"
            >
              Sign in to accept
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

  if (state === "success") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
        <div className="w-full max-w-sm rounded-2xl border border-teal-200 bg-white p-8 shadow-sm text-center space-y-4">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-teal-100">
            <svg className="h-6 w-6 text-teal-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-gray-900">Invite accepted!</h1>
          <p className="text-sm text-gray-500">You now have access to the shared finances. Redirecting to your dashboard…</p>
          <Link href="/account/dashboard" className="inline-block text-sm font-semibold text-teal-600 hover:underline">
            Go now →
          </Link>
        </div>
      </div>
    );
  }

  // error — also suppresses ownerUid unused warning
  void ownerUid;
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
        <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-teal-500 border-t-transparent" />
      </div>
    }>
      <InvitePageInner />
    </Suspense>
  );
}
