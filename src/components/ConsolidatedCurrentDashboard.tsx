"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseClient } from "@/lib/firebase";
import NetWorthChart from "@/components/NetWorthChart";
import type { ParsedStatementData } from "@/lib/types";

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
  description: string;
  weight: number;   // nominal weight, will be redistributed if skipped
  status: SignalStatus;
  detail: string;   // one-line explanation of result
}

interface HistoryPoint {
  yearMonth: string;
  netWorth: number;
  incomeTotal: number;
  expensesTotal: number;
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
    if (!cur || !prev) return {
      id: "nw_trend", name: "Net worth trend",
      description: "Growing month-over-month",
      weight: 30, status: "skip",
      detail: "Not enough history yet",
    };
    const delta = cur.netWorth - prev.netWorth;
    const pct   = prev.netWorth !== 0 ? delta / Math.abs(prev.netWorth) : 0;
    if (pct > 0.005) return {
      id: "nw_trend", name: "Net worth trend",
      description: "Growing month-over-month",
      weight: 30, status: "pass",
      detail: `Up ${fmtShort(delta)} vs last month`,
    };
    if (pct >= -0.005) return {
      id: "nw_trend", name: "Net worth trend",
      description: "Growing month-over-month",
      weight: 30, status: "warning",
      detail: "Flat this month (within 0.5%)",
    };
    return {
      id: "nw_trend", name: "Net worth trend",
      description: "Growing month-over-month",
      weight: 30, status: "fail",
      detail: `Down ${fmtShort(Math.abs(delta))} vs last month`,
    };
  })();

  // ── 2. Savings rate (25%) ─────────────────────────────────────────────────
  const srSignal: Signal = (() => {
    if (!cur || cur.incomeTotal <= 0) return {
      id: "savings_rate", name: "Savings rate",
      description: "Saving ≥ 10% of take-home income this month",
      weight: 25, status: "skip",
      detail: "No income data this month",
    };
    const rate = (cur.incomeTotal - cur.expensesTotal) / cur.incomeTotal;
    if (rate >= 0.10) return {
      id: "savings_rate", name: "Savings rate",
      description: "Saving ≥ 10% of take-home income this month",
      weight: 25, status: "pass",
      detail: `Saving ${Math.round(rate * 100)}% of income`,
    };
    if (rate >= 0) return {
      id: "savings_rate", name: "Savings rate",
      description: "Saving ≥ 10% of take-home income this month",
      weight: 25, status: "warning",
      detail: `Saving ${Math.round(rate * 100)}% — target is 10%`,
    };
    return {
      id: "savings_rate", name: "Savings rate",
      description: "Saving ≥ 10% of take-home income this month",
      weight: 25, status: "fail",
      detail: `Spending ${fmt(cur.expensesTotal - cur.incomeTotal)} more than earned`,
    };
  })();

  // ── 3. Debt plan adherence (20%) ──────────────────────────────────────────
  const debtSignal: Signal = (() => {
    if (!hasDebts || !cur || cur.debtTotal <= 0) return {
      id: "debt_plan", name: "Debt plan adherence",
      description: "Debt balance decreasing month-over-month",
      weight: 20, status: "skip",
      detail: "No active debts — signal skipped",
    };
    if (!prev) return {
      id: "debt_plan", name: "Debt plan adherence",
      description: "Debt balance decreasing month-over-month",
      weight: 20, status: "skip",
      detail: "Not enough history yet",
    };
    const delta = cur.debtTotal - prev.debtTotal;
    if (delta < -10) return {
      id: "debt_plan", name: "Debt plan adherence",
      description: "Debt balance decreasing month-over-month",
      weight: 20, status: "pass",
      detail: `Paid down ${fmt(Math.abs(delta))} this month`,
    };
    if (delta <= 50) return {
      id: "debt_plan", name: "Debt plan adherence",
      description: "Debt balance decreasing month-over-month",
      weight: 20, status: "warning",
      detail: "Debt unchanged this month",
    };
    return {
      id: "debt_plan", name: "Debt plan adherence",
      description: "Debt balance decreasing month-over-month",
      weight: 20, status: "fail",
      detail: `Debt increased by ${fmt(delta)} this month`,
    };
  })();

  // ── 4. Spending vs budget (15%) ───────────────────────────────────────────
  const spendSignal: Signal = (() => {
    if (!cur || cur.expensesTotal <= 0 || prev3.length < 2) return {
      id: "spending_vs_budget", name: "Spending vs budget",
      description: "Total spend within 110% of 3-month average",
      weight: 15, status: "skip",
      detail: "Not enough history to set a baseline",
    };
    const avg = prev3.reduce((s, h) => s + h.expensesTotal, 0) / prev3.length;
    const ratio = avg > 0 ? cur.expensesTotal / avg : 1;
    if (ratio <= 1.0) return {
      id: "spending_vs_budget", name: "Spending vs budget",
      description: "Total spend within 110% of 3-month average",
      weight: 15, status: "pass",
      detail: `Spending at ${Math.round(ratio * 100)}% of avg — on target`,
    };
    if (ratio <= 1.10) return {
      id: "spending_vs_budget", name: "Spending vs budget",
      description: "Total spend within 110% of 3-month average",
      weight: 15, status: "warning",
      detail: `Spending at ${Math.round(ratio * 100)}% of avg — slightly elevated`,
    };
    return {
      id: "spending_vs_budget", name: "Spending vs budget",
      description: "Total spend within 110% of 3-month average",
      weight: 15, status: "fail",
      detail: `Spending at ${Math.round(ratio * 100)}% of avg — ${fmt(cur.expensesTotal - avg)} over`,
    };
  })();

  // ── 5. Goal trajectory (5%) ───────────────────────────────────────────────
  // Skipped until Goals feature is built
  const goalSignal: Signal = {
    id: "goal_trajectory", name: "Goal trajectory",
    description: "FI date within 12 months of original plan",
    weight: 5, status: "skip",
    detail: "Goals not set up yet",
  };

  // ── 6. Emergency fund buffer (5%) ─────────────────────────────────────────
  const efSignal: Signal = (() => {
    if (!cur || cur.expensesTotal <= 0) return {
      id: "emergency_fund", name: "Emergency fund buffer",
      description: "Liquid savings ≥ 1 month of expenses",
      weight: 5, status: "skip",
      detail: "No expense data to set benchmark",
    };
    if (liquidAssets <= 0) return {
      id: "emergency_fund", name: "Emergency fund buffer",
      description: "Liquid savings ≥ 1 month of expenses",
      weight: 5, status: "skip",
      detail: "No linked savings/chequing account",
    };
    const months = liquidAssets / cur.expensesTotal;
    if (months >= 1) return {
      id: "emergency_fund", name: "Emergency fund buffer",
      description: "Liquid savings ≥ 1 month of expenses",
      weight: 5, status: "pass",
      detail: `${months.toFixed(1)} months of expenses in liquid savings`,
    };
    if (months >= 0.5) return {
      id: "emergency_fund", name: "Emergency fund buffer",
      description: "Liquid savings ≥ 1 month of expenses",
      weight: 5, status: "warning",
      detail: `${months.toFixed(1)} months covered — target is 1 month`,
    };
    return {
      id: "emergency_fund", name: "Emergency fund buffer",
      description: "Liquid savings ≥ 1 month of expenses",
      weight: 5, status: "fail",
      detail: `Only ${months.toFixed(1)} months covered — needs attention`,
    };
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

  useEffect(() => {
    const { auth } = getFirebaseClient();
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) { router.push("/login"); return; }
      setLoading(true); setError(null);
      try {
        const token = await user.getIdToken();
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
          ? json.history.map((h: { yearMonth: string; netWorth: number; incomeTotal?: number; expensesTotal?: number; debtTotal?: number }) => ({
              yearMonth: h.yearMonth,
              netWorth: h.netWorth,
              incomeTotal: h.incomeTotal ?? 0,
              expensesTotal: h.expensesTotal ?? 0,
              debtTotal: h.debtTotal ?? 0,
              isEstimate: incomplete.includes(h.yearMonth),
            }))
          : []);
      } catch { setError("Failed to load dashboard"); }
      finally { setLoading(false); }
    });
    return () => unsub();
  }, [router, refreshKey]);

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
  const expenses   = data.expenses?.total ?? 0;
  const saved      = income - expenses;
  const hasDebts   = debts > 0;

  const nwDelta    = previousMonth != null ? netWorth - previousMonth.netWorth : null;
  const assetDelta = previousMonth != null ? assets   - previousMonth.assets   : null;
  const debtDelta  = previousMonth != null ? debts    - previousMonth.debts    : null;

  const assetSubLabel = assetLabels.map((l) => ASSET_TYPE_LABEL[l] ?? l).slice(0, 3).join(", ") || null;
  const debtSubLabel  = debtLabels.map((l) => DEBT_TYPE_LABEL[l] ?? l).slice(0, 3).join(" + ")   || null;

  // ── avg income / spending from history (months with data) ─────────────────
  const incomeMonths   = history.filter((h) => h.incomeTotal   > 0);
  const expenseMonths  = history.filter((h) => h.expensesTotal > 0);
  const avgIncome  = incomeMonths.length  > 0 ? incomeMonths.reduce((s, h)  => s + h.incomeTotal,   0) / incomeMonths.length  : 0;
  const avgExpenses= expenseMonths.length > 0 ? expenseMonths.reduce((s, h) => s + h.expensesTotal, 0) / expenseMonths.length : 0;

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
      <div className="space-y-5">

        {/* ── Header ───────────────────────────────────────────────────────── */}
        <div className="flex items-start justify-between">
          <p className="text-sm text-gray-400">
            {monthLabel(yearMonth)}
            {accountCount > 0 && (
              <> · <span className="text-gray-500">{accountCount} account{accountCount !== 1 ? "s" : ""} synced</span></>
            )}
            {statementCount > 0 && (
              <> · {statementCount} statement{statementCount !== 1 ? "s" : ""} combined</>
            )}
          </p>
          {/* On track badge — only shown after ≥2 statements, click opens modal */}
          {trackStatus && statementCount >= 2 && (
            <button
              onClick={() => setModalOpen(true)}
              className={`shrink-0 flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition hover:opacity-80 ${TRACK_CONFIG[trackStatus].badge}`}
              title="Click to see health check breakdown"
            >
              <span className={`h-1.5 w-1.5 rounded-full ${TRACK_CONFIG[trackStatus].dot}`} />
              {TRACK_CONFIG[trackStatus].label}
            </button>
          )}
        </div>

        {/* ── Incomplete months banner ──────────────────────────────────────── */}
        {incompleteMonths.length > 0 && (
          <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
            <svg className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            </svg>
            <div className="text-sm">
              <p className="font-medium text-amber-800">Trends still building</p>
              <p className="mt-0.5 text-amber-700 text-xs">
                {incompleteMonths.length} month{incompleteMonths.length !== 1 ? "s" : ""} use estimated balances.{" "}
                <Link href="/account/accounts" className="font-medium underline hover:text-amber-900">Review accounts →</Link>
              </p>
            </div>
          </div>
        )}


        {/* ── NET WORTH hero ────────────────────────────────────────────────── */}
        <div className="rounded-2xl border border-gray-200 bg-white px-6 py-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">Net worth</p>
          <div className="mt-2 flex items-end gap-4">
            <p className="text-5xl font-extrabold tracking-tight text-gray-900 tabular-nums leading-none">
              {fmtNW(netWorth)}
            </p>
            {nwDelta != null && (
              <span className={`mb-1 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-sm font-semibold ${
                nwDelta >= 0 ? "bg-green-100 text-green-700" : "bg-red-100 text-red-600"
              }`}>
                {nwDelta >= 0
                  ? <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" /></svg>
                  : <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
                }
                {fmtShort(nwDelta)} this month
              </span>
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

          {/* Avg Spending/mo */}
          <Link href="/account/spending" className="group rounded-xl border border-gray-200 bg-white p-4 shadow-sm hover:border-purple-200 hover:shadow transition">
            <p className="text-xs text-gray-400">Avg spending/mo</p>
            <p className="mt-1 text-xl font-bold text-gray-900 tabular-nums">
              {avgExpenses > 0 ? fmtNW(avgExpenses) : "—"}
            </p>
            {expenses > 0 && avgExpenses > 0 ? (
              <p className={`mt-1 text-xs font-medium ${expenses <= avgExpenses ? "text-green-600" : "text-red-500"}`}>
                {fmt(expenses)} this month
              </p>
            ) : (
              <p className="mt-1 text-xs text-gray-400">
                {expenseMonths.length > 0 ? `${expenseMonths.length} month avg` : "no spend data"}
              </p>
            )}
          </Link>
        </div>

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
