"use client";

import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseClient } from "@/lib/firebase";
import { doc, getDoc, setDoc } from "firebase/firestore";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip,
} from "recharts";
import type { IncomeTransaction, IncomeSource } from "@/lib/types";
import {
  scoreSource, detectFrequency,
  FREQUENCY_CONFIG, RELIABILITY_CONFIG, GENERIC_SOURCE_NAMES,
} from "@/lib/incomeEngine";
import type { SourceMonthData } from "@/lib/incomeEngine";
import { fmt, getCurrencySymbol } from "@/lib/currencyUtils";
import type { SourceSuggestion } from "@/lib/sourceMappings";
import { INCOME_TRANSFER_RE } from "@/lib/spendingMetrics";

// ── helpers ───────────────────────────────────────────────────────────────────

function fmtShort(v: number) {
  const sym = getCurrencySymbol();
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${sym}${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sym}${Math.round(abs / 1_000)}k`;
  return fmt(v);
}
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
    .toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ── visual config ─────────────────────────────────────────────────────────────

const SOURCE_COLORS = [
  "#7c3aed", "#f59e0b", "#10b981", "#3b82f6", "#f97316", "#ec4899", "#06b6d4", "#84cc16",
];

// Inter-account transfer patterns — auto-excluded from income display.
// Uses the canonical INCOME_TRANSFER_RE from spendingMetrics (single source of truth).
function isTransferSource(description: string, txns?: { category?: string }[]): boolean {
  if (INCOME_TRANSFER_RE.test(description)) return true;
  if (txns && txns.length > 0 && txns.every((t) => t.category === "Transfer In")) return true;
  return false;
}

function isGenericSourceName(description: string): boolean {
  const d = description.trim().toLowerCase();
  return GENERIC_SOURCE_NAMES.some((g) => d === g);
}

/**
 * When all income is labeled with a generic name (e.g. "Income"), split
 * transactions into amount clusters for better scoring.
 *
 * The description stays as the original bank name — we never invent labels.
 * When a generic source has multiple distinguishable amount clusters we create
 * separate virtual entries keyed by a stable cluster id (original_name#N) so
 * the scoring engine treats them independently. The user can then rename each.
 */
function clusterByAmount(
  description: string,
  txns: IncomeTransaction[],
): { description: string; transactions: IncomeTransaction[] }[] {
  if (!isGenericSourceName(description) || txns.length <= 1) {
    return [{ description, transactions: txns }];
  }

  const sorted = [...txns].sort((a, b) => b.amount - a.amount);
  const clusters: { representative: number; txns: IncomeTransaction[] }[] = [];

  for (const txn of sorted) {
    const match = clusters.find(
      (c) => Math.abs(c.representative - txn.amount) / Math.max(c.representative, 1) <= 0.15,
    );
    if (match) {
      match.txns.push(txn);
    } else {
      clusters.push({ representative: txn.amount, txns: [txn] });
    }
  }

  const result: { description: string; transactions: IncomeTransaction[] }[] = [];
  const miscTxns: IncomeTransaction[] = [];

  for (const cluster of clusters) {
    const avg = cluster.txns.reduce((s, t) => s + t.amount, 0) / cluster.txns.length;
    if (avg >= 200 && cluster.txns.length >= 2) {
      // Use a descriptive fallback label — user can rename to their payee name ("MAM Pay" etc.)
      result.push({
        description: `${description} — ${fmt(Math.round(avg))}`,
        transactions: cluster.txns,
      });
    } else {
      miscTxns.push(...cluster.txns);
    }
  }

  if (miscTxns.length > 0) {
    result.push({ description, transactions: miscTxns });
  }

  // If there's only one meaningful cluster, just keep the original name
  if (result.length === 1 && miscTxns.length === 0) {
    return [{ description, transactions: txns }];
  }

  return result.length > 0 ? result : [{ description, transactions: txns }];
}

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
  const [uid, setUid]                     = useState<string | null>(null);
  const [excludedSources, setExcludedSources] = useState<Set<string>>(new Set());
  const [transferSources, setTransferSources] = useState<Set<string>>(new Set());
  const [sourceLabels, setSourceLabels]   = useState<Record<string, string>>({});
  const [editingLabel, setEditingLabel]   = useState<string | null>(null);
  const [labelDraft, setLabelDraft]       = useState("");
  const labelInputRef                     = useRef<HTMLInputElement>(null);
  const [showOneTime, setShowOneTime]     = useState(false);
  const [suggestions, setSuggestions]     = useState<SourceSuggestion[]>([]);
  // pairKey → "confirmed" | "rejected" | undefined (pending)
  const [suggestionDecisions, setSuggestionDecisions] = useState<Record<string, "confirmed" | "rejected">>({});
  const [applyingMappings, setApplyingMappings] = useState(false);
  const [token, setToken]                 = useState<string | null>(null);
  const [suggestionListExpanded, setSuggestionListExpanded] = useState(false);

  useEffect(() => {
    const { auth, db } = getFirebaseClient();
    return onAuthStateChanged(auth, async (user) => {
      if (!user) { router.push("/login"); return; }
      setUid(user.uid);
      setLoading(true); setError(null);
      try {
        // Load excluded income sources + custom labels from Firestore
        const [prefDoc, labelsDoc, transferDoc] = await Promise.all([
          getDoc(doc(db, `users/${user.uid}/prefs/excludedIncomeSources`)),
          getDoc(doc(db, `users/${user.uid}/prefs/incomeSourceLabels`)),
          getDoc(doc(db, `users/${user.uid}/prefs/transferIncomeSources`)),
        ]);
        if (prefDoc.exists()) {
          setExcludedSources(new Set(prefDoc.data()?.keys ?? []));
        }
        if (labelsDoc.exists()) {
          setSourceLabels(labelsDoc.data() ?? {});
        }
        if (transferDoc.exists()) {
          setTransferSources(new Set(transferDoc.data()?.keys ?? []));
        }
        const token = await user.getIdToken();
        setToken(token);
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
        const incomeSugg = json.incomeSuggestions ?? [];
        setSuggestions(incomeSugg);
        // Default every suggestion to "confirmed" — user unchecks the ones they disagree with
        const defaultDecisions: Record<string, "confirmed" | "rejected"> = {};
        for (const s of incomeSugg) defaultDecisions[s.pairKey] = "confirmed";
        setSuggestionDecisions(defaultDecisions);

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

  async function handleExcludeSource(description: string) {
    const next = new Set(excludedSources);
    next.add(description);
    setExcludedSources(next);
    if (!uid) return;
    const { db } = getFirebaseClient();
    await setDoc(doc(db, `users/${uid}/prefs/excludedIncomeSources`), { keys: Array.from(next) });
  }

  async function handleRestoreSource(description: string) {
    const next = new Set(excludedSources);
    next.delete(description);
    setExcludedSources(next);
    if (!uid) return;
    const { db } = getFirebaseClient();
    await setDoc(doc(db, `users/${uid}/prefs/excludedIncomeSources`), { keys: Array.from(next) });
  }

  async function handleMarkAsTransfer(description: string) {
    const next = new Set(transferSources);
    next.add(description);
    setTransferSources(next);
    if (!uid) return;
    const { db } = getFirebaseClient();
    await setDoc(doc(db, `users/${uid}/prefs/transferIncomeSources`), { keys: Array.from(next) });
    // Invalidate cache so incomeTotal is recomputed without this source
    if (token) {
      fetch("/api/user/invalidate-cache", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => {});
    }
  }

  async function handleRestoreTransfer(description: string) {
    const next = new Set(transferSources);
    next.delete(description);
    setTransferSources(next);
    if (!uid) return;
    const { db } = getFirebaseClient();
    await setDoc(doc(db, `users/${uid}/prefs/transferIncomeSources`), { keys: Array.from(next) });
    // Invalidate cache so incomeTotal is recomputed with this source restored
    if (token) {
      fetch("/api/user/invalidate-cache", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => {});
    }
  }

  function startEditLabel(description: string) {
    setEditingLabel(description);
    setLabelDraft(sourceLabels[description] ?? description);
    setTimeout(() => labelInputRef.current?.select(), 30);
  }

  async function saveLabel(description: string) {
    const trimmed = labelDraft.trim();
    const next = { ...sourceLabels };
    if (trimmed && trimmed !== description) {
      next[description] = trimmed;
    } else {
      delete next[description];
    }
    setSourceLabels(next);
    setEditingLabel(null);
    if (!uid) return;
    const { db } = getFirebaseClient();
    await setDoc(doc(db, `users/${uid}/prefs/incomeSourceLabels`), next);
  }

  function cancelEditLabel() {
    setEditingLabel(null);
    setLabelDraft("");
  }

  async function handleApplyMappings() {
    if (!token) return;
    const confirmed = suggestions.filter((s) => suggestionDecisions[s.pairKey] === "confirmed");
    const rejected  = suggestions.filter((s) => suggestionDecisions[s.pairKey] === "rejected");
    const toSave = [
      ...confirmed.map((s) => ({ ...s, status: "confirmed" as const, affectsCache: false, createdAt: new Date().toISOString() })),
      ...rejected.map((s)  => ({ ...s, status: "rejected"  as const, affectsCache: false, createdAt: new Date().toISOString() })),
    ];
    if (toSave.length === 0) return;
    setApplyingMappings(true);
    try {
      await fetch("/api/user/source-mappings", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ mappings: toSave }),
      });
      // Remove applied suggestions from the review list
      const appliedKeys = new Set(toSave.map((m) => m.pairKey));
      setSuggestions((prev) => prev.filter((s) => !appliedKeys.has(s.pairKey)));
      setSuggestionDecisions({});
    } finally {
      setApplyingMappings(false);
    }
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
  // For generic source names (e.g. "Income"), cluster by amount to surface
  // meaningful sub-sources (e.g. bi-weekly payroll vs. misc small deposits).
  const rawSourceMap = new Map<string, IncomeTransaction[]>();
  if (transactions.length > 0) {
    for (const txn of transactions) {
      const key = (txn.source ?? "Other").trim();
      if (!rawSourceMap.has(key)) rawSourceMap.set(key, []);
      rawSourceMap.get(key)!.push(txn);
    }
  } else {
    for (const src of sources) {
      rawSourceMap.set(src.description.trim(), []);
    }
  }

  // Expand generic source names into amount clusters
  const expandedSources: { description: string; amount: number; txns: IncomeTransaction[] }[] = [];
  for (const [desc, txns] of rawSourceMap.entries()) {
    if (transactions.length > 0) {
      const clusters = clusterByAmount(desc, txns);
      for (const c of clusters) {
        expandedSources.push({
          description: c.description,
          amount: c.transactions.reduce((s, t) => s + t.amount, 0),
          txns: c.transactions,
        });
      }
    } else {
      const src = sources.find((s) => s.description.trim() === desc);
      expandedSources.push({ description: desc, amount: src?.amount ?? 0, txns: [] });
    }
  }

  // Build a lookup: expanded description → its transactions (for filtering/display)
  const expandedTxnMap = new Map(expandedSources.map((s) => [s.description, s.txns]));

  const allMergedSources = expandedSources
    .map(({ description, amount }) => ({ description, amount }))
    .sort((a, b) => b.amount - a.amount);

  // Auto-filter inter-account transfers + user-excluded sources
  const mergedSources = allMergedSources.filter(
    (s) => !isTransferSource(s.description, expandedTxnMap.get(s.description) ?? []) && !excludedSources.has(s.description) && !transferSources.has(s.description)
  );
  const autoFilteredSources = allMergedSources.filter((s) => isTransferSource(s.description, expandedTxnMap.get(s.description) ?? []) || transferSources.has(s.description));
  const manuallyExcludedSources = allMergedSources.filter((s) => excludedSources.has(s.description));

  // Score each consolidated source using cross-month history.
  // For clustered sub-sources (e.g. "Regular Deposit ($3,638)") there is no
  // cross-month history under that key — build a synthetic single-month history
  // from the current transactions so the sub-monthly scorer can still fire.
  const scoredSources = mergedSources.map((src, i) => {
    const clusterTxns = expandedTxnMap.get(src.description) ?? [];
    let hist = sourceHistory[src.description] ?? [];

    // If no cross-month history but we have current-month txns (clustered source),
    // synthesise a single-month history entry so frequency scoring works.
    if (hist.length === 0 && clusterTxns.length > 0) {
      hist = [{
        yearMonth: selectedMonth ?? "",
        amount: src.amount,
        transactions: clusterTxns.map((t) => ({ date: t.date, amount: t.amount })),
      }];
    }

    // Detect frequency first — passed to scoreSource so bi-weekly/weekly sources
    // use gap-based scoring instead of (broken) monthly-total scoring.
    const allDates   = hist.flatMap((h) => h.transactions.map((t) => t.date).filter(Boolean) as string[]);
    const freqResult = detectFrequency(allDates);

    const result = scoreSource(src.description, hist, totalMonths, freqResult);
    const totalIncome = current?.txIncome ?? income?.total ?? 0;
    const pct = totalIncome > 0 ? Math.round((src.amount / totalIncome) * 100) : 0;

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
    <div className="mx-auto max-w-2xl px-4 pt-4 pb-8 sm:py-8">
      <p className="text-red-600">{error}</p>
    </div>
  );
  if (history.length === 0) return (
    <div className="mx-auto max-w-2xl px-4 pt-4 pb-8 sm:py-8">
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
    <div className="mx-auto max-w-2xl px-4 pt-4 pb-8 sm:py-8 sm:px-6">

      {/* Suggestions review card */}
      {suggestions.length > 0 && (() => {
        const merging = suggestions.filter((s) => suggestionDecisions[s.pairKey] !== "rejected");
        return (
          <div className="mt-4 rounded-xl border border-purple-200 bg-purple-50/40 overflow-hidden">
            {/* Header — one-tap action */}
            <div className="flex items-center justify-between px-4 py-3">
              <div>
                <p className="text-sm font-semibold text-purple-900">
                  {merging.length} duplicate income source{merging.length !== 1 ? "s" : ""} found
                </p>
                <button
                  onClick={() => setSuggestionListExpanded((v) => !v)}
                  className="text-[11px] text-purple-400 underline underline-offset-2 hover:text-purple-600"
                >
                  {suggestionListExpanded ? "Hide list" : "Review before merging"}
                </button>
              </div>
              <button
                onClick={handleApplyMappings}
                disabled={applyingMappings}
                className="shrink-0 rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-700 disabled:opacity-50 transition"
              >
                {applyingMappings ? "Saving…" : "Merge All"}
              </button>
            </div>
            {/* Collapsed list — optional review */}
            {suggestionListExpanded && (
              <div className="border-t border-purple-100 divide-y divide-purple-100/60 max-h-72 overflow-y-auto">
                {suggestions.map((s) => {
                  const excluded = suggestionDecisions[s.pairKey] === "rejected";
                  return (
                    <button
                      key={s.pairKey}
                      onClick={() => setSuggestionDecisions((p) => ({
                        ...p,
                        [s.pairKey]: excluded ? "confirmed" : "rejected",
                      }))}
                      className={`flex w-full items-center gap-3 px-4 py-2 text-left transition hover:bg-purple-50/60 ${excluded ? "opacity-40" : ""}`}
                    >
                      <span className={`shrink-0 h-4 w-4 rounded border flex items-center justify-center transition ${excluded ? "border-gray-300 bg-white" : "border-purple-500 bg-purple-500"}`}>
                        {!excluded && <svg className="h-2.5 w-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
                      </span>
                      <span className="flex-1 min-w-0 text-sm text-gray-800 truncate">{s.canonical}</span>
                      <svg className="h-3 w-3 text-gray-300 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M17 8l4 4m0 0l-4 4m4-4H3" /></svg>
                      <span className={`flex-1 min-w-0 text-sm truncate ${excluded ? "text-gray-400" : "text-gray-500 line-through decoration-gray-300"}`}>{s.alias}</span>
                    </button>
                  );
                })}
                {merging.length !== suggestions.length && (
                  <div className="px-4 py-2 text-[11px] text-purple-500 bg-purple-50">
                    {merging.length} will merge · {suggestions.length - merging.length} excluded
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })()}

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

              {/* One-time deposits — collapsed expandable row */}
              {oneTimeTotal > 0 && (
                <div className="mt-1">
                  <button
                    onClick={() => setShowOneTime((v) => !v)}
                    className="flex items-center gap-1 text-xs text-amber-600 hover:text-amber-700 transition"
                  >
                    <span>{fmt(oneTimeTotal)} in one-time deposits — excluded from averages</span>
                    <svg className={`h-3 w-3 transition-transform ${showOneTime ? "rotate-180" : ""}`}
                      fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  {showOneTime && (
                    <div className="mt-1.5 space-y-0.5 pl-2 border-l-2 border-amber-100">
                      {oneTimeSources.map((s) => {
                        const acct = transactions.find(
                          (t) => (t.source ?? "Other").trim() === s.description
                        )?.accountLabel;
                        return (
                          <p key={s.description} className="text-xs text-amber-500">
                            {fmt(s.amount)} · {s.description}
                            {acct ? <span className="text-amber-400"> · {acct}</span> : ""}
                          </p>
                        );
                      })}
                    </div>
                  )}
                </div>
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
                // (use expandedTxnMap so clustered sub-sources resolve correctly)
                const srcTxns = (expandedTxnMap.get(src.description) ?? transactions
                  .filter((t) => (t.source ?? "Other").trim() === src.description))
                  .slice()
                  .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
                // Unique accounts this source was deposited into
                const srcAccounts = [...new Set(srcTxns.map((t) => t.accountLabel).filter(Boolean))];
                // Strip internal cluster suffix (#1, #2) for display
                const baseDescription = src.description.replace(/#\d+$/, "");
                const customLabel     = sourceLabels[src.description];
                const displayName     = customLabel ?? baseDescription;
                const needsName       = !customLabel && isGenericSourceName(baseDescription);
                const isEditing  = editingLabel === src.description;
                return (
                  <div key={src.description} className={src.reliability === "one-time" ? "opacity-60" : ""}>
                    {/* Label edit row — shown above the link when editing */}
                    {isEditing && (
                      <div className="mb-1.5 flex items-center gap-1.5">
                        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: src.color }} />
                        <input
                          ref={labelInputRef}
                          value={labelDraft}
                          onChange={(e) => setLabelDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") saveLabel(src.description);
                            if (e.key === "Escape") cancelEditLabel();
                          }}
                          className="flex-1 rounded border border-purple-300 bg-white px-2 py-0.5 text-sm font-medium text-gray-900 outline-none focus:ring-1 focus:ring-purple-400"
                          autoFocus
                        />
                        <button onClick={() => saveLabel(src.description)} className="text-[11px] font-semibold text-purple-600 hover:text-purple-800">Save</button>
                        <button onClick={cancelEditLabel} className="text-[11px] text-gray-400 hover:text-gray-600">Cancel</button>
                      </div>
                    )}
                    <Link
                      href={`/account/income/${encodeURIComponent(src.description)}`}
                      className={`block w-full text-left group ${isEditing ? "pointer-events-none" : ""}`}
                    >
                      <div className="flex items-start justify-between gap-2 mb-1.5">
                        <div className="flex items-center gap-2 min-w-0">
                          {!isEditing && <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: src.color }} />}
                          {isEditing ? <span className="w-2.5 shrink-0" /> : null}
                          <span className="font-medium text-sm text-gray-800 truncate group-hover:text-purple-600 transition-colors">
                            {displayName}
                          </span>
                          {needsName && (
                            <span className="shrink-0 rounded-full border border-dashed border-purple-300 px-2 py-0.5 text-[10px] text-purple-400 italic">
                              tap ✎ to name
                            </span>
                          )}
                          {srcAccounts.length > 0 && (
                            <span className="text-[10px] text-gray-400 truncate">
                              → {srcAccounts.join(", ")}
                            </span>
                          )}
                          {/* Rename button */}
                          <button
                            onClick={(e) => { e.preventDefault(); e.stopPropagation(); startEditLabel(src.description); }}
                            title="Rename source"
                            className="shrink-0 rounded-full p-0.5 text-gray-300 hover:text-purple-500 hover:bg-purple-50 transition opacity-0 group-hover:opacity-100"
                          >
                            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                            </svg>
                          </button>
                          <button
                            onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleMarkAsTransfer(src.description); }}
                            title="Mark as transfer (not income)"
                            className="shrink-0 rounded-full p-0.5 text-gray-300 hover:text-blue-400 hover:bg-blue-50 transition opacity-0 group-hover:opacity-100"
                          >
                            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                            </svg>
                          </button>
                          <button
                            onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleExcludeSource(src.description); }}
                            title="Exclude from income"
                            className="shrink-0 rounded-full p-0.5 text-gray-300 hover:text-red-400 hover:bg-red-50 transition opacity-0 group-hover:opacity-100"
                          >
                            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>                        </div>
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

            {/* Hidden sources footer */}
            {(autoFilteredSources.length > 0 || manuallyExcludedSources.length > 0) && (
              <div className="mt-4 border-t border-gray-100 pt-3 space-y-1">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1.5">Not counted as income</p>
                {autoFilteredSources.map((s) => (
                  <div key={s.description} className="flex items-center justify-between text-xs text-gray-400">
                    <span className="flex items-center gap-1.5">
                      <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium">transfer</span>
                      {s.description}
                      <span className="text-gray-300">{fmt(s.amount)}</span>
                    </span>
                    {transferSources.has(s.description) && (
                      <button
                        onClick={() => handleRestoreTransfer(s.description)}
                        className="text-[10px] text-purple-400 hover:text-purple-600 hover:underline"
                      >
                        restore
                      </button>
                    )}
                  </div>
                ))}
                {manuallyExcludedSources.map((s) => (
                  <div key={s.description} className="flex items-center justify-between text-xs text-gray-400">
                    <span>{s.description} <span className="text-gray-300">{fmt(s.amount)}</span></span>
                    <button
                      onClick={() => handleRestoreSource(s.description)}
                      className="text-[10px] text-purple-400 hover:text-purple-600 hover:underline"
                    >
                      restore
                    </button>
                  </div>
                ))}
              </div>
            )}
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
                        <span className="text-xs font-medium text-gray-700 truncate max-w-[160px]">
                          {sourceLabels[src.description] ?? src.description.replace(/#\d+$/, "")}
                        </span>
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
                // For clustered sub-sources, find by txn membership; otherwise by description
                const txnRawDesc = (txn.source ?? "Other").trim();
                const srcEntry = scoredSources.find(
                  (s) => (expandedTxnMap.get(s.description) ?? []).includes(txn)
                ) ?? scoredSources.find((s) => s.description === txnRawDesc);
                const cfg = srcEntry ? RELIABILITY_CONFIG[srcEntry.reliability] : null;
                // Show user's custom label → strip #N suffix → raw source name
                const clusteredDesc = srcEntry?.description ?? txnRawDesc;
                const displayLabel  = sourceLabels[clusteredDesc]
                  ?? clusteredDesc.replace(/#\d+$/, "")
                  ?? txn.source ?? "Other";
                return (
                  <div key={i} className="flex items-center justify-between py-3">
                    <div>
                      <p className="text-sm font-medium text-gray-800">{displayLabel}</p>
                      <p className="text-xs text-gray-400 flex items-center gap-1.5">
                        {txn.date && <span>{fmtDate(txn.date)}</span>}
                        {txn.category && <><span>·</span><span className="text-purple-500">{txn.category}</span></>}
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
