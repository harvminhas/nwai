"use client";

/**
 * ParseStatusBanner
 *
 * Shows a compact "Analyzing…" strip at the top of any page after an upload.
 * Reads pending statement IDs written to localStorage by the upload page.
 * Watches each via Firestore onSnapshot (falls back to API polling for anonymous).
 * Calls `onRefresh` once all are complete so the parent can re-fetch its data.
 */

import { useEffect, useRef, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { getFirebaseClient } from "@/lib/firebase";

export const PENDING_KEY = "nwai_pending_parses";

export interface PendingParse {
  id: string;
  name?: string;
}

export function addPendingParse(id: string, name?: string) {
  try {
    const raw     = localStorage.getItem(PENDING_KEY);
    const current: PendingParse[] = raw ? JSON.parse(raw) : [];
    // avoid duplicates
    if (!current.find((p) => p.id === id)) {
      current.push({ id, name });
      localStorage.setItem(PENDING_KEY, JSON.stringify(current));
    }
  } catch { /* ignore SSR / private-mode errors */ }
}

type ParseItemStatus = "analyzing" | "done" | "error";
interface ParseItem extends PendingParse { status: ParseItemStatus }

export default function ParseStatusBanner({ onRefresh }: { onRefresh: () => void }) {
  const [items,    setItems]    = useState<ParseItem[]>([]);
  const [showDone, setShowDone] = useState(false);
  const onRefreshRef            = useRef(onRefresh);
  const refreshedRef            = useRef(false);

  // Keep ref in sync so the stable effect closure always calls the latest onRefresh
  useEffect(() => { onRefreshRef.current = onRefresh; }, [onRefresh]);

  useEffect(() => {
    let pending: PendingParse[] = [];
    try {
      const raw = localStorage.getItem(PENDING_KEY);
      pending   = raw ? JSON.parse(raw) : [];
    } catch { return; }

    if (pending.length === 0) return;

    setItems(pending.map((p) => ({ ...p, status: "analyzing" })));

    const { db }  = getFirebaseClient();
    const unsubs: (() => void)[]                     = [];
    const timers:  ReturnType<typeof setInterval>[]  = [];

    const markDone = (id: string, finalStatus: ParseItemStatus) => {
      setItems((prev) => {
        const next = prev.map((p) => p.id === id ? { ...p, status: finalStatus } : p);
        const allFinished = next.every((p) => p.status !== "analyzing");
        if (allFinished && !refreshedRef.current) {
          refreshedRef.current = true;
          try { localStorage.removeItem(PENDING_KEY); } catch { /* */ }
          setShowDone(true);
          // Brief "done" flash, then trigger data refresh
          setTimeout(() => onRefreshRef.current(), 1200);
        }
        return next;
      });
    };

    const startPolling = (id: string) => {
      const poll = async () => {
        try {
          const res  = await fetch(`/api/statement/${id}`);
          const data = await res.json();
          if (data.status === "completed") { clearInterval(t); markDone(id, "done"); }
          else if (data.status === "error") { clearInterval(t); markDone(id, "error"); }
        } catch { /* network blip — keep going */ }
      };
      poll();
      const t = setInterval(poll, 3000);
      timers.push(t);
    };

    for (const p of pending) {
      const ref   = doc(db, "statements", p.id);
      const unsub = onSnapshot(
        ref,
        (snap) => {
          const s = snap.data()?.status as string | undefined;
          if (s === "completed") markDone(p.id, "done");
          else if (s === "error") markDone(p.id, "error");
        },
        (err) => {
          // For anonymous / pre-rules users fall back to polling
          if (err.code === "permission-denied" || err.code === "unauthenticated") {
            startPolling(p.id);
          } else {
            startPolling(p.id);
          }
        }
      );
      unsubs.push(unsub);
    }

    return () => {
      unsubs.forEach((u) => u());
      timers.forEach((t) => clearInterval(t));
    };
  // Run once on mount — pending list is stable
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (items.length === 0) return null;

  const analyzing = items.filter((i) => i.status === "analyzing");
  const errors    = items.filter((i) => i.status === "error");

  if (showDone) {
    return (
      <div className="mb-5 flex items-center gap-2 rounded-xl border border-green-200 bg-green-50 px-4 py-2.5 text-sm text-green-700">
        <svg className="h-4 w-4 shrink-0 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
        <span className="font-medium">
          Statement{items.length > 1 ? "s" : ""} ready — refreshing…
        </span>
      </div>
    );
  }

  const label = analyzing.length === 1 && items[0]?.name
    ? `"${items[0].name}"`
    : `${analyzing.length} statement${analyzing.length !== 1 ? "s" : ""}`;

  return (
    <div className="mb-5 flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
      <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-amber-800">Analyzing {label}…</p>
        <p className="text-xs text-amber-600">This page will refresh automatically when ready.</p>
      </div>
      {errors.length > 0 && (
        <span className="text-xs text-red-500">{errors.length} error{errors.length > 1 ? "s" : ""}</span>
      )}
    </div>
  );
}
