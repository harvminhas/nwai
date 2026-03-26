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
import {
  scoreSource, detectFrequency,
  FREQUENCY_CONFIG, RELIABILITY_CONFIG,
} from "@/lib/incomeEngine";
import type { SourceMonthData } from "@/lib/incomeEngine";

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

// ── visual config ─────────────────────────────────────────────────────────────

const SOURCE_COLORS = [
  "#7c3aed", "#f59e0b", "#10b981", "#3b82f6", "#f97316", "#ec4899", "#06b6d4", "#84cc16",
];

// ── types ─────────────────────────────────────────────────────────────────────

interface HistoryPoint { yearMonth: string; incomeTotal: number; expensesTotal: number }
interface ConsolidatedData {
  income: { total: number; sources: IncomeSource[]; transactions?: IncomeTransaction[] };
  expenses: { total: number };
  savingsRate: number;
  /** Transaction-date-based totals (statements are ingestion only) */
  txIncome?: number;
  txExpenses?: number;
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

  useEffect(() => {
    const { auth } = getFirebaseClient();
    return onAuthStateChanged(auth, async (user) => {
      if (!user) { router.push("/login"); return; }
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
              // Transaction-date-based totals (statements are ingestion only)
              txIncome: json.txMonthlyIncome ?? json.data.income?.total ?? 0,
              txExpenses: json.txMonthlyExpenses ?? json.data.expenses?.total ?? 0,
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
            txIncome: json.txMonthlyIncome ?? json.data.income?.total ?? 0,
            txExpenses: json.txMonthlyExpenses ?? json.data.expenses?.total ?? 0,
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
  // Use transaction-date-based totals (statements are ingestion only)
  const expensesTotal   = current?.txExpenses ?? current?.expenses?.total ?? 0;
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
    const totalIncome = current?.txIncome ?? income?.total ?? 0;
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
  const incomeDelta = prevPoint != null ? (current?.txIncome ?? income?.total ?? 0) - prevPoint.incomeTotal : null;

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

          {/* No income for this month but we have history — data gap, not a financial problem */}
          {(current?.txIncome ?? income?.total ?? 0) === 0 && avgIncome > 0 ? (
            <div className="mt-3">
              <p className="font-semibold text-gray-500 text-lg">No deposits detected</p>
              <p className="mt-1 text-xs text-gray-400 leading-relaxed">
                No chequing or savings statement uploaded for {selectedMonth ? longMonth(selectedMonth) : "this period"}.
                Your {regularHistoryPoints.length}-month average is{" "}
                <span className="font-semibold text-gray-600">{fmt(avgIncome)}/mo</span>.
              </p>
              <Link
                href="/upload"
                className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-purple-200 bg-purple-50 px-3 py-1.5 text-xs font-semibold text-purple-700 hover:bg-purple-100 transition"
              >
                Upload a statement →
              </Link>
            </div>
          ) : (
            <>
              <p className="mt-2 font-bold text-4xl text-gray-900">{fmt(current?.txIncome ?? income?.total ?? 0)}</p>

              {incomeDelta !== null && incomeDelta !== 0 && (
                <p className={`mt-1 text-xs font-medium ${incomeDelta > 0 ? "text-green-600" : "text-amber-500"}`}>
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
                  <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${surplus >= 0 ? "border-green-200 bg-green-50 text-green-700" : "border-amber-200 bg-amber-50 text-amber-700"}`}>
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
            </>
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
                // Individual deposits for this source in the selected month
                const srcTxns     = transactions
                  .filter((t) => (t.source ?? t.description ?? "Other").trim() === src.description)
                  .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
                return (
                  <div key={src.description} className={src.reliability === "one-time" ? "opacity-60" : ""}>
                    <Link
                      href={`/account/income/${encodeURIComponent(src.description)}`}
                      className="block w-full text-left group"
                    >
                      <div className="flex items-start justify-between gap-2 mb-1.5">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: src.color }} />
                          <span className="font-medium text-sm text-gray-800 truncate group-hover:text-purple-600 transition-colors">
                            {src.description}
                          </span>
                        </div>
                        <div className="shrink-0 flex items-center gap-2">
                          <div className="text-right">
                            <span className="font-semibold text-sm text-gray-900 tabular-nums">{fmt(src.amount)}</span>
                            <span className="ml-2 text-xs text-gray-400">{src.pct}%</span>
                          </div>
                          <svg className="h-4 w-4 text-gray-300 group-hover:text-purple-400 transition-colors shrink-0"
                            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                          </svg>
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
                        {srcTxns.length > 0 && (
                          <span className="text-[10px] text-gray-300">· {srcTxns.length} deposit{srcTxns.length !== 1 ? "s" : ""} this month</span>
                        )}
                      </div>
                    </Link>
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
