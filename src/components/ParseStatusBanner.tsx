"use client";

/**
 * ParseStatusBanner
 *
 * Shows a compact "Analyzing…" strip while statements are parsing.
 * Reads pending statement IDs written to localStorage by the upload flow.
 * Watches each via Firestore onSnapshot (falls back to API polling).
 * Calls `onRefresh` once all are complete so the parent can re-fetch data.
 * Calls `onAllComplete` (optional) so the parent can trigger redirects.
 *
 * Key design: subscribes to the `nwai_parse_added` custom event so newly
 * queued uploads are picked up immediately — even if the banner was already
 * mounted before the upload happened.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { getFirebaseClient } from "@/lib/firebase";

export const PENDING_KEY       = "nwai_pending_parses";
export const SETUP_SESSION_KEY = "nwai_setup_session";
const PARSE_ADDED_EVENT        = "nwai_parse_added";

export interface PendingParse {
  id: string;
  name?: string;
}

export function addPendingParse(id: string, name?: string) {
  try {
    const raw     = localStorage.getItem(PENDING_KEY);
    const current: PendingParse[] = raw ? JSON.parse(raw) : [];
    if (!current.find((p) => p.id === id)) {
      current.push({ id, name });
      localStorage.setItem(PENDING_KEY, JSON.stringify(current));
    }
    // Also track in the setup session so the setup page has batch context
    const sessionRaw = localStorage.getItem(SETUP_SESSION_KEY);
    const session: string[] = sessionRaw ? JSON.parse(sessionRaw) : [];
    if (!session.includes(id)) {
      session.push(id);
      localStorage.setItem(SETUP_SESSION_KEY, JSON.stringify(session));
    }
    // Notify any mounted ParseStatusBanner that a new parse was queued
    window.dispatchEvent(new CustomEvent(PARSE_ADDED_EVENT, { detail: { id, name } }));
  } catch { /* ignore SSR / private-mode errors */ }
}

// ── banner ────────────────────────────────────────────────────────────────────

type ParseItemStatus = "analyzing" | "done" | "error";
interface ParseItem extends PendingParse { status: ParseItemStatus }

export default function ParseStatusBanner({
  onRefresh,
  onAllComplete,
}: {
  onRefresh: () => void;
  /** Called once when ALL pending parses finish (success or error). Use to trigger redirects. */
  onAllComplete?: () => void;
}) {
  const [items, setItems]       = useState<ParseItem[]>(() => {
    // Hydrate from localStorage on first render so items from a previous
    // page session (e.g. after a route change) are immediately visible.
    try {
      const raw = localStorage.getItem(PENDING_KEY);
      const pending: PendingParse[] = raw ? JSON.parse(raw) : [];
      return pending.map((p) => ({ ...p, status: "analyzing" as ParseItemStatus }));
    } catch { return []; }
  });
  const [showDone, setShowDone] = useState(false);
  const onRefreshRef            = useRef(onRefresh);
  const onAllCompleteRef        = useRef(onAllComplete);
  const refreshedRef            = useRef(false);
  // Track which IDs we've already started watching to avoid duplicates
  const watchedRef              = useRef(new Set<string>());

  useEffect(() => { onRefreshRef.current = onRefresh; }, [onRefresh]);
  useEffect(() => { onAllCompleteRef.current = onAllComplete; }, [onAllComplete]);

  const markDone = useCallback((id: string, finalStatus: ParseItemStatus) => {
    setItems((prev) => {
      const next = prev.map((p) => p.id === id ? { ...p, status: finalStatus } : p);
      const allFinished = next.length > 0 && next.every((p) => p.status !== "analyzing");
      if (allFinished && !refreshedRef.current) {
        refreshedRef.current = true;
        try { localStorage.removeItem(PENDING_KEY); } catch { /* */ }
        setShowDone(true);
        setTimeout(() => {
          onRefreshRef.current();
          onAllCompleteRef.current?.();
        }, 800);
        // Auto-dismiss the green "ready" strip after 2.5 s
        setTimeout(() => setItems([]), 2500);
      }
      return next;
    });
  }, []);

  const startWatching = useCallback((id: string, name?: string) => {
    if (watchedRef.current.has(id)) return;
    watchedRef.current.add(id);

    setItems((prev) => {
      if (prev.find((p) => p.id === id)) return prev;
      return [...prev, { id, name, status: "analyzing" }];
    });

    const { db } = getFirebaseClient();

    const startPolling = () => {
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
      return t;
    };

    let pollingTimer: ReturnType<typeof setInterval> | null = null;
    const ref   = doc(db, "statements", id);
    const unsub = onSnapshot(
      ref,
      (snap) => {
        const s = (snap.data()?.status ?? "") as string;
        if (s === "completed") { unsub(); if (pollingTimer) clearInterval(pollingTimer); markDone(id, "done"); }
        else if (s === "error") { unsub(); if (pollingTimer) clearInterval(pollingTimer); markDone(id, "error"); }
      },
      () => { pollingTimer = startPolling(); }
    );
  }, [markDone]);

  // On mount: start watching anything already in localStorage
  useEffect(() => {
    try {
      const raw = localStorage.getItem(PENDING_KEY);
      const pending: PendingParse[] = raw ? JSON.parse(raw) : [];
      for (const p of pending) startWatching(p.id, p.name);
    } catch { /* */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Listen for new parses added after mount (e.g. user uploads while on the page)
  useEffect(() => {
    const handler = (e: Event) => {
      const { id, name } = (e as CustomEvent<{ id: string; name?: string }>).detail;
      startWatching(id, name);
    };
    window.addEventListener(PARSE_ADDED_EVENT, handler);
    return () => window.removeEventListener(PARSE_ADDED_EVENT, handler);
  }, [startWatching]);

  if (items.length === 0) return null;

  const analyzing = items.filter((i) => i.status === "analyzing");
  const errors    = items.filter((i) => i.status === "error");

  return (
    <div className="mb-5">
      {showDone ? (
        <div className="flex items-center gap-2 rounded-xl border border-green-200 bg-green-50 px-4 py-2.5 text-sm text-green-700">
          <svg className="h-4 w-4 shrink-0 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
          <span className="font-medium">
            Statement{items.length > 1 ? "s" : ""} ready — refreshing…
          </span>
        </div>
      ) : (
        <div className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-amber-800">
              {analyzing.length === 1 && items[0]?.name
                ? `Analyzing "${items[0].name}"…`
                : `Analyzing ${analyzing.length} statement${analyzing.length !== 1 ? "s" : ""}…`}
            </p>
            <p className="text-xs text-amber-600">This will update automatically when ready.</p>
          </div>
          {errors.length > 0 && (
            <span className="text-xs text-red-500">{errors.length} error{errors.length > 1 ? "s" : ""}</span>
          )}
        </div>
      )}
    </div>
  );
}
