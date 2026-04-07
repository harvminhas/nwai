"use client";

/**
 * ParseStatusBanner
 *
 * Shows a compact "Analyzing…" strip at the top of any page after an upload.
 * Reads pending statement IDs written to localStorage by the upload page.
 * Watches each via Firestore onSnapshot (falls back to API polling for anonymous).
 * Calls `onRefresh` once all are complete so the parent can re-fetch its data.
 *
 * Also handles the new-account backfill prompt: when a completed statement has
 * backfillPromptNeeded=true, shows an inline age-bucket modal so the user can
 * indicate how long they've had that account.
 */

import { useEffect, useRef, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { getFirebaseClient } from "@/lib/firebase";
import { onAuthStateChanged } from "firebase/auth";

export const PENDING_KEY    = "nwai_pending_parses";
const BACKFILL_PROMPT_KEY   = "nwai_backfill_prompt";

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
  } catch { /* ignore SSR / private-mode errors */ }
}

// ── Age bucket prompt types ───────────────────────────────────────────────────

interface BackfillPrompt {
  statementId: string;
  accountSlug: string;
  accountName: string;
  accountType: string;
  firstBalance: number;
  firstStatementYearMonth: string;
  oldestMonth: string; // oldest month in the user's history — used for ">6 mo" bucket
  slugIsAccountNumber: boolean; // true when slug is ••••XXXX (vs bank-name fallback)
}

const AGE_BUCKETS = [
  { id: "new",    label: "< 1 month",  months: 0,  help: "This is a brand-new account — no backfill needed." },
  { id: "1to3",   label: "1–3 months", months: 2,  help: "We'll estimate 2 months of balance history." },
  { id: "3to6",   label: "3–6 months", months: 4,  help: "We'll estimate 4 months of balance history." },
  { id: "over6",  label: "> 6 months", months: -1, help: "We'll estimate back to your earliest tracked month." },
] as const;

type BucketId = typeof AGE_BUCKETS[number]["id"];

// ── Backfill prompt modal ─────────────────────────────────────────────────────

function BackfillPromptModal({
  prompt,
  idToken,
  onDone,
}: {
  prompt: BackfillPrompt;
  idToken: string;
  onDone: () => void;
}) {
  const [selected, setSelected] = useState<BucketId | null>(null);
  const [saving,   setSaving]   = useState(false);

  const handleSave = async () => {
    if (!selected) return;
    setSaving(true);

    const bucket    = AGE_BUCKETS.find((b) => b.id === selected)!;
    // For ">6 mo", backfill to the oldest tracked month (or 12 months if no baseline)
    const backfillMonths = bucket.months === -1
      ? (prompt.oldestMonth
          ? monthsDiff(prompt.oldestMonth, prompt.firstStatementYearMonth)
          : 12)
      : bucket.months;

    await fetch("/api/user/account-backfills", {
      method:  "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
      body:    JSON.stringify({
        statementId:             prompt.statementId,
        accountSlug:             prompt.accountSlug,
        accountName:             prompt.accountName,
        accountType:             prompt.accountType,
        backfillMonths,
        firstBalance:            prompt.firstBalance,
        firstStatementYearMonth: prompt.firstStatementYearMonth,
      }),
    });
    setSaving(false);
    onDone();
  };

  const selectedBucket = AGE_BUCKETS.find((b) => b.id === selected);
  const displayId = prompt.slugIsAccountNumber
    ? `••••${prompt.accountSlug}`
    : prompt.accountSlug;

  return (
    <div className="mb-5 rounded-xl border border-blue-200 bg-blue-50 p-4">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-100">
          <svg className="h-4 w-4 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-blue-900">
            New account detected — {prompt.accountName || displayId}
          </p>
          <p className="mt-0.5 text-xs text-blue-700">
            How long have you had this account? We&apos;ll estimate its history so your net worth chart doesn&apos;t show a false spike.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {AGE_BUCKETS.map((b) => (
              <button
                key={b.id}
                onClick={() => setSelected(b.id)}
                className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
                  selected === b.id
                    ? "border-blue-500 bg-blue-600 text-white"
                    : "border-blue-200 bg-white text-blue-700 hover:border-blue-400"
                }`}
              >
                {b.label}
              </button>
            ))}
          </div>
          {selectedBucket && (
            <p className="mt-2 text-[11px] text-blue-600">{selectedBucket.help}</p>
          )}
          <div className="mt-3 flex items-center gap-2">
            <button
              onClick={handleSave}
              disabled={!selected || saving}
              className="rounded-lg bg-blue-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-40 transition"
            >
              {saving ? "Saving…" : "Confirm"}
            </button>
            <button
              onClick={onDone}
              className="text-xs text-blue-500 hover:text-blue-700"
            >
              Skip
            </button>
          </div>

          {/* Soft duplicate advisory */}
          <div className="mt-3 rounded-lg border border-blue-200 bg-white/70 px-3 py-2">
            <p className="text-[11px] text-blue-700">
              <span className="font-semibold">Already tracking this account?</span>{" "}
              {prompt.slugIsAccountNumber
                ? <>If {displayId} is the same card listed under a different number, go to <a href="/account/liabilities?tab=accounts" className="underline hover:text-blue-900">Accounts</a> and delete the old entry, then re-upload.</>
                : <>If this account is already tracked under a different name, go to <a href="/account/liabilities?tab=accounts" className="underline hover:text-blue-900">Accounts</a> and delete the duplicate, then re-upload.</>
              }
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function monthsDiff(from: string, to: string): number {
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  return Math.max(0, (ty - fy) * 12 + (tm - fm));
}

// ── Main banner ───────────────────────────────────────────────────────────────

type ParseItemStatus = "analyzing" | "done" | "error";
interface ParseItem extends PendingParse { status: ParseItemStatus }

export default function ParseStatusBanner({ onRefresh }: { onRefresh: () => void }) {
  const [items,          setItems]          = useState<ParseItem[]>([]);
  const [showDone,       setShowDone]       = useState(false);
  const [idToken,        setIdToken]        = useState<string | null>(null);
  const onRefreshRef                        = useRef(onRefresh);
  const refreshedRef                        = useRef(false);

  // Persist the backfill prompt to localStorage so it survives parent remounts
  // (e.g. when the dashboard triggers setLoading(true) during a data refresh).
  const [backfillPrompt, setBackfillPromptState] = useState<BackfillPrompt | null>(() => {
    try {
      const raw = localStorage.getItem(BACKFILL_PROMPT_KEY);
      return raw ? (JSON.parse(raw) as BackfillPrompt) : null;
    } catch { return null; }
  });
  const setBackfillPrompt = (p: BackfillPrompt | null) => {
    setBackfillPromptState(p);
    try {
      if (p) localStorage.setItem(BACKFILL_PROMPT_KEY, JSON.stringify(p));
      else    localStorage.removeItem(BACKFILL_PROMPT_KEY);
    } catch { /* ignore */ }
  };

  useEffect(() => { onRefreshRef.current = onRefresh; }, [onRefresh]);

  // Get auth token for the backfill POST
  useEffect(() => {
    const { auth } = getFirebaseClient();
    return onAuthStateChanged(auth, async (user) => {
      if (user) setIdToken(await user.getIdToken());
    });
  }, []);

  useEffect(() => {
    let pending: PendingParse[] = [];
    try {
      const raw = localStorage.getItem(PENDING_KEY);
      pending   = raw ? JSON.parse(raw) : [];
    } catch { return; }

    if (pending.length === 0) return;

    setItems(pending.map((p) => ({ ...p, status: "analyzing" })));

    const { db }  = getFirebaseClient();
    const unsubs: (() => void)[]                    = [];
    const timers:  ReturnType<typeof setInterval>[] = [];

    const markDone = (id: string, finalStatus: ParseItemStatus) => {
      setItems((prev) => {
        const next = prev.map((p) => p.id === id ? { ...p, status: finalStatus } : p);
        const allFinished = next.every((p) => p.status !== "analyzing");
        if (allFinished && !refreshedRef.current) {
          refreshedRef.current = true;
          try { localStorage.removeItem(PENDING_KEY); } catch { /* */ }
          setShowDone(true);
          setTimeout(() => onRefreshRef.current(), 1200);
        }
        return next;
      });
    };

    const checkBackfill = (snapData: Record<string, unknown>, stmtId: string) => {
      if (snapData.backfillPromptNeeded === true) {
        const parsedData = snapData.parsedData as Record<string, unknown> | undefined;
        setBackfillPrompt({
          statementId:             stmtId,
          accountSlug:             (snapData.accountSlug as string) ?? "",
          accountName:             (parsedData?.accountName as string) ?? (snapData.accountSlug as string) ?? "New account",
          accountType:             (parsedData?.accountType as string) ?? "other",
          firstBalance:            (parsedData?.netWorth as number)  ?? 0,
          firstStatementYearMonth: (snapData.yearMonth as string)    ?? "",
          oldestMonth:             (snapData.backfillOldestMonth as string) ?? "",
          slugIsAccountNumber:     (snapData.slugIsAccountNumber as boolean) ?? false,
        });
      }
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
          const data = snap.data() ?? {};
          const s    = data.status as string | undefined;
          if (s === "completed") {
            // checkBackfill on every completed snapshot — backfillPromptNeeded
            // is written in the same update as status:"completed" so it will be
            // present on the very first firing, but we also re-check on any
            // subsequent snapshot just in case.
            checkBackfill(data as Record<string, unknown>, p.id);
            markDone(p.id, "done");
          } else if (s === "error") {
            markDone(p.id, "error");
          }
        },
        () => startPolling(p.id)
      );
      unsubs.push(unsub);
    }

    return () => {
      unsubs.forEach((u) => u());
      timers.forEach((t) => clearInterval(t));
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (items.length === 0 && !backfillPrompt) return null;

  const analyzing = items.filter((i) => i.status === "analyzing");
  const errors    = items.filter((i) => i.status === "error");

  return (
    <>
      {/* Backfill age-bucket prompt — shown when a new account is detected */}
      {backfillPrompt && idToken && (
        <BackfillPromptModal
          prompt={backfillPrompt}
          idToken={idToken}
          onDone={() => { setBackfillPrompt(null); onRefreshRef.current(); }}
        />
      )}

      {/* Parse progress / done banner */}
      {items.length > 0 && (
        showDone ? (
          <div className="mb-5 flex items-center gap-2 rounded-xl border border-green-200 bg-green-50 px-4 py-2.5 text-sm text-green-700">
            <svg className="h-4 w-4 shrink-0 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            <span className="font-medium">
              Statement{items.length > 1 ? "s" : ""} ready — refreshing…
            </span>
          </div>
        ) : (
          <div className="mb-5 flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
            <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-amber-800">
                Analyzing {analyzing.length === 1 && items[0]?.name ? `"${items[0].name}"` : `${analyzing.length} statement${analyzing.length !== 1 ? "s" : ""}`}…
              </p>
              <p className="text-xs text-amber-600">This page will refresh automatically when ready.</p>
            </div>
            {errors.length > 0 && (
              <span className="text-xs text-red-500">{errors.length} error{errors.length > 1 ? "s" : ""}</span>
            )}
          </div>
        )
      )}
    </>
  );
}
