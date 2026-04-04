"use client";

import { useState, useEffect, useRef } from "react";

interface Props {
  token: string;
  onRefreshed: () => void;
}

const IDLE_STEPS = [
  "Your numbers have been updated",
  "New data is ready to view",
];

const BUSY_STEPS = [
  { label: "Connecting…",        ms: 600  },
  { label: "Loading statements…", ms: 1800 },
  { label: "Applying rules…",    ms: 1400 },
  { label: "Calculating totals…", ms: 1600 },
  { label: "Building insights…", ms: 1500 },
  { label: "Almost done…",       ms: 900  },
];

/**
 * Shown when the API returns needsRefresh:true.
 * Idle: cycles through gentle "ready" messages.
 * Busy: animates through step-by-step progress labels while the rebuild runs.
 */
export default function RefreshToast({ token, onRefreshed }: Props) {
  const [busy, setBusy]           = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [stepIdx, setStepIdx]     = useState(0);
  const timerRef                  = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Idle: cycle between the two "ready" messages every 4 s
  useEffect(() => {
    if (busy || dismissed) return;
    const id = setInterval(() => setStepIdx((i) => (i + 1) % IDLE_STEPS.length), 4000);
    return () => clearInterval(id);
  }, [busy, dismissed]);

  // Busy: advance through BUSY_STEPS sequentially
  useEffect(() => {
    if (!busy) return;
    setStepIdx(0);
    let idx = 0;

    function advance() {
      idx++;
      if (idx < BUSY_STEPS.length) {
        setStepIdx(idx);
        timerRef.current = setTimeout(advance, BUSY_STEPS[idx].ms);
      }
    }

    timerRef.current = setTimeout(advance, BUSY_STEPS[0].ms);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [busy]);

  if (dismissed) return null;

  async function handleRefresh() {
    setBusy(true);
    try {
      await fetch("/api/user/insights/generate", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ event: "full.refresh" }),
      });
      onRefreshed();
    } catch {
      // best-effort
    } finally {
      setBusy(false);
      setDismissed(true);
    }
  }

  const label = busy ? BUSY_STEPS[stepIdx]?.label : IDLE_STEPS[stepIdx];

  return (
    <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 w-[calc(100%-2rem)] max-w-sm">
      <div className="flex items-center gap-3 rounded-2xl bg-gray-900 px-4 py-3 shadow-xl ring-1 ring-white/10">

        {/* Icon — spinner while busy, bell while idle */}
        {busy ? (
          <svg
            className="h-4 w-4 shrink-0 text-indigo-400 animate-spin"
            fill="none" viewBox="0 0 24 24"
          >
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
          </svg>
        ) : (
          <svg className="h-4 w-4 shrink-0 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        )}

        {/* Animated label */}
        <p
          key={label}
          className="flex-1 text-sm text-gray-100 transition-opacity duration-300"
        >
          {label}
        </p>

        {/* Progress dots while busy */}
        {busy && (
          <span className="flex gap-1 shrink-0">
            {BUSY_STEPS.map((_, i) => (
              <span
                key={i}
                className={`block h-1.5 w-1.5 rounded-full transition-colors duration-300 ${
                  i <= stepIdx ? "bg-indigo-400" : "bg-gray-600"
                }`}
              />
            ))}
          </span>
        )}

        {/* Refresh button — only shown when idle */}
        {!busy && (
          <button
            onClick={handleRefresh}
            className="shrink-0 rounded-lg bg-white px-3 py-1 text-xs font-semibold text-gray-900 hover:bg-gray-100 transition"
          >
            Refresh
          </button>
        )}

        {/* Dismiss — only when idle */}
        {!busy && (
          <button
            onClick={() => setDismissed(true)}
            className="shrink-0 p-0.5 text-gray-500 hover:text-gray-300 transition"
            aria-label="Dismiss"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
