"use client";

/**
 * /promo/[code]  — Campaign landing page
 *
 * Flow:
 *   Logged-in user → shows "Redeem now" button → calls API → success state
 *   Anonymous user → stores code in localStorage → CTA links to /signup?promo=CODE
 *                    (PromoClaimBanner on the dashboard auto-redeems after login)
 */

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseClient } from "@/lib/firebase";

const PROMO_STORAGE_KEY = "nwai_pending_promo";

type CodeStatus = "loading" | "valid" | "invalid" | "redeemed" | "already_active";

interface CodeInfo {
  durationDays: number;
  description: string;
}

function durationLabel(days: number): string {
  if (days % 365 === 0) return `${days / 365} year${days / 365 > 1 ? "s" : ""}`;
  if (days % 30 === 0)  return `${days / 30} month${days / 30 > 1 ? "s" : ""}`;
  return `${days} days`;
}

const proFeatures = [
  "Unlimited statement uploads",
  "Full financial history (no 6-month cap)",
  "AI-powered insights & alerts",
  "Spending forecast",
  "Goals tracker",
  "Debt payoff planner",
  "What-if scenario planner",
  "Market & inflation signals",
  "CSV data export",
];

export default function PromoPage() {
  const params   = useParams();
  const rawCode  = (Array.isArray(params.code) ? params.code[0] : params.code) ?? "";
  const code     = rawCode.toUpperCase().trim();

  const [codeStatus, setCodeStatus]   = useState<CodeStatus>("loading");
  const [codeInfo,   setCodeInfo]     = useState<CodeInfo | null>(null);
  const [error,      setError]        = useState<string | null>(null);
  const [redeeming,  setRedeeming]    = useState(false);
  const [isLoggedIn, setIsLoggedIn]   = useState(false);
  const [idToken,    setIdToken]      = useState<string | null>(null);
  const [authReady,  setAuthReady]    = useState(false);

  // Validate code on mount
  useEffect(() => {
    if (!code) { setCodeStatus("invalid"); return; }

    fetch(`/api/user/redeem-promo?code=${encodeURIComponent(code)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.valid) {
          setCodeStatus("valid");
          setCodeInfo({ durationDays: data.durationDays, description: data.description });
          // Store in localStorage so PromoClaimBanner can auto-redeem after signup/login
          try { localStorage.setItem(PROMO_STORAGE_KEY, code); } catch { /* ignore */ }
        } else {
          setCodeStatus("invalid");
          setError(data.error ?? "Invalid promo code.");
        }
      })
      .catch(() => { setCodeStatus("invalid"); setError("Could not validate code. Please try again."); });
  }, [code]);

  // Auth state
  useEffect(() => {
    const { auth } = getFirebaseClient();
    return onAuthStateChanged(auth, async (user) => {
      setIsLoggedIn(!!user);
      setIdToken(user ? await user.getIdToken() : null);
      setAuthReady(true);
    });
  }, []);

  async function handleRedeem() {
    if (!idToken) return;
    setRedeeming(true);
    setError(null);
    try {
      const res  = await fetch("/api/user/redeem-promo", {
        method: "POST",
        headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.error?.includes("already have an active promo")) {
          setCodeStatus("already_active");
        } else {
          setError(data.error ?? "Redemption failed.");
        }
        return;
      }
      // Clear pending promo from storage — it's been redeemed
      try { localStorage.removeItem(PROMO_STORAGE_KEY); } catch { /* ignore */ }
      setCodeStatus("redeemed");
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setRedeeming(false);
    }
  }

  const duration = codeInfo ? durationLabel(codeInfo.durationDays) : "";

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <header className="border-b border-gray-100 bg-white px-4 py-4 sm:px-6">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <Link href="/" className="text-lg font-extrabold tracking-tight text-purple-600">
            networth.online
          </Link>
          <div className="flex items-center gap-4 text-sm text-gray-400">
            <Link href="/login" className="hover:text-gray-600 transition">Log in</Link>
            <Link href="/signup" className="rounded-lg bg-purple-600 px-4 py-1.5 font-semibold text-white text-xs hover:bg-purple-700 transition">
              Sign up free
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-12 sm:px-6 lg:px-8">

        {/* Loading */}
        {codeStatus === "loading" && (
          <div className="flex justify-center py-24">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-purple-600 border-t-transparent" />
          </div>
        )}

        {/* Invalid code */}
        {codeStatus === "invalid" && (
          <div className="mx-auto max-w-md text-center py-20">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-red-100 mx-auto">
              <svg className="h-8 w-8 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <h1 className="mt-4 text-xl font-bold text-gray-900">Code not found</h1>
            <p className="mt-2 text-sm text-gray-500">{error ?? "This promo code is invalid or has expired."}</p>
            <Link href="/" className="mt-6 inline-block rounded-xl bg-purple-600 px-6 py-3 text-sm font-semibold text-white hover:bg-purple-700 transition">
              Go to networth.online →
            </Link>
          </div>
        )}

        {/* Already active */}
        {codeStatus === "already_active" && (
          <div className="mx-auto max-w-md text-center py-20">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-blue-100 mx-auto">
              <svg className="h-8 w-8 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h1 className="mt-4 text-xl font-bold text-gray-900">You already have Pro access</h1>
            <p className="mt-2 text-sm text-gray-500">An active promo is already applied to your account. Head to your dashboard to keep exploring.</p>
            <Link href="/account/dashboard" className="mt-6 inline-block rounded-xl bg-purple-600 px-6 py-3 text-sm font-semibold text-white hover:bg-purple-700 transition">
              Go to dashboard →
            </Link>
          </div>
        )}

        {/* Redeemed! */}
        {codeStatus === "redeemed" && (
          <div className="mx-auto max-w-md text-center py-20">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-100 mx-auto">
              <svg className="h-8 w-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h1 className="mt-4 text-2xl font-extrabold text-gray-900">You&apos;re on Pro!</h1>
            <p className="mt-2 text-sm text-gray-500">
              {duration} of Pro access has been added to your account. Enjoy every feature — no credit card required.
            </p>
            <Link href="/account/dashboard" className="mt-6 inline-block rounded-xl bg-purple-600 px-6 py-3 text-sm font-semibold text-white hover:bg-purple-700 transition shadow-md">
              Go to your dashboard →
            </Link>
          </div>
        )}

        {/* Valid code — main offer */}
        {(codeStatus === "valid") && (
          <div className="grid gap-10 lg:grid-cols-[1fr_360px]">

            {/* Left: offer */}
            <div>
              {/* Campaign badge */}
              <div className="inline-flex items-center gap-2 rounded-full border border-purple-200 bg-purple-50 px-3 py-1 text-xs font-semibold text-purple-700 mb-4">
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                </svg>
                Promo code: {code}
              </div>

              <h1 className="text-3xl font-extrabold text-gray-900 sm:text-4xl leading-tight">
                {duration} of Pro — free.
              </h1>
              <p className="mt-3 text-base text-gray-500">
                Get full access to every feature with no credit card required. 
                Know exactly where your money goes, catch forgotten subscriptions, 
                and plan your financial future.
              </p>

              {/* Features */}
              <ul className="mt-6 space-y-2.5">
                {proFeatures.map((f) => (
                  <li key={f} className="flex items-center gap-3 text-sm text-gray-700">
                    <svg className="h-4 w-4 shrink-0 text-purple-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                    {f}
                  </li>
                ))}
              </ul>

              {/* Trust micro-row */}
              <div className="mt-8 flex flex-wrap gap-3">
                {["🔒 Encrypted", "🚫 No bank login", "🛡️ Data never sold", "☁️ Google Cloud"].map((b) => (
                  <span key={b} className="inline-flex items-center rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs text-gray-500">
                    {b}
                  </span>
                ))}
              </div>
            </div>

            {/* Right: redemption card */}
            <div className="lg:sticky lg:top-8 self-start">
              <div className="rounded-2xl border-2 border-purple-200 bg-white p-8 shadow-lg">
                <div className="text-center">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-purple-600 px-4 py-1 text-xs font-bold text-white">
                    Pro · {duration} free
                  </span>
                  <p className="mt-4 text-4xl font-extrabold text-gray-900">$0</p>
                  <p className="text-sm text-gray-400">for {duration}, then $9.99/mo or cancel</p>
                </div>

                <div className="mt-6 space-y-3">
                  {error && (
                    <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>
                  )}

                  {!authReady ? (
                    <div className="flex justify-center py-4">
                      <div className="h-5 w-5 animate-spin rounded-full border-2 border-purple-600 border-t-transparent" />
                    </div>
                  ) : isLoggedIn ? (
                    /* Logged in → redeem immediately */
                    <button
                      onClick={handleRedeem}
                      disabled={redeeming}
                      className="w-full rounded-xl bg-purple-600 px-4 py-3.5 font-semibold text-white shadow-md hover:bg-purple-700 transition disabled:opacity-60"
                    >
                      {redeeming ? "Activating…" : `Claim ${duration} of Pro free →`}
                    </button>
                  ) : (
                    /* Not logged in → sign up first */
                    <>
                      <Link
                        href={`/signup?promo=${encodeURIComponent(code)}`}
                        className="block w-full rounded-xl bg-purple-600 px-4 py-3.5 text-center font-semibold text-white shadow-md hover:bg-purple-700 transition"
                      >
                        Create free account & claim →
                      </Link>
                      <p className="text-center text-xs text-gray-400">Already have an account?{" "}
                        <Link href={`/login?promo=${encodeURIComponent(code)}`} className="text-purple-600 hover:underline font-medium">
                          Log in
                        </Link>
                      </p>
                    </>
                  )}
                </div>

                <div className="mt-5 border-t border-gray-100 pt-4 space-y-1.5">
                  {[
                    "No credit card required",
                    "Cancel any time after promo ends",
                    "All Pro features unlocked immediately",
                  ].map((line) => (
                    <p key={line} className="flex items-center gap-1.5 text-xs text-gray-500">
                      <svg className="h-3.5 w-3.5 text-green-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                      {line}
                    </p>
                  ))}
                </div>
              </div>

              {/* Promo ends note */}
              <p className="mt-3 text-center text-xs text-gray-400">
                Code: <span className="font-mono font-semibold text-gray-600">{code}</span>
                {" · "}Limited availability
              </p>
            </div>

          </div>
        )}

      </main>

      <footer className="mt-16 border-t border-gray-100 bg-gray-50 px-4 py-6 text-center text-xs text-gray-400">
        <p>
          <span className="font-semibold text-purple-600">networth.online</span>
          &nbsp;· No bank login · No credentials ·{" "}
          <Link href="/privacy" className="hover:underline">Privacy</Link>
          {" "}·{" "}
          <Link href="/terms" className="hover:underline">Terms</Link>
        </p>
      </footer>
    </div>
  );
}
