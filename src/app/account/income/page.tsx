"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseClient } from "@/lib/firebase";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip,
} from "recharts";
import type { IncomeTransaction, IncomeSource } from "@/lib/types";

// ── helpers ───────────────────────────────────────────────────────────────────

function fmt(v: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD",
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(v);
}
function fmtShort(v: number) {
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${Math.round(abs / 1_000)}k`;
  return fmt(v);
}
function fmtAxis(v: number) {
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${Math.round(abs / 1_000)}k`;
  return v === 0 ? "$0" : fmt(v);
}
function shortMonth(ym: string) {
  const [y, m] = ym.split("-");
  if (!m) return ym;
  return new Date(parseInt(y), parseInt(m) - 1, 1)
    .toLocaleDateString("en-US", { month: "short", year: "2-digit" });
}
function longMonth(ym: string) {
  const [y, m] = ym.split("-");
  if (!m) return ym;
  return new Date(parseInt(y), parseInt(m) - 1, 1)
    .toLocaleDateString("en-US", { month: "long", year: "numeric" });
}
function fmtDate(iso: string) {
  return new Date(iso + "T12:00:00")
    .toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ── reliability engine ────────────────────────────────────────────────────────

export type Reliability = "very stable" | "stable" | "quarterly" | "one-time" | "irregular";

// Keywords that indicate a one-time government/refund deposit
const ONE_TIME_KEYWORDS = [
  "cra", "gst", "hst", "refund", "rebate", "tax return", "ccb", "canada child",
  "oas", "cerb", "ei benefit", "ei payment", "stimulus", "benefit payment",
];
// Keywords that indicate quarterly cadence
const QUARTERLY_KEYWORDS = [
  "dividend", "quarterly", "distribution", "tfsa dividend", "rrsp dividend",
];

interface SourceMonthData {
  yearMonth: string;
  amount: number;
  transactions: { date?: string; amount: number }[];
}

interface ReliabilityResult {
  reliability: Reliability;
  score: number; // 0–100
  amountScore: number;
  timingScore: number;
  frequencyScore: number;
  note?: string; // e.g. "excluded from avg"
}

function scoreSource(
  description: string,
  history: SourceMonthData[],  // per-month data across all tracked months
  totalMonthsTracked: number,
): ReliabilityResult {
  const desc = description.toLowerCase();
  const n = history.length; // months this source appeared

  // ── One-time detection ─────────────────────────────────────────────────────
  const isOneTimeKeyword = ONE_TIME_KEYWORDS.some((k) => desc.includes(k));
  if (isOneTimeKeyword || (n === 1 && totalMonthsTracked >= 3)) {
    // Single appearance across 3+ months → likely one-time
    return {
      reliability: "one-time", score: 0,
      amountScore: 0, timingScore: 0, frequencyScore: 0,
      note: "excluded from monthly average",
    };
  }

  // ── Quarterly detection ────────────────────────────────────────────────────
  const isQuarterlyKeyword = QUARTERLY_KEYWORDS.some((k) => desc.includes(k));
  if (isQuarterlyKeyword) {
    return {
      reliability: "quarterly", score: 70,
      amountScore: 80, timingScore: 70, frequencyScore: 50,
    };
  }
  // Frequency-based quarterly detection (appears ~1 in 3 months)
  if (totalMonthsTracked >= 4) {
    const freq = n / totalMonthsTracked;
    if (freq >= 0.2 && freq <= 0.4) {
      return {
        reliability: "quarterly", score: 70,
        amountScore: 80, timingScore: 70, frequencyScore: 50,
      };
    }
  }

  // ── Amount consistency score (50% weight) ──────────────────────────────────
  let amountScore: number;
  if (n < 2) {
    // Single month: keyword fallback
    if (desc.includes("salary") || desc.includes("payroll") || desc.includes("wage")) amountScore = 95;
    else if (desc.includes("rental") || desc.includes("rent")) amountScore = 85;
    else amountScore = 50;
  } else {
    const amounts = history.map((h) => h.amount);
    const mean = amounts.reduce((s, a) => s + a, 0) / n;
    const stddev = Math.sqrt(amounts.reduce((s, a) => s + (a - mean) ** 2, 0) / n);
    const cv = mean > 0 ? stddev / mean : 1;
    // CV=0 → 100, CV=0.02 → ~93, CV=0.1 → ~67, CV=0.3 → 0
    amountScore = Math.max(0, Math.min(100, 100 - cv * 333));
  }

  // ── Timing consistency score (30% weight) ──────────────────────────────────
  let timingScore: number;
  const allTxns = history.flatMap((h) => h.transactions);
  const datedTxns = allTxns.filter((t) => t.date);

  if (datedTxns.length < 2) {
    // Keyword fallback
    if (desc.includes("salary") || desc.includes("payroll")) timingScore = 90;
    else if (desc.includes("rental") || desc.includes("rent")) timingScore = 75;
    else timingScore = 50;
  } else {
    const days = datedTxns.map((t) => new Date(t.date! + "T12:00:00").getDate());
    const txnsPerMonth = datedTxns.length / Math.max(n, 1);

    if (txnsPerMonth <= 1.3) {
      // Monthly cadence — measure day-of-month variance
      const mean = days.reduce((s, d) => s + d, 0) / days.length;
      const avgDeviation = days.reduce((s, d) => {
        // Wrap-around for end-of-month (e.g. 28/30/31 variance)
        const diff = Math.abs(d - mean);
        return s + Math.min(diff, 31 - diff);
      }, 0) / days.length;
      // 0 days deviation = 100, 3 days = ~55, 7 days = 0
      timingScore = Math.max(0, Math.min(100, 100 - avgDeviation * 14));
    } else {
      // Semi-monthly (e.g. 1st & 15th) — split first/second half and score each cluster
      const firstHalf = days.filter((d) => d <= 15);
      const secondHalf = days.filter((d) => d > 15);
      if (firstHalf.length > 0 && secondHalf.length > 0) {
        const calcClusterVariance = (cluster: number[]) => {
          const m = cluster.reduce((s, d) => s + d, 0) / cluster.length;
          return cluster.reduce((s, d) => s + Math.abs(d - m), 0) / cluster.length;
        };
        const v1 = calcClusterVariance(firstHalf);
        const v2 = calcClusterVariance(secondHalf);
        timingScore = Math.max(0, Math.min(100, 100 - ((v1 + v2) / 2) * 14));
      } else {
        timingScore = 60;
      }
    }
  }

  // ── Frequency score (20% weight) ──────────────────────────────────────────
  let frequencyScore: number;
  if (totalMonthsTracked <= 1) {
    frequencyScore = 50; // not enough data
  } else {
    frequencyScore = Math.min(100, (n / totalMonthsTracked) * 100);
  }

  // ── Weighted total ─────────────────────────────────────────────────────────
  const score = Math.round(amountScore * 0.5 + timingScore * 0.3 + frequencyScore * 0.2);

  let reliability: Reliability;
  if (score >= 88) reliability = "very stable";
  else if (score >= 70) reliability = "stable";
  else reliability = "irregular";

  return { reliability, score, amountScore: Math.round(amountScore), timingScore: Math.round(timingScore), frequencyScore: Math.round(frequencyScore) };
}

// ── frequency engine ─────────────────────────────────────────────────────────

export type Frequency =
  | "weekly" | "bi-weekly" | "monthly" | "quarterly" | "semi-annual" | "irregular";

interface FrequencyResult {
  frequency: Frequency;
  medianGap: number | null;
  stdDev: number | null;
  sampleCount: number; // number of dated transactions used
}

function detectFrequency(allDates: string[]): FrequencyResult {
  const dated = allDates.filter(Boolean).sort();
  if (dated.length < 2) {
    return { frequency: "irregular", medianGap: null, stdDev: null, sampleCount: dated.length };
  }

  // Compute day-gaps between consecutive deposits
  const timestamps = dated.map((d) => new Date(d + "T12:00:00").getTime());
  const gaps: number[] = [];
  for (let i = 1; i < timestamps.length; i++) {
    gaps.push(Math.round((timestamps[i] - timestamps[i - 1]) / 86_400_000));
  }

  // Median gap (resistant to outliers from missed months)
  const sorted = [...gaps].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];

  // Standard deviation
  const avg = gaps.reduce((s, g) => s + g, 0) / gaps.length;
  const stdDev = Math.sqrt(gaps.reduce((s, g) => s + (g - avg) ** 2, 0) / gaps.length);

  // Map median to bucket
  let bucket: Frequency;
  if (median <= 8) bucket = "weekly";
  else if (median <= 19) bucket = "bi-weekly";
  else if (median <= 45) bucket = "monthly";
  else if (median <= 100) bucket = "quarterly";
  else if (median <= 200) bucket = "semi-annual";
  else bucket = "irregular";

  // Downgrade if variance is too high (std_dev > 50% of median)
  if (bucket !== "irregular" && stdDev > 0.5 * median) {
    bucket = "irregular";
  }

  return { frequency: bucket, medianGap: median, stdDev: Math.round(stdDev), sampleCount: dated.length };
}

const FREQUENCY_CONFIG: Record<Frequency, { label: string; badge: string; description: string }> = {
  "weekly":      { label: "weekly",      badge: "border-blue-200 bg-blue-50 text-blue-700",     description: "Deposits arrive every week" },
  "bi-weekly":   { label: "bi-weekly",   badge: "border-purple-200 bg-purple-50 text-purple-700", description: "Twice a month — e.g. 1st & 15th" },
  "monthly":     { label: "monthly",     badge: "border-green-200 bg-green-50 text-green-700",   description: "Arrives once a month" },
  "quarterly":   { label: "quarterly",   badge: "border-amber-200 bg-amber-50 text-amber-700",   description: "Every ~3 months" },
  "semi-annual": { label: "semi-annual", badge: "border-indigo-200 bg-indigo-50 text-indigo-700", description: "Twice a year" },
  "irregular":   { label: "irregular",   badge: "border-orange-200 bg-orange-50 text-orange-600", description: "No consistent pattern" },
};

// ── visual config ─────────────────────────────────────────────────────────────

const SOURCE_COLORS = [
  "#7c3aed", "#f59e0b", "#10b981", "#3b82f6", "#f97316", "#ec4899", "#06b6d4", "#84cc16",
];

const RELIABILITY_CONFIG: Record<Reliability, {
  label: string; badge: string; barColor: string; barWidthClass: string; description: string;
}> = {
  "very stable": {
    label: "very stable",
    badge: "border-green-200 bg-green-50 text-green-700",
    barColor: "#10b981",
    barWidthClass: "w-full",
    description: "Consistent amount, predictable timing every month",
  },
  "stable": {
    label: "stable",
    badge: "border-green-100 bg-green-50 text-green-600",
    barColor: "#34d399",
    barWidthClass: "w-4/5",
    description: "Reliable amount, minor timing variance allowed",
  },
  "quarterly": {
    label: "quarterly",
    badge: "border-amber-200 bg-amber-50 text-amber-600",
    barColor: "#f59e0b",
    barWidthClass: "w-2/5",
    description: "Predictable every ~3 months — cadence, not instability",
  },
  "one-time": {
    label: "one-time",
    badge: "border-gray-200 bg-gray-50 text-gray-500",
    barColor: "#d1d5db",
    barWidthClass: "w-1/12",
    description: "Single deposit — excluded from monthly average",
  },
  "irregular": {
    label: "irregular",
    badge: "border-orange-200 bg-orange-50 text-orange-600",
    barColor: "#fb923c",
    barWidthClass: "w-1/4",
    description: "No consistent pattern detected",
  },
};

// ── types ─────────────────────────────────────────────────────────────────────

interface HistoryPoint { yearMonth: string; incomeTotal: number; expensesTotal: number }
interface ConsolidatedData {
  income: { total: number; sources: IncomeSource[]; transactions?: IncomeTransaction[] };
  expenses: { total: number };
  savingsRate: number;
}

// ── page ──────────────────────────────────────────────────────────────────────

export default function IncomePage() {
  const router = useRouter();

  const [history, setHistory]             = useState<HistoryPoint[]>([]);
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  const [dataByMonth, setDataByMonth]     = useState<Record<string, ConsolidatedData>>({});
  const [sourceHistory, setSourceHistory] = useState<Record<string, SourceMonthData[]>>({});
  const [totalMonths, setTotalMonths]     = useState(0);
  const [loading, setLoading]             = useState(true);
  const [error, setError]                 = useState<string | null>(null);
  const [showAllTxns, setShowAllTxns]     = useState(false);
  const [expandedSource, setExpandedSource] = useState<string | null>(null);

  useEffect(() => {
    const { auth } = getFirebaseClient();
    return onAuthStateChanged(auth, async (user) => {
      if (!user) { router.push("/account/login"); return; }
      setLoading(true); setError(null);
      try {
        const token = await user.getIdToken();
        const res = await fetch("/api/user/statements/consolidated", {
          headers: { Authorization: `Bearer ${token}` },
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) { setError(json.error || "Failed to load"); return; }

        const hist: HistoryPoint[] = (json.history ?? []).map(
          (h: { yearMonth: string; incomeTotal?: number; expensesTotal?: number }) => ({
            yearMonth: h.yearMonth,
            incomeTotal: h.incomeTotal ?? 0,
            expensesTotal: h.expensesTotal ?? 0,
          })
        );
        setHistory(hist);
        setTotalMonths(json.totalMonthsTracked ?? hist.length);
        setSourceHistory(json.incomeSourceHistory ?? {});

        const latestYm: string = json.yearMonth ?? null;
        setSelectedMonth(latestYm);
        if (latestYm && json.data) {
          setDataByMonth({
            [latestYm]: {
              income: json.data.income ?? { total: 0, sources: [], transactions: [] },
              expenses: json.data.expenses ?? { total: 0 },
              savingsRate: json.data.savingsRate ?? 0,
            },
          });
        }
      } catch { setError("Failed to load income data"); }
      finally { setLoading(false); }
    });
  }, [router]);

  async function fetchMonth(ym: string) {
    if (dataByMonth[ym]) { setSelectedMonth(ym); return; }
    try {
      const { auth } = getFirebaseClient();
      const user = auth.currentUser;
      if (!user) return;
      const token = await user.getIdToken();
      const res = await fetch(`/api/user/statements/consolidated?month=${ym}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json.data) {
        setDataByMonth((prev) => ({
          ...prev,
          [ym]: {
            income: json.data.income ?? { total: 0, sources: [], transactions: [] },
            expenses: json.data.expenses ?? { total: 0 },
            savingsRate: json.data.savingsRate ?? 0,
          },
        }));
      }
    } catch { /* ignore */ }
    setSelectedMonth(ym);
  }

  // ── derived ──────────────────────────────────────────────────────────────────

  const current         = selectedMonth ? dataByMonth[selectedMonth] : null;
  const income          = current?.income;
  const sources         = income?.sources ?? [];
  const transactions    = income?.transactions ?? [];
  const expensesTotal   = current?.expenses?.total ?? 0;
  const savingsRate     = current?.savingsRate ?? 0;

  // Derive sources from transactions (ground truth) when available;
  // fall back to income.sources only if no transactions exist.
  const mergedSourceMap = new Map<string, number>();
  if (transactions.length > 0) {
    // Group transactions by their source field
    for (const txn of transactions) {
      const key = (txn.source ?? txn.description ?? "Other").trim();
      mergedSourceMap.set(key, (mergedSourceMap.get(key) ?? 0) + txn.amount);
    }
  } else {
    // Fallback: merge income.sources by description (case-insensitive)
    for (const src of sources) {
      const key = src.description.trim();
      mergedSourceMap.set(key, (mergedSourceMap.get(key) ?? 0) + src.amount);
    }
  }
  const mergedSources = Array.from(mergedSourceMap.entries())
    .map(([description, amount]) => ({ description, amount }))
    .sort((a, b) => b.amount - a.amount);

  // Score each consolidated source using cross-month history
  const scoredSources = mergedSources.map((src, i) => {
    const hist = sourceHistory[src.description] ?? [];
    const result = scoreSource(src.description, hist, totalMonths);
    const totalIncome = income?.total ?? 0;
    const pct = totalIncome > 0 ? Math.round((src.amount / totalIncome) * 100) : 0;

    // Frequency: gather ALL dated transactions for this source across all months
    const allDates = hist.flatMap((h) => h.transactions.map((t) => t.date).filter(Boolean) as string[]);
    const freqResult = detectFrequency(allDates);

    return {
      ...src,
      color: SOURCE_COLORS[i % SOURCE_COLORS.length],
      pct,
      ...result,
      freqResult,
    };
  });

  // One-time sources excluded from monthly average
  const regularSources  = scoredSources.filter((s) => s.reliability !== "one-time");
  const oneTimeSources  = scoredSources.filter((s) => s.reliability === "one-time");
  const regularTotal    = regularSources.reduce((s, src) => s + src.amount, 0);
  const oneTimeTotal    = oneTimeSources.reduce((s, src) => s + src.amount, 0);

  // Use regularTotal for surplus/savings calculations (one-time deposits excluded)
  const surplus = regularTotal - expensesTotal;

  // Chart data
  const sortedHistory = [...history].sort((a, b) => a.yearMonth.localeCompare(b.yearMonth));
  const chartData = sortedHistory.map((h) => ({
    label: shortMonth(h.yearMonth),
    income: h.incomeTotal,
  }));

  // Monthly avg from regular history points only (exclude spike months if possible)
  const regularHistoryPoints = sortedHistory.filter((h) => h.incomeTotal > 0);
  const avgIncome = regularHistoryPoints.length > 0
    ? Math.round(regularHistoryPoints.reduce((s, h) => s + h.incomeTotal, 0) / regularHistoryPoints.length)
    : 0;

  // Previous month delta
  const currentIdx = selectedMonth ? sortedHistory.findIndex((h) => h.yearMonth === selectedMonth) : -1;
  const prevPoint  = currentIdx > 0 ? sortedHistory[currentIdx - 1] : null;
  const incomeDelta = prevPoint != null ? (income?.total ?? 0) - prevPoint.incomeTotal : null;

  const tabMonths      = sortedHistory.slice(-6).map((h) => h.yearMonth);
  const visibleTxns    = showAllTxns ? transactions : transactions.slice(0, 6);

  // ── render ───────────────────────────────────────────────────────────────────

  if (loading) return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <div className="h-10 w-10 animate-spin rounded-full border-4 border-purple-600 border-t-transparent" />
    </div>
  );
  if (error) return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <p className="text-red-600">{error}</p>
    </div>
  );
  if (history.length === 0) return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-12 text-center">
        <p className="text-sm text-gray-500">No income data yet.</p>
        <p className="mt-1 text-xs text-gray-400">Upload a chequing or savings statement to see your income breakdown.</p>
        <Link href="/upload" className="mt-4 inline-block rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700">
          Upload a statement
        </Link>
      </div>
    </div>
  );

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">

      {/* Header */}
      <div className="mb-1">
        <h1 className="font-bold text-3xl text-gray-900">Income</h1>
        <p className="mt-0.5 text-sm text-gray-400">
          Inferred from deposits{selectedMonth && <> · {longMonth(selectedMonth)}</>}
        </p>
      </div>

      {/* Month tabs */}
      {tabMonths.length > 1 && (
        <div className="mt-4 flex gap-1.5 overflow-x-auto pb-1">
          {tabMonths.map((ym) => (
            <button key={ym} onClick={() => fetchMonth(ym)}
              className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                ym === selectedMonth
                  ? "bg-purple-600 text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {shortMonth(ym)}
            </button>
          ))}
        </div>
      )}

      <div className="mt-5 space-y-4">

        {/* ── Summary card ───────────────────────────────────────────────────── */}
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">
            total received · {selectedMonth ? longMonth(selectedMonth) : ""}
          </p>
          <p className="mt-2 font-bold text-4xl text-gray-900">{fmt(income?.total ?? 0)}</p>

          {incomeDelta !== null && incomeDelta !== 0 && (
            <p className={`mt-1 text-xs font-medium ${incomeDelta > 0 ? "text-green-600" : "text-red-500"}`}>
              {incomeDelta > 0 ? "↑" : "↓"} {fmtShort(Math.abs(incomeDelta))} vs {prevPoint ? shortMonth(prevPoint.yearMonth) : "last month"}
            </p>
          )}
          {incomeDelta === null && <p className="mt-1 text-xs text-gray-400">First month tracked</p>}

          {/* One-time note */}
          {oneTimeTotal > 0 && (
            <p className="mt-1 text-xs text-amber-600">
              Includes {fmt(oneTimeTotal)} one-time deposit{oneTimeSources.length > 1 ? "s" : ""} — excluded from averages
            </p>
          )}

          {/* Surplus / spent / savings rate pills */}
          {regularTotal > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${surplus >= 0 ? "border-green-200 bg-green-50 text-green-700" : "border-red-200 bg-red-50 text-red-700"}`}>
                {surplus >= 0 ? "surplus" : "deficit"} {surplus >= 0 ? "+" : ""}{fmt(surplus)}
              </span>
              {expensesTotal > 0 && (
                <span className="rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs font-semibold text-gray-600">
                  spent {fmt(expensesTotal)}
                </span>
              )}
              {savingsRate > 0 && (
                <span className="rounded-full border border-purple-200 bg-purple-50 px-3 py-1 text-xs font-semibold text-purple-700">
                  savings rate {savingsRate}%
                </span>
              )}
            </div>
          )}
        </div>

        {/* ── Monthly income trend chart ──────────────────────────────────────── */}
        {chartData.length >= 2 && (
          <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-gray-400">Monthly income</p>
            {avgIncome > 0 && (
              <p className="mb-3 text-xs text-gray-400">
                {regularHistoryPoints.length}-month avg{" "}
                <span className="font-semibold text-gray-600">{fmt(avgIncome)} / mo</span>
              </p>
            )}
            <div className="h-44">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#9ca3af" }} tickLine={false} axisLine={false} />
                  <YAxis tickFormatter={fmtAxis} tick={{ fontSize: 11, fill: "#9ca3af" }} tickLine={false} axisLine={false} width={52} />
                  <Tooltip
                    formatter={(v) => [typeof v === "number" ? fmt(v) : String(v), "Income"]}
                    contentStyle={{ borderRadius: "8px", border: "1px solid #e5e7eb", fontSize: "13px" }}
                    labelStyle={{ fontWeight: 600, color: "#111827" }}
                  />
                  <Line type="monotone" dataKey="income" stroke="#7c3aed" strokeWidth={2}
                    dot={{ fill: "#7c3aed", strokeWidth: 0, r: 3 }}
                    activeDot={{ r: 5, fill: "#7c3aed", stroke: "#fff", strokeWidth: 2 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* ── By source ──────────────────────────────────────────────────────── */}
        {scoredSources.length > 0 && (
          <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <p className="mb-4 text-xs font-semibold uppercase tracking-wider text-gray-400">By source</p>
            <div className="space-y-5">
              {scoredSources.map((src) => {
                const fcfg        = FREQUENCY_CONFIG[src.freqResult.frequency];
                const hasFreqData = src.freqResult.sampleCount >= 2;
                const gapHint     = hasFreqData && src.freqResult.medianGap != null
                  ? src.freqResult.stdDev != null && src.freqResult.stdDev <= 3
                    ? `every ${src.freqResult.medianGap}d`
                    : `~${src.freqResult.medianGap}d gaps`
                  : null;
                const isExpanded  = expandedSource === src.description;
                // Individual deposits for this source in the selected month
                const srcTxns     = transactions
                  .filter((t) => (t.source ?? t.description ?? "Other").trim() === src.description)
                  .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
                const hasBreakdown = srcTxns.length > 1 || (srcTxns.length === 1 && srcTxns[0].amount !== src.amount);

                return (
                  <div key={src.description} className={src.reliability === "one-time" ? "opacity-60" : ""}>
                    {/* Clickable header row */}
                    <button
                      className="w-full text-left"
                      onClick={() => hasBreakdown && setExpandedSource(isExpanded ? null : src.description)}
                      title={hasBreakdown ? "Click to see individual deposits" : undefined}
                    >
                      <div className="flex items-start justify-between gap-2 mb-1.5">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: src.color }} />
                          <span className="font-medium text-sm text-gray-800 truncate">{src.description}</span>
                          {hasBreakdown && (
                            <span className="text-gray-300 text-xs">{isExpanded ? "▲" : "▾"}</span>
                          )}
                        </div>
                        <div className="shrink-0 text-right">
                          <span className="font-semibold text-sm text-gray-900 tabular-nums">{fmt(src.amount)}</span>
                          <span className="ml-2 text-xs text-gray-400">{src.pct}%</span>
                        </div>
                      </div>
                      {/* Amount bar */}
                      <div className="mb-2 h-1.5 w-full rounded-full bg-gray-100 overflow-hidden">
                        <div className="h-full rounded-full transition-all"
                          style={{ width: `${src.pct}%`, backgroundColor: src.color }} />
                      </div>
                      {/* Frequency badge + gap hint */}
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold border ${fcfg.badge}`}>
                          {fcfg.label}
                        </span>
                        {gapHint && (
                          <span className="text-[10px] text-gray-400 tabular-nums">{gapHint}</span>
                        )}
                        {src.reliability === "one-time" && (
                          <span className="text-[10px] text-gray-400">· excluded from avg</span>
                        )}
                        {hasBreakdown && !isExpanded && (
                          <span className="text-[10px] text-gray-300">· {srcTxns.length} deposits</span>
                        )}
                      </div>
                    </button>

                    {/* Expanded breakdown */}
                    {isExpanded && srcTxns.length > 0 && (
                      <div className="mt-2 rounded-lg border border-gray-100 bg-gray-50 divide-y divide-gray-100">
                        {srcTxns.map((t, i) => (
                          <div key={i} className="flex items-center justify-between px-3 py-2">
                            <div>
                              <p className="text-xs font-medium text-gray-700">{t.description}</p>
                              {t.date && (
                                <p className="text-[10px] text-gray-400">{fmtDate(t.date)}</p>
                              )}
                            </div>
                            <span className="text-xs font-semibold tabular-nums text-green-600">+{fmt(t.amount)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Reliability by source ──────────────────────────────────────────── */}
        {scoredSources.filter((s) => s.reliability !== "one-time").length > 0 && (
          <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-gray-400">Reliability by source</p>
            <p className="mb-4 text-xs text-gray-400">
              Based on amount consistency, timing, and frequency across months
            </p>
            <div className="space-y-4">
              {scoredSources
                .filter((s) => s.reliability !== "one-time")
                .map((src) => {
                  const rcfg = RELIABILITY_CONFIG[src.reliability];
                  const fcfg = FREQUENCY_CONFIG[src.freqResult.frequency];
                  const isQuarterly = src.reliability === "quarterly";
                  const hasFreq = src.freqResult.sampleCount >= 2;
                  // Not enough cross-month data to score reliably
                  const needsMoreData = totalMonths < 2 || (sourceHistory[src.description]?.length ?? 0) < 2;
                  return (
                    <div key={src.description}>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-xs font-medium text-gray-700 truncate max-w-[160px]">{src.description}</span>
                        {needsMoreData ? (
                          <span className="text-[10px] text-gray-400 italic">building — needs more months</span>
                        ) : (
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold border ${rcfg.badge}`}>
                            {rcfg.label}
                          </span>
                        )}
                      </div>
                      {/* Reliability bar — dimmed when insufficient data */}
                      <div className={`flex h-1.5 w-full overflow-hidden rounded-full ${needsMoreData ? "bg-gray-100" : "bg-gray-100"}`}>
                        {needsMoreData ? (
                          <div className="h-full w-1/4 rounded-full bg-gray-200 animate-pulse" />
                        ) : (
                          <div className="h-full rounded-full transition-all"
                            style={{ width: `${src.score}%`, backgroundColor: rcfg.barColor }} />
                        )}
                      </div>
                      {needsMoreData && (
                        <p className="mt-1 text-[10px] text-gray-400">
                          Upload more months to unlock reliability scoring
                        </p>
                      )}
                      {!needsMoreData && isQuarterly && (
                        <p className="mt-1 text-[10px] text-amber-600">{rcfg.description}</p>
                      )}
                      {/* Frequency cadence detail — only when we have real gap data */}
                      {hasFreq && (
                        <div className="mt-2 flex items-center gap-2">
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold border ${fcfg.badge}`}>
                            {fcfg.label}
                          </span>
                          <span className="text-[10px] text-gray-400">
                            {fcfg.description}
                            {src.freqResult.medianGap != null && (
                              <> · median gap <span className="font-medium text-gray-600">{src.freqResult.medianGap}d</span></>
                            )}
                            {src.freqResult.stdDev != null && src.freqResult.stdDev > 0 && (
                              <> ±{src.freqResult.stdDev}d</>
                            )}
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          </div>
        )}

        {/* ── All deposits ───────────────────────────────────────────────────── */}
        {transactions.length > 0 && (
          <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                All deposits · {selectedMonth ? longMonth(selectedMonth) : ""}
              </p>
              <span className="text-xs text-gray-400">{transactions.length} total</span>
            </div>
            <div className="divide-y divide-gray-100">
              {visibleTxns.map((txn, i) => {
                const srcEntry = scoredSources.find((s) => s.description === (txn.source ?? txn.description ?? "Other").trim());
                const cfg = srcEntry ? RELIABILITY_CONFIG[srcEntry.reliability] : null;
                return (
                  <div key={i} className="flex items-center justify-between py-3">
                    <div>
                      <p className="text-sm font-medium text-gray-800">{txn.description}</p>
                      <p className="text-xs text-gray-400 flex items-center gap-1.5">
                        {txn.date && <span>{fmtDate(txn.date)}</span>}
                        {txn.source && <><span>·</span><span className="text-purple-500">{txn.source}</span></>}
                        {cfg && (
                          <><span>·</span>
                          <span className={`rounded px-1.5 py-0.5 text-[9px] font-semibold border ${cfg.badge}`}>
                            {cfg.label}
                          </span></>
                        )}
                      </p>
                    </div>
                    <span className={`font-semibold text-sm tabular-nums ${srcEntry?.reliability === "one-time" ? "text-gray-400" : "text-green-600"}`}>
                      +{fmt(txn.amount)}
                    </span>
                  </div>
                );
              })}
            </div>
            {transactions.length > 6 && (
              <button onClick={() => setShowAllTxns((v) => !v)}
                className="mt-3 text-xs font-medium text-purple-600 hover:underline">
                {showAllTxns ? "Show less" : `View all ${transactions.length} deposits`}
              </button>
            )}
          </div>
        )}

        {sources.length === 0 && (
          <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-8 text-center">
            <p className="text-sm text-gray-500">No income found for this month.</p>
            <p className="mt-1 text-xs text-gray-400">Upload a chequing or savings statement to see deposits.</p>
            <Link href="/upload" className="mt-3 inline-block text-sm font-medium text-purple-600 hover:underline">
              Upload a statement →
            </Link>
          </div>
        )}

      </div>
    </div>
  );
}
