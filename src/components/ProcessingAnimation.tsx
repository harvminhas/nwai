"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import { getFirebaseClient } from "@/lib/firebase";

const STEPS = [
  { label: "Reading your statement…",        duration: 2000 },
  { label: "Identifying account & balances…", duration: 3000 },
  { label: "Analysing activity…",             duration: 2000 },
  { label: "Generating insights…",            duration: 2000 },
  { label: "Complete!",                        duration: 800  },
];

const POLL_INTERVAL  = 2500;
const WARN_THRESHOLD = 30000;
const POLL_TIMEOUT   = 90000;

export type ProcessingAnimationProps = {
  statementId: string;
  onError?: (message: string) => void;
  onComplete?: () => void;
  compact?: boolean;
};

export default function ProcessingAnimation({
  statementId,
  onError,
  onComplete,
  compact = false,
}: ProcessingAnimationProps) {
  const router          = useRouter();
  const isLoggedInRef   = useRef(false);
  const [done,         setDone]         = useState(false);
  const [timedOut,     setTimedOut]     = useState(false);
  const [slowWarning,  setSlowWarning]  = useState(false);
  const [stepIndex,    setStepIndex]    = useState(0);
  const [message,      setMessage]      = useState("Starting…");
  const [isLoggedIn,   setIsLoggedIn]   = useState(false);

  // Track auth state
  useEffect(() => {
    const { auth } = getFirebaseClient();
    return onAuthStateChanged(auth, (user) => {
      isLoggedInRef.current = !!user;
      setIsLoggedIn(!!user);
    });
  }, []);

  // Cosmetic step animation — independent of actual Firestore status
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    let elapsed = 0;
    STEPS.forEach((step, i) => {
      timers.push(setTimeout(() => { setStepIndex(i); setMessage(step.label); }, elapsed));
      elapsed += step.duration;
    });
    return () => timers.forEach(clearTimeout);
  }, [statementId]);

  // Status listener: try Firestore onSnapshot (works for logged-in users with rules deployed),
  // automatically falls back to API polling for anonymous users (no auth → permission denied).
  useEffect(() => {
    const { db } = getFirebaseClient();
    const doneRef   = { current: false };
    let pollTimer:  ReturnType<typeof setInterval> | null = null;
    let timeoutId:  ReturnType<typeof setTimeout>  | null = null;
    const warnTimer = setTimeout(() => setSlowWarning(true), WARN_THRESHOLD);

    const handleComplete = () => {
      if (doneRef.current) return;
      doneRef.current = true;
      if (pollTimer) clearInterval(pollTimer);
      if (timeoutId) clearTimeout(timeoutId);
      setMessage("Complete!");
      setTimeout(() => {
        if (compact) {
          onComplete?.();
        } else if (isLoggedInRef.current) {
          router.push("/account/dashboard");
        } else {
          // Persist so AuthForm can claim this statement after signup/login
          try { localStorage.setItem("nwai_claim_statement", statementId); } catch { /* ignore */ }
          router.push(`/dashboard/${statementId}`);
        }
      }, 600);
    };

    const handleError = (msg: string) => {
      if (doneRef.current) return;
      doneRef.current = true;
      if (pollTimer) clearInterval(pollTimer);
      if (timeoutId) clearTimeout(timeoutId);
      onError?.(msg);
    };

    const startPolling = () => {
      const poll = async () => {
        if (doneRef.current) return;
        try {
          const res  = await fetch(`/api/statement/${statementId}`);
          const data = await res.json();
          if (data.status === "completed") handleComplete();
          else if (data.status === "error") handleError(data.errorMessage || "Something went wrong.");
        } catch { /* network hiccup — keep polling */ }
      };

      poll();
      pollTimer = setInterval(poll, POLL_INTERVAL);
      timeoutId = setTimeout(() => {
        if (!doneRef.current) {
          if (pollTimer) clearInterval(pollTimer);
          setTimedOut(true);
        }
      }, POLL_TIMEOUT);
    };

    // Try real-time Firestore listener first. If the user is unauthenticated (anonymous
    // upload), Firestore security rules will deny access → we catch the error and fall
    // back to API polling which uses the Admin SDK and bypasses client rules.
    const ref  = doc(db, "statements", statementId);
    const unsub = onSnapshot(
      ref,
      (snap) => {
        if (doneRef.current) return;
        const status = snap.data()?.status as string | undefined;
        if (status === "completed") handleComplete();
        else if (status === "error") handleError(snap.data()?.errorMessage || "Something went wrong.");
      },
      (err) => {
        // Permission denied → anonymous user; fall back to polling
        if (err.code === "permission-denied" || err.code === "unauthenticated") {
          startPolling();
        } else {
          console.error("Firestore snapshot error:", err);
          startPolling(); // fall back for any other error too
        }
      }
    );

    return () => {
      unsub();
      if (pollTimer) clearInterval(pollTimer);
      if (timeoutId) clearTimeout(timeoutId);
      clearTimeout(warnTimer);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statementId]);

  if (timedOut) {
    return (
      <div className="mt-8 rounded-lg border border-red-200 bg-red-50 p-6">
        <p className="font-semibold text-red-800">Processing timed out.</p>
        <p className="mt-1 text-sm text-gray-600">
          The AI is taking longer than expected. Your file has been saved — try refreshing in a minute.
          If it keeps failing, verify your <strong>GEMINI_API_KEY</strong> is set in your environment variables.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link href="/upload" className="rounded-lg bg-red-600 px-5 py-2.5 font-semibold text-white transition hover:bg-red-700">
            Try again
          </Link>
          {isLoggedIn && (
            <Link href="/account/dashboard" className="rounded-lg border-2 border-gray-300 px-5 py-2.5 font-semibold text-gray-700 transition hover:bg-gray-50">
              Back to dashboard
            </Link>
          )}
        </div>
      </div>
    );
  }

  if (done) {
    // Fallback: should auto-redirect above, but keep as safety net
    return (
      <div className="mt-8 rounded-lg border border-green-200 bg-green-50 p-6">
        <div className="flex items-center gap-2">
          <span className="text-green-600 text-xl">✓</span>
          <p className="font-semibold text-gray-900">Your statement is ready!</p>
        </div>
        <div className="mt-4">
          <Link href={`/dashboard/${statementId}`}
            className="rounded-lg bg-gradient-to-r from-purple-600 to-purple-700 px-5 py-2.5 font-semibold text-white transition hover:from-purple-700 hover:to-purple-800">
            View statement
          </Link>
        </div>
      </div>
    );
  }

  if (compact) {
    return (
      <div className="space-y-1">
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <span className="h-3 w-3 animate-spin rounded-full border-2 border-purple-500 border-t-transparent" />
          {message}
        </div>
        {slowWarning && (
          <p className="text-xs text-amber-600">Still working — complex statements can take up to a minute…</p>
        )}
      </div>
    );
  }

  return (
    <div className="mt-8 rounded-lg border border-gray-200 bg-gray-50 p-8 text-center">
      <div className="inline-block h-10 w-10 animate-spin rounded-full border-4 border-purple-600 border-t-transparent" />
      <p className="mt-4 font-medium text-gray-900">{message}</p>
      <p className="mt-1 text-sm text-gray-500">
        Step {Math.min(stepIndex + 1, STEPS.length)} of {STEPS.length}
      </p>
      {slowWarning && (
        <p className="mt-3 text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded px-3 py-2">
          Still working — complex statements can take up to a minute. Hang tight…
        </p>
      )}
    </div>
  );
}
