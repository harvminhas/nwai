"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { collection, query, orderBy, limit, onSnapshot } from "firebase/firestore";
import { getFirebaseClient } from "@/lib/firebase";
import NetWorthChart from "@/components/NetWorthChart";
import AgentInsightCards from "@/components/AgentInsightCards";
import type { ParsedStatementData } from "@/lib/types";
import type { AgentCard } from "@/lib/agentTypes";
import { isBalanceMarker } from "@/lib/balanceMarkers";

// ── helpers ───────────────────────────────────────────────────────────────────

function fmt(v: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD",
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(v);
}
function fmtShort(v: number) {
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "+";
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000)     return `${sign}$${Math.round(abs / 1_000)}k`;
  return `${sign}${fmt(Math.abs(v))}`;
}
function fmtNW(v: number) {
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000)     return `$${Math.round(abs / 1_000)}k`;
  return fmt(v);
}
function monthLabel(ym: string) {
  const [y, m] = ym.split("-");
  if (!m) return ym;
  return new Date(parseInt(y), parseInt(m) - 1, 1)
    .toLocaleDateString("en-US", { month: "long", year: "numeric" });
}




// ── scoring engine ────────────────────────────────────────────────────────────

type SignalStatus = "pass" | "warning" | "fail" | "skip";
type TrackStatus  = "on-track" | "watch" | "off-track";

interface Signal {
  id: string;
  name: string;
  shortName: string; // abbreviated label for the strip card
  description: string;
  weight: number;    // nominal weight, redistributed if skipped
  status: SignalStatus;
  detail: string;    // one-line explanation of result
  fillPct: number;   // 0–100 meter fill, pre-computed
}

interface HistoryPoint {
  yearMonth: string;
  netWorth: number;
  incomeTotal: number;
  expensesTotal: number;
  coreExpensesTotal?: number;
  debtTotal: number;
  isEstimate?: boolean;
}

function computeSignals(
  currentYm: string,
  history: HistoryPoint[],
  liquidAssets: number,
  hasDebts: boolean,
): Signal[] {
  const sorted = [...history].sort((a, b) => a.yearMonth.localeCompare(b.yearMonth));
  const idx    = sorted.findIndex((h) => h.yearMonth === currentYm);
  const cur    = idx >= 0 ? sorted[idx] : null;
  const prev   = idx > 0  ? sorted[idx - 1] : null;
  const prev3  = idx >= 3 ? sorted.slice(idx - 3, idx) : sorted.slice(0, idx);

  // ── 1. Net worth trend (30%) ──────────────────────────────────────────────
  const nwSignal: Signal = (() => {
    const base = { id: "nw_trend", name: "Net worth trend", shortName: "Net worth", description: "Growing month-over-month", weight: 30 };
    if (!cur || !prev) return { ...base, status: "skip", detail: "Not enough history yet", fillPct: 0 };
    const delta = (cur.netWorth ?? 0) - (prev.netWorth ?? 0);
    const pct   = (prev.netWorth ?? 0) !== 0 ? delta / Math.abs(prev.netWorth ?? 0) : 0;
    // fillPct: map [-10%, +10%] → [0, 100]; 0% = 50, +5% = 75, -5% = 25
    const fillPct = Math.round(Math.min(100, Math.max(0, (pct * 500 + 1) * 50)));
    if (pct > 0.005) return { ...base, status: "pass",    detail: `Up ${fmtShort(delta)} vs last month`,          fillPct };
    if (pct >= -0.005) return { ...base, status: "warning", detail: "Flat this month (within 0.5%)",               fillPct: 50 };
    return              { ...base, status: "fail",    detail: `Down ${fmtShort(Math.abs(delta))} vs last month`, fillPct };
  })();

  // ── 2. Savings rate (25%) ─────────────────────────────────────────────────
  const srSignal: Signal = (() => {
    const base = { id: "savings_rate", name: "Savings rate", shortName: "Savings rate", description: "Saving ≥ 10% of take-home income this month", weight: 25 };
    if (!cur || cur.incomeTotal <= 0) return { ...base, status: "skip", detail: "No income data this month", fillPct: 0 };
    const rate = (cur.incomeTotal - cur.expensesTotal) / cur.incomeTotal;
    // fillPct: map [-50%, +50%] → [0, 100]; 10% target ≈ 75% fill
    const fillPct = Math.round(Math.min(100, Math.max(0, (rate + 0.5) / 0.8 * 100)));
    if (rate >= 0.10) return { ...base, status: "pass",    detail: `Saving ${Math.round(rate * 100)}% of income`,                        fillPct };
    if (rate >= 0)   return { ...base, status: "warning", detail: `Saving ${Math.round(rate * 100)}% — target is 10%`,                   fillPct };
    return            { ...base, status: "fail",    detail: `Spending ${fmt(cur.expensesTotal - cur.incomeTotal)} more than earned`, fillPct };
  })();

  // ── 3. Debt plan adherence (20%) ──────────────────────────────────────────
  const debtSignal: Signal = (() => {
    const base = { id: "debt_plan", name: "Debt plan adherence", shortName: "Debt", description: "Debt balance decreasing month-over-month", weight: 20 };
    if (!hasDebts || !cur || cur.debtTotal <= 0) return { ...base, status: "skip", detail: "No active debts — signal skipped", fillPct: 0 };
    if (!prev)                                    return { ...base, status: "skip", detail: "Not enough history yet",           fillPct: 0 };
    const delta   = cur.debtTotal - prev.debtTotal;
    // fillPct: paid-down ratio vs total debt; clamp [-10%, +10%] change → [0, 100]
    const changePct = cur.debtTotal > 0 ? delta / cur.debtTotal : 0;
    const fillPct = Math.round(Math.min(100, Math.max(0, (-changePct * 500 + 1) * 50)));
    if (delta < -10) return { ...base, status: "pass",    detail: `Paid down ${fmt(Math.abs(delta))} this month`,  fillPct };
    if (delta <= 50) return { ...base, status: "warning", detail: "Debt unchanged this month",                     fillPct: 50 };
    return            { ...base, status: "fail",    detail: `Debt increased by ${fmt(delta)} this month`,   fillPct };
  })();

  // ── 4. Spending vs budget (15%) ───────────────────────────────────────────
  const spendSignal: Signal = (() => {
    const base = { id: "spending_vs_budget", name: "Spending vs budget", shortName: "Spending", description: "Total spend within 110% of 3-month average", weight: 15 };
    if (!cur || cur.expensesTotal <= 0 || prev3.length < 2) return { ...base, status: "skip", detail: "Not enough history to set a baseline", fillPct: 0 };
    const avg   = prev3.reduce((s, h) => s + h.expensesTotal, 0) / prev3.length;
    const ratio = avg > 0 ? cur.expensesTotal / avg : 1;
    // fillPct: ratio ≤ 1 = full; each 10% over cuts 20pts; clamped 0–100
    const fillPct = Math.round(Math.min(100, Math.max(0, 100 - Math.max(0, ratio - 1) * 200)));
    if (ratio <= 1.0)  return { ...base, status: "pass",    detail: `Spending at ${Math.round(ratio * 100)}% of avg — on target`,         fillPct };
    if (ratio <= 1.10) return { ...base, status: "warning", detail: `Spending at ${Math.round(ratio * 100)}% of avg — slightly elevated`, fillPct };
    return              { ...base, status: "fail",    detail: `Spending at ${Math.round(ratio * 100)}% of avg — ${fmt(cur.expensesTotal - avg)} over`, fillPct };
  })();

  // ── 5. Goal trajectory (5%) ───────────────────────────────────────────────
  const goalSignal: Signal = {
    id: "goal_trajectory", name: "Goal trajectory", shortName: "Goals",
    description: "FI date within 12 months of original plan",
    weight: 5, status: "skip",
    detail: "Goals not set up yet", fillPct: 0,
  };

  // ── 6. Emergency fund buffer (5%) ─────────────────────────────────────────
  const efSignal: Signal = (() => {
    const base = { id: "emergency_fund", name: "Emergency fund buffer", shortName: "Emergency fund", description: "Liquid savings ≥ 1 month of expenses", weight: 5 };
    if (!cur || cur.expensesTotal <= 0) return { ...base, status: "skip", detail: "No expense data to set benchmark",      fillPct: 0 };
    if (liquidAssets <= 0)              return { ...base, status: "skip", detail: "No linked savings/chequing account",    fillPct: 0 };
    const months  = liquidAssets / cur.expensesTotal;
    // fillPct: 0 mo = 0%, 1 mo = 33%, 3 mo = 100% (capped)
    const fillPct = Math.round(Math.min(100, Math.max(0, months / 3 * 100)));
    if (months >= 1)   return { ...base, status: "pass",    detail: `${months.toFixed(1)} months of expenses in liquid savings`, fillPct };
    if (months >= 0.5) return { ...base, status: "warning", detail: `${months.toFixed(1)} months covered — target is 1 month`,  fillPct };
    return              { ...base, status: "fail",    detail: `Only ${months.toFixed(1)} months covered — needs attention`, fillPct };
  })();

  return [nwSignal, srSignal, debtSignal, spendSignal, goalSignal, efSignal];
}

function computeScore(signals: Signal[]): number {
  const active = signals.filter((s) => s.status !== "skip");
  if (active.length === 0) return 0;
  const totalWeight = active.reduce((s, sig) => s + sig.weight, 0);
  const earned = active.reduce((s, sig) => {
    const pts = sig.status === "pass" ? 1 : sig.status === "warning" ? 0.5 : 0;
    return s + sig.weight * pts;
  }, 0);
  return Math.round((earned / totalWeight) * 100);
}

function rawStatus(score: number, signals: Signal[]): TrackStatus | null {
  const active = signals.filter((s) => s.status !== "skip");
  if (active.length < 2) return null; // not enough signals to score
  const hasFail    = active.some((s) => s.status === "fail");
  const hasWarning = active.some((s) => s.status === "warning");
  if (hasFail || score < 50)  return "off-track";
  if (hasWarning || score < 75) return "watch";
  return "on-track";
}

/** Apply hysteresis: status must hold for 2 consecutive months before changing. */
function applyHysteresis(
  currentStatus: TrackStatus | null,
  prevStatus: TrackStatus | null,
): TrackStatus | null {
  if (currentStatus === null) return null;
  if (prevStatus === null) return currentStatus; // first month with data
  // If same as last month → confirmed
  if (currentStatus === prevStatus) return currentStatus;
  // Different → hold the previous status (needs 2 in a row to flip)
  return prevStatus;
}

// ── status badge config ───────────────────────────────────────────────────────

const TRACK_CONFIG: Record<TrackStatus, {
  label: string; badge: string; dot: string;
}> = {
  "on-track":  { label: "On track",       badge: "bg-green-100 text-green-700 border-green-200",  dot: "bg-green-500" },
  "watch":     { label: "Watch spending", badge: "bg-amber-100 text-amber-700 border-amber-200",  dot: "bg-amber-500" },
  "off-track": { label: "Off track",      badge: "bg-red-100 text-red-600 border-red-200",        dot: "bg-red-500" },
};

const SIGNAL_STATUS_CONFIG: Record<SignalStatus, { label: string; color: string; bg: string }> = {
  pass:    { label: "Pass",    color: "text-green-700",  bg: "bg-green-100 border-green-200" },
  warning: { label: "Warning", color: "text-amber-700",  bg: "bg-amber-100 border-amber-200" },
  fail:    { label: "Fail",    color: "text-red-600",    bg: "bg-red-100 border-red-200" },
  skip:    { label: "N/A",     color: "text-gray-400",   bg: "bg-gray-100 border-gray-200" },
};


// ── type-to-label maps ────────────────────────────────────────────────────────

const ASSET_TYPE_LABEL: Record<string, string> = {
  savings: "savings", investments: "investments", property: "property",
  RRSP: "RRSP", rrsp: "RRSP", tfsa: "TFSA",
};
const DEBT_TYPE_LABEL: Record<string, string> = {
  CC: "CC", mortgage: "mortgage", loan: "loan",
};

// ── signal strip ─────────────────────────────────────────────────────────────

const STRIP_BAR: Record<SignalStatus, string> = {
  pass:    "bg-green-500",
  warning: "bg-amber-400",
  fail:    "bg-red-500",
  skip:    "bg-gray-200",
};
const STRIP_LABEL: Record<SignalStatus, { text: string; cls: string }> = {
  pass:    { text: "Pass",    cls: "text-green-600" },
  warning: { text: "Watch",   cls: "text-amber-500" },
  fail:    { text: "Fail",    cls: "text-red-500"   },
  skip:    { text: "N/A",     cls: "text-gray-300"  },
};

function SignalStrip({ signals, score, status, onOpenModal }: {
  signals: Signal[];
  score: number;
  status: TrackStatus | null;
  onOpenModal: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const active = signals.filter((s) => s.status !== "skip");
  if (active.length < 2) return null;

  const scoreColor = score >= 75 ? "text-green-600" : score >= 50 ? "text-amber-500" : "text-red-500";
  const scoreBar   = score >= 75 ? "bg-green-500"   : score >= 50 ? "bg-amber-400"   : "bg-red-500";
  const trackCfg   = status ? TRACK_CONFIG[status] : null;

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
      {/* Header row — always visible */}
      <div className="flex items-center gap-3 px-4 py-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mr-auto">Financial health</p>

        {/* Status badge */}
        {trackCfg && (
          <span className={`shrink-0 flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${trackCfg.badge}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${trackCfg.dot}`} />
            {trackCfg.label}
          </span>
        )}

        {/* Score + expand toggle */}
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-2 rounded-lg px-2 py-1 hover:bg-gray-50 transition"
        >
          <div className="flex items-center gap-1.5">
            <div className="h-1.5 w-16 rounded-full bg-gray-100 overflow-hidden">
              <div className={`h-full rounded-full ${scoreBar} transition-all`} style={{ width: `${score}%` }} />
            </div>
            <span className={`text-xs font-bold tabular-nums ${scoreColor}`}>{score}/100</span>
          </div>
          <svg
            className={`h-3.5 w-3.5 text-gray-400 transition-transform ${expanded ? "rotate-180" : ""}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>

      {/* Signal grid — only when expanded */}
      {expanded && (
        <>
          <div className="grid grid-cols-2 gap-px bg-gray-100 border-t border-gray-100 sm:grid-cols-4">
            {active.map((sig) => {
              const lb = STRIP_LABEL[sig.status];
              return (
                <div key={sig.id} className="bg-white px-3.5 py-3 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <p className="text-[11px] font-semibold text-gray-500 leading-tight truncate pr-1">{sig.shortName}</p>
                    <span className={`text-[10px] font-bold shrink-0 ${lb.cls}`}>{lb.text}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${STRIP_BAR[sig.status]}`}
                      style={{ width: `${sig.fillPct}%` }}
                    />
                  </div>
                  <p className="text-[11px] text-gray-400 leading-tight line-clamp-2">{sig.detail}</p>
                </div>
              );
            })}
          </div>
          {/* Full breakdown link */}
          <button
            onClick={onOpenModal}
            className="flex w-full items-center justify-center gap-1 border-t border-gray-100 py-2.5 text-xs font-medium text-purple-600 hover:bg-purple-50 transition"
          >
            View full breakdown
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </>
      )}
    </div>
  );
}

// ── signal breakdown modal ────────────────────────────────────────────────────

function SignalModal({
  signals, score, status, onClose,
}: {
  signals: Signal[];
  score: number;
  status: TrackStatus | null;
  onClose: () => void;
}) {
  const trackCfg = status ? TRACK_CONFIG[status] : null;
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-md rounded-2xl bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <div>
            <h2 className="font-bold text-gray-900">Health check</h2>
            <p className="mt-0.5 text-xs text-gray-400">
              Each signal has a weight. The overall score determines the badge.
            </p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Score summary */}
        <div className="flex items-center gap-4 border-b border-gray-100 px-5 py-3">
          <div className="flex-1">
            <div className="flex h-2 w-full overflow-hidden rounded-full bg-gray-100">
              <div
                className={`h-full rounded-full transition-all ${
                  score >= 75 ? "bg-green-500" : score >= 50 ? "bg-amber-500" : "bg-red-500"
                }`}
                style={{ width: `${score}%` }}
              />
            </div>
            <p className="mt-1 text-xs text-gray-400">Overall score: <span className="font-semibold text-gray-700">{score}/100</span></p>
          </div>
          {trackCfg && (
            <span className={`shrink-0 rounded-full border px-3 py-1 text-xs font-semibold ${trackCfg.badge}`}>
              {trackCfg.label}
            </span>
          )}
        </div>

        {/* Signals */}
        <div className="divide-y divide-gray-50 max-h-[60vh] overflow-y-auto">
          {signals.map((sig) => {
            const scfg = SIGNAL_STATUS_CONFIG[sig.status];
            const activeWeight = sig.status !== "skip" ? sig.weight : null;
            return (
              <div key={sig.id} className={`px-5 py-4 ${sig.status === "skip" ? "opacity-50" : ""}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-800">{sig.name}</p>
                    <p className="mt-0.5 text-xs text-gray-400">{sig.description}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <span className={`inline-block rounded-full border px-2 py-0.5 text-[10px] font-bold ${scfg.bg} ${scfg.color}`}>
                      {scfg.label}
                    </span>
                    {activeWeight != null && (
                      <p className="mt-1 text-[10px] text-gray-400">weight: {activeWeight}%</p>
                    )}
                  </div>
                </div>
                <p className={`mt-1.5 text-xs ${scfg.color}`}>{sig.detail}</p>
                {/* Weight bar */}
                {activeWeight != null && (
                  <div className="mt-2 h-0.5 w-full overflow-hidden rounded-full bg-gray-100">
                    <div
                      className={`h-full rounded-full ${
                        sig.status === "pass" ? "bg-green-400" : sig.status === "warning" ? "bg-amber-400" : "bg-red-400"
                      }`}
                      style={{ width: `${activeWeight * 3}%` }}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="border-t border-gray-100 px-5 py-3">
          <p className="text-[10px] text-gray-400">
            Status requires 2 consecutive months to change. Skipped signals are redistributed to active ones.
          </p>
        </div>
      </div>
    </div>
  );
}

// ── component ─────────────────────────────────────────────────────────────────

export default function ConsolidatedCurrentDashboard({ refreshKey }: { refreshKey?: number }) {
  const router = useRouter();
  const [data, setData]               = useState<ParsedStatementData | null>(null);
  const [previousMonth, setPreviousMonth] = useState<{ netWorth: number; assets: number; debts: number; expenses: number } | null>(null);
  const [yearMonth, setYearMonth]     = useState<string | null>(null);
  const [history, setHistory]         = useState<HistoryPoint[]>([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState<string | null>(null);
  const [statementCount, setStatementCount] = useState(0);
  const [accountCount, setAccountCount]     = useState(0);
  const [incompleteMonths, setIncompleteMonths] = useState<string[]>([]);
  const [assetLabels, setAssetLabels] = useState<string[]>([]);
  const [debtLabels, setDebtLabels]   = useState<string[]>([]);
  const [liquidAssets, setLiquidAssets] = useState(0);
  const [modalOpen, setModalOpen]     = useState(false);
  const [agentCards, setAgentCards]   = useState<AgentCard[]>([]);
  const [idToken, setIdToken]         = useState<string | null>(null);
  const [uid, setUid]                 = useState<string | null>(null);
  const [excludeTransfers, setExcludeTransfers] = useState<boolean>(() => {
    if (typeof window !== "undefined") return localStorage.getItem("excludeTransfersFromTypical") === "true";
    return false;
  });

  useEffect(() => {
    const { auth } = getFirebaseClient();
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) { router.push("/login"); return; }
      setLoading(true); setError(null);
      try {
        const token = await user.getIdToken();
        setIdToken(token);
        setUid(user.uid);
        const res = await fetch("/api/user/statements/consolidated", { headers: { Authorization: `Bearer ${token}` } });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) { setError(json.error || "Failed to load"); return; }

        setData(json.data ?? null);
        setStatementCount(json.count ?? 0);
        setAccountCount(json.accountCount ?? 0);
        setPreviousMonth(json.previousMonth ?? null);
        setYearMonth(json.yearMonth ?? null);
        setAssetLabels(json.assetLabels ?? []);
        setDebtLabels(json.debtLabels ?? []);
        setLiquidAssets(json.liquidAssets ?? 0);
        const incomplete: string[] = json.incompleteMonths ?? [];
        setIncompleteMonths(incomplete);
        setHistory(Array.isArray(json.history)
          ? json.history.map((h: { yearMonth: string; netWorth: number; incomeTotal?: number; expensesTotal?: number; coreExpensesTotal?: number; debtTotal?: number }) => ({
              yearMonth: h.yearMonth,
              netWorth: h.netWorth,
              incomeTotal: h.incomeTotal ?? 0,
              expensesTotal: h.expensesTotal ?? 0,
              coreExpensesTotal: h.coreExpensesTotal,
              debtTotal: h.debtTotal ?? 0,
              isEstimate: incomplete.includes(h.yearMonth),
            }))
          : []);
      } catch { setError("Failed to load dashboard"); }
      finally { setLoading(false); }
    });
    return () => unsub();
  }, [router, refreshKey]);

  // Real-time listener for agent insight cards — fires immediately with cached
  // data and again whenever the pipeline writes new cards after an upload.
  useEffect(() => {
    if (!uid) return;
    const { db } = getFirebaseClient();
    const q = query(
      collection(db, `users/${uid}/agentInsights`),
      orderBy("createdAt", "desc"),
      limit(20)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const cards = snap.docs
          .map((d) => ({ id: d.id, ...d.data() } as AgentCard))
          .filter((c) => !c.dismissed);
        setAgentCards(cards);
      },
      () => {} // ignore listener errors silently
    );
    return unsub;
  }, [uid]);

  if (loading) return (
    <div className="flex min-h-[40vh] items-center justify-center">
      <div className="h-10 w-10 animate-spin rounded-full border-4 border-purple-600 border-t-transparent" />
    </div>
  );
  if (error || !data || !yearMonth) return (
    <div className="rounded-xl border border-gray-200 bg-white p-8 text-center">
      <p className="text-gray-600">{error || "No data yet."}</p>
      <Link href="/upload" className="mt-3 inline-block text-sm font-medium text-purple-600 hover:underline">
        Upload your first statement →
      </Link>
    </div>
  );

  // ── derived ────────────────────────────────────────────────────────────────

  const netWorth   = data.netWorth ?? 0;
  const assets     = data.assets ?? Math.max(0, netWorth);
  const debts      = data.debts ?? Math.max(0, -netWorth);
  const income     = data.income?.total ?? 0;
  const hasDebts   = debts > 0;

  const nwDelta    = previousMonth != null ? netWorth - previousMonth.netWorth : null;
  const assetDelta = previousMonth != null ? assets   - previousMonth.assets   : null;
  const debtDelta  = previousMonth != null ? debts    - previousMonth.debts    : null;

  // Onboarding: ≤3 months of real history
  const isOnboarding = history.filter((h) => !h.isEstimate).length <= 3;

  // Detect "new account added" vs genuine financial loss.
  // Primary signal: debt jumped significantly while net worth dropped
  //   → almost always means a mortgage, loan, or CC was just added.
  // Secondary signal: any negative delta during onboarding (incomplete data).
  const isLikelyNewAccount =
    nwDelta !== null && nwDelta < 0 && (
      (debtDelta !== null && debtDelta > 10_000) ||
      isOnboarding
    );

  const assetSubLabel = assetLabels.map((l) => ASSET_TYPE_LABEL[l] ?? l).slice(0, 3).join(", ") || null;
  const debtSubLabel  = debtLabels.map((l) => DEBT_TYPE_LABEL[l] ?? l).slice(0, 3).join(" + ")   || null;

  // ── avg income / spending from history (months with data) ─────────────────
  const incomeMonths   = history.filter((h) => h.incomeTotal   > 0);
  const expenseMonths  = history.filter((h) => h.expensesTotal > 0);
  const avgIncome  = incomeMonths.length  > 0 ? incomeMonths.reduce((s, h)  => s + h.incomeTotal,   0) / incomeMonths.length  : 0;
  const avgExpenses= expenseMonths.length > 0 ? expenseMonths.reduce((s, h) => s + h.expensesTotal, 0) / expenseMonths.length : 0;

  // When excludeTransfers is on, use coreExpensesTotal (transfers/debt payments stripped out)
  const effectiveExpenseKey = (h: HistoryPoint) =>
    excludeTransfers && h.coreExpensesTotal !== undefined ? h.coreExpensesTotal : h.expensesTotal;
  const effectiveExpenseMonths = history.filter((h) => effectiveExpenseKey(h) > 0);
  const medianExpenses = (() => {
    if (effectiveExpenseMonths.length === 0) return 0;
    const sorted = [...effectiveExpenseMonths].map(effectiveExpenseKey).sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  })();

  // Current-month expenses — same filtering as the spending page:
  // only transactions dated within the current calendar month, no balance markers.
  const TRANSFER_CATS = /^transfers$/i;
  const allExpenseTxns = data?.expenses?.transactions ?? [];
  const calendarMonthTxns = allExpenseTxns.filter(
    (t) => (!t.date || t.date.startsWith(yearMonth)) && !isBalanceMarker(t.merchant ?? "")
  );
  // Fall back to pre-computed total only when no dated transactions exist
  const monthRawTotal = calendarMonthTxns.length > 0
    ? calendarMonthTxns.reduce((s, t) => s + t.amount, 0)
    : (data?.expenses?.total ?? 0);
  const expenses = excludeTransfers
    ? calendarMonthTxns
        .filter((t) => !TRANSFER_CATS.test((t.category ?? "").trim()))
        .reduce((s, t) => s + t.amount, 0)
    : monthRawTotal;

  // saved uses the same filtered expense figure so the hero card stays consistent
  const saved = income - expenses;

  // ── scoring ────────────────────────────────────────────────────────────────
  const signals   = computeSignals(yearMonth, history, liquidAssets, hasDebts);
  const score     = computeScore(signals);

  // Compute previous month's status for hysteresis
  const sorted    = [...history].sort((a, b) => a.yearMonth.localeCompare(b.yearMonth));
  const prevIdx   = sorted.findIndex((h) => h.yearMonth === yearMonth) - 1;
  const prevYm    = prevIdx >= 0 ? sorted[prevIdx].yearMonth : null;
  const prevSigs  = prevYm ? computeSignals(prevYm, history, liquidAssets, hasDebts) : null;
  const prevScore = prevSigs ? computeScore(prevSigs) : null;
  const curRaw    = rawStatus(score, signals);
  const prevRaw   = prevSigs && prevScore != null ? rawStatus(prevScore, prevSigs) : null;
  const trackStatus = applyHysteresis(curRaw, prevRaw);

  const chartHistory  = history.map((h) => ({ yearMonth: h.yearMonth, netWorth: h.netWorth, isEstimate: h.isEstimate }));

  return (
    <>
      <div className="space-y-4">

        {/* ── Incomplete months banner — only shown when current month is estimated
             or the majority of history is estimated (suppressed for isolated
             historical gaps which are normal with multi-account setups) ───── */}
        {(() => {
          const currentIncomplete = yearMonth ? incompleteMonths.includes(yearMonth) : false;
          const totalMonths       = history.length;
          // Show only if current month is estimated, or >40% of history is estimated
          const manyIncomplete    = totalMonths > 0 && incompleteMonths.length / totalMonths > 0.4;
          if (!currentIncomplete && !manyIncomplete) return null;

          return (
            <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
              <svg className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              </svg>
              <div className="text-sm">
                <p className="font-medium text-amber-800">
                  {currentIncomplete ? "Current balance is estimated" : "Some months use estimated balances"}
                </p>
                <p className="mt-0.5 text-amber-700 text-xs">
                  {currentIncomplete
                    ? "Upload a statement for all accounts this month for an accurate net worth."
                    : `${incompleteMonths.length} month${incompleteMonths.length !== 1 ? "s" : ""} are missing a statement for at least one account.`}{" "}
                  <Link href="/account/accounts" className="font-medium underline hover:text-amber-900">Review accounts →</Link>
                </p>
              </div>
            </div>
          );
        })()}


        {/* ── NET WORTH hero ────────────────────────────────────────────────── */}
        <div className="rounded-2xl border border-gray-200 bg-white px-6 py-5 shadow-sm">
          <div className="flex items-baseline gap-2">
            <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">Net worth</p>
            <p className="text-xs text-gray-400">
              {monthLabel(yearMonth)}
              {statementCount > 0 && <> · {statementCount} statement{statementCount !== 1 ? "s" : ""}</>}
            </p>
          </div>
          <div className="mt-2 flex items-end gap-4">
            <p className="text-5xl font-extrabold tracking-tight text-gray-900 tabular-nums leading-none">
              {fmtNW(netWorth)}
            </p>
            {nwDelta != null && (
              <div className="relative mb-1 group/nwbadge">
                <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-sm font-semibold cursor-default ${
                  nwDelta >= 0
                    ? "bg-green-100 text-green-700"
                    : isLikelyNewAccount
                      ? "bg-amber-50 text-amber-700"   // soften — likely new account added
                      : "bg-red-100 text-red-600"
                }`}>
                  {nwDelta >= 0
                    ? <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" /></svg>
                    : <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
                  }
                  {fmtShort(nwDelta)} this month
                  {isLikelyNewAccount && (
                    <svg className="h-3.5 w-3.5 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  )}
                </span>
                {/* Tooltip — shown on hover when new account likely added */}
                {isLikelyNewAccount && (
                  <div className="pointer-events-none absolute left-0 top-full mt-2 z-10 hidden group-hover/nwbadge:block w-64">
                    <div className="rounded-xl border border-amber-200 bg-white px-3 py-2.5 shadow-lg text-xs text-gray-600 leading-relaxed">
                      <p className="font-semibold text-gray-800 mb-0.5">Why the drop?</p>
                      <p>Your debt increased this month — likely because a new account was added (mortgage, loan, or credit card), not an actual financial loss.</p>
                      <p className="mt-1 text-gray-400">Upload prior statements to fill in the history.</p>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
          {saved !== 0 && income > 0 && (
            <p className="mt-2 text-xs text-gray-400">
              {saved >= 0
                ? <><span className="font-medium text-blue-600">{fmt(saved)}</span> saved this month</>
                : <><span className="font-medium text-red-500">{fmt(Math.abs(saved))}</span> over budget this month</>
              }
            </p>
          )}
        </div>

        {/* ── Health signals strip ──────────────────────────────────────────── */}
        {statementCount >= 2 && (
          <SignalStrip signals={signals} score={score} status={trackStatus} onOpenModal={() => setModalOpen(true)} />
        )}

        {/* ── 4 KPI cards ───────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {/* Assets */}
          <Link href="/account/assets" className="group rounded-xl border border-gray-200 bg-white p-4 shadow-sm hover:border-purple-200 hover:shadow transition">
            <p className="text-xs text-gray-400">Assets</p>
            <p className="mt-1 text-xl font-bold text-gray-900 tabular-nums">{fmtNW(assets)}</p>
            {assetSubLabel
              ? <p className="mt-1 text-xs text-gray-400 truncate">{assetSubLabel}</p>
              : assetDelta != null
                ? <p className={`mt-1 text-xs font-medium ${assetDelta >= 0 ? "text-green-600" : "text-red-500"}`}>{fmtShort(assetDelta)} vs last mo</p>
                : null}
          </Link>

          {/* Debts */}
          <Link href="/account/liabilities" className="group rounded-xl border border-gray-200 bg-white p-4 shadow-sm hover:border-purple-200 hover:shadow transition">
            <p className="text-xs text-gray-400">Debts</p>
            <p className="mt-1 text-xl font-bold text-red-500 tabular-nums">{fmtNW(debts)}</p>
            {debtSubLabel
              ? <p className="mt-1 text-xs text-gray-400 truncate">{debtSubLabel}</p>
              : debtDelta != null && debts > 0
                ? <p className={`mt-1 text-xs font-medium ${debtDelta <= 0 ? "text-green-600" : "text-red-500"}`}>
                    {debtDelta <= 0 ? `${fmtShort(Math.abs(debtDelta))} paid down` : `${fmtShort(debtDelta)} more`}
                  </p>
                : null}
          </Link>

          {/* Avg Income/mo */}
          <Link href="/account/income" className="group rounded-xl border border-gray-200 bg-white p-4 shadow-sm hover:border-purple-200 hover:shadow transition">
            <p className="text-xs text-gray-400">Avg income/mo</p>
            <p className="mt-1 text-xl font-bold text-green-600 tabular-nums">
              {avgIncome > 0 ? fmtNW(avgIncome) : "—"}
            </p>
            {income > 0 && avgIncome > 0 ? (
              <p className={`mt-1 text-xs font-medium ${income >= avgIncome ? "text-green-600" : "text-amber-500"}`}>
                {fmt(income)} this month
              </p>
            ) : (
              <p className="mt-1 text-xs text-gray-400">
                {incomeMonths.length > 0 ? `${incomeMonths.length} month avg` : "no income data"}
              </p>
            )}
          </Link>

          {/* Typical Spending/mo */}
          <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <Link href="/account/spending" className="group block">
              <p className="text-xs text-gray-400">Typical spending/mo</p>
              <p className="mt-1 text-xl font-bold text-gray-900 tabular-nums">
                {medianExpenses > 0 ? fmtNW(medianExpenses) : "—"}
              </p>
              {expenses > 0 && medianExpenses > 0 ? (
                <p className={`mt-1 text-xs font-medium ${expenses <= medianExpenses ? "text-green-600" : "text-red-500"}`}>
                  {fmt(expenses)} this month
                </p>
              ) : (
                <p className="mt-1 text-xs text-gray-400">
                  {effectiveExpenseMonths.length > 0 ? `${effectiveExpenseMonths.length} month median` : "no spend data"}
                </p>
              )}
            </Link>
            <label
              className="mt-2.5 flex items-center gap-1.5 cursor-pointer select-none w-fit"
              title="Exclude transfers, debt payments &amp; investments from spending total"
              onClick={(e) => e.stopPropagation()}
            >
              <input
                type="checkbox"
                checked={excludeTransfers}
                onChange={(e) => {
                  setExcludeTransfers(e.target.checked);
                  localStorage.setItem("excludeTransfersFromTypical", String(e.target.checked));
                }}
                className="w-3 h-3 accent-purple-600 cursor-pointer"
              />
              <span className="text-[11px] text-gray-400">excl. transfers</span>
            </label>
          </div>
        </div>

        {/* ── Agent insight cards ───────────────────────────────────────────── */}
        {idToken && (
          <AgentInsightCards cards={agentCards} token={idToken} />
        )}

        {/* ── Net worth chart ───────────────────────────────────────────────── */}
        {chartHistory.length >= 2 && <NetWorthChart history={chartHistory} />}

      </div>

      {/* ── Signal breakdown modal ────────────────────────────────────────── */}
      {modalOpen && (
        <SignalModal
          signals={signals}
          score={score}
          status={trackStatus}
          onClose={() => setModalOpen(false)}
        />
      )}
    </>
  );
}
