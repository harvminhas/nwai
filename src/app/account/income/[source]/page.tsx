"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter, useParams } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseClient } from "@/lib/firebase";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, ReferenceLine,
} from "recharts";
import {
  scoreSource,
  detectFrequency,
  FREQUENCY_CONFIG,
  RELIABILITY_CONFIG,
} from "@/lib/incomeEngine";
import type { SourceMonthData } from "@/lib/incomeEngine";
import { fmt, getCurrencySymbol } from "@/lib/currencyUtils";
import { pairKey } from "@/lib/sourceMappings";
import type { SourceSuggestion, SourceMapping } from "@/lib/sourceMappings";

// ── helpers ───────────────────────────────────────────────────────────────────

function fmtAxis(v: number) {
  const sym = getCurrencySymbol();
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${sym}${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sym}${Math.round(abs / 1_000)}k`;
  return v === 0 ? `${sym}0` : fmt(v);
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
    .toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// ── page ──────────────────────────────────────────────────────────────────────

export default function IncomeSourcePage() {
  const router = useRouter();
  const params = useParams();
  const sourceName = decodeURIComponent(params.source as string);

  const [history, setHistory]             = useState<SourceMonthData[]>([]);
  const [totalMonths, setTotalMonths]     = useState(0);
  const [loading, setLoading]             = useState(true);
  const [error, setError]                 = useState<string | null>(null);
  const [expandedMonth, setExpandedMonth] = useState<string | null>(null);
  const [token, setToken]                 = useState<string | null>(null);

  // Merge state
  const [similarSources, setSimilarSources]   = useState<SourceSuggestion[]>([]);
  const [mergeExpanded, setMergeExpanded]     = useState(false);
  const [mergeSelected, setMergeSelected]     = useState<Set<string>>(new Set());
  const [merging, setMerging]                 = useState(false);

  const loadData = useCallback(async (tok: string) => {
    try {
      const consolidatedRes = await fetch("/api/user/statements/consolidated", {
        headers: { Authorization: `Bearer ${tok}` },
      });
      const json = await consolidatedRes.json().catch(() => ({}));
      if (!consolidatedRes.ok) { setError(json.error ?? "Failed to load"); return; }

      const sourceHist: Record<string, SourceMonthData[]> = json.incomeSourceHistory ?? {};
      const months = (sourceHist[sourceName] ?? [])
        .slice()
        .sort((a, b) => b.yearMonth.localeCompare(a.yearMonth));
      setHistory(months);
      setTotalMonths(json.totalMonthsTracked ?? 0);
      if (months.length > 0) setExpandedMonth(months[0].yearMonth);

      // Use server-computed incomeSuggestions (includes both statement + cash sources,
      // already filtered against existing mappings). Filter to pairs involving this source.
      const allSuggestions: SourceSuggestion[] = json.incomeSuggestions ?? [];
      const lc = sourceName.toLowerCase();
      const relevant = allSuggestions.filter(
        (s) => s.canonical.toLowerCase() === lc || s.alias.toLowerCase() === lc
      );
      const normalised = relevant.map((s) => {
        const matchesCanonical = s.canonical.toLowerCase() === lc;
        return matchesCanonical
          ? { ...s, canonical: sourceName }
          : { ...s, canonical: sourceName, alias: s.canonical };
      });
      setSimilarSources(normalised);
    } catch { setError("Failed to load source data"); }
    finally { setLoading(false); }
  }, [sourceName]);

  useEffect(() => {
    const { auth } = getFirebaseClient();
    return onAuthStateChanged(auth, async (user) => {
      if (!user) { router.push("/login"); return; }
      setLoading(true); setError(null);
      const tok = await user.getIdToken();
      setToken(tok);
      await loadData(tok);
    });
  }, [router, loadData]);

  // ── merge handler ─────────────────────────────────────────────────────────

  async function handleMerge() {
    if (!token || mergeSelected.size === 0) return;
    setMerging(true);
    try {
      const toSave: SourceMapping[] = Array.from(mergeSelected).map((alias) => {
        const key = pairKey(sourceName, alias);
        return {
          id:           key.replace(/\|/g, "_"),
          pairKey:      key,
          type:         "income" as const,
          canonical:    sourceName,
          alias,
          status:       "confirmed" as const,
          affectsCache: false,
          createdAt:    new Date().toISOString(),
        };
      });
      await fetch("/api/user/source-mappings", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ mappings: toSave }),
      });
      setMergeSelected(new Set());
      setSimilarSources((prev) => prev.filter((s) => !mergeSelected.has(s.alias)));
      setMergeExpanded(false);
      // Reload so history reflects the merge
      setLoading(true);
      await loadData(token);
    } finally { setMerging(false); }
  }

  // ── derived ───────────────────────────────────────────────────────────────

  const reliabilityResult = history.length > 0
    ? scoreSource(sourceName, history, totalMonths)
    : null;

  const allDates = history.flatMap((h) =>
    h.transactions.map((t) => t.date).filter(Boolean) as string[]
  );
  const freqResult = detectFrequency(allDates);

  const totalEarned = history.reduce((s, h) => s + h.amount, 0);
  const avgPerMonth = history.length > 0 ? Math.round(totalEarned / history.length) : 0;
  const maxAmount   = Math.max(...history.map((h) => h.amount), 0);

  const chartData = [...history]
    .sort((a, b) => a.yearMonth.localeCompare(b.yearMonth))
    .map((h) => ({ label: shortMonth(h.yearMonth), amount: h.amount, ym: h.yearMonth }));

  const reliability = reliabilityResult?.reliability ?? "irregular";
  const rcfg        = RELIABILITY_CONFIG[reliability];
  const fcfg        = FREQUENCY_CONFIG[freqResult.frequency];

  const needsMoreData = totalMonths < 2 || history.length < 2;

  // ── render ────────────────────────────────────────────────────────────────

  if (loading) return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <div className="h-10 w-10 animate-spin rounded-full border-4 border-purple-600 border-t-transparent" />
    </div>
  );
  if (error) return (
    <div className="mx-auto max-w-2xl lg:max-w-5xl px-4 pt-4 pb-8 sm:py-8">
      <p className="text-red-600">{error}</p>
    </div>
  );

  return (
    <div className="mx-auto max-w-2xl lg:max-w-5xl px-4 pt-4 pb-8 sm:py-8 sm:px-6">

      {/* Back nav */}
      <Link
        href="/account/income"
        className="mb-5 inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-700 transition"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
        Income
      </Link>

      {/* Similar sources — merge banner */}
      {similarSources.length > 0 && (
        <div className="mb-4 rounded-xl border border-purple-200 bg-purple-50/40 overflow-hidden">
          <div role="button" tabIndex={0}
            className="flex w-full items-center gap-2 px-4 py-3 text-left cursor-pointer hover:bg-purple-50 transition"
            onClick={() => setMergeExpanded((v) => !v)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setMergeExpanded((v) => !v); }}
          >
            <svg className="h-4 w-4 shrink-0 text-purple-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            <p className="flex-1 text-sm font-semibold text-purple-900">
              {similarSources.length} similar source{similarSources.length !== 1 ? "s" : ""} found — merge to combine history
            </p>
            {mergeSelected.size >= 1 && (
              <button
                onClick={(e) => { e.stopPropagation(); void handleMerge(); }}
                disabled={merging}
                className="shrink-0 rounded-lg bg-purple-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-purple-700 disabled:opacity-50 transition"
              >
                {merging ? "Merging…" : `Merge ${mergeSelected.size}`}
              </button>
            )}
            <svg className={`h-4 w-4 shrink-0 text-purple-400 transition-transform ${mergeExpanded ? "rotate-180" : ""}`}
              fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </div>
          {mergeExpanded && (
            <div className="border-t border-purple-100 divide-y divide-purple-100/60">
              {similarSources.map((s) => {
                const checked = mergeSelected.has(s.alias);
                return (
                  <button key={s.alias}
                    onClick={() => setMergeSelected((prev) => {
                      const next = new Set(prev);
                      checked ? next.delete(s.alias) : next.add(s.alias);
                      return next;
                    })}
                    className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-purple-50/60 ${checked ? "" : "opacity-60"}`}
                  >
                    <span className={`shrink-0 h-4 w-4 rounded border flex items-center justify-center transition ${checked ? "border-purple-500 bg-purple-500" : "border-gray-300 bg-white"}`}>
                      {checked && <svg className="h-2.5 w-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
                    </span>
                    <span className="flex-1 text-sm text-gray-800 truncate">{s.alias}</span>
                    <svg className="h-3 w-3 shrink-0 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M17 8l4 4m0 0l-4 4m4-4H3" /></svg>
                    <span className="text-sm text-gray-500 truncate">{sourceName}</span>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${s.confidence === "high" ? "bg-green-100 text-green-700" : "bg-yellow-100 text-yellow-700"}`}>
                      {s.confidence}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900 truncate">{sourceName}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${fcfg.badge}`}>
            {fcfg.label}
          </span>
          {!needsMoreData && (
            <span className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${rcfg.badge}`}>
              {rcfg.label}
            </span>
          )}
          {needsMoreData && (
            <span className="text-xs text-gray-400 italic">building — needs more months</span>
          )}
        </div>
      </div>

      <div className="space-y-4">

        {/* ── KPI strip ────────────────────────────────────────────────────── */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Total earned",   value: fmt(totalEarned) },
            { label: "Avg per month",  value: fmt(avgPerMonth) },
            { label: "Months tracked", value: String(history.length) },
          ].map(({ label, value }) => (
            <div key={label} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm text-center">
              <p className="text-xs text-gray-400">{label}</p>
              <p className="mt-1 text-lg font-bold text-gray-900">{value}</p>
            </div>
          ))}
        </div>

        {/* ── Chart ────────────────────────────────────────────────────────── */}
        {chartData.length >= 2 && (
          <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <p className="mb-4 text-xs font-semibold uppercase tracking-wider text-gray-400">Monthly amounts</p>
            <div className="h-44">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}
                  onClick={(d) => {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const payload = (d as any)?.activePayload?.[0]?.payload;
                    if (payload?.ym) setExpandedMonth(payload.ym as string);
                  }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#9ca3af" }} tickLine={false} axisLine={false} />
                  <YAxis tickFormatter={fmtAxis} tick={{ fontSize: 11, fill: "#9ca3af" }} tickLine={false} axisLine={false} width={52} />
                  <Tooltip
                    formatter={(v) => [typeof v === "number" ? fmt(v) : String(v), sourceName]}
                    contentStyle={{ borderRadius: "8px", border: "1px solid #e5e7eb", fontSize: "13px" }}
                    labelStyle={{ fontWeight: 600, color: "#111827" }}
                  />
                  {avgPerMonth > 0 && (
                    <ReferenceLine y={avgPerMonth} stroke="#d1d5db" strokeDasharray="4 4"
                      label={{ value: "avg", position: "insideTopRight", fontSize: 10, fill: "#9ca3af" }} />
                  )}
                  <Bar dataKey="amount" fill="#7c3aed" radius={[4, 4, 0, 0]} maxBarSize={48} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            {avgPerMonth > 0 && (
              <p className="mt-1 text-xs text-gray-400 text-right">
                avg <span className="font-medium text-gray-600">{fmt(avgPerMonth)}/mo</span>
              </p>
            )}
          </div>
        )}

        {/* ── Reliability detail ───────────────────────────────────────────── */}
        {!needsMoreData && (
          <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">Reliability signals</p>
            <div className="space-y-3">
              {[
                { label: "Amount consistency", score: reliabilityResult!.amountScore,    weight: "50%" },
                { label: "Timing consistency", score: reliabilityResult!.timingScore,    weight: "30%" },
                { label: "Frequency",          score: reliabilityResult!.frequencyScore, weight: "20%" },
              ].map(({ label, score, weight }) => (
                <div key={label}>
                  <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
                    <span>{label} <span className="text-gray-300">· {weight}</span></span>
                    <span className="font-semibold text-gray-700">{score}/100</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-gray-100">
                    <div className="h-full rounded-full bg-purple-400 transition-all" style={{ width: `${score}%` }} />
                  </div>
                </div>
              ))}
            </div>
            {freqResult.medianGap != null && (
              <p className="mt-3 text-xs text-gray-400">
                {fcfg.description}
                {" · "}median gap <span className="font-medium text-gray-600">{freqResult.medianGap}d</span>
                {freqResult.stdDev != null && freqResult.stdDev > 0 && ` ±${freqResult.stdDev}d`}
              </p>
            )}
          </div>
        )}

        {/* ── Month-by-month history ───────────────────────────────────────── */}
        {history.length > 0 && (
          <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100">
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">History</p>
            </div>
            <div className="divide-y divide-gray-100">
              {history.map((h) => {
                const isOpen = expandedMonth === h.yearMonth;
                const pct    = maxAmount > 0 ? (h.amount / maxAmount) * 100 : 0;
                const sorted = [...h.transactions].sort((a, b) =>
                  (b.date ?? "").localeCompare(a.date ?? "")
                );
                return (
                  <div key={h.yearMonth}>
                    <button
                      className="w-full px-5 py-3.5 flex items-center gap-4 text-left hover:bg-gray-50 transition"
                      onClick={() => setExpandedMonth(isOpen ? null : h.yearMonth)}
                    >
                      <div className="shrink-0 w-1 h-8 rounded-full overflow-hidden bg-gray-100">
                        <div
                          className="w-full rounded-full bg-purple-400 transition-all"
                          style={{ height: `${pct}%`, marginTop: `${100 - pct}%` }}
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-gray-800">{longMonth(h.yearMonth)}</p>
                        <p className="text-xs text-gray-400">
                          {sorted.length} deposit{sorted.length !== 1 ? "s" : ""}
                        </p>
                      </div>
                      <div className="shrink-0 flex items-center gap-2">
                        <span className="text-sm font-bold text-gray-900 tabular-nums">{fmt(h.amount)}</span>
                        <svg
                          className={`h-4 w-4 text-gray-300 transition-transform ${isOpen ? "rotate-180" : ""}`}
                          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                        </svg>
                      </div>
                    </button>

                    {isOpen && sorted.length > 0 && (
                      <div className="border-t border-gray-100 bg-gray-50 divide-y divide-gray-100">
                        {sorted.map((txn, i) => (
                          <div key={i} className="flex items-center justify-between px-5 py-3">
                            <p className="text-sm font-medium text-gray-700">{txn.date ? fmtDate(txn.date) : "—"}</p>
                            <span className="text-sm font-semibold text-green-600 tabular-nums">+{fmt(txn.amount)}</span>
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

        {history.length === 0 && (
          <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-10 text-center">
            <p className="text-sm text-gray-500">No history found for &ldquo;{sourceName}&rdquo;.</p>
            <Link href="/account/income" className="mt-2 inline-block text-sm font-medium text-purple-600 hover:underline">
              Back to income
            </Link>
          </div>
        )}

      </div>
    </div>
  );
}
