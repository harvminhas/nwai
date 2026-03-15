"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseClient } from "@/lib/firebase";

const STEPS = [
  { label: "Reading your statement…", duration: 2000 },
  { label: "Identifying account & balances…", duration: 3000 },
  { label: "Analysing activity…", duration: 2000 },
  { label: "Generating insights…", duration: 2000 },
  { label: "Complete!", duration: 800 },
];

const POLL_INTERVAL = 1500;
const POLL_TIMEOUT = 35000;

export type ProcessingAnimationProps = {
  statementId: string;
  onError?: (message: string) => void;
};

export default function ProcessingAnimation({
  statementId,
  onError,
}: ProcessingAnimationProps) {
  const router = useRouter();
  const [stepIndex, setStepIndex] = useState(0);
  const [message, setMessage] = useState("Starting…");
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [done, setDone] = useState(false);
  const [timedOut, setTimedOut] = useState(false);

  // Detect auth state
  useEffect(() => {
    const { auth } = getFirebaseClient();
    return onAuthStateChanged(auth, (user) => setIsLoggedIn(!!user));
  }, []);

  useEffect(() => {
    let stepTimer: ReturnType<typeof setTimeout>;
    let pollTimer: ReturnType<typeof setInterval>;
    let timeoutId: ReturnType<typeof setTimeout>;

    const poll = async () => {
      try {
        const res = await fetch(`/api/statement/${statementId}`);
        const data = await res.json();
        if (data.status === "completed") {
          setMessage("Complete!");
          clearInterval(pollTimer);
          clearTimeout(timeoutId);
          setTimeout(() => {
            if (isLoggedIn) {
              router.push("/account/dashboard");
            } else {
              setDone(true);
            }
          }, 600);
          return;
        }
        if (data.status === "error") {
          clearInterval(pollTimer);
          clearTimeout(timeoutId);
          onError?.(data.errorMessage || "Something went wrong.");
          return;
        }
      } catch {
        // keep polling
      }
    };

    pollTimer = setInterval(poll, POLL_INTERVAL);
    timeoutId = setTimeout(() => {
      clearInterval(pollTimer);
      setTimedOut(true);
    }, POLL_TIMEOUT);

    let elapsed = 0;
    STEPS.forEach((step, i) => {
      stepTimer = setTimeout(() => {
        setStepIndex(i);
        setMessage(step.label);
      }, elapsed);
      elapsed += step.duration;
    });

    return () => {
      clearTimeout(stepTimer);
      clearInterval(pollTimer);
      clearTimeout(timeoutId);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statementId, router, onError, isLoggedIn]);

  if (timedOut) {
    return (
      <div className="mt-8 rounded-lg border border-red-200 bg-red-50 p-6">
        <p className="font-semibold text-red-800">Processing is taking too long.</p>
        <p className="mt-1 text-sm text-gray-600">
          This usually means the AI API key is missing or invalid. Check your environment variables and try again.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link
            href="/upload"
            className="rounded-lg bg-red-600 px-5 py-2.5 font-semibold text-white transition hover:bg-red-700"
          >
            Try again
          </Link>
          {isLoggedIn && (
            <Link
              href="/account/dashboard"
              className="rounded-lg border-2 border-gray-300 px-5 py-2.5 font-semibold text-gray-700 transition hover:bg-gray-50"
            >
              Back to dashboard
            </Link>
          )}
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div className="mt-8 rounded-lg border border-green-200 bg-green-50 p-6">
        <div className="flex items-center gap-2">
          <span className="text-green-600 text-xl">✓</span>
          <p className="font-semibold text-gray-900">Your statement is ready!</p>
        </div>
        <p className="mt-2 text-sm text-gray-600">
          Create a free account to save your data and track progress over time, or view this statement now.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link
            href="/account/signup"
            className="rounded-lg bg-gradient-to-r from-purple-600 to-purple-700 px-5 py-2.5 font-semibold text-white transition hover:from-purple-700 hover:to-purple-800"
          >
            Create free account
          </Link>
          <Link
            href={`/dashboard/${statementId}`}
            className="rounded-lg border-2 border-purple-600 px-5 py-2.5 font-semibold text-purple-600 transition hover:bg-purple-50"
          >
            View statement
          </Link>
        </div>
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
    </div>
  );
}
