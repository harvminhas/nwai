"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseClient } from "@/lib/firebase";
import Sidebar from "@/components/Sidebar";
import UploadZone from "@/components/UploadZone";
import ProcessingAnimation from "@/components/ProcessingAnimation";
import { usePlan } from "@/contexts/PlanContext";
import ParseStatusBanner, { addPendingParse } from "@/components/ParseStatusBanner";

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

// ── queue types ───────────────────────────────────────────────────────────────

type FileStatus = "queued" | "uploading" | "processing" | "done" | "error";

interface QueueItem {
  id: string;          // local id for React key
  file: File;
  status: FileStatus;
  statementId?: string;
  error?: string;
}

// ── upload page ───────────────────────────────────────────────────────────────

export default function UploadPage() {
  const { can, setTestPlan } = usePlan();
  const canMulti = can("multiUpload");

  const [statementId, setStatementId] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [processingError, setProcessingError] = useState<string | null>(null);
  const [idToken, setIdToken] = useState<string | null>(null);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [showSignupGate, setShowSignupGate] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);

  // Multi-upload queue (Pro only)
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [queueRunning, setQueueRunning] = useState(false);

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

  // ── single file upload (free / anon) ─────────────────────────────────────

  const handleFileSelect = async (file: File) => {
    setUploadError(null);
    setProcessingError(null);
    const formData = new FormData();
    formData.append("file", file);

    const headers: HeadersInit = {};
    if (idToken) headers.Authorization = `Bearer ${idToken}`;

    try {
      const res = await fetch("/api/upload", { method: "POST", headers, body: formData });
      const data = await res.json();
      if (res.status === 409 && data.error === "duplicate") {
        if (isLoggedIn) { window.location.href = "/account/dashboard"; return; }
        setStatementId(data.existingStatementId as string);
        return;
      }
      if (!res.ok) { setUploadError(data.error || "Upload failed"); return; }
      if (!idToken && typeof sessionStorage !== "undefined") {
        sessionStorage.setItem(ANONYMOUS_UPLOAD_KEY, "1");
      }
      const sid = data.statementId as string;
      setStatementId(sid);
      // Persist for claim-on-signup — works even if user navigates away before signing up
      if (!idToken) {
        try { localStorage.setItem("nwai_claim_statement", sid); } catch { /* ignore */ }
      }
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

  // ── multi-file queue (Pro) ─────────────────────────────────────────────────

  const handleFilesSelect = (files: File[]) => {
    const items: QueueItem[] = files.map((file, i) => ({
      id: `${Date.now()}_${i}`,
      file,
      status: "queued",
    }));
    setQueue((prev) => [...prev, ...items]);
  };

  // Process the queue sequentially whenever it changes
  useEffect(() => {
    if (!idToken || queueRunning) return;
    const nextQueued = queue.find((q) => q.status === "queued");
    if (!nextQueued) return;

    setQueueRunning(true);

    const processItem = async (item: QueueItem) => {
      // Mark as uploading
      setQueue((prev) => prev.map((q) => q.id === item.id ? { ...q, status: "uploading" } : q));

      try {
        const formData = new FormData();
        formData.append("file", item.file);
        const res  = await fetch("/api/upload", {
          method: "POST",
          headers: { Authorization: `Bearer ${idToken}` },
          body: formData,
        });
        const data = await res.json();

        if (res.status === 409 && data.error === "duplicate") {
          setQueue((prev) => prev.map((q) =>
            q.id === item.id ? { ...q, status: "error", error: "Already uploaded (duplicate)" } : q
          ));
          return;
        }
        if (!res.ok) {
          setQueue((prev) => prev.map((q) =>
            q.id === item.id ? { ...q, status: "error", error: data.error || "Upload failed" } : q
          ));
          return;
        }

        const sid = data.statementId as string;
        setQueue((prev) => prev.map((q) =>
          q.id === item.id ? { ...q, status: "processing", statementId: sid } : q
        ));
        addPendingParse(sid, item.file.name);

        // Kick off parsing (fire and forget — QueueRow tracks status via onSnapshot)
        fetch("/api/parse", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ statementId: sid }),
        }).catch(() => {});
      } finally {
        setQueueRunning(false);
      }
    };

    processItem(nextQueued);
  }, [queue, idToken, queueRunning]);

  // "kicked off" = every item has progressed past the upload step (parse is in-flight or finished)
  const allKickedOff = queue.length > 0 && queue.every((q) => ["processing", "done", "error"].includes(q.status));
  const allDone      = queue.length > 0 && queue.every((q) => q.status === "done" || q.status === "error");
  const anyDone      = queue.some((q) => q.status === "done");
  const showQueue = queue.length > 0;


  // ── Logged-in layout ─────────────────────────────────────────────────────

  if (authChecked && isLoggedIn) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Sidebar />
        <div className="lg:pl-56">
          <div className="lg:hidden h-14" />
          <div className="mx-auto max-w-xl px-4 py-12 sm:px-6">

            {/* Page header */}
            <div className="mb-6 flex items-center justify-between">
              <div>
                <h1 className="font-bold text-xl text-gray-900">Upload statement</h1>
                <p className="mt-0.5 text-xs text-gray-400">PDF · Any major bank · Results in ~60 seconds</p>
              </div>
              <Link href="/account/statements" className="text-xs text-gray-400 hover:text-gray-600 transition">
                Manage uploads →
              </Link>
            </div>

            {/* Shows backfill age-bucket prompt when a new account is detected */}
            <ParseStatusBanner onRefresh={() => {}} />

            {/* Single file mode — shows ProcessingAnimation after upload */}
            {!canMulti && (
              <>
                {!statementId ? (
                  <>
                    <UploadZone onFileSelect={handleFileSelect} />
                    {uploadError && <p className="mt-3 text-sm text-red-600">{uploadError}</p>}

                    {/* Inline trust strip */}
                    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
                      {uploadTrustBadges.map((p) => (
                        <span key={p.label} className="flex items-center gap-1 text-xs text-gray-400">
                          <span aria-hidden="true">{p.icon}</span>
                          {p.label}
                        </span>
                      ))}
                    </div>

                    {/* Premium upsell banner */}
                    <div className="mt-5 rounded-xl bg-indigo-50 border border-indigo-100 px-4 py-4">
                      <div className="flex items-start gap-3">
                        <svg className="mt-0.5 shrink-0 text-indigo-400" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                        </svg>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-indigo-900">Upload all accounts at once with Premium</p>
                          <p className="mt-0.5 text-xs text-indigo-600">Drag in all your statements together — we sort them automatically by account type.</p>
                        </div>
                      </div>
                      <div className="mt-3">
                        <button
                          onClick={() => setTestPlan("pro")}
                          className="inline-flex items-center gap-1 rounded-lg border border-indigo-300 bg-white px-3 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-50 transition"
                        >
                          See premium upload
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M7 17L17 7M17 7H7M17 7v10" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  </>
                ) : processingError ? (
                  <div className="rounded-lg border border-red-200 bg-red-50 p-6">
                    <p className="text-red-800">{processingError}</p>
                    <button onClick={() => { setStatementId(null); setProcessingError(null); }}
                      className="mt-4 inline-block font-medium text-purple-600 hover:underline">Try again</button>
                  </div>
                ) : (
                  /* Logged-in: fire-and-forget — show success immediately, no waiting */
                  <div className="mt-2 rounded-xl border border-green-200 bg-green-50 p-6">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-green-100">
                        <svg className="h-5 w-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      </div>
                      <div>
                        <p className="font-semibold text-gray-900">Statement uploaded</p>
                        <p className="text-sm text-gray-500">AI analysis running in the background</p>
                      </div>
                    </div>
                    <p className="mt-3 text-sm text-gray-600">
                      This usually takes 30–60 seconds. Your dashboard will show the updated data as soon as it's ready — no need to wait here.
                    </p>
                    <div className="mt-5 flex flex-wrap gap-3">
                      <Link href="/account/dashboard"
                        className="rounded-lg bg-purple-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-purple-700 transition">
                        Go to dashboard →
                      </Link>
                      <button onClick={() => { setStatementId(null); setProcessingError(null); }}
                        className="rounded-lg border border-gray-300 px-5 py-2.5 text-sm font-semibold text-gray-600 hover:bg-gray-50 transition">
                        Upload another
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}

            {/* Multi-file mode (Pro) */}
            {canMulti && (
              <>
                <div className="mb-5 flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <h1 className="font-bold text-xl text-gray-900">Upload statements</h1>
                      <span className="rounded-full bg-indigo-100 px-2.5 py-0.5 text-xs font-semibold text-indigo-700">Premium</span>
                    </div>
                    <p className="mt-1 text-sm text-gray-400">Drop all your statements at once — we auto-detect the account type from the file.</p>
                  </div>
                  <Link href="/account/dashboard" className="text-sm text-gray-400 hover:text-gray-600 mt-0.5">✕</Link>
                </div>

                {!showQueue || !allDone ? (
                  <>
                    <UploadZone multiple onFilesSelect={handleFilesSelect} />
                    {uploadError && <p className="mt-3 text-sm text-red-600">{uploadError}</p>}
                  </>
                ) : null}

                {/* Queue list */}
                {showQueue && (
                  <div className="mt-6 space-y-2">
                    {queue.map((item) => (
                      <QueueRow
                        key={item.id}
                        item={item}
                        onDone={() => setQueue((prev) =>
                          prev.map((q) => q.id === item.id ? { ...q, status: "done" } : q)
                        )}
                      />
                    ))}
                  </div>
                )}

                {allKickedOff && (
                  <div className="mt-6 flex items-center justify-between rounded-xl border border-gray-200 bg-white px-5 py-4 shadow-sm">
                    <div>
                      <p className="text-sm font-medium text-gray-700">
                        {allDone && !anyDone
                          ? "All files had errors"
                          : allDone
                          ? "All done — dashboard is updated"
                          : "Analyzing in background…"}
                      </p>
                      {!allDone && (
                        <p className="mt-0.5 text-xs text-gray-400">You can go to your dashboard now — no need to wait.</p>
                      )}
                    </div>
                    <div className="flex gap-3">
                      <button
                        onClick={() => setQueue([])}
                        className="text-sm text-gray-400 hover:text-gray-600"
                      >
                        Upload more
                      </button>
                      <Link href="/account/dashboard"
                        className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-700 transition">
                        View dashboard →
                      </Link>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

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

// ── QueueRow — shows file name + status badge; tracks parse completion ────────

function QueueRow({
  item,
  onDone,
}: {
  item: QueueItem;
  onDone: () => void;
}) {
  const statusColor: Record<FileStatus, string> = {
    queued:     "bg-gray-100 text-gray-500",
    uploading:  "bg-blue-100 text-blue-600",
    processing: "bg-amber-100 text-amber-700",
    done:       "bg-green-100 text-green-600",
    error:      "bg-red-100 text-red-500",
  };
  const statusLabel: Record<FileStatus, string> = {
    queued:     "Queued",
    uploading:  "Uploading…",
    processing: "Analyzing…",
    done:       "✓ Done",
    error:      "Error",
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-gray-800">{item.file.name}</p>
          <p className="mt-0.5 text-xs text-gray-400">
            {(item.file.size / 1024 / 1024).toFixed(1)} MB
          </p>
          {item.status === "error" && item.error && (
            <p className="mt-1 text-xs text-red-500">{item.error}</p>
          )}
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${statusColor[item.status]}`}>
          {(item.status === "uploading" || item.status === "processing") ? (
            <span className="flex items-center gap-1">
              <span className="h-2.5 w-2.5 animate-spin rounded-full border-2 border-current border-t-transparent inline-block" />
              {statusLabel[item.status]}
            </span>
          ) : statusLabel[item.status]}
        </span>
      </div>

      {/* Compact ProcessingAnimation watches status in background; calls onDone when complete */}
      {item.status === "processing" && item.statementId && (
        <div className="mt-2">
          <ProcessingAnimation
            statementId={item.statementId}
            onComplete={onDone}
            onError={() => onDone()}
            compact
          />
        </div>
      )}
    </div>
  );
}
