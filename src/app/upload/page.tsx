"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseClient } from "@/lib/firebase";
import Sidebar from "@/components/Sidebar";
import UploadZone from "@/components/UploadZone";
import ProcessingAnimation from "@/components/ProcessingAnimation";

const checklist = [
  "Your current net worth",
  "Income breakdown (salary, side income)",
  "Expense categories (housing, food, shopping, etc.)",
  "Subscription detection (Netflix, Spotify, etc.)",
  "Savings rate calculation",
  "Smart insights to save more",
];

const ANONYMOUS_UPLOAD_KEY = "nwai_anonymous_uploaded";

export default function UploadPage() {
  const [statementId, setStatementId] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [processingError, setProcessingError] = useState<string | null>(null);
  const [idToken, setIdToken] = useState<string | null>(null);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [showSignupGate, setShowSignupGate] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    const { auth } = getFirebaseClient();
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        const token = await user.getIdToken();
        setIdToken(token);
        setIsLoggedIn(true);
        setShowSignupGate(false);
      } else {
        setIdToken(null);
        setIsLoggedIn(false);
        if (typeof window !== "undefined" && sessionStorage.getItem(ANONYMOUS_UPLOAD_KEY) === "1") {
          setShowSignupGate(true);
        }
      }
      setAuthChecked(true);
    });
    return () => unsubscribe();
  }, []);

  const handleFileSelect = async (file: File) => {
    setUploadError(null);
    setProcessingError(null);
    const formData = new FormData();
    formData.append("file", file);

    const headers: HeadersInit = {};
    if (idToken) headers.Authorization = `Bearer ${idToken}`;

    try {
      const res = await fetch("/api/upload", {
        method: "POST",
        headers,
        body: formData,
      });
      const data = await res.json();
      if (res.status === 409 && data.error === "duplicate") {
        // Already uploaded — navigate to existing result
        if (isLoggedIn) {
          window.location.href = "/account/dashboard";
        } else {
          setStatementId(data.existingStatementId as string);
        }
        return;
      }
      if (!res.ok) {
        setUploadError(data.error || "Upload failed");
        return;
      }
      if (!idToken && typeof sessionStorage !== "undefined") {
        sessionStorage.setItem(ANONYMOUS_UPLOAD_KEY, "1");
      }
      const sid = data.statementId as string;
      setStatementId(sid);

      // Trigger parse from the client so it runs as its own request
      // (server-side fire-and-forget is killed by Vercel when the upload response returns)
      fetch("/api/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ statementId: sid }),
      }).catch(() => {});
    } catch {
      setUploadError("Upload failed. Please try again.");
    }
  };

  // ── Logged-in layout ────────────────────────────────────────────────────────
  if (authChecked && isLoggedIn) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Sidebar />
        <div className="lg:pl-56">
          <div className="lg:hidden h-14" />
          <div className="mx-auto max-w-xl px-4 py-12 sm:px-6">
          {!statementId ? (
            <>
              <div className="mb-6 flex items-center justify-between">
                <h1 className="font-bold text-2xl text-gray-900">Upload statement</h1>
                <Link
                  href="/account/dashboard"
                  className="text-sm text-gray-500 hover:text-gray-700"
                >
                  ✕ Cancel
                </Link>
              </div>

              <UploadZone onFileSelect={handleFileSelect} />

              {uploadError && (
                <p className="mt-3 text-sm text-red-600" role="alert">
                  {uploadError}
                </p>
              )}

              <p className="mt-4 text-xs text-gray-400 text-center">
                PDF, CSV, PNG or JPG — max 10MB
              </p>
            </>
          ) : (
            <>
              {processingError ? (
                <div className="rounded-lg border border-red-200 bg-red-50 p-6">
                  <p className="text-red-800">{processingError}</p>
                  <button
                    onClick={() => { setStatementId(null); setProcessingError(null); }}
                    className="mt-4 inline-block font-medium text-purple-600 hover:underline"
                  >
                    Try again
                  </button>
                </div>
              ) : (
                <ProcessingAnimation
                  statementId={statementId}
                  onError={setProcessingError}
                />
              )}
            </>
          )}
          </div>
        </div>
      </div>
    );
  }

  // ── Anonymous / public layout ───────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6 lg:px-8">
        <h1 className="font-bold text-3xl text-gray-900 md:text-4xl">
          Upload your statement
        </h1>
        <p className="mt-2 text-base text-gray-600">
          We'll analyze it in seconds. No bank login required.
        </p>

        {!statementId ? (
          <>
            {authChecked && showSignupGate ? (
              <div className="mt-8 rounded-lg border-2 border-purple-200 bg-purple-50/50 p-6">
                <p className="font-semibold text-gray-900">
                  You've already uploaded a statement.
                </p>
                <p className="mt-1 text-sm text-gray-600">
                  Create a free account to upload another statement and save your financial profile.
                </p>
                <div className="mt-4 flex flex-wrap gap-3">
                  <Link
                    href="/account/signup"
                    className="rounded-lg bg-gradient-to-r from-purple-600 to-purple-700 px-6 py-3 font-semibold text-white transition hover:from-purple-700 hover:to-purple-800"
                  >
                    Create free account
                  </Link>
                  <Link
                    href="/account/login"
                    className="rounded-lg border-2 border-purple-600 px-6 py-3 font-semibold text-purple-600 transition hover:bg-purple-50"
                  >
                    Log in
                  </Link>
                </div>
              </div>
            ) : (
              <>
                <div className="mt-8">
                  <UploadZone onFileSelect={handleFileSelect} />
                </div>
                {uploadError && (
                  <p className="mt-4 text-sm text-red-600" role="alert">
                    {uploadError}
                  </p>
                )}
              </>
            )}

            <div className="mt-10 rounded-lg border border-gray-200 bg-white p-6">
              <h2 className="font-semibold text-lg text-gray-900">What you'll get</h2>
              <ul className="mt-4 space-y-2">
                {checklist.map((item) => (
                  <li key={item} className="flex items-center gap-2 text-gray-700">
                    <span className="text-green-600">✓</span> {item}
                  </li>
                ))}
              </ul>
            </div>
          </>
        ) : (
          <>
            {processingError ? (
              <div className="mt-8 rounded-lg border border-red-200 bg-red-50 p-6">
                <p className="text-red-800">{processingError}</p>
                <Link
                  href="/upload"
                  className="mt-4 inline-block font-medium text-purple-600 hover:underline"
                >
                  Try again
                </Link>
              </div>
            ) : (
              <ProcessingAnimation
                statementId={statementId}
                onError={setProcessingError}
              />
            )}
          </>
        )}

        <p className="mt-8 text-center text-sm text-gray-500">
          <Link href="/" className="text-purple-600 hover:underline">
            Back to home
          </Link>
        </p>
      </div>
    </div>
  );
}
