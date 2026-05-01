"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseClient } from "@/lib/firebase";
import UploadZone from "@/components/UploadZone";
import ProcessingAnimation from "@/components/ProcessingAnimation";
import { usePlan } from "@/contexts/PlanContext";
import { addPendingParse } from "@/components/ParseStatusBanner";

const checklist = [
  { icon: "💰", label: "Net worth snapshot (assets − liabilities)" },
  { icon: "📊", label: "Spending breakdown by category" },
  { icon: "💼", label: "Income sources identified" },
  { icon: "🔁", label: "Subscriptions & recurring charges detected" },
  { icon: "📈", label: "Savings rate calculated" },
  { icon: "🧠", label: "AI insights to save more" },
];

const uploadTrustBadges = [
  { icon: "🔒", label: "SSL Encrypted" },
  { icon: "☁️", label: "Google Cloud" },
  { icon: "🚫", label: "No bank login" },
  { icon: "🛡️", label: "Data never sold" },
];

const whatHappensSteps = [
  {
    title: "Sent securely",
    body: "Your PDF travels over HTTPS — the same encryption your bank uses.",
  },
  {
    title: "AI reads every transaction",
    body: "Our AI categorises each line item and detects patterns. Takes about 30–60 seconds.",
  },
  {
    title: "Stored encrypted",
    body: "The file is saved in Google Cloud, encrypted at rest, and private to your account only.",
  },
  {
    title: "Never shared or sold",
    body: "Your financial data is never shared with advertisers, data brokers, or third parties.",
  },
];

const miniTestimonials = [
  { quote: "Found $340/mo in forgotten subscriptions on my first upload.", name: "Priya S.", location: "Toronto" },
  { quote: "Finally a finance app that doesn't need my banking password.", name: "Marcus T.", location: "Seattle" },
];

const ANONYMOUS_UPLOAD_KEY = "nwai_anonymous_uploaded";


// ── upload page ───────────────────────────────────────────────────────────────

export default function UploadPage() {
  usePlan(); // plan context available for future gates

  const router = useRouter();
  const [statementId, setStatementId] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [processingError, setProcessingError] = useState<string | null>(null);
  const [showSignupGate, setShowSignupGate] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    const { auth } = getFirebaseClient();
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        // Logged-in users go straight to the statements page (which has the inline dropzone)
        router.replace("/account/statements");
        return;
      }
      if (typeof window !== "undefined" && sessionStorage.getItem(ANONYMOUS_UPLOAD_KEY) === "1") {
        setShowSignupGate(true);
      }
      setAuthChecked(true);
    });
    return () => unsubscribe();
  }, [router]);

  // ── anonymous file upload ─────────────────────────────────────────────────

  const handleFileSelect = async (file: File) => {
    setUploadError(null);
    setProcessingError(null);
    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      const data = await res.json();
      if (res.status === 409 && data.error === "duplicate") {
        setStatementId(data.existingStatementId as string);
        return;
      }
      if (!res.ok) { setUploadError(data.error || "Upload failed"); return; }
      if (typeof sessionStorage !== "undefined") {
        sessionStorage.setItem(ANONYMOUS_UPLOAD_KEY, "1");
      }
      const sid = data.statementId as string;
      setStatementId(sid);
      try { localStorage.setItem("nwai_claim_statement", sid); } catch { /* ignore */ }
      addPendingParse(sid, file.name);
      fetch("/api/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ statementId: sid }),
      }).catch(() => {});
    } catch {
      setUploadError("Upload failed. Please try again.");
    }
  };

  // ── Anonymous / public layout ─────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-white">

      {/* Minimal header */}
      <header className="border-b border-gray-100 bg-white px-4 py-4 sm:px-6">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <Link href="/" className="text-lg font-extrabold tracking-tight text-purple-600">
            networth.online
          </Link>
          <Link href="/" className="text-sm text-gray-400 hover:text-gray-600 transition">
            ← Back to home
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">

        {/* Processing / error state — full-width */}
        {statementId && !processingError && (
          <div className="max-w-xl mx-auto">
            <ProcessingAnimation statementId={statementId} onError={setProcessingError} />
            <p className="mt-6 text-center text-sm text-gray-500">
              <Link href="/" className="text-purple-600 hover:underline">Back to home</Link>
            </p>
          </div>
        )}

        {statementId && processingError && (
          <div className="max-w-xl mx-auto mt-8 rounded-lg border border-red-200 bg-red-50 p-6">
            <p className="text-red-800">{processingError}</p>
            <Link href="/upload" className="mt-4 inline-block font-medium text-purple-600 hover:underline">Try again</Link>
          </div>
        )}

        {/* Main upload UI */}
        {!statementId && (
          <div className="grid gap-10 lg:grid-cols-[1fr_380px]">

            {/* ── Left column: upload zone + trust ── */}
            <div>
              <h1 className="text-3xl font-extrabold text-gray-900 sm:text-4xl leading-tight">
                Your financial picture<br className="hidden sm:block" /> in under 60 seconds
              </h1>
              <p className="mt-3 text-base text-gray-500">
                Drop a PDF bank statement. No bank login. No credentials. Just your statement file.
              </p>

              {/* Supported banks */}
              <p className="mt-2 text-xs text-gray-400">
                Works with: TD · RBC · CIBC · Scotiabank · BMO · Chase · Wells Fargo · Bank of America · Citi · Capital One · and more
              </p>

              {authChecked && showSignupGate ? (
                /* Already uploaded — prompt to sign up */
                <div className="mt-8 rounded-2xl border-2 border-purple-200 bg-purple-50/50 p-8">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-purple-100">
                    <svg className="h-6 w-6 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <p className="mt-4 font-semibold text-gray-900 text-lg">You've already uploaded a statement.</p>
                  <p className="mt-2 text-sm text-gray-600">
                    Create a free account to save your results, upload more statements, and track your finances over time.
                  </p>
                  <div className="mt-6 flex flex-wrap gap-3">
                    <Link href="/signup"
                      className="rounded-xl bg-purple-600 px-6 py-3 font-semibold text-white shadow-sm transition hover:bg-purple-700">
                      Create free account
                    </Link>
                    <Link href="/login"
                      className="rounded-xl border-2 border-purple-200 px-6 py-3 font-semibold text-purple-700 transition hover:bg-purple-50">
                      Log in
                    </Link>
                  </div>
                </div>
              ) : (
                /* Upload zone */
                <div className="mt-6">
                  <UploadZone onFileSelect={handleFileSelect} />
                  {uploadError && (
                    <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
                      {uploadError}
                    </p>
                  )}

                  {/* Security badge row */}
                  <div className="mt-4 flex flex-wrap gap-2">
                    {uploadTrustBadges.map((b) => (
                      <span
                        key={b.label}
                        className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs font-medium text-gray-500"
                      >
                        <span aria-hidden="true">{b.icon}</span>
                        {b.label}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* What happens step-by-step */}
              <div className="mt-8 rounded-2xl border border-gray-100 bg-gray-50 p-6">
                <h2 className="text-sm font-bold uppercase tracking-widest text-gray-400 mb-5">
                  What happens to your file
                </h2>
                <ol className="space-y-4">
                  {whatHappensSteps.map((step, i) => (
                    <li key={i} className="flex items-start gap-4">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-purple-100 text-xs font-bold text-purple-600 mt-0.5">
                        {i + 1}
                      </span>
                      <div>
                        <p className="text-sm font-semibold text-gray-800">{step.title}</p>
                        <p className="mt-0.5 text-sm text-gray-500">{step.body}</p>
                      </div>
                    </li>
                  ))}
                </ol>

                {/* Comparison callout */}
                <div className="mt-5 border-t border-gray-200 pt-4">
                  <p className="text-xs text-gray-500">
                    <span className="font-semibold text-gray-700">Unlike Mint or Credit Karma</span> — we never ask for your
                    banking username or password. A PDF is all we need, and you stay in control.
                  </p>
                </div>
              </div>

              {/* Mini testimonials */}
              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                {miniTestimonials.map((t) => (
                  <figure key={t.name} className="rounded-xl border border-gray-100 bg-white p-4">
                    <blockquote>
                      <p className="text-sm text-gray-600 leading-relaxed">&ldquo;{t.quote}&rdquo;</p>
                    </blockquote>
                    <figcaption className="mt-2 text-xs text-gray-400">
                      — {t.name}, {t.location}
                    </figcaption>
                  </figure>
                ))}
              </div>
            </div>

            {/* ── Right column: what you'll get ── */}
            <div className="space-y-5">

              {/* What you'll discover */}
              <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
                <h2 className="font-bold text-gray-900">What you&apos;ll discover</h2>
                <p className="mt-1 text-xs text-gray-400">From a single month's statement</p>
                <ul className="mt-4 space-y-3">
                  {checklist.map((item) => (
                    <li key={item.label} className="flex items-center gap-3">
                      <span className="text-lg leading-none" aria-hidden="true">{item.icon}</span>
                      <span className="text-sm text-gray-700">{item.label}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-5 border-t border-gray-100 pt-4">
                  <p className="text-xs text-gray-400">
                    Upload more months to unlock <span className="font-semibold text-gray-600">trend analysis</span>, spending forecasts, and AI-powered planning tools.
                  </p>
                </div>
              </div>

              {/* Privacy promise card */}
              <div className="rounded-2xl border border-green-100 bg-green-50 p-6">
                <div className="flex items-center gap-2 mb-3">
                  <svg className="h-5 w-5 text-green-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                  </svg>
                  <h3 className="font-bold text-green-900 text-sm">Our privacy promise</h3>
                </div>
                <ul className="space-y-2">
                  {[
                    "Your banking login is never requested or stored",
                    "Your file is encrypted and private to your account",
                    "We don't sell or share your financial data",
                    "No ads. No data brokers. Revenue comes from subscriptions only.",
                  ].map((item) => (
                    <li key={item} className="flex items-start gap-2 text-sm text-green-800">
                      <svg className="mt-0.5 h-4 w-4 shrink-0 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                      {item}
                    </li>
                  ))}
                </ul>
                <div className="mt-4 border-t border-green-200 pt-3">
                  <Link href="/privacy" className="text-xs text-green-700 hover:underline">
                    Read our full Privacy Policy →
                  </Link>
                </div>
              </div>

              {/* How to get your PDF */}
              <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
                <h3 className="font-bold text-gray-900 text-sm">How to get your statement PDF</h3>
                <ol className="mt-3 space-y-2">
                  {[
                    "Log in to your bank's website (not this app)",
                    "Go to Statements or Account History",
                    "Download last month as a PDF",
                    "Drop it above — we handle the rest",
                  ].map((step, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-gray-600">
                      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gray-100 text-[10px] font-bold text-gray-500">
                        {i + 1}
                      </span>
                      {step}
                    </li>
                  ))}
                </ol>
              </div>

              {/* Pricing nudge */}
              <div className="rounded-2xl border border-purple-100 bg-purple-50 p-5 text-center">
                <p className="text-sm text-purple-900 font-semibold">Free to start</p>
                <p className="mt-1 text-xs text-purple-700">
                  Upload your first statement at no cost.<br />
                  Pro plan unlocks unlimited history & AI insights for $9.99/mo.
                </p>
                <div className="mt-3 flex justify-center gap-2 text-xs">
                  <Link href="/login" className="text-purple-700 hover:underline font-medium">Log in</Link>
                  <span className="text-purple-300">·</span>
                  <Link href="/signup" className="text-purple-700 hover:underline font-medium">Create account</Link>
                </div>
              </div>

            </div>
          </div>
        )}

      </main>

      {/* Minimal footer */}
      <footer className="mt-12 border-t border-gray-100 bg-gray-50 px-4 py-6 text-center text-xs text-gray-400">
        <p>
          <span className="font-semibold text-purple-600">networth.online</span>
          &nbsp;· No bank login · No credentials · No ads ·{" "}
          <Link href="/privacy" className="hover:underline">Privacy Policy</Link>
          {" "}·{" "}
          <Link href="/terms" className="hover:underline">Terms</Link>
        </p>
      </footer>
    </div>
  );
}

