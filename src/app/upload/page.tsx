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
  "Your current net worth",
  "Income breakdown (salary, side income)",
  "Expense categories (housing, food, shopping, etc.)",
  "Subscription detection (Netflix, Spotify, etc.)",
  "Savings rate calculation",
  "Smart insights to save more",
];

const uploadTrustPoints = [
  { icon: "🔒", label: "Encrypted over HTTPS" },
  { icon: "🔐", label: "File stored encrypted, private to you" },
  { icon: "🚫", label: "No bank login needed" },
  { icon: "🔕", label: "Data never sold" },
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
              <h1 className="font-bold text-xl text-gray-900">Upload statement</h1>
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
                      {uploadTrustPoints.map((p) => (
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
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6 lg:px-8">
        <h1 className="font-bold text-3xl text-gray-900 md:text-4xl">Upload your statement</h1>
        <p className="mt-2 text-base text-gray-600">We'll analyze it in seconds. No bank login required.</p>

        {!statementId ? (
          <>
            {authChecked && showSignupGate ? (
              <div className="mt-8 rounded-lg border-2 border-purple-200 bg-purple-50/50 p-6">
                <p className="font-semibold text-gray-900">You've already uploaded a statement.</p>
                <p className="mt-1 text-sm text-gray-600">
                  Create a free account to upload another statement and save your financial profile.
                </p>
                <div className="mt-4 flex flex-wrap gap-3">
                  <Link href="/signup"
                    className="rounded-lg bg-gradient-to-r from-purple-600 to-purple-700 px-6 py-3 font-semibold text-white transition hover:from-purple-700 hover:to-purple-800">
                    Create free account
                  </Link>
                  <Link href="/login"
                    className="rounded-lg border-2 border-purple-600 px-6 py-3 font-semibold text-purple-600 transition hover:bg-purple-50">
                    Log in
                  </Link>
                </div>
              </div>
            ) : (
              <>
                <div className="mt-8">
                  <UploadZone onFileSelect={handleFileSelect} />
                </div>
                {uploadError && <p className="mt-4 text-sm text-red-600">{uploadError}</p>}

                {/* Inline trust strip */}
                <div className="mt-4 flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
                  {uploadTrustPoints.map((p) => (
                    <span key={p.label} className="flex items-center gap-1.5 text-xs text-gray-400">
                      <span aria-hidden="true">{p.icon}</span>
                      {p.label}
                    </span>
                  ))}
                </div>

                {/* What happens to your file */}
                <div className="mt-5 rounded-xl border border-gray-200 bg-white px-5 py-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-3">What happens when you upload</p>
                  <ol className="space-y-2">
                    {[
                      "Your PDF is sent securely over HTTPS to our servers",
                      "AI reads and categorises every transaction (takes ~30 sec)",
                      "The file is stored encrypted in Google Cloud, private to your account",
                      "Your data is never shared with other users or third parties",
                    ].map((step, i) => (
                      <li key={i} className="flex items-start gap-2.5 text-sm text-gray-600">
                        <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-purple-100 text-[10px] font-bold text-purple-600">
                          {i + 1}
                        </span>
                        {step}
                      </li>
                    ))}
                  </ol>
                </div>
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
        ) : processingError ? (
          <div className="mt-8 rounded-lg border border-red-200 bg-red-50 p-6">
            <p className="text-red-800">{processingError}</p>
            <Link href="/upload" className="mt-4 inline-block font-medium text-purple-600 hover:underline">Try again</Link>
          </div>
        ) : (
          <ProcessingAnimation statementId={statementId} onError={setProcessingError} />
        )}

        <p className="mt-8 text-center text-sm text-gray-500">
          <Link href="/" className="text-purple-600 hover:underline">Back to home</Link>
        </p>
      </div>
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
