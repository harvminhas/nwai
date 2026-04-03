"use client";

import { useState } from "react";

interface Props {
  token: string;
  /** Called after the rebuild completes so the parent can reload its data. */
  onRefreshed: () => void;
}

/**
 * Shown when the API returns needsRefresh:true (cached data built with an older
 * schema version). The user taps "Refresh" → force-rebuilds the financial profile
 * cache via insights/generate, then lets the parent reload fresh data.
 */
export default function RefreshToast({ token, onRefreshed }: Props) {
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState(false);

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
      // best-effort — dismiss even on failure
    } finally {
      setBusy(false);
      setDismissed(true);
    }
  }

  return (
    <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 w-[calc(100%-2rem)] max-w-sm">
      <div className="flex items-center gap-3 rounded-2xl bg-gray-900 px-4 py-3 shadow-xl">
        <svg className="h-4 w-4 shrink-0 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
        <p className="flex-1 text-sm text-gray-100">Numbers updated — tap to refresh</p>
        <button
          onClick={handleRefresh}
          disabled={busy}
          className="shrink-0 rounded-lg bg-white px-3 py-1 text-xs font-semibold text-gray-900 hover:bg-gray-100 disabled:opacity-50 transition"
        >
          {busy ? "Refreshing…" : "Refresh"}
        </button>
        <button
          onClick={() => setDismissed(true)}
          className="shrink-0 p-0.5 text-gray-500 hover:text-gray-300 transition"
          aria-label="Dismiss"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}
