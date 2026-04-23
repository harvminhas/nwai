"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter, useParams } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseClient } from "@/lib/firebase";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, ReferenceLine, Cell,
} from "recharts";
import {
  scoreSource,
  detectFrequency,
  FREQUENCY_CONFIG,
  RELIABILITY_CONFIG,
  INCOME_CATEGORIES,
  INCOME_CAT_COLORS,
} from "@/lib/incomeEngine";
import type { Frequency, SourceMonthData } from "@/lib/incomeEngine";
import { fmt, getCurrencySymbol, formatCurrency } from "@/lib/currencyUtils";
import { incomeTxnKey, merchantSlug } from "@/lib/applyRules";
import { pairKey } from "@/lib/sourceMappings";
import type { SourceSuggestion, SourceMapping } from "@/lib/sourceMappings";

// ── helpers ───────────────────────────────────────────────────────────────────

// fmtAxis is called inside Recharts callbacks — takes currency as a closure param
function makeFmtAxis(currency: string) {
  return (v: number) => {
    const sym = getCurrencySymbol(currency);
    const abs = Math.abs(v);
    if (abs >= 1_000_000) return `${sym}${(abs / 1_000_000).toFixed(1)}M`;
    if (abs >= 1_000) return `${sym}${Math.round(abs / 1_000)}k`;
    return v === 0 ? `${sym}0` : fmt(v, currency);
  };
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
function fmtDateShort(iso: string) {
  return new Date(iso + "T12:00:00")
    .toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
function fmtDateFull(iso: string) {
  return new Date(iso + "T12:00:00")
    .toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

/** Expected deposits per calendar month for a given frequency. */
function depositsPerMonth(freq: Frequency): number {
  return freq === "weekly" ? 4 : freq === "bi-weekly" ? 2 : freq === "monthly" ? 1
    : freq === "quarterly" ? 1 / 3 : freq === "semi-annual" ? 1 / 6 : 1;
}

/** Gap in days between deposits for a given frequency. */
function freqGapDays(freq: Frequency): number {
  return freq === "weekly" ? 7 : freq === "bi-weekly" ? 14 : freq === "monthly" ? 30
    : freq === "quarterly" ? 90 : freq === "semi-annual" ? 182 : 30;
}

/** Median of a numeric array (returns 0 for empty). */
function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? ((s[m - 1]! + s[m]!) / 2) : s[m]!;
}

interface InsightItem {
  icon: "warn" | "check" | "info";
  title: string;
  body: string;
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
  const [homeCurrency, setHomeCurrency]   = useState("USD");
  const [avgMonthlyExpenses, setAvgMonthlyExpenses] = useState(0);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [cashCommitments, setCashCommitments] = useState<any[]>([]);
  const [chartView, setChartView]         = useState<"actual" | "expected">("actual");

  // Category + frequency state
  const [sourceCategory, setSourceCategory]       = useState<string>("");
  const [frequencyOverride, setFrequencyOverride] = useState<string>("");
  const [savingFrequency, setSavingFrequency]     = useState(false);
  const [txnSplits, setTxnSplits]                 = useState<Record<string, { category: string; amount: number }[]>>({});
  const [savingTxnKey, setSavingTxnKey]           = useState<string | null>(null);

  // Merge state
  const [similarSources, setSimilarSources] = useState<SourceSuggestion[]>([]);
  const [mergeExpanded, setMergeExpanded]   = useState(false);
  const [mergeSelected, setMergeSelected]   = useState<Set<string>>(new Set());
  const [merging, setMerging]               = useState(false);

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

      setHomeCurrency(json.homeCurrency ?? "USD");
      setCashCommitments(json.cashCommitmentItems ?? []);

      // Average monthly expenses from last 6 months of overall history
      const overallHist: { yearMonth: string; expensesTotal: number }[] = json.history ?? [];
      if (overallHist.length > 0) {
        const recent = overallHist.slice(-6);
        setAvgMonthlyExpenses(
          Math.round(recent.reduce((s, h) => s + h.expensesTotal, 0) / recent.length)
        );
      }

      // Source-level default category + frequency override
      const slug = sourceName.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 60);
      const catRules: Record<string, string> = json.incomeCategoryRules ?? {};
      setSourceCategory(catRules[slug] ?? "");
      const freqOverrides: Record<string, string> = json.incomeFrequencyOverrides ?? {};
      setFrequencyOverride(freqOverrides[slug] ?? "");
      setTxnSplits(json.incomeTxnSplits ?? {});

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

  // ── per-transaction category ──────────────────────────────────────────────

  async function handleSetTxnCategory(
    txn: { date?: string; amount: number; accountSlug?: string },
    category: string,
  ) {
    if (!token) return;
    const acctSlug = txn.accountSlug ?? "unknown";
    const key = incomeTxnKey(acctSlug, { source: sourceName, amount: txn.amount, date: txn.date });
    setSavingTxnKey(key);
    try {
      const effectiveDefault = sourceCategory || "Other";
      if (!category || category === effectiveDefault) {
        await fetch("/api/user/income-txn-category", {
          method: "PUT",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ accountSlug: acctSlug, date: txn.date, amount: txn.amount, source: sourceName, splits: [] }),
        });
        setTxnSplits((prev) => { const n = { ...prev }; delete n[key]; return n; });
      } else {
        const splits = [{ category, amount: txn.amount }];
        await fetch("/api/user/income-txn-category", {
          method: "PUT",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ accountSlug: acctSlug, date: txn.date, amount: txn.amount, source: sourceName, splits }),
        });
        setTxnSplits((prev) => ({ ...prev, [key]: splits }));
      }
    } finally {
      setSavingTxnKey(null);
    }
  }

  // ── frequency override ────────────────────────────────────────────────────

  async function handleSetFrequency(newFreq: string) {
    if (!token) return;
    setSavingFrequency(true);
    const prev = frequencyOverride;
    setFrequencyOverride(newFreq);
    try {
      await fetch("/api/user/income-category-rules", {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ source: sourceName, frequencyOverride: newFreq || null }),
      });
    } catch {
      setFrequencyOverride(prev);
    } finally {
      setSavingFrequency(false);
    }
  }

  // ── merge handler ─────────────────────────────────────────────────────────

  async function handleMerge() {
    if (!token || mergeSelected.size === 0) return;
    setMerging(true);
    try {
      const toSave: SourceMapping[] = Array.from(mergeSelected).map((alias) => {
        const key = pairKey(sourceName, alias);
        return {
          id: key.replace(/\|/g, "_"),
          pairKey: key,
          type: "income" as const,
          canonical: sourceName,
          alias,
          status: "confirmed" as const,
          affectsCache: false,
          createdAt: new Date().toISOString(),
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

  const effectiveFreq  = (frequencyOverride as Frequency) || freqResult.frequency;
  const fcfg           = FREQUENCY_CONFIG[effectiveFreq];
  const reliability    = reliabilityResult?.reliability ?? "irregular";
  const rcfg           = RELIABILITY_CONFIG[reliability];
  const needsMoreData  = totalMonths < 2 || history.length < 2;

  // Currency-aware formatters — must be defined early so derived insight strings can use them
  const fmtCur  = (v: number) => fmt(v, homeCurrency);
  const fmtAxis = makeFmtAxis(homeCurrency);

  // Typical deposit = most recent transaction amount.
  // Medians are avoided intentionally: stable income changes over time (tax adjustments,
  // raises, etc.) and bonuses in the history would skew the average.
  const allTxnsSorted = history
    .flatMap((h) => h.transactions.map((t) => ({ date: t.date ?? "", amount: t.amount })))
    .sort((a, b) => b.date.localeCompare(a.date));
  const allTxnAmounts = allTxnsSorted.map((t) => t.amount);
  const typicalDeposit = allTxnsSorted[0]?.amount ?? (allTxnAmounts.length > 0 ? median(allTxnAmounts) : avgPerMonth);
  const expectedMonthly = typicalDeposit * depositsPerMonth(effectiveFreq);

  // Next expected deposit
  const lastDepositDate = allDates.sort().reverse()[0] ?? null;
  const nextExpectedInfo = (() => {
    if (!lastDepositDate || effectiveFreq === "irregular") return null;
    const last = new Date(lastDepositDate + "T12:00:00");
    const gap  = freqGapDays(effectiveFreq);
    const next = new Date(last.getTime() + gap * 24 * 60 * 60 * 1000);
    const daysUntil = Math.round((next.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    const score = reliabilityResult?.score ?? 0;
    const confidence = score >= 75 ? "High confidence" : score >= 45 ? "Moderate confidence" : "Low confidence";
    const confColor   = score >= 75 ? "text-green-600 bg-green-50 border-green-200"
      : score >= 45 ? "text-amber-600 bg-amber-50 border-amber-200"
      : "text-gray-500 bg-gray-50 border-gray-200";
    return { date: next.toISOString().slice(0, 10), daysUntil, amount: typicalDeposit, confidence, confColor };
  })();

  // Upcoming commitment
  const upcomingBill = (() => {
    const today = new Date().toISOString().slice(0, 10);
    const sorted = cashCommitments
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .filter((c: any) => c.nextDate && c.nextDate >= today)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .sort((a: any, b: any) => a.nextDate.localeCompare(b.nextDate));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return sorted[0] as any ?? null;
  })();

  // Unique categories for this source
  const srcSlugSuffix = `::${merchantSlug(sourceName)}`;
  const uniqueCategories = (() => {
    const cats = new Set<string>();
    cats.add(sourceCategory || "Other");
    for (const [key, splits] of Object.entries(txnSplits)) {
      if (!key.endsWith(srcSlugSuffix)) continue;
      for (const sp of splits) { if (sp.category) cats.add(sp.category); }
    }
    return Array.from(cats);
  })();

  // Per-month anomaly: expected deposits per month (for bi-weekly = 2, monthly = 1, etc.)
  const expDepositsPerMonth = Math.max(1, Math.round(depositsPerMonth(effectiveFreq)));

  // Insights ("What to know")
  const insights: InsightItem[] = (() => {
    const items: InsightItem[] = [];
    if (!reliabilityResult || history.length === 0) return items;

    // Anomaly months (deposits that include a bonus/unusually large txn)
    for (const h of history) {
      for (const t of h.transactions) {
        if (t.amount > typicalDeposit * 1.6 && typicalDeposit > 0) {
          const mult = (t.amount / typicalDeposit).toFixed(1);
          const acctSlug = t.accountSlug ?? "unknown";
          const txKey = incomeTxnKey(acctSlug, { source: sourceName, amount: t.amount, date: t.date });
          const splits = txnSplits[txKey] ?? [];
          const hasBonus = splits.some((s) => s.category === "Bonus") || sourceCategory === "Bonus";
          items.push({
            icon: "warn",
            title: `${t.date ? fmtDateShort(t.date) : longMonth(h.yearMonth)} deposit was ~${mult}× a typical paycheck`,
            body: `Received +${fmtCur(t.amount)}${hasBonus ? " tagged as bonus" : ""}. ${parseFloat(mult) >= 2 ? "Likely a large bonus — worth confirming if recurring." : "Slightly above typical — may include overtime or bonus."}`,
          });
          break; // one anomaly per month is enough
        }
      }
    }

    // Missing deposits
    for (const h of history) {
      const actualCount  = h.transactions.length;
      const missing = expDepositsPerMonth - actualCount;
      if (missing > 0 && actualCount > 0 && expDepositsPerMonth >= 2) {
        items.push({
          icon: "info",
          title: `${longMonth(h.yearMonth)} looks light — only ${actualCount} deposit recorded`,
          body: `${fcfg.label.charAt(0).toUpperCase() + fcfg.label.slice(1)} cadence expects ${expDepositsPerMonth} deposits per month. ${missing === 1 ? "A deposit" : `${missing} deposits`} may be missing, or your statement coverage starts mid-month.`,
        });
      }
    }

    // Amount consistency
    if (allTxnAmounts.length >= 3) {
      const nonBonus = allTxnAmounts.filter((a) => a <= typicalDeposit * 1.5);
      if (nonBonus.length >= 2) {
        const spread = (Math.max(...nonBonus) - Math.min(...nonBonus));
        const spreadPct = typicalDeposit > 0 ? (spread / typicalDeposit) * 100 : 0;
        if (spreadPct < 1) {
          items.push({
            icon: "check",
            title: "Amounts are perfectly consistent",
            body: `Every deposit has landed at exactly ${fmtCur(typicalDeposit)}. No variability detected.`,
          });
        } else if (spreadPct < 10) {
          items.push({
            icon: "check",
            title: "Amounts are very consistent",
            body: `Deposits vary by less than ${Math.round(spreadPct)}% — highly predictable income.`,
          });
        }
      }
    }

    // Limited history
    if (history.length < 4) {
      items.push({
        icon: "info",
        title: "Limited history — patterns not yet confirmed",
        body: `Only ${history.length} month${history.length !== 1 ? "s" : ""} of data. Upload more statements to improve confidence.`,
      });
    }

    return items.slice(0, 4); // cap at 4
  })();

  // Chart data with per-bar status
  const chartData = [...history]
    .sort((a, b) => a.yearMonth.localeCompare(b.yearMonth))
    .map((h) => {
      const hasBonus = h.transactions.some((t) => {
        const acctSlug = t.accountSlug ?? "unknown";
        const txKey = incomeTxnKey(acctSlug, { source: sourceName, amount: t.amount, date: t.date });
        const sp = txnSplits[txKey] ?? [];
        return sp.some((s) => s.category === "Bonus") || t.amount > typicalDeposit * 1.6;
      });
      const isLight = !hasBonus && h.transactions.length < expDepositsPerMonth && expDepositsPerMonth >= 2;
      return {
        label: shortMonth(h.yearMonth),
        ym: h.yearMonth,
        amount: chartView === "actual" ? h.amount : expectedMonthly,
        actual: h.amount,
        expected: expectedMonthly,
        status: hasBonus ? "bonus" : isLight ? "light" : "normal",
      };
    });

  // Month subtitle helper
  function monthSubtitle(h: SourceMonthData): { text: string; color: string } {
    const n = h.transactions.length;
    const hasBonus = h.transactions.some((t) => {
      const acctSlug = t.accountSlug ?? "unknown";
      const txKey = incomeTxnKey(acctSlug, { source: sourceName, amount: t.amount, date: t.date });
      const sp = txnSplits[txKey] ?? [];
      return sp.some((s) => s.category === "Bonus") || t.amount > typicalDeposit * 1.6;
    });
    const missing = expDepositsPerMonth - n;
    const isOldest = h.yearMonth === (history[history.length - 1]?.yearMonth ?? "");
    if (hasBonus) return { text: `${n} deposit${n !== 1 ? "s" : ""} · includes bonus`, color: "bg-amber-400" };
    if (missing > 0 && n > 0 && expDepositsPerMonth >= 2) return { text: `${n} deposit · ${missing} may be missing`, color: "bg-amber-400" };
    if (isOldest && history.length >= 3) return { text: `${n} deposit${n !== 1 ? "s" : ""} · baseline month`, color: "bg-purple-400" };
    return { text: `${n} deposit${n !== 1 ? "s" : ""}`, color: "bg-purple-400" };
  }

  // Coverage %
  // Use monthly-equivalent income (e.g. bi-weekly $4k × 2 = $8k/mo) for coverage
  const coveragePct = avgMonthlyExpenses > 0 && expectedMonthly > 0
    ? Math.min(100, Math.round((expectedMonthly / avgMonthlyExpenses) * 100))
    : null;

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
    <div className="mx-auto max-w-2xl lg:max-w-5xl px-4 pt-4 pb-12 sm:py-8 sm:px-6 space-y-4">

      {/* Back nav */}
      <Link
        href="/account/income"
        className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-700 transition"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
        Income
      </Link>

      {/* ── Similar sources — merge banner ────────────────────────────────── */}
      {similarSources.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-purple-200 bg-purple-50/40">
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
              <button onClick={(e) => { e.stopPropagation(); void handleMerge(); }} disabled={merging}
                className="shrink-0 rounded-lg bg-purple-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-purple-700 disabled:opacity-50 transition">
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

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <div>
        {/* Breadcrumb subtitle */}
        <p className="text-sm text-gray-400 font-medium">
          {sourceName}
          {uniqueCategories[0] && uniqueCategories[0] !== "Other" && (
            <> · {fcfg.label} {uniqueCategories[0].toLowerCase()}</>
          )}
        </p>

        {/* Next expected deposit — the hero number */}
        {nextExpectedInfo ? (
          <>
            <p className="mt-1 text-[11px] text-gray-400 font-medium">~{getCurrencySymbol(homeCurrency)}</p>
            <p className="-mt-1 text-5xl font-bold tracking-tight text-gray-900 tabular-nums">
              {fmtCur(nextExpectedInfo.amount)}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-gray-500">
              <span>{fmtDateFull(nextExpectedInfo.date)}</span>
              <span className="text-gray-300">·</span>
              <span>{nextExpectedInfo.daysUntil <= 0 ? "today or overdue"
                : nextExpectedInfo.daysUntil === 1 ? "tomorrow"
                : `in ${nextExpectedInfo.daysUntil} days`}</span>
              <span className="text-gray-300">·</span>
              <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium ${nextExpectedInfo.confColor}`}>
                <span className="h-1.5 w-1.5 rounded-full bg-current" />
                {nextExpectedInfo.confidence}
              </span>
            </div>
          </>
        ) : (
          <p className="mt-1 text-4xl font-bold tracking-tight text-gray-900">{sourceName}</p>
        )}

        {/* Controls row */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {uniqueCategories.map((cat) => {
            const color = INCOME_CAT_COLORS[cat] ?? "#9ca3af";
            return (
              <span key={cat}
                className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium"
                style={{ backgroundColor: `${color}22`, color }}>
                <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
                {cat}
              </span>
            );
          })}
          <div className="relative inline-flex items-center">
            <select
              value={effectiveFreq}
              disabled={savingFrequency}
              onChange={(e) => void handleSetFrequency(e.target.value)}
              className="appearance-none rounded-full border border-gray-200 bg-white pl-2.5 pr-6 py-1 text-xs font-medium text-gray-700 cursor-pointer hover:border-purple-300 focus:outline-none focus:ring-1 focus:ring-purple-300 disabled:opacity-50 transition"
            >
              {(Object.keys(FREQUENCY_CONFIG) as Frequency[]).map((f) => (
                <option key={f} value={f}>{FREQUENCY_CONFIG[f].label}</option>
              ))}
            </select>
            <svg className="pointer-events-none absolute right-1.5 h-3 w-3 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
            {frequencyOverride && (
              <button type="button" title="Reset to auto-detected"
                onClick={() => void handleSetFrequency("")}
                className="ml-1 text-gray-300 hover:text-gray-500 transition">
                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
          {!needsMoreData && (
            <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${rcfg.badge}`}>
              {rcfg.label}
            </span>
          )}
        </div>
      </div>

      {/* ── What this deposit covers ──────────────────────────────────────── */}
      {(coveragePct !== null || upcomingBill) && (
        <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
          <div className="flex items-center justify-between px-5 pt-4 pb-1">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">Monthly income coverage</p>
            <Link href="/account/cashflow" className="text-xs font-medium text-purple-600 hover:underline">
              See cashflow →
            </Link>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4 px-5 py-4">
            {coveragePct !== null && (
              <div>
                <p className="text-xs text-gray-400 mb-1">Monthly expenses covered</p>
                <p className="text-3xl font-bold text-gray-900">{coveragePct}%</p>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-gray-100">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${coveragePct}%`,
                      backgroundColor: coveragePct >= 80 ? "#10b981" : coveragePct >= 50 ? "#7c3aed" : "#f59e0b",
                    }}
                  />
                </div>
                <p className="mt-1.5 text-xs text-gray-400">
                  {formatCurrency(expectedMonthly, homeCurrency, undefined, true)}/mo of {formatCurrency(avgMonthlyExpenses, homeCurrency, undefined, true)} avg spend
                  {effectiveFreq !== "monthly" && effectiveFreq !== "irregular" && (
                    <span className="ml-1 text-gray-300">({fmtCur(typicalDeposit)} × {depositsPerMonth(effectiveFreq) % 1 === 0 ? depositsPerMonth(effectiveFreq) : depositsPerMonth(effectiveFreq).toFixed(1)})</span>
                  )}
                </p>
              </div>
            )}
            {upcomingBill && (
              <div>
                <p className="text-xs text-gray-400 mb-1">Next {upcomingBill.name} due</p>
                <p className="text-3xl font-bold text-gray-900">{fmtDateShort(upcomingBill.nextDate)}</p>
                {nextExpectedInfo && (
                  <p className="mt-1.5 text-xs">
                    {(() => {
                      const billMs  = new Date(upcomingBill.nextDate + "T12:00:00").getTime();
                      const nextMs  = new Date(nextExpectedInfo.date + "T12:00:00").getTime();
                      const diffD   = Math.round((billMs - nextMs) / (1000 * 60 * 60 * 24));
                      if (Math.abs(diffD) <= 1) return <span className="text-green-600">Same day as next expected deposit</span>;
                      if (diffD > 0)  return <><span className="text-amber-600 font-medium">{diffD} days after</span><span className="text-gray-400"> next expected deposit</span></>;
                      return <><span className="text-green-600 font-medium">{Math.abs(diffD)} days before</span><span className="text-gray-400"> next expected deposit</span></>;
                    })()}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── What to know ─────────────────────────────────────────────────── */}
      {insights.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
          <p className="px-5 pt-4 pb-2 text-[10px] font-semibold uppercase tracking-widest text-gray-400">What to know</p>
          <div className="divide-y divide-gray-100">
            {insights.map((ins, i) => {
              const cfg = {
                warn:  { bg: "bg-amber-50",   dot: "bg-amber-400",   text: "text-amber-600",   path: "M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" },
                check: { bg: "bg-emerald-50", dot: "bg-emerald-400", text: "text-emerald-600", path: "M5 13l4 4L19 7" },
                info:  { bg: "bg-blue-50",    dot: "bg-blue-400",    text: "text-blue-500",    path: "M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" },
              }[ins.icon];
              return (
                <div key={i} className={`flex gap-3 px-5 py-3.5 ${cfg.bg}`}>
                  <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/70 ${cfg.text}`}>
                    <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d={cfg.path} />
                    </svg>
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900">{ins.title}</p>
                    <p className="mt-0.5 text-xs text-gray-500 leading-relaxed">{ins.body}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Monthly amounts chart ─────────────────────────────────────────── */}
      {chartData.length >= 2 && (
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">Monthly Amounts</p>
              <p className="text-xs text-gray-400 mt-0.5">{chartData.length} months · {needsMoreData ? "limited history" : "stable trend"}</p>
            </div>
            {expectedMonthly > 0 && (
              <div className="flex rounded-lg border border-gray-200 overflow-hidden text-[10px] font-semibold">
                <button
                  className={`px-3 py-1.5 transition ${chartView === "actual" ? "bg-gray-900 text-white" : "text-gray-400 hover:bg-gray-50"}`}
                  onClick={() => setChartView("actual")}
                >ACTUAL</button>
                <button
                  className={`px-3 py-1.5 transition ${chartView === "expected" ? "bg-gray-900 text-white" : "text-gray-400 hover:bg-gray-50"}`}
                  onClick={() => setChartView("expected")}
                >EXPECTED</button>
              </div>
            )}
          </div>

          {/* Partial coverage warning */}
          {needsMoreData && (
            <div className="mb-3 flex gap-2.5 rounded-lg border border-amber-100 bg-amber-50 px-3 py-2">
              <svg className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              </svg>
              <p className="text-xs text-amber-700">Limited history — trend will stabilize after ~6 months.</p>
            </div>
          )}

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
                  formatter={(v, _n, props) => {
                    const p = props.payload as typeof chartData[0];
                    const lines: [string, string][] = [];
                    lines.push([fmtCur(p.actual), "Actual"]);
                    if (expectedMonthly > 0) lines.push([fmtCur(p.expected), "Expected"]);
                    return lines[0];
                  }}
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const p = payload[0]?.payload as typeof chartData[0];
                    return (
                      <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs shadow">
                        <p className="font-semibold text-gray-800 mb-1">{p.label}</p>
                        <p className="text-gray-700">Actual: <span className="font-semibold">{fmtCur(p.actual)}</span></p>
                        {expectedMonthly > 0 && (
                          <p className="text-gray-400">Expected: {fmtCur(p.expected)}</p>
                        )}
                        {p.status === "bonus" && <p className="text-amber-600 mt-0.5">Includes bonus</p>}
                        {p.status === "light"  && <p className="text-amber-600 mt-0.5">Below expected</p>}
                      </div>
                    );
                  }}
                />
                {expectedMonthly > 0 && chartView === "actual" && (
                  <ReferenceLine y={expectedMonthly} stroke="#c4b5fd" strokeDasharray="4 4"
                    label={{ value: "expected", position: "insideTopRight", fontSize: 10, fill: "#a78bfa" }} />
                )}
                <Bar dataKey="amount" radius={[4, 4, 0, 0]} maxBarSize={48}>
                  {chartData.map((entry) => (
                    <Cell
                      key={entry.ym}
                      fill={entry.status === "bonus" ? "#f59e0b" : entry.status === "light" ? "#fbbf24" : "#7c3aed"}
                      opacity={chartView === "expected" ? 0.3 : 1}
                    />
                  ))}
                </Bar>
                {chartView === "expected" && expectedMonthly > 0 && (
                  <ReferenceLine y={expectedMonthly} stroke="#7c3aed" strokeWidth={2}
                    label={{ value: fmtCur(expectedMonthly), position: "insideTopRight", fontSize: 11, fill: "#7c3aed" }} />
                )}
              </BarChart>
            </ResponsiveContainer>
          </div>
          {expectedMonthly > 0 && (
            <p className="mt-2 text-xs text-gray-400">
              Expected monthly: <span className="font-medium text-gray-600">{fmtCur(expectedMonthly)}</span>
              {" · "}avg actual: <span className="font-medium text-gray-600">{fmtCur(avgPerMonth)}</span>
            </p>
          )}
        </div>
      )}

      {/* ── Reliability ──────────────────────────────────────────────────── */}
      {!needsMoreData && reliabilityResult && (
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <div className="flex items-start justify-between mb-4">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">Reliability</p>
            <div className="text-right">
              <span className="text-3xl font-bold text-gray-900">{reliabilityResult.score}</span>
              <span className="text-sm text-gray-400">/100</span>
            </div>
          </div>
          <div className="space-y-3.5">
            {[
              { label: "Amount consistency", score: reliabilityResult.amountScore,    weight: "50%" },
              { label: "Timing consistency", score: reliabilityResult.timingScore,    weight: "30%" },
              { label: "Frequency",          score: reliabilityResult.frequencyScore, weight: "20%" },
            ].map(({ label, score, weight }) => {
              const barColor = score >= 75 ? "#7c3aed" : score >= 45 ? "#f59e0b" : "#ef4444";
              return (
                <div key={label}>
                  <div className="flex items-center justify-between text-xs mb-1.5">
                    <span className="text-gray-500">{label} <span className="text-gray-300">· weight {weight}</span></span>
                    <span className="font-semibold text-gray-700">{score}</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-gray-100">
                    <div className="h-full rounded-full transition-all" style={{ width: `${score}%`, backgroundColor: barColor }} />
                  </div>
                </div>
              );
            })}
          </div>
          {freqResult.medianGap != null && (
            <p className="mt-4 text-xs text-gray-400 border-t border-gray-100 pt-3">
              {fcfg.label.charAt(0).toUpperCase() + fcfg.label.slice(1)} cadence
              {" · "}median gap <span className="font-medium text-gray-600">{freqResult.medianGap}d</span>
              {freqResult.stdDev != null && freqResult.stdDev > 0 && ` ±${freqResult.stdDev}d`}
              {needsMoreData ? " · confidence grows with more statement history" : ""}
            </p>
          )}
        </div>
      )}

      {/* ── History ──────────────────────────────────────────────────────── */}
      {history.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
          <p className="px-5 pt-4 pb-2 text-[10px] font-semibold uppercase tracking-widest text-gray-400">History</p>
          <div className="divide-y divide-gray-100">
            {history.map((h) => {
              const isOpen   = expandedMonth === h.yearMonth;
              const sub      = monthSubtitle(h);
              const sorted   = [...h.transactions].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
              return (
                <div key={h.yearMonth}>
                  <button
                    className="w-full px-5 py-3.5 flex items-center gap-4 text-left hover:bg-gray-50 transition"
                    onClick={() => setExpandedMonth(isOpen ? null : h.yearMonth)}
                  >
                    {/* Left accent bar */}
                    <span className={`shrink-0 w-1 h-8 rounded-full ${sub.color}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-800">{longMonth(h.yearMonth)}</p>
                      <p className={`text-xs mt-0.5 ${sub.color === "bg-amber-400" ? "text-amber-600" : "text-gray-400"}`}>
                        {sub.text}
                      </p>
                    </div>
                    <div className="shrink-0 flex items-center gap-2">
                      <span className="text-sm font-bold text-gray-900 tabular-nums">{fmtCur(h.amount)}</span>
                      <svg className={`h-4 w-4 text-gray-300 transition-transform ${isOpen ? "rotate-180" : ""}`}
                        fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>
                  </button>

                  {isOpen && sorted.length > 0 && (
                    <div className="border-t border-gray-100 divide-y divide-gray-100">
                      {sorted.map((txn, i) => {
                        const acctSlug    = txn.accountSlug ?? "unknown";
                        const txKey       = incomeTxnKey(acctSlug, { source: sourceName, amount: txn.amount, date: txn.date });
                        const splits      = txnSplits[txKey] ?? [];
                        const effectiveCat = splits.length === 1 && Math.abs(splits[0].amount - txn.amount) < 0.005
                          ? splits[0].category
                          : (sourceCategory || "Other");
                        const isSaving    = savingTxnKey === txKey;
                        const hasOverride = splits.length > 0;
                        const isAnomaly   = txn.amount > typicalDeposit * 1.6 && typicalDeposit > 0;
                        const catColor    = INCOME_CAT_COLORS[effectiveCat] ?? "#9ca3af";
                        return (
                          <div key={i} className="flex items-center gap-3 px-5 py-3 bg-gray-50/50">
                            <p className="w-16 shrink-0 text-sm text-gray-500">{txn.date ? fmtDateShort(txn.date) : "—"}</p>
                            {isSaving ? (
                              <span className="text-[10px] text-gray-400">Saving…</span>
                            ) : (
                              <select
                                value={effectiveCat}
                                onChange={(e) => void handleSetTxnCategory(txn, e.target.value)}
                                className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold cursor-pointer focus:outline-none focus:ring-1 focus:ring-purple-300 transition`}
                                style={{
                                  backgroundColor: `${catColor}22`,
                                  color: catColor,
                                  borderColor: hasOverride ? catColor + "66" : "#e5e7eb",
                                }}
                              >
                                {INCOME_CATEGORIES.filter(c => c !== "Transfer").map((cat) => (
                                  <option key={cat} value={cat}>{cat}</option>
                                ))}
                              </select>
                            )}
                            {isAnomaly && (
                              <span className="text-[10px] text-amber-500 italic shrink-0">
                                ~{(txn.amount / typicalDeposit).toFixed(1)}× typical ({fmtCur(typicalDeposit)})
                              </span>
                            )}
                            <span className="flex-1" />
                            <span className="text-sm font-semibold text-green-600 tabular-nums">+{fmtCur(txn.amount)}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Footer */}
          <div className="px-5 py-3 border-t border-gray-100 text-center">
            <p className="text-xs text-gray-400">
              Total earned since {longMonth(history[history.length - 1]?.yearMonth ?? "")}
              {" · "}<span className="font-medium text-gray-600">{formatCurrency(totalEarned, homeCurrency, undefined, true)}</span>
              {" "}across {history.length} months
            </p>
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
  );
}
