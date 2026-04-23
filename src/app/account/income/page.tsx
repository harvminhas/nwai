"use client";

import { useEffect, useState, useRef, useCallback, Suspense } from "react";
import Link from "next/link";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseClient } from "@/lib/firebase";
import { doc, getDoc, setDoc } from "firebase/firestore";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis,
  CartesianGrid, Tooltip,
} from "recharts";
import type { IncomeTransaction, IncomeSource } from "@/lib/types";
import {
  scoreSource, detectFrequency,
  FREQUENCY_CONFIG, RELIABILITY_CONFIG, GENERIC_SOURCE_NAMES,
  INCOME_CATEGORIES, INCOME_CAT_COLORS,
  type Reliability,
} from "@/lib/incomeEngine";
import type { SourceMonthData } from "@/lib/incomeEngine";
import { fmt, getCurrencySymbol, formatCurrency } from "@/lib/currencyUtils";
import { incomeTxnKey } from "@/lib/applyRules";
import type { SourceSuggestion } from "@/lib/sourceMappings";
import { INCOME_TRANSFER_RE } from "@/lib/spendingMetrics";
import type { CashIncomeEntry, CashIncomeFrequency, CashIncomeCategory } from "@/lib/cashIncome";
import { CASH_INCOME_FREQ_MONTHLY, occurrencesInMonth, datesInMonth } from "@/lib/cashIncome";
import { PROFILE_REFRESHED_EVENT, useProfileRefresh } from "@/contexts/ProfileRefreshContext";

// ── helpers ───────────────────────────────────────────────────────────────────

function fmtShort(v: number, ccy?: string) {
  const sym = getCurrencySymbol(ccy);
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${sym}${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sym}${Math.round(abs / 1_000)}k`;
  return fmt(v, ccy);
}
function fmtAxis(v: number, ccy?: string) {
  const sym = getCurrencySymbol(ccy);
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${sym}${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sym}${Math.round(abs / 1_000)}k`;
  return v === 0 ? `${sym}0` : fmt(v, ccy);
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
function fmtDateFull(iso: string) {
  return new Date(iso + "T12:00:00")
    .toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
function toMonthly(amount: number, freq: CashIncomeFrequency): number {
  return amount * (CASH_INCOME_FREQ_MONTHLY[freq] ?? 0);
}
function sourceSlug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 60);
}

/** Merge synthetic cash income transactions into a consolidated data income object.
 *  Avoids duplicating entries that already exist with the same source name. */
function mergeCashTransactions(
  income: { total: number; sources: IncomeSource[]; transactions?: IncomeTransaction[] },
  cashEntries: CashIncomeEntry[],
  yearMonth: string,
): { total: number; sources: IncomeSource[]; transactions: IncomeTransaction[] } {
  const existing = income.transactions ?? [];
  const existingNames = new Set(existing.map((t) => (t.source ?? "").toLowerCase()));
  const synthetic: IncomeTransaction[] = [];
  for (const entry of cashEntries) {
    if (existingNames.has(entry.name.toLowerCase())) continue; // already in statement
    for (const date of datesInMonth(entry, yearMonth)) {
      synthetic.push({ source: entry.name, amount: entry.amount, date, category: entry.category, accountLabel: "Cash", accountSlug: "cash" });
    }
  }
  return { ...income, transactions: [...existing, ...synthetic] };
}

// ── visual config ─────────────────────────────────────────────────────────────

const SOURCE_COLORS = [
  "#7c3aed", "#f59e0b", "#10b981", "#3b82f6", "#f97316", "#ec4899", "#06b6d4", "#84cc16",
];

const CASH_INCOME_FREQ_OPTIONS: { value: CashIncomeFrequency; label: string }[] = [
  { value: "weekly",    label: "Weekly" },
  { value: "biweekly",  label: "Every 2 weeks" },
  { value: "monthly",   label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "annual",    label: "Annually" },
  { value: "once",      label: "One-time" },
];
const CASH_INCOME_CATEGORY_OPTIONS = INCOME_CATEGORIES.filter((c) => c !== "Transfer");

const CATEGORY_COLORS: Record<string, string> = {
  Salary:      "#7c3aed",
  Freelance:   "#3b82f6",
  Rent:        "#10b981",
  Business:    "#f59e0b",
  Government:  "#06b6d4",
  Investment:  "#ec4899",
  Gift:        "#84cc16",
  Other:       "#9ca3af",
};

// ── transfer detection ────────────────────────────────────────────────────────

function isTransferSource(description: string, txns?: { category?: string }[]): boolean {
  if (INCOME_TRANSFER_RE.test(description)) return true;
  if (txns && txns.length > 0 && txns.every((t) => t.category === "Transfer In")) return true;
  return false;
}
function isGenericSourceName(description: string): boolean {
  const d = description.trim().toLowerCase();
  return GENERIC_SOURCE_NAMES.some((g) => d === g);
}

// ── amount clustering ─────────────────────────────────────────────────────────

function clusterByAmount(
  description: string,
  txns: IncomeTransaction[],
  ccy?: string,
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
    if (match) { match.txns.push(txn); }
    else { clusters.push({ representative: txn.amount, txns: [txn] }); }
  }
  const result: { description: string; transactions: IncomeTransaction[] }[] = [];
  const miscTxns: IncomeTransaction[] = [];
  for (const cluster of clusters) {
    const avg = cluster.txns.reduce((s, t) => s + t.amount, 0) / cluster.txns.length;
    if (avg >= 200 && cluster.txns.length >= 2) {
      result.push({ description: `${description} — ${fmt(Math.round(avg), ccy)}`, transactions: cluster.txns });
    } else {
      miscTxns.push(...cluster.txns);
    }
  }
  if (miscTxns.length > 0) result.push({ description, transactions: miscTxns });
  if (result.length === 1 && miscTxns.length === 0) return [{ description, transactions: txns }];
  return result.length > 0 ? result : [{ description, transactions: txns }];
}

// ── tab types ─────────────────────────────────────────────────────────────────

const TABS = [
  { id: "overview",     label: "Overview" },
  { id: "sources",      label: "By Source" },
  { id: "categories",   label: "By Category" },
  { id: "cash",         label: "Cash" },
  { id: "transactions", label: "Transactions" },
] as const;
type TabId = typeof TABS[number]["id"];


// ── local types ───────────────────────────────────────────────────────────────

interface HistoryPoint { yearMonth: string; incomeTotal: number; expensesTotal: number; isEstimate?: boolean }
interface ConsolidatedData {
  income: { total: number; sources: IncomeSource[]; transactions?: IncomeTransaction[] };
  expenses: { total: number };
  savingsRate: number;
  txIncome?: number;
  txExpenses?: number;
}

// ── cash income form ──────────────────────────────────────────────────────────

/** Preset start-date options — same concept as "how far back" on statement upload. */
const START_DATE_PRESETS: { label: string; monthsAgo: number }[] = [
  { label: "This month",    monthsAgo: 0 },
  { label: "Last month",    monthsAgo: 1 },
  { label: "3 months ago",  monthsAgo: 3 },
  { label: "6 months ago",  monthsAgo: 6 },
  { label: "1 year ago",    monthsAgo: 12 },
];

function monthsAgoYmd(n: number): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

const EMPTY_CASH_FORM = {
  id: "",
  name: "",
  amount: "",
  frequency: "monthly" as CashIncomeFrequency,
  category: "Other" as CashIncomeCategory,
  notes: "",
  nextDate: "",
  startDate: monthsAgoYmd(0), // default: this month
};

// ── page ──────────────────────────────────────────────────────────────────────

function IncomePageInner() {
  const router     = useRouter();
  const pathname   = usePathname();
  const searchParams = useSearchParams();
  const { requestProfileRefresh } = useProfileRefresh();

  const [history, setHistory]             = useState<HistoryPoint[]>([]);
  const [latestStmtMonth, setLatestStmtMonth] = useState<string | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  const [dataByMonth, setDataByMonth]     = useState<Record<string, ConsolidatedData>>({});
  const [sourceHistory, setSourceHistory] = useState<Record<string, SourceMonthData[]>>({});
  const [totalMonths, setTotalMonths]     = useState(0);
  const [loading, setLoading]             = useState(true);
  const [error, setError]                 = useState<string | null>(null);
  const [uid, setUid]                     = useState<string | null>(null);
  const [excludedSources, setExcludedSources] = useState<Set<string>>(new Set());
  const [transferSources, setTransferSources] = useState<Set<string>>(new Set());
  const [sourceLabels, setSourceLabels]   = useState<Record<string, string>>({});
  const [editingLabel, setEditingLabel]   = useState<string | null>(null);
  const [labelDraft, setLabelDraft]       = useState("");
  const labelInputRef                     = useRef<HTMLInputElement>(null);
  const [showOneTime, setShowOneTime]     = useState(false);
  const [srcTimeScope, setSrcTimeScope]   = useState<"3" | "6" | "12" | "all">("12");
  const [suggestions, setSuggestions]     = useState<SourceSuggestion[]>([]);
  const [suggestionDecisions, setSuggestionDecisions] = useState<Record<string, "confirmed" | "rejected">>({});
  const [expandedIncomeCatRows, setExpandedIncomeCatRows] = useState<Set<string>>(new Set());
  const [applyingMappings, setApplyingMappings] = useState(false);
  const [token, setToken]                 = useState<string | null>(null);
  const tokenRef                          = useRef<string | null>(null);
  const [suggestionListExpanded, setSuggestionListExpanded] = useState(false);
  const [homeCurrency, setHomeCurrency]   = useState<string>("USD");

  // Income category rules: source slug → category (source-level default)
  const [incomeCategoryRules, setIncomeCategoryRules] = useState<Record<string, string>>({});
  const [savingCategoryRule, setSavingCategoryRule]   = useState<string | null>(null);
  // Per-transaction income splits: incomeTxnKey → splits array
  const [incomeTxnSplits, setIncomeTxnSplits]         = useState<Record<string, { category: string; amount: number }[]>>({});
  // Split editor state
  const [editingSplitTxn, setEditingSplitTxn]         = useState<string | null>(null);
  const [splitDraft, setSplitDraft]                   = useState<{ category: string; amount: string }[]>([]);
  const [savingTxnKey, setSavingTxnKey]               = useState<string | null>(null);

  // Cash income
  const [cashItems, setCashItems]         = useState<CashIncomeEntry[]>([]);
  const [cashLoading, setCashLoading]     = useState(false);
  const [cashForm, setCashForm]           = useState(EMPTY_CASH_FORM);
  const [showCashModal, setShowCashModal] = useState(false);
  const [savingCash, setSavingCash]       = useState(false);

  // Active tab
  const initialTab = (searchParams.get("tab") as TabId | null);
  const [activeTab, setActiveTab]         = useState<TabId>(
    TABS.some((t) => t.id === initialTab) ? initialTab! : "overview"
  );

  function switchTab(id: TabId) {
    setActiveTab(id);
    const p = new URLSearchParams(Array.from(searchParams.entries()));
    p.set("tab", id);
    router.replace(`${pathname}?${p}`);
  }

  // ── data loading ─────────────────────────────────────────────────────────────

  // Fetch a single month's data into cache without changing selectedMonth.
  const prefetchMonth = useCallback(async (ym: string, tok: string, cashEntries: CashIncomeEntry[]) => {
    try {
      const res = await fetch(`/api/user/statements/consolidated?month=${ym}`, {
        headers: { Authorization: `Bearer ${tok}` },
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json.data) {
        const rawIncome = json.data.income ?? { total: 0, sources: [], transactions: [] };
        setDataByMonth((prev) => ({
          ...prev,
          [ym]: {
            income: mergeCashTransactions(rawIncome, cashEntries, ym),
            expenses: json.data.expenses ?? { total: 0 },
            savingsRate: json.data.savingsRate ?? 0,
            txIncome: json.txMonthlyIncome ?? json.data.income?.total ?? 0,
            txExpenses: json.txMonthlyExpenses ?? json.data.expenses?.total ?? 0,
          },
        }));
      } else {
        const cashTotal = cashEntries.reduce((sum, e) => sum + occurrencesInMonth(e, ym) * e.amount, 0);
        setDataByMonth((prev) => ({
          ...prev,
          [ym]: {
            income: mergeCashTransactions({ total: cashTotal, sources: [], transactions: [] }, cashEntries, ym),
            expenses: { total: 0 },
            savingsRate: 0,
            txIncome: cashTotal,
            txExpenses: 0,
          },
        }));
      }
    } catch { /* best-effort */ }
  }, []);

  useEffect(() => {
    const { auth, db } = getFirebaseClient();
    return onAuthStateChanged(auth, async (user) => {
      if (!user) { router.push("/login"); return; }
      setUid(user.uid);
      setLoading(true); setError(null);
      try {
        const [prefDoc, labelsDoc, transferDoc] = await Promise.all([
          getDoc(doc(db, `users/${user.uid}/prefs/excludedIncomeSources`)),
          getDoc(doc(db, `users/${user.uid}/prefs/incomeSourceLabels`)),
          getDoc(doc(db, `users/${user.uid}/prefs/transferIncomeSources`)),
        ]);
        if (prefDoc.exists()) setExcludedSources(new Set(prefDoc.data()?.keys ?? []));
        if (labelsDoc.exists()) setSourceLabels(labelsDoc.data() ?? {});
        if (transferDoc.exists()) setTransferSources(new Set(transferDoc.data()?.keys ?? []));

        const tok = await user.getIdToken();
        setToken(tok);
        tokenRef.current = tok;
        const res = await fetch("/api/user/statements/consolidated", {
          headers: { Authorization: `Bearer ${tok}` },
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) { setError(json.error || "Failed to load"); return; }
        if (json.homeCurrency) setHomeCurrency(json.homeCurrency);

        const hist: HistoryPoint[] = (json.history ?? []).map(
          (h: { yearMonth: string; incomeTotal?: number; expensesTotal?: number; isEstimate?: boolean }) => ({
            yearMonth: h.yearMonth,
            incomeTotal: h.incomeTotal ?? 0,
            expensesTotal: h.expensesTotal ?? 0,
            isEstimate: h.isEstimate ?? false,
          })
        );
        setHistory(hist);
        // Last month with a real uploaded statement (not cash-only or backfill)
        const lastRealMonth = [...hist].reverse().find((h) => !h.isEstimate)?.yearMonth ?? (json.yearMonth as string ?? null);
        setLatestStmtMonth(lastRealMonth);
        setTotalMonths(json.totalMonthsTracked ?? hist.length);
        setSourceHistory(json.incomeSourceHistory ?? {});
        setIncomeCategoryRules(json.incomeCategoryRules ?? {});
        setIncomeTxnSplits(json.incomeTxnSplits ?? {});
        setCashItems((json.cashIncomeItems ?? []) as CashIncomeEntry[]);

        const incomeSugg = json.incomeSuggestions ?? [];
        setSuggestions(incomeSugg);
        const defaultDecisions: Record<string, "confirmed" | "rejected"> = {};
        for (const s of incomeSugg) defaultDecisions[s.pairKey] = "confirmed";
        setSuggestionDecisions(defaultDecisions);

        const latestYm: string = json.yearMonth ?? null;
        // Default to the most recent month with actual income — avoids showing an
        // empty detail panel when the current month's statements aren't fully uploaded.
        const defaultYm = [...hist].reverse().find((h) => h.incomeTotal > 0)?.yearMonth ?? latestYm;
        setSelectedMonth(defaultYm);
        const initialCashItems = (json.cashIncomeItems ?? []) as CashIncomeEntry[];
        if (latestYm && json.data) {
          const rawIncome = json.data.income ?? { total: 0, sources: [], transactions: [] };
          setDataByMonth({
            [latestYm]: {
              income: mergeCashTransactions(rawIncome, initialCashItems, latestYm),
              expenses: json.data.expenses ?? { total: 0 },
              savingsRate: json.data.savingsRate ?? 0,
              txIncome: json.txMonthlyIncome ?? json.data.income?.total ?? 0,
              txExpenses: json.txMonthlyExpenses ?? json.data.expenses?.total ?? 0,
            },
          });
        }
        // Background-prefetch all other history months so chart dots are instantly clickable
        const otherYms = hist.map((h) => h.yearMonth).filter((ym) => ym !== latestYm);
        for (const ym of otherYms) {
          void prefetchMonth(ym, tok, initialCashItems);
        }
      } catch { setError("Failed to load income data"); }
      finally { setLoading(false); }
    });
  }, [router, prefetchMonth]);

  // Re-fetches history + cash items when the financial profile is rebuilt.
  // Clears the whole dataByMonth cache so stale values (e.g. deleted cash income)
  // don't linger in the detail panel.
  const reloadConsolidated = useCallback(async () => {
    const tok = tokenRef.current;
    if (!tok) return;
    try {
      const res = await fetch("/api/user/statements/consolidated", {
        headers: { Authorization: `Bearer ${tok}` },
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return;
      const hist: HistoryPoint[] = (json.history ?? []).map(
        (h: { yearMonth: string; incomeTotal?: number; expensesTotal?: number; isEstimate?: boolean }) => ({
          yearMonth: h.yearMonth,
          incomeTotal: h.incomeTotal ?? 0,
          expensesTotal: h.expensesTotal ?? 0,
          isEstimate: h.isEstimate ?? false,
        })
      );
      setHistory(hist);
      const lastRealMonth = [...hist].reverse().find((h) => !h.isEstimate)?.yearMonth ?? (json.yearMonth as string ?? null);
      setLatestStmtMonth(lastRealMonth);
      setTotalMonths(json.totalMonthsTracked ?? hist.length);
      setSourceHistory(json.incomeSourceHistory ?? {});
      setIncomeCategoryRules(json.incomeCategoryRules ?? {});
      setIncomeTxnSplits(json.incomeTxnSplits ?? {});
      const freshCashItems = (json.cashIncomeItems ?? []) as CashIncomeEntry[];
      setCashItems(freshCashItems);
      const latestYm: string = json.yearMonth ?? null;
      // Reset entire cache so deleted/changed items don't show stale data
      const freshCache: Record<string, ConsolidatedData> = {};
      if (latestYm && json.data) {
        const rawIncome = json.data.income ?? { total: 0, sources: [], transactions: [] };
        freshCache[latestYm] = {
          income: mergeCashTransactions(rawIncome, freshCashItems, latestYm),
          expenses: json.data.expenses ?? { total: 0 },
          savingsRate: json.data.savingsRate ?? 0,
          txIncome: json.txMonthlyIncome ?? json.data.income?.total ?? 0,
          txExpenses: json.txMonthlyExpenses ?? json.data.expenses?.total ?? 0,
        };
      }
      setDataByMonth(freshCache);
      // Background-prefetch all other history months so dots are instantly clickable
      const allYms = hist.map((h) => h.yearMonth).filter((ym) => ym !== latestYm);
      for (const ym of allYms) {
        void prefetchMonth(ym, tok, freshCashItems);
      }
    } catch { /* best-effort */ }
  }, [prefetchMonth]);

  useEffect(() => {
    if (!token) return;
    window.addEventListener(PROFILE_REFRESHED_EVENT, reloadConsolidated);
    return () => window.removeEventListener(PROFILE_REFRESHED_EVENT, reloadConsolidated);
  }, [token, reloadConsolidated]);

  async function fetchMonth(ym: string) {
    setSelectedMonth(ym);
    if (dataByMonth[ym]) return;
    try {
      const { auth } = getFirebaseClient();
      const user = auth.currentUser;
      if (!user) return;
      const tok = await user.getIdToken();
      const res = await fetch(`/api/user/statements/consolidated?month=${ym}`, {
        headers: { Authorization: `Bearer ${tok}` },
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json.data) {
        const rawIncome = json.data.income ?? { total: 0, sources: [], transactions: [] };
        setDataByMonth((prev) => ({
          ...prev,
          [ym]: {
            income: mergeCashTransactions(rawIncome, cashItems, ym),
            expenses: json.data.expenses ?? { total: 0 },
            savingsRate: json.data.savingsRate ?? 0,
            txIncome: json.txMonthlyIncome ?? json.data.income?.total ?? 0,
            txExpenses: json.txMonthlyExpenses ?? json.data.expenses?.total ?? 0,
          },
        }));
      } else {
        const cashTotal = cashItems.reduce((sum, entry) =>
          sum + occurrencesInMonth(entry, ym) * entry.amount, 0);
        setDataByMonth((prev) => ({
          ...prev,
          [ym]: {
            income: mergeCashTransactions({ total: cashTotal, sources: [], transactions: [] }, cashItems, ym),
            expenses: { total: 0 },
            savingsRate: 0,
            txIncome: cashTotal,
            txExpenses: 0,
          },
        }));
      }
    } catch { /* ignore */ }
  }

  // ── source prefs ─────────────────────────────────────────────────────────────

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
    if (token) fetch("/api/user/invalidate-cache", { method: "POST", headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
    requestProfileRefresh();
  }
  async function handleRestoreTransfer(description: string) {
    const next = new Set(transferSources);
    next.delete(description);
    setTransferSources(next);
    if (!uid) return;
    const { db } = getFirebaseClient();
    await setDoc(doc(db, `users/${uid}/prefs/transferIncomeSources`), { keys: Array.from(next) });
    if (token) fetch("/api/user/invalidate-cache", { method: "POST", headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
    requestProfileRefresh();
  }

  // ── source labels ─────────────────────────────────────────────────────────────

  function startEditLabel(description: string) {
    setEditingLabel(description);
    setLabelDraft(sourceLabels[description] ?? description);
    setTimeout(() => labelInputRef.current?.select(), 30);
  }
  async function saveLabel(description: string) {
    const trimmed = labelDraft.trim();
    const next = { ...sourceLabels };
    if (trimmed && trimmed !== description) { next[description] = trimmed; }
    else { delete next[description]; }
    setSourceLabels(next);
    setEditingLabel(null);
    if (!uid) return;
    const { db } = getFirebaseClient();
    await setDoc(doc(db, `users/${uid}/prefs/incomeSourceLabels`), next);
  }
  function cancelEditLabel() { setEditingLabel(null); setLabelDraft(""); }

  // ── income category rules ─────────────────────────────────────────────────────

  async function handleSetCategory(source: string, category: string) {
    if (!token) return;
    const slug = sourceSlug(source);
    setSavingCategoryRule(slug);
    try {
      await fetch("/api/user/income-category-rules", {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ source, category }),
      });
      setIncomeCategoryRules((prev) => ({ ...prev, [slug]: category }));
      // If marked as Transfer, also add to local transferSources state
      if (category === "Transfer") {
        setTransferSources((prev) => new Set([...prev, source]));
      } else if (transferSources.has(source)) {
        setTransferSources((prev) => { const n = new Set(prev); n.delete(source); return n; });
      }
    } finally {
      setSavingCategoryRule(null);
    }
  }

  // ── per-transaction income splits ────────────────────────────────────────────

  function openSplitEditor(txKey: string, existingSplits: { category: string; amount: number }[]) {
    setEditingSplitTxn(txKey);
    setSplitDraft(existingSplits.map((s) => ({ category: s.category, amount: String(s.amount) })));
  }

  function closeSplitEditor() {
    setEditingSplitTxn(null);
    setSplitDraft([]);
  }

  async function handleSaveSplits(
    txn: { source: string; amount: number; date?: string; accountSlug?: string },
    rawSplits: { category: string; amount: string }[],
  ) {
    if (!token) return;
    const acctSlug = txn.accountSlug ?? "unknown";
    const key = incomeTxnKey(acctSlug, txn);
    // Filter out blank/zero rows, parse amounts
    const splits = rawSplits
      .filter((s) => s.category && parseFloat(s.amount) > 0)
      .map((s) => ({ category: s.category, amount: parseFloat(s.amount) }));
    setSavingTxnKey(key);
    try {
      await fetch("/api/user/income-txn-category", {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ accountSlug: acctSlug, date: txn.date, amount: txn.amount, source: txn.source, splits }),
      });
      setIncomeTxnSplits((prev) =>
        splits.length === 0 ? (({ [key]: _, ...rest }) => rest)(prev) : { ...prev, [key]: splits }
      );
    } finally {
      setSavingTxnKey(null);
      closeSplitEditor();
    }
  }

  // ── source mappings ───────────────────────────────────────────────────────────

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
      const appliedKeys = new Set(toSave.map((m) => m.pairKey));
      setSuggestions((prev) => prev.filter((s) => !appliedKeys.has(s.pairKey)));
      setSuggestionDecisions({});
    } finally {
      setApplyingMappings(false);
    }
  }

  // ── cash income CRUD ──────────────────────────────────────────────────────────

  const loadCashIncome = useCallback(async (tok: string) => {
    setCashLoading(true);
    try {
      const res = await fetch("/api/user/cash-income", { headers: { Authorization: `Bearer ${tok}` } });
      const json = await res.json().catch(() => ({}));
      if (res.ok) setCashItems(json.items ?? []);
    } finally { setCashLoading(false); }
  }, []);

  function openAddCash() {
    setCashForm(EMPTY_CASH_FORM);
    setShowCashModal(true);
  }
  function openEditCash(item: CashIncomeEntry) {
    setCashForm({
      id: item.id,
      name: item.name,
      amount: String(item.amount),
      frequency: item.frequency,
      category: item.category,
      notes: item.notes ?? "",
      nextDate: item.nextDate ?? "",
      startDate: item.startDate ?? monthsAgoYmd(0),
    });
    setShowCashModal(true);
  }
  async function saveCashItem() {
    if (!token || !cashForm.name || !cashForm.amount) return;
    setSavingCash(true);
    try {
      const body = {
        ...cashForm,
        amount: parseFloat(cashForm.amount),
        notes: cashForm.notes || undefined,
        nextDate: cashForm.nextDate || undefined,
        startDate: cashForm.startDate || undefined,
        ...(cashForm.id ? { id: cashForm.id } : {}),
      };
      await fetch("/api/user/cash-income", {
        method: cashForm.id ? "PUT" : "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      setShowCashModal(false);
      await loadCashIncome(token);
      // Invalidate cache so incomeTotal is recomputed with new cash income
      await fetch("/api/user/invalidate-cache", { method: "POST", headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
      await reloadConsolidated();
      requestProfileRefresh();
    } finally { setSavingCash(false); }
  }
  async function deleteCashItem(id: string) {
    if (!token) return;
    await fetch(`/api/user/cash-income?id=${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
    setCashItems((prev) => prev.filter((c) => c.id !== id));
    await fetch("/api/user/invalidate-cache", { method: "POST", headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
    await reloadConsolidated();
    requestProfileRefresh();
  }

  // ── derived ───────────────────────────────────────────────────────────────────

  const current         = selectedMonth ? dataByMonth[selectedMonth] : null;
  const income          = current?.income;
  const sources         = income?.sources ?? [];
  const transactions    = income?.transactions ?? [];
  const expensesTotal   = current?.txExpenses ?? current?.expenses?.total ?? 0;

  const rawSourceMap = new Map<string, IncomeTransaction[]>();
  if (transactions.length > 0) {
    for (const txn of transactions) {
      const key = (txn.source ?? "Other").trim();
      if (!rawSourceMap.has(key)) rawSourceMap.set(key, []);
      rawSourceMap.get(key)!.push(txn);
    }
  } else {
    for (const src of sources) rawSourceMap.set(src.description.trim(), []);
  }

  const expandedSources: { description: string; amount: number; txns: IncomeTransaction[] }[] = [];
  for (const [desc, txns] of rawSourceMap.entries()) {
    if (transactions.length > 0) {
      const clusters = clusterByAmount(desc, txns, homeCurrency);
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
  const expandedTxnMap = new Map(expandedSources.map((s) => [s.description, s.txns]));
  const allMergedSources = expandedSources.map(({ description, amount }) => ({ description, amount })).sort((a, b) => b.amount - a.amount);

  const mergedSources = allMergedSources.filter(
    (s) => !isTransferSource(s.description, expandedTxnMap.get(s.description) ?? [])
         && !excludedSources.has(s.description)
         && !transferSources.has(s.description)
         && incomeCategoryRules[sourceSlug(s.description)] !== "Transfer"
  );
  const autoFilteredSources = allMergedSources.filter(
    (s) => isTransferSource(s.description, expandedTxnMap.get(s.description) ?? []) || transferSources.has(s.description) || incomeCategoryRules[sourceSlug(s.description)] === "Transfer"
  );
  const manuallyExcludedSources = allMergedSources.filter((s) => excludedSources.has(s.description));

  const scoredSources = mergedSources.map((src, i) => {
    const clusterTxns = expandedTxnMap.get(src.description) ?? [];
    let hist = sourceHistory[src.description] ?? [];
    if (hist.length === 0 && clusterTxns.length > 0) {
      hist = [{ yearMonth: selectedMonth ?? "", amount: src.amount, transactions: clusterTxns.map((t) => ({ date: t.date, amount: t.amount })) }];
    }
    const allDates   = hist.flatMap((h) => h.transactions.map((t) => t.date).filter(Boolean) as string[]);
    const freqResult = detectFrequency(allDates);
    const result = scoreSource(src.description, hist, totalMonths, freqResult);
    const totalIncome = current?.txIncome ?? income?.total ?? 0;
    const pct = totalIncome > 0 ? Math.round((src.amount / totalIncome) * 100) : 0;
    return { ...src, color: SOURCE_COLORS[i % SOURCE_COLORS.length], pct, ...result, freqResult };
  });

  const regularSources  = scoredSources.filter((s) => s.reliability !== "one-time");
  const oneTimeSources  = scoredSources.filter((s) => s.reliability === "one-time");
  const regularTotal    = regularSources.reduce((s, src) => s + src.amount, 0);
  const oneTimeTotal    = oneTimeSources.reduce((s, src) => s + src.amount, 0);
  const surplus         = regularTotal - expensesTotal;

  const sortedHistory   = [...history].sort((a, b) => a.yearMonth.localeCompare(b.yearMonth));

  // Drop trailing zero-income months so the chart ends on real data.
  // Then split remaining months into actual (solid) vs projected (dashed):
  //   - months with isEstimate=true (cash-only, no statement) → projected/dashed
  //   - real statement months → actual/solid
  // The last real month gets both values so the lines connect.
  const trimmedHistory = (() => {
    const arr = [...sortedHistory];
    while (arr.length > 1 && arr[arr.length - 1].incomeTotal === 0) arr.pop();
    return arr;
  })();

  const lastRealIdx = (() => {
    for (let i = trimmedHistory.length - 1; i >= 0; i--) {
      if (!trimmedHistory[i].isEstimate) return i;
    }
    return trimmedHistory.length - 1;
  })();

  const chartData = trimmedHistory.map((h, i) => {
    const isProjected = i > lastRealIdx;
    const isBoundary  = i === lastRealIdx;
    return {
      label:     shortMonth(h.yearMonth),
      ym:        h.yearMonth,
      income:    isProjected ? null : h.incomeTotal,
      projected: (isProjected || isBoundary) ? h.incomeTotal : null,
    };
  });
  const regularHistoryPoints = trimmedHistory.filter((h) => h.incomeTotal > 0);
  const avgIncome       = regularHistoryPoints.length > 0
    ? Math.round(regularHistoryPoints.reduce((s, h) => s + h.incomeTotal, 0) / regularHistoryPoints.length)
    : 0;
  const currentIdx      = selectedMonth ? sortedHistory.findIndex((h) => h.yearMonth === selectedMonth) : -1;
  const prevPoint       = currentIdx > 0 ? sortedHistory[currentIdx - 1] : null;
  const incomeDelta     = prevPoint != null ? (current?.txIncome ?? income?.total ?? 0) - prevPoint.incomeTotal : null;
  const tabMonths       = sortedHistory.slice(-6).map((h) => h.yearMonth);
  const txCount         = transactions.length;

  // ── all-time derivations ──────────────────────────────────────────────────────
  const allTimeIncome = sortedHistory.reduce((s, h) => s + h.incomeTotal, 0);

  // For By Source all-time view
  const srcScopeCutoff = (() => {
    if (srcTimeScope === "all") return "";
    const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - parseInt(srcTimeScope));
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  })();
  const srcScopeHistory = srcTimeScope === "all" ? sortedHistory : sortedHistory.filter((h) => h.yearMonth >= srcScopeCutoff);
  const srcScopeIncome  = srcScopeHistory.reduce((s, h) => s + h.incomeTotal, 0);

  const allTimeScoredSources: {
    description: string; total: number; months: number; avgMonthly: number;
    freqResult: ReturnType<typeof detectFrequency>;
    sparkData: { ym: string; v: number }[];
    pct: number; color: string;
    reliability: Reliability; score: number;
  }[] = Object.entries(sourceHistory)
    .map(([description, monthHistory], i) => {
      const isTransferSrc = isTransferSource(description) || transferSources.has(description) || incomeCategoryRules[sourceSlug(description)] === "Transfer";
      const isExcludedSrc = excludedSources.has(description);
      if (isTransferSrc || isExcludedSrc) return null;
      const filtered = srcTimeScope === "all" ? monthHistory : monthHistory.filter((h) => h.yearMonth >= srcScopeCutoff);
      if (filtered.length === 0) return null;
      const total = filtered.reduce((s, h) => s + h.amount, 0);
      const months = filtered.length;
      const avgMonthly = months > 0 ? total / months : 0;
      const allDates = filtered.flatMap((h) => (h.transactions ?? []).map((t) => t.date).filter(Boolean) as string[]);
      const freqResult = detectFrequency(allDates);
      const sparkData = srcScopeHistory.map((h) => ({
        ym: h.yearMonth,
        v: filtered.find((m) => m.yearMonth === h.yearMonth)?.amount ?? 0,
      }));
      const pct = srcScopeIncome > 0 ? Math.round((total / srcScopeIncome) * 100) : 0;
      const scored = scoreSource(description, filtered, months, freqResult);
      return { description, total, months, avgMonthly, freqResult, sparkData, pct, color: SOURCE_COLORS[i % SOURCE_COLORS.length], ...scored };
    })
    .filter((s): s is NonNullable<typeof s> => s !== null)
    .sort((a, b) => b.total - a.total);

  // Cash income derived
  const cashMonthlyTotal = cashItems.reduce((s, c) => s + toMonthly(c.amount, c.frequency), 0);

  // ── Income category breakdown ─────────────────────────────────────────────────
  // Iterates each transaction in scope, applies incomeTxnSplits so that per-txn
  // overrides (e.g. one Bonus deposit inside a Salary source) are counted correctly.
  const incomeCategoryBreakdown = (() => {
    type CatEntry = { total: number; sources: { name: string; total: number; isCash: boolean }[] };
    const catMap = new Map<string, CatEntry>();

    function addToMap(cat: string, srcName: string, amount: number, isCash: boolean) {
      if (!catMap.has(cat)) catMap.set(cat, { total: 0, sources: [] });
      const e = catMap.get(cat)!;
      e.total += amount;
      // Accumulate into existing source entry if already present for this category
      const existing = e.sources.find((s) => s.name === srcName && s.isCash === isCash);
      if (existing) existing.total += amount;
      else e.sources.push({ name: srcName, total: amount, isCash });
    }

    for (const src of allTimeScoredSources) {
      const srcCat = incomeCategoryRules[sourceSlug(src.description)] || "Other";
      const filtered = srcTimeScope === "all"
        ? (sourceHistory[src.description] ?? [])
        : (sourceHistory[src.description] ?? []).filter((h) => h.yearMonth >= srcScopeCutoff);

      for (const month of filtered) {
        if (month.transactions.length === 0) {
          // No individual transactions — treat whole month amount as source category
          addToMap(srcCat, src.description, month.amount, false);
          continue;
        }
        for (const txn of month.transactions) {
          const acctSlug = txn.accountSlug ?? "unknown";
          const txKey    = incomeTxnKey(acctSlug, { source: src.description, amount: txn.amount, date: txn.date });
          const splits   = incomeTxnSplits[txKey] ?? [];
          if (splits.length > 0) {
            const splitTotal = splits.reduce((s, x) => s + x.amount, 0);
            const residual   = Math.max(0, txn.amount - splitTotal);
            if (residual > 0.005) addToMap(srcCat, src.description, residual, false);
            for (const sp of splits) {
              if (sp.amount > 0.005) addToMap(sp.category, src.description, sp.amount, false);
            }
          } else {
            addToMap(srcCat, src.description, txn.amount, false);
          }
        }
      }
    }

    for (const item of cashItems) {
      const cashTotal = srcScopeHistory.reduce((s, h) => s + occurrencesInMonth(item, h.yearMonth) * item.amount, 0);
      if (cashTotal <= 0) continue;
      const cat = item.category || "Other";
      addToMap(cat, item.name, cashTotal, true);
    }

    const grandTotal = Array.from(catMap.values()).reduce((s, e) => s + e.total, 0);
    return Array.from(catMap.entries())
      .sort((a, b) => b[1].total - a[1].total)
      .map(([name, data]) => ({
        name,
        total: data.total,
        pct: grandTotal > 0 ? Math.round((data.total / grandTotal) * 100) : 0,
        sources: data.sources.sort((a, b) => b.total - a.total),
        color: INCOME_CAT_COLORS[name] ?? "#9ca3af",
      }));
  })();

  // Reliability score: weighted avg of top-source scores (0–100), or 0 if no sources
  const reliabilityScore = (() => {
    const sources = allTimeScoredSources.filter((s) => s.months >= 2);
    if (sources.length === 0) return cashItems.length > 0 ? 90 : 0;
    const totalWeight = sources.reduce((s, x) => s + x.avgMonthly, 0);
    if (totalWeight === 0) return 0;
    return Math.round(sources.reduce((s, x) => s + x.score * (x.avgMonthly / totalWeight), 0));
  })();
  const reliabilityLabel = reliabilityScore >= 80 ? "Strong cadence" : reliabilityScore >= 55 ? "Good cadence" : "Irregular";
  const reliabilityColor = reliabilityScore >= 80 ? "#10b981" : reliabilityScore >= 55 ? "#f59e0b" : "#ef4444";

  // Next expected: find the cash item or scored source with the nearest future occurrence
  const nextExpected = (() => {
    const todayStr = new Date().toISOString().slice(0, 10);
    const todayYM  = todayStr.slice(0, 7);
    const nextYM   = (() => { const d = new Date(); d.setMonth(d.getMonth() + 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; })();
    let best: { name: string; amount: number; date: string } | null = null;
    for (const entry of cashItems) {
      if (entry.frequency === "once") continue;
      for (const ym of [todayYM, nextYM]) {
        const dates = datesInMonth(entry, ym).filter((d) => d > todayStr);
        if (dates.length > 0) {
          const d = dates[0];
          if (!best || d < best.date) best = { name: entry.name, amount: entry.amount, date: d };
          break;
        }
      }
    }
    return best;
  })();

  // "On your radar" cards — up to 4 items combining: upcoming, late, trend, new source
  const radarItems = (() => {
    const todayStr  = new Date().toISOString().slice(0, 10);
    const todayYM   = todayStr.slice(0, 7);
    const nextYM    = (() => { const d = new Date(); d.setMonth(d.getMonth() + 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; })();
    const items: { type: "upcoming" | "late" | "trend" | "new"; title: string; sub: string; amount?: number; positive?: boolean }[] = [];

    // Upcoming cash income (next 14 days)
    const upcoming: { entry: typeof cashItems[0]; date: string }[] = [];
    for (const entry of cashItems) {
      if (entry.frequency === "once") continue;
      for (const ym of [todayYM, nextYM]) {
        const dates = datesInMonth(entry, ym).filter((d) => d > todayStr);
        if (dates.length > 0) { upcoming.push({ entry, date: dates[0] }); break; }
      }
    }
    upcoming.sort((a, b) => a.date.localeCompare(b.date));
    for (const { entry, date } of upcoming.slice(0, 2)) {
      const diffDays = Math.round((new Date(date).getTime() - new Date(todayStr).getTime()) / 86_400_000);
      const when = diffDays === 0 ? "today" : diffDays === 1 ? "tomorrow" : diffDays <= 7 ? `in ${diffDays} days` : `${date.slice(5).replace("-", "/")}`;
      items.push({ type: "upcoming", title: `${entry.name} expected ${when}`, sub: `${entry.name} · monthly cadence, reliable`, amount: entry.amount, positive: true });
    }

    // Late income: monthly cash items whose expected date this month has already passed
    for (const entry of cashItems) {
      if (entry.frequency !== "monthly") continue;
      const datesThisMonth = datesInMonth(entry, todayYM);
      for (const d of datesThisMonth) {
        if (d < todayStr) {
          const diffDays = Math.round((new Date(todayStr).getTime() - new Date(d).getTime()) / 86_400_000);
          const anchor = entry.nextDate ? `usually arrives by the ${new Date(entry.nextDate + "T12:00:00").getDate()}th` : "usually arrives mid-month";
          items.push({ type: "late", title: `${entry.name} is ${diffDays} day${diffDays !== 1 ? "s" : ""} late`, sub: `${entry.name} · ${anchor}`, amount: entry.amount });
        }
      }
    }

    // Income trend vs 3-mo avg
    const recent3 = sortedHistory.slice(-3).filter((h) => !h.isEstimate);
    const prev3   = sortedHistory.slice(-6, -3).filter((h) => !h.isEstimate);
    if (recent3.length >= 2 && prev3.length >= 2) {
      const recentAvg = recent3.reduce((s, h) => s + h.incomeTotal, 0) / recent3.length;
      const prevAvg   = prev3.reduce((s, h) => s + h.incomeTotal, 0) / prev3.length;
      if (prevAvg > 0) {
        const pct = Math.round(((recentAvg - prevAvg) / prevAvg) * 100);
        if (Math.abs(pct) >= 5) {
          const dir = pct > 0 ? "up" : "down";
          items.push({ type: "trend", title: `Income ${dir} ${Math.abs(pct)}% vs. 3-mo avg`, sub: `Average ${dir} from ${fmt(Math.round(prevAvg), homeCurrency)} to ${fmt(Math.round(recentAvg), homeCurrency)}`, positive: pct > 0 });
        }
      }
    }

    return items.slice(0, 4);
  })();

  // All-time source count (statement + cash)
  const allSourceCount = Object.keys(sourceHistory).filter(
    (d) => !isTransferSource(d) && !excludedSources.has(d) && !transferSources.has(d) && incomeCategoryRules[sourceSlug(d)] !== "Transfer"
  ).length + cashItems.length;

  // ── render helpers ────────────────────────────────────────────────────────────

  const mergingCount = suggestions.filter((s) => suggestionDecisions[s.pairKey] !== "rejected").length;

  // ── loading / error states ────────────────────────────────────────────────────

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
  if (history.length === 0) return (
    <div className="mx-auto max-w-2xl lg:max-w-5xl px-4 pt-4 pb-8 sm:py-8">
      <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-12 text-center">
        <p className="text-sm text-gray-500">No income data yet.</p>
        <p className="mt-1 text-xs text-gray-400">Upload a chequing or savings statement to see your income breakdown.</p>
        <Link href="/upload" className="mt-4 inline-block rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700">
          Upload a statement
        </Link>
      </div>
    </div>
  );

  // ── main render ───────────────────────────────────────────────────────────────

  return (
    <div className="mx-auto max-w-2xl lg:max-w-5xl px-4 pt-4 pb-8 sm:py-8 sm:px-6">

      {/* Header */}
      <div className="mb-1">
        <h1 className="font-bold text-3xl text-gray-900">Income</h1>
        <p className="mt-0.5 text-sm text-gray-400">
          {avgIncome > 0 ? `${fmt(avgIncome, homeCurrency)}/mo avg` : ""}{regularHistoryPoints.length > 0 ? ` · ${regularHistoryPoints.length} months tracked` : ""}
        </p>
      </div>

      {/* Section tabs */}
      <div className="mt-3 overflow-x-auto">
        <div className="flex border-b border-gray-200 min-w-max">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => switchTab(tab.id)}
              className={`relative mr-4 pb-2.5 text-sm font-medium transition-colors shrink-0 ${
                activeTab === tab.id
                  ? "text-gray-900 after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-purple-600"
                  : "text-gray-400 hover:text-gray-600"
              }`}
            >
              {tab.label}
              {tab.id === "transactions" && txCount > 0 && (
                <span className="ml-1.5 rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-500">{txCount}</span>
              )}
              {tab.id === "sources" && allSourceCount > 0 && (
                <span className="ml-1.5 rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-500">{allSourceCount}</span>
              )}
              {tab.id === "categories" && incomeCategoryBreakdown.length > 0 && (
                <span className="ml-1.5 rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-500">{incomeCategoryBreakdown.length}</span>
              )}
              {tab.id === "cash" && cashItems.length > 0 && (
                <span className="ml-1.5 rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-500">{cashItems.length}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-5 space-y-4">

        {/* ══════════════════════════════════════════════════════════════════════ */}
        {/* OVERVIEW TAB                                                          */}
        {/* ══════════════════════════════════════════════════════════════════════ */}
        {activeTab === "overview" && (
          <>
            {/* Suggestions review card */}
            {suggestions.length > 0 && (
              <div className="rounded-xl border border-purple-200 bg-purple-50/40 overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3">
                  <div>
                    <p className="text-sm font-semibold text-purple-900">
                      {mergingCount} duplicate income source{mergingCount !== 1 ? "s" : ""} found
                    </p>
                    <button onClick={() => setSuggestionListExpanded((v) => !v)}
                      className="text-[11px] text-purple-400 underline underline-offset-2 hover:text-purple-600">
                      {suggestionListExpanded ? "Hide list" : "Review before merging"}
                    </button>
                  </div>
                  <button onClick={handleApplyMappings} disabled={applyingMappings}
                    className="shrink-0 rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-700 disabled:opacity-50 transition">
                    {applyingMappings ? "Saving…" : "Merge All"}
                  </button>
                </div>
                {suggestionListExpanded && (
                  <div className="border-t border-purple-100 divide-y divide-purple-100/60 max-h-72 overflow-y-auto">
                    {suggestions.map((s) => {
                      const excluded = suggestionDecisions[s.pairKey] === "rejected";
                      return (
                        <button key={s.pairKey}
                          onClick={() => setSuggestionDecisions((p) => ({ ...p, [s.pairKey]: excluded ? "confirmed" : "rejected" }))}
                          className={`flex w-full items-center gap-3 px-4 py-2 text-left transition hover:bg-purple-50/60 ${excluded ? "opacity-40" : ""}`}>
                          <span className={`shrink-0 h-4 w-4 rounded border flex items-center justify-center transition ${excluded ? "border-gray-300 bg-white" : "border-purple-500 bg-purple-500"}`}>
                            {!excluded && <svg className="h-2.5 w-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
                          </span>
                          <span className="flex-1 min-w-0 text-sm text-gray-800 truncate">{s.canonical}</span>
                          <svg className="h-3 w-3 text-gray-300 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M17 8l4 4m0 0l-4 4m4-4H3" /></svg>
                          <span className={`flex-1 min-w-0 text-sm truncate ${excluded ? "text-gray-400" : "text-gray-500 line-through decoration-gray-300"}`}>{s.alias}</span>
                        </button>
                      );
                    })}
                    {mergingCount !== suggestions.length && (
                      <div className="px-4 py-2 text-[11px] text-purple-500 bg-purple-50">
                        {mergingCount} will merge · {suggestions.length - mergingCount} excluded
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* All-time summary strip */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {/* Monthly Average */}
              <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 mb-1">Monthly average</p>
                <p className="text-xl font-bold text-gray-900 tabular-nums">{avgIncome > 0 ? fmt(avgIncome, homeCurrency) : "—"}</p>
                <p className="text-xs text-gray-400 mt-0.5">across {regularHistoryPoints.length} months</p>
              </div>
              {/* Reliability */}
              <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 mb-1">Reliability</p>
                <p className="text-xl font-bold text-gray-900 tabular-nums">{reliabilityScore}<span className="text-sm font-normal text-gray-400">/100</span></p>
                <div className="mt-1.5 h-1.5 w-full rounded-full bg-gray-100 overflow-hidden">
                  <div className="h-full rounded-full transition-all" style={{ width: `${reliabilityScore}%`, backgroundColor: reliabilityColor }} />
                </div>
                <p className="text-xs mt-1" style={{ color: reliabilityColor }}>{reliabilityLabel}</p>
              </div>
              {/* Next Expected */}
              <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 mb-1">Next expected</p>
                {nextExpected ? (
                  <>
                    <p className="text-sm font-semibold text-gray-900 truncate">{nextExpected.name}</p>
                    <p className="text-xs text-green-600 mt-0.5 font-medium">+{fmt(nextExpected.amount, homeCurrency)} · {(() => {
                      const d = new Date(nextExpected.date + "T12:00:00");
                      return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
                    })()}</p>
                  </>
                ) : <p className="text-sm text-gray-400 mt-1">—</p>}
              </div>
              {/* Best Month */}
              <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 mb-1">Best month</p>
                {(() => {
                  const best = sortedHistory.reduce((a, b) => b.incomeTotal > a.incomeTotal ? b : a, sortedHistory[0]);
                  return best ? (
                    <>
                      <p className="text-xl font-bold text-gray-900 tabular-nums">{fmtShort(best.incomeTotal, homeCurrency)}</p>
                      <p className="text-xs text-gray-400 mt-0.5">{longMonth(best.yearMonth)}</p>
                    </>
                  ) : <p className="text-xl font-bold text-gray-400">—</p>;
                })()}
              </div>
            </div>

            {/* Monthly income trend chart */}
            {chartData.length >= 2 && (
              <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
                <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-gray-400">Monthly income</p>
                {avgIncome > 0 && (
                  <p className="mb-3 text-xs text-gray-400">
                    {regularHistoryPoints.length}-month avg <span className="font-semibold text-gray-600">{fmt(avgIncome, homeCurrency)} / mo</span>
                  </p>
                )}
                <div className="h-44 relative"
                  onPointerDown={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const innerLeft = 52; // YAxis width
                    const innerRight = rect.width - 8; // right margin
                    const innerWidth = innerRight - innerLeft;
                    const relX = e.clientX - rect.left - innerLeft;
                    if (innerWidth <= 0 || relX < -8 || relX > innerWidth + 8) return;
                    const idx = Math.round((Math.max(0, Math.min(innerWidth, relX)) / innerWidth) * (chartData.length - 1));
                    const ym = chartData[Math.max(0, Math.min(chartData.length - 1, idx))]?.ym;
                    if (ym) void fetchMonth(ym);
                  }}
                >
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}
                      style={{ cursor: "pointer" }}>
                      <defs>
                        <linearGradient id="incomeGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#7c3aed" stopOpacity={0.18} />
                          <stop offset="95%" stopColor="#7c3aed" stopOpacity={0.01} />
                        </linearGradient>
                        <linearGradient id="incomeGradProj" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#a78bfa" stopOpacity={0.12} />
                          <stop offset="95%" stopColor="#a78bfa" stopOpacity={0.01} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
                      <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#9ca3af" }} tickLine={false} axisLine={false} />
                      <YAxis tickFormatter={(v) => fmtAxis(v, homeCurrency)} tick={{ fontSize: 11, fill: "#9ca3af" }} tickLine={false} axisLine={false} width={52} />
                      <Tooltip
                        formatter={(v, name) => {
                          const label = name === "projected" ? "Est. income" : "Income";
                          return [typeof v === "number" ? fmt(v, homeCurrency) : String(v), label];
                        }}
                        contentStyle={{ borderRadius: "8px", border: "1px solid #e5e7eb", fontSize: "13px" }}
                        labelStyle={{ fontWeight: 600, color: "#111827" }} />
                      {/* Actual months — solid area */}
                      <Area type="monotone" dataKey="income" stroke="#7c3aed" strokeWidth={2}
                        fill="url(#incomeGrad)" fillOpacity={1}
                        connectNulls={false}
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        dot={(props: any) => {
                          const ym = props.payload?.ym as string | undefined;
                          const isSelected = ym === selectedMonth;
                          if (props.cx == null || props.cy == null) return <g key={`a-${ym}`} />;
                          return (
                            <circle key={`actual-${ym ?? props.cx}`}
                              cx={props.cx as number} cy={props.cy as number}
                              r={isSelected ? 6 : 4}
                              fill={isSelected ? "#fff" : "#7c3aed"}
                              stroke="#7c3aed"
                              strokeWidth={isSelected ? 2.5 : 0}
                            />
                          );
                        }}
                        activeDot={{ r: 6, fill: "#fff", stroke: "#7c3aed", strokeWidth: 2 }} />
                      {/* Projected months — dashed area */}
                      <Area type="monotone" dataKey="projected" stroke="#a78bfa" strokeWidth={2}
                        strokeDasharray="5 4" strokeOpacity={0.55}
                        fill="url(#incomeGradProj)" fillOpacity={0.5}
                        connectNulls={false}
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        dot={(props: any) => {
                          const ym = props.payload?.ym as string | undefined;
                          const isSelected = ym === selectedMonth;
                          if (ym === latestStmtMonth) return <g key={`p-boundary-${ym}`} />;
                          if (props.cx == null || props.cy == null) return <g key={`p-${ym}`} />;
                          return (
                            <circle key={`proj-${ym ?? props.cx}`}
                              cx={props.cx as number} cy={props.cy as number}
                              r={isSelected ? 6 : 4}
                              fill={isSelected ? "#fff" : "#a78bfa"}
                              stroke="#a78bfa"
                              strokeWidth={isSelected ? 2.5 : 0}
                            />
                          );
                        }}
                        activeDot={{ r: 6, fill: "#fff", stroke: "#a78bfa", strokeWidth: 2 }} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
                <div className="mt-2 flex items-center justify-center gap-4">
                  <p className="text-center text-[11px] text-gray-400">Click a month to see breakdown</p>
                  {chartData.some((d) => d.projected !== null && d.ym !== latestStmtMonth) && (
                    <span className="flex items-center gap-1 text-[11px] text-gray-400">
                      <svg width="18" height="6" viewBox="0 0 18 6"><line x1="0" y1="3" x2="18" y2="3" stroke="#a78bfa" strokeWidth="2" strokeDasharray="5 4" /></svg>
                      estimated from recurring
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* On your radar */}
            {radarItems.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">On your radar</p>
                  <p className="text-xs text-gray-400">{radarItems.length} item{radarItems.length !== 1 ? "s" : ""}</p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {radarItems.map((item, i) => (
                    <div key={i} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm flex items-start gap-3">
                      {item.type === "upcoming" && (
                        <div className="shrink-0 mt-0.5 h-7 w-7 rounded-full bg-purple-100 flex items-center justify-center">
                          <svg className="h-3.5 w-3.5 text-purple-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                        </div>
                      )}
                      {item.type === "late" && (
                        <div className="shrink-0 mt-0.5 h-7 w-7 rounded-full bg-amber-100 flex items-center justify-center">
                          <svg className="h-3.5 w-3.5 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" /></svg>
                        </div>
                      )}
                      {item.type === "trend" && (
                        <div className={`shrink-0 mt-0.5 h-7 w-7 rounded-full flex items-center justify-center ${item.positive ? "bg-green-100" : "bg-red-100"}`}>
                          <svg className={`h-3.5 w-3.5 ${item.positive ? "text-green-500" : "text-red-500"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d={item.positive ? "M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" : "M13 17h8m0 0V9m0 8l-8-8-4 4-6-6"} /></svg>
                        </div>
                      )}
                      {item.type === "new" && (
                        <div className="shrink-0 mt-0.5 h-7 w-7 rounded-full bg-blue-100 flex items-center justify-center">
                          <svg className="h-3.5 w-3.5 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-gray-800">{item.title}</p>
                        <p className="text-xs text-gray-400 mt-0.5 truncate">{item.sub}</p>
                      </div>
                      {item.amount != null && (
                        <p className={`shrink-0 text-sm font-semibold tabular-nums ${item.positive ? "text-green-600" : item.type === "late" ? "text-amber-600" : "text-gray-700"}`}>
                          {item.positive ? "+" : ""}{fmt(item.amount, homeCurrency)}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Loading state while month data is fetching */}
            {selectedMonth && !current && (
              <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm text-center text-sm text-gray-400 animate-pulse">
                Loading {longMonth(selectedMonth)}…
              </div>
            )}

            {/* Month detail */}
            {selectedMonth && current && (
              <div className="rounded-xl border border-purple-100 bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs font-semibold uppercase tracking-wider text-purple-500">Month detail</p>
                  <button onClick={() => setSelectedMonth(null)} className="text-xs text-gray-400 hover:text-gray-600 transition">✕ close</button>
                </div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">{longMonth(selectedMonth)}</p>
                <p className="text-3xl font-bold text-gray-900 mb-4">{fmt(current.txIncome ?? income?.total ?? 0, homeCurrency)}</p>
                {(() => {
                  const monthTxns = current.income?.transactions ?? [];
                  const monthSources = current.income?.sources ?? [];
                  const cashForMonth = cashItems.filter((c) => occurrencesInMonth(c, selectedMonth) > 0);
                  const isExcluded = (desc: string) =>
                    isTransferSource(desc) || transferSources.has(desc) || excludedSources.has(desc);

                  // Build per-source rows with individual transaction details
                  const txnRows = monthTxns
                    .filter((t) => !isExcluded((t.source ?? "").trim()))
                    .map((t) => ({
                      name: (t.source ?? "Other").trim(),
                      amount: t.amount,
                      date: t.date,
                      isCash: t.accountLabel === "Cash",
                      category: t.category,
                    }));

                  const srcRows = monthSources
                    .filter((s) => !isExcluded(s.description))
                    .map((s) => ({ name: s.description, amount: s.amount, date: undefined, isCash: false, category: undefined }));

                  const rows = txnRows.length > 0 ? txnRows : srcRows;

                  if (rows.length === 0 && cashForMonth.length === 0) {
                    return (
                      <div className="text-sm text-gray-400 space-y-1">
                        <p>No income data for this month.</p>
                        {latestStmtMonth && latestStmtMonth !== selectedMonth && (
                          <button onClick={() => void fetchMonth(latestStmtMonth)}
                            className="text-xs text-purple-500 hover:text-purple-700 underline underline-offset-2">
                            Jump to {longMonth(latestStmtMonth)}
                          </button>
                        )}
                      </div>
                    );
                  }

                  const freqLabel = (entry: typeof cashItems[0]) => {
                    const map: Record<string, string> = { weekly: "weekly", biweekly: "bi-weekly", monthly: "monthly", quarterly: "quarterly", annual: "annual", once: "one-time" };
                    return map[entry.frequency] ?? entry.frequency;
                  };

                  return (
                    <div className="space-y-0 divide-y divide-gray-50">
                      {rows.length === 0 && cashForMonth.length > 0 && (
                        <p className="text-xs text-amber-600 font-medium mb-3">Cash income only · no statement uploaded</p>
                      )}
                      {rows.map((row, i) => {
                        const cashEntry = cashItems.find((c) => c.name.toLowerCase() === row.name.toLowerCase());
                        return (
                          <div key={i} className="flex items-center justify-between py-3">
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium text-gray-800 truncate">{row.name}</p>
                              <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                                {row.date && <span className="text-xs text-gray-400">{fmtDate(row.date)}</span>}
                                {cashEntry && <span className="text-[10px] rounded-full bg-gray-100 px-1.5 py-0.5 text-gray-500 font-medium">{freqLabel(cashEntry)}</span>}
                                {row.isCash && <span className="flex items-center gap-0.5 text-[10px] rounded-full bg-amber-50 border border-amber-200 px-1.5 py-0.5 text-amber-600 font-medium"><span className="h-1.5 w-1.5 rounded-full bg-amber-400 inline-block" />cash</span>}
                                {row.isCash && <span className="text-[10px] rounded-full bg-green-50 border border-green-200 px-1.5 py-0.5 text-green-600 font-medium">confirmed</span>}
                              </div>
                            </div>
                            <span className="shrink-0 ml-3 font-semibold text-sm text-green-700 tabular-nums">+{fmt(row.amount, homeCurrency)}</span>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>
            )}
            
          </>
        )}

        {/* ══════════════════════════════════════════════════════════════════════ */}
        {/* TRANSACTIONS TAB                                                      */}
        {/* ══════════════════════════════════════════════════════════════════════ */}
        {activeTab === "transactions" && (
          <div className="space-y-3">
            {/* Month selector — only shown here */}
            {tabMonths.length > 1 && (
              <div className="flex gap-1.5 overflow-x-auto pb-1">
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
          <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                All deposits · {selectedMonth ? longMonth(selectedMonth) : ""}
              </p>
              <span className="text-xs text-gray-400">{txCount} total</span>
            </div>
            {txCount === 0 ? (
              <div className="px-5 py-8 text-center text-sm text-gray-400">No deposits for this month.</div>
            ) : (
              <div className="divide-y divide-gray-100">
                {transactions.map((txn, i) => {
                  const rawSrc   = (txn.source ?? "Other").trim();
                  const acctSlug = txn.accountSlug ?? "unknown";
                  const txKey    = incomeTxnKey(acctSlug, { source: rawSrc, amount: txn.amount, date: txn.date });
                  const isCash   = acctSlug === "cash";
                  const srcCat   = incomeCategoryRules[sourceSlug(rawSrc)] ?? txn.category ?? "Other";
                  const splits   = incomeTxnSplits[txKey] ?? [];
                  const splitTotal = splits.reduce((s, x) => s + x.amount, 0);
                  const residual   = Math.max(0, txn.amount - splitTotal);
                  const isTransfer = isTransferSource(rawSrc) || transferSources.has(rawSrc) || srcCat === "Transfer";
                  const isEditing  = editingSplitTxn === txKey;
                  const isSaving   = savingTxnKey === txKey;

                  return (
                    <div key={i} className={`${isTransfer ? "opacity-50" : ""}`}>
                      {/* Main row */}
                      <div className="flex items-center gap-3 px-5 py-3">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-800 truncate">{sourceLabels[rawSrc] ?? rawSrc}</p>
                          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                            {txn.date && <span className="text-xs text-gray-400">{fmtDate(txn.date)}</span>}
                            {txn.accountLabel && <span className="text-xs text-gray-300">· {txn.accountLabel}</span>}
                            {isTransfer && <span className="text-[10px] font-semibold rounded-full bg-gray-100 px-1.5 py-0.5 text-gray-400">transfer</span>}
                            {/* Category summary pills */}
                            {!isTransfer && splits.length === 0 && srcCat && (
                              <span className="text-[10px] font-medium rounded-full px-1.5 py-0.5"
                                style={{ backgroundColor: `${INCOME_CAT_COLORS[srcCat] ?? "#9ca3af"}22`, color: INCOME_CAT_COLORS[srcCat] ?? "#9ca3af" }}>
                                {srcCat}
                              </span>
                            )}
                            {!isTransfer && splits.length > 0 && (
                              <>
                                <span className="text-[10px] font-medium rounded-full px-1.5 py-0.5"
                                  style={{ backgroundColor: `${INCOME_CAT_COLORS[srcCat] ?? "#9ca3af"}22`, color: INCOME_CAT_COLORS[srcCat] ?? "#9ca3af" }}>
                                  {srcCat} {fmt(residual, homeCurrency)}
                                </span>
                                {splits.map((sp, si) => (
                                  <span key={si} className="text-[10px] font-medium rounded-full px-1.5 py-0.5"
                                    style={{ backgroundColor: `${INCOME_CAT_COLORS[sp.category] ?? "#9ca3af"}22`, color: INCOME_CAT_COLORS[sp.category] ?? "#9ca3af" }}>
                                    {sp.category} {fmt(sp.amount, homeCurrency)}
                                  </span>
                                ))}
                              </>
                            )}
                          </div>
                        </div>
                        {/* Split button — hidden for cash entries & transfers */}
                        {!isCash && !isTransfer && (
                          <button
                            onClick={() => isEditing ? closeSplitEditor() : openSplitEditor(txKey, splits)}
                            className={`shrink-0 rounded-lg border px-2 py-1 text-[11px] font-semibold transition ${
                              isEditing
                                ? "border-purple-300 bg-purple-50 text-purple-700"
                                : splits.length > 0
                                  ? "border-purple-200 bg-purple-50/60 text-purple-600 hover:bg-purple-100"
                                  : "border-gray-200 bg-gray-50 text-gray-400 hover:border-purple-200 hover:text-purple-500"
                            }`}
                          >
                            {splits.length > 0 ? `${splits.length + 1} splits` : "Split"}
                          </button>
                        )}
                        <span className={`shrink-0 font-semibold text-sm tabular-nums ${isTransfer ? "text-gray-400" : "text-green-600"}`}>
                          +{formatCurrency(txn.amount, homeCurrency, txn.currency, false)}
                        </span>
                      </div>

                      {/* Inline split editor */}
                      {isEditing && (
                        <div className="mx-5 mb-3 rounded-xl border border-purple-100 bg-purple-50/40 p-3 space-y-2">
                          {/* Residual row (auto-calculated) */}
                          <div className="flex items-center gap-2 rounded-lg bg-white/70 px-3 py-2">
                            <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: INCOME_CAT_COLORS[srcCat] ?? "#9ca3af" }} />
                            <span className="flex-1 text-xs font-medium text-gray-600">{srcCat} <span className="text-gray-400 font-normal">(residual)</span></span>
                            <span className="text-xs font-semibold text-gray-700 tabular-nums">
                              {fmt(Math.max(0, txn.amount - splitDraft.reduce((s, x) => s + (parseFloat(x.amount) || 0), 0)), homeCurrency)}
                            </span>
                          </div>

                          {/* Editable split rows */}
                          {splitDraft.map((sp, si) => (
                            <div key={si} className="flex items-center gap-2">
                              <select
                                value={sp.category}
                                onChange={(e) => setSplitDraft((prev) => prev.map((r, ri) => ri === si ? { ...r, category: e.target.value } : r))}
                                className="flex-1 rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs font-medium text-gray-700 focus:outline-none focus:ring-1 focus:ring-purple-400"
                              >
                                {INCOME_CATEGORIES.filter((c) => c !== "Transfer").map((cat) => (
                                  <option key={cat} value={cat}>{cat}</option>
                                ))}
                              </select>
                              <div className="relative w-28">
                                <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-xs text-gray-400">{getCurrencySymbol(homeCurrency)}</span>
                                <input
                                  type="number" min="0" step="0.01"
                                  value={sp.amount}
                                  onChange={(e) => setSplitDraft((prev) => prev.map((r, ri) => ri === si ? { ...r, amount: e.target.value } : r))}
                                  className="w-full rounded-lg border border-gray-200 bg-white pl-5 pr-2 py-1.5 text-xs tabular-nums text-gray-700 focus:outline-none focus:ring-1 focus:ring-purple-400"
                                />
                              </div>
                              <button onClick={() => setSplitDraft((prev) => prev.filter((_, ri) => ri !== si))}
                                className="shrink-0 rounded-full p-1 text-gray-300 hover:text-red-400 hover:bg-red-50 transition">
                                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                </svg>
                              </button>
                            </div>
                          ))}

                          {/* Add split button — disabled when no residual left */}
                          {splitDraft.reduce((s, x) => s + (parseFloat(x.amount) || 0), 0) < txn.amount - 0.005 && (
                            <button
                              onClick={() => setSplitDraft((prev) => [...prev, { category: "Bonus", amount: "" }])}
                              className="flex items-center gap-1 text-xs font-medium text-purple-500 hover:text-purple-700 transition"
                            >
                              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                              </svg>
                              Add split
                            </button>
                          )}

                          {/* Save / Cancel */}
                          <div className="flex items-center justify-end gap-2 pt-1 border-t border-purple-100">
                            <button onClick={closeSplitEditor}
                              className="text-xs text-gray-400 hover:text-gray-600 transition">Cancel</button>
                            <button
                              disabled={isSaving}
                              onClick={() => void handleSaveSplits(
                                { source: rawSrc, amount: txn.amount, date: txn.date, accountSlug: acctSlug },
                                splitDraft,
                              )}
                              className="rounded-lg bg-purple-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-purple-700 disabled:opacity-50 transition"
                            >
                              {isSaving ? "Saving…" : "Save"}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════════ */}
        {/* BY SOURCE TAB                                                         */}
        {/* ══════════════════════════════════════════════════════════════════════ */}
        {/* CATEGORIES TAB                                                        */}
        {/* ══════════════════════════════════════════════════════════════════════ */}
        {activeTab === "categories" && (
          <>
            {/* Scope selector — shared with By Source */}
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">Income by category</p>
              <div className="flex gap-1">
                {(["3", "6", "12", "all"] as const).map((s) => (
                  <button key={s} onClick={() => setSrcTimeScope(s)}
                    className={`rounded-full px-2.5 py-1 text-xs font-semibold transition ${srcTimeScope === s ? "bg-purple-600 text-white" : "bg-gray-100 text-gray-500 hover:bg-gray-200"}`}>
                    {s === "all" ? "All" : `${s}mo`}
                  </button>
                ))}
              </div>
            </div>

            {incomeCategoryBreakdown.length === 0 ? (
              <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-8 text-center">
                <p className="text-sm text-gray-500">No income data to categorize.</p>
              </div>
            ) : (
              <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
                <div className="divide-y divide-gray-100">
                  {incomeCategoryBreakdown.map((cat) => {
                    const isOpen = expandedIncomeCatRows.has(cat.name);
                    const toggleCat = () => setExpandedIncomeCatRows((prev) => {
                      const next = new Set(prev);
                      if (next.has(cat.name)) next.delete(cat.name); else next.add(cat.name);
                      return next;
                    });
                    return (
                      <div key={cat.name}>
                        {/* Category row */}
                        <div className="flex items-center group hover:bg-gray-50 transition">
                          <button onClick={toggleCat} className="flex flex-1 items-center gap-4 px-5 py-3 min-w-0 text-left">
                            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: cat.color }} />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-sm font-medium text-gray-800">{cat.name}</span>
                                <div className="flex items-center gap-2 shrink-0">
                                  <span className="text-sm font-semibold text-gray-700 tabular-nums">{fmt(Math.round(cat.total), homeCurrency)}</span>
                                  <span className="text-xs text-gray-400 w-8 text-right">{cat.pct}%</span>
                                </div>
                              </div>
                              <div className="h-1 overflow-hidden rounded-full bg-gray-100">
                                <div className="h-full rounded-full" style={{ width: `${Math.min(cat.pct, 100)}%`, backgroundColor: cat.color }} />
                              </div>
                            </div>
                          </button>
                          <button onClick={toggleCat} className="shrink-0 px-3 py-3 text-gray-300 hover:text-gray-500 transition">
                            <svg className={`h-4 w-4 transition-transform ${isOpen ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                            </svg>
                          </button>
                        </div>

                        {/* Expanded source rows */}
                        {isOpen && (
                          <div className="border-t border-gray-50 bg-gray-50/60">
                            {cat.sources.map((src) => {
                              const srcPct = cat.total > 0 ? Math.round((src.total / cat.total) * 100) : 0;
                              const href = `/account/income/${encodeURIComponent(src.name)}`;
                              return (
                                <Link key={src.name} href={href}
                                  className="flex items-center gap-3 pl-10 pr-5 py-2.5 hover:bg-gray-100 transition group/sub">
                                  <span className="h-1.5 w-1.5 shrink-0 rounded-full opacity-60" style={{ backgroundColor: cat.color }} />
                                  <span className="flex-1 text-[13px] text-gray-600 truncate group-hover/sub:text-purple-600 transition-colors">{src.name}</span>
                                  {src.isCash && (
                                    <span className="shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">cash</span>
                                  )}
                                  <span className="text-[13px] text-gray-500 tabular-nums shrink-0">{fmt(Math.round(src.total), homeCurrency)}</span>
                                  <span className="text-xs text-gray-400 w-7 text-right shrink-0">{srcPct}%</span>
                                  <svg className="h-3.5 w-3.5 text-gray-300 group-hover/sub:text-purple-400 transition-colors shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                                  </svg>
                                </Link>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}

        {/* ══════════════════════════════════════════════════════════════════════ */}
        {activeTab === "sources" && (
          <>
            {/* Scope selector */}
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">All income sources</p>
              <div className="flex gap-1">
                {(["3", "6", "12", "all"] as const).map((s) => (
                  <button key={s} onClick={() => setSrcTimeScope(s)}
                    className={`rounded-full px-2.5 py-1 text-xs font-semibold transition ${srcTimeScope === s ? "bg-purple-600 text-white" : "bg-gray-100 text-gray-500 hover:bg-gray-200"}`}>
                    {s === "all" ? "All" : `${s}mo`}
                  </button>
                ))}
              </div>
            </div>

            {allTimeScoredSources.length === 0 ? (
              <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-8 text-center">
                <p className="text-sm text-gray-500">No income sources found.</p>
              </div>
            ) : (
              <div className="rounded-xl border border-gray-200 bg-white shadow-sm divide-y divide-gray-100 overflow-hidden">
                {allTimeScoredSources.map((src) => {
                  const fcfg            = FREQUENCY_CONFIG[src.freqResult.frequency];
                  const rcfg            = RELIABILITY_CONFIG[src.reliability];
                  const baseDescription = src.description.replace(/#\d+$/, "");
                  const customLabel     = sourceLabels[src.description];
                  const displayName     = customLabel ?? baseDescription;
                  const needsName       = !customLabel && isGenericSourceName(baseDescription);
                  const isEditing       = editingLabel === src.description;
                  const needsMoreData   = src.months < 2;
                  const srcSlug         = sourceSlug(src.description);
                  const srcCategory     = incomeCategoryRules[srcSlug] ?? "";
                  const isSavingSrcCat  = savingCategoryRule === srcSlug;
                  const catColor        = INCOME_CAT_COLORS[srcCategory] ?? "#9ca3af";
                  return (
                    <div key={src.description} className={`px-4 py-3 group ${src.reliability === "one-time" ? "opacity-60" : ""}`}>
                      {isEditing && (
                        <div className="mb-1.5 flex items-center gap-1.5">
                          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: src.color }} />
                          <input ref={labelInputRef} value={labelDraft} onChange={(e) => setLabelDraft(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter") saveLabel(src.description); if (e.key === "Escape") cancelEditLabel(); }}
                            className="flex-1 rounded border border-purple-300 bg-white px-2 py-0.5 text-sm font-medium text-gray-900 outline-none focus:ring-1 focus:ring-purple-400" autoFocus />
                          <button onClick={() => saveLabel(src.description)} className="text-[11px] font-semibold text-purple-600 hover:text-purple-800">Save</button>
                          <button onClick={cancelEditLabel} className="text-[11px] text-gray-400 hover:text-gray-600">Cancel</button>
                        </div>
                      )}
                      <Link href={`/account/income/${encodeURIComponent(src.description)}`}
                        className={`flex items-center gap-3 ${isEditing ? "pointer-events-none" : ""}`}>
                        {/* Colour dot */}
                        {!isEditing && <span className="h-2.5 w-2.5 shrink-0 rounded-full mt-0.5" style={{ backgroundColor: src.color }} />}
                        {/* Name + badges */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-sm text-gray-800 truncate group-hover:text-purple-600 transition-colors">{displayName}</span>
                            {needsName && <span className="shrink-0 rounded-full border border-dashed border-purple-300 px-2 py-0.5 text-[10px] text-purple-400 italic">tap ✎ to name</span>}
                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold border ${fcfg.badge}`}>{fcfg.label}</span>
                            {!needsMoreData && <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold border ${rcfg.badge}`}>{rcfg.label}</span>}
                          </div>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-xs text-gray-400">{src.months} mo · {fmt(Math.round(src.avgMonthly), homeCurrency)}/mo avg</span>
                            {/* Category picker — inline, stopPropagation so link doesn't fire */}
                            {isSavingSrcCat ? (
                              <span className="text-[10px] text-gray-400">Saving…</span>
                            ) : (
                              <select
                                value={srcCategory}
                                onClick={(e) => e.preventDefault()}
                                onChange={(e) => { e.preventDefault(); e.stopPropagation(); void handleSetCategory(src.description, e.target.value); }}
                                className="rounded-full border px-2 py-0.5 text-[10px] font-semibold cursor-pointer focus:outline-none focus:ring-1 focus:ring-purple-300 transition"
                                style={srcCategory
                                  ? { borderColor: `${catColor}55`, backgroundColor: `${catColor}18`, color: catColor }
                                  : { borderColor: "#e5e7eb", backgroundColor: "#f9fafb", color: "#9ca3af" }
                                }
                              >
                                <option value="">Categorize…</option>
                                {INCOME_CATEGORIES.map((cat) => (
                                  <option key={cat} value={cat}>{cat}</option>
                                ))}
                              </select>
                            )}
                          </div>
                        </div>
                        {/* Action buttons (hover) */}
                        <div className="shrink-0 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
                          <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); startEditLabel(src.description); }} title="Rename" className="rounded-full p-1 text-gray-300 hover:text-purple-500 hover:bg-purple-50 transition">
                            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                          </button>
                          <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleMarkAsTransfer(src.description); }} title="Mark as transfer" className="rounded-full p-1 text-gray-300 hover:text-blue-400 hover:bg-blue-50 transition">
                            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" /></svg>
                          </button>
                          <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleExcludeSource(src.description); }} title="Exclude" className="rounded-full p-1 text-gray-300 hover:text-red-400 hover:bg-red-50 transition">
                            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                          </button>
                        </div>
                        {/* Total + share */}
                        <div className="shrink-0 text-right">
                          <p className="font-semibold text-sm text-gray-900 tabular-nums">{fmt(Math.round(src.total), homeCurrency)}</p>
                          <p className="text-xs text-gray-400">{src.pct}%</p>
                        </div>
                        <svg className="h-4 w-4 text-gray-300 group-hover:text-purple-400 transition-colors shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
                      </Link>
                      {/* Share bar */}
                      <div className="mt-2 h-1 w-full rounded-full bg-gray-100 overflow-hidden">
                        <div className="h-full rounded-full transition-all" style={{ width: `${src.pct}%`, backgroundColor: src.color }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Hidden / excluded sources */}
            {(() => {
              const hiddenTransfers = Object.entries(sourceHistory)
                .filter(([d]) => isTransferSource(d) || transferSources.has(d) || incomeCategoryRules[sourceSlug(d)] === "Transfer")
                .map(([d, h]) => ({ description: d, total: h.reduce((s, m) => s + m.amount, 0) }));
              const hiddenExcluded = Object.entries(sourceHistory)
                .filter(([d]) => excludedSources.has(d))
                .map(([d, h]) => ({ description: d, total: h.reduce((s, m) => s + m.amount, 0) }));
              if (hiddenTransfers.length === 0 && hiddenExcluded.length === 0) return null;
              return (
                <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-2">Not counted as income</p>
                  <div className="space-y-1">
                    {hiddenTransfers.map((s) => (
                      <div key={s.description} className="flex items-center justify-between text-xs text-gray-400">
                        <span className="flex items-center gap-1.5">
                          <span className="rounded-full bg-gray-200 px-1.5 py-0.5 text-[10px] font-medium">transfer</span>
                          {s.description}
                        </span>
                        {transferSources.has(s.description) && (
                          <button onClick={() => handleRestoreTransfer(s.description)} className="text-[10px] text-purple-400 hover:text-purple-600 hover:underline">restore</button>
                        )}
                      </div>
                    ))}
                    {hiddenExcluded.map((s) => (
                      <div key={s.description} className="flex items-center justify-between text-xs text-gray-400">
                        <span>{s.description}</span>
                        <button onClick={() => handleRestoreSource(s.description)} className="text-[10px] text-purple-400 hover:text-purple-600 hover:underline">restore</button>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}
          </>
        )}

        {/* ══════════════════════════════════════════════════════════════════════ */}
        {/* CASH TAB                                                              */}
        {/* ══════════════════════════════════════════════════════════════════════ */}
        {activeTab === "cash" && (
          <>
            {/* Header row */}
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-gray-800">Cash &amp; recurring income</p>
                <p className="text-xs text-gray-400 mt-0.5">Off-statement income: rent, side work, cash payments. Rolls into your income total.</p>
              </div>
              <button onClick={() => { if (token) loadCashIncome(token); openAddCash(); }}
                className="shrink-0 rounded-lg bg-purple-600 px-3 py-2 text-sm font-semibold text-white hover:bg-purple-700 transition">
                + Add
              </button>
            </div>

            {/* Monthly summary banner */}
            {cashItems.length > 0 && cashMonthlyTotal > 0 && (
              <div className="rounded-xl border border-green-200 bg-green-50/60 px-4 py-3 flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-green-800">Est. monthly cash income</p>
                  <p className="text-xs text-green-600 mt-0.5">{cashItems.filter((c) => c.frequency !== "once").length} recurring source{cashItems.filter((c) => c.frequency !== "once").length !== 1 ? "s" : ""}</p>
                </div>
                <div className="text-right">
                  <p className="font-bold text-lg text-green-700">{fmt(Math.round(cashMonthlyTotal), homeCurrency)}<span className="text-sm font-normal">/mo</span></p>
                  <p className="text-xs text-green-500">{fmt(Math.round(cashMonthlyTotal * 12), homeCurrency)}/yr</p>
                </div>
              </div>
            )}

            {/* Items list */}
            {cashLoading ? (
              <div className="flex justify-center py-8">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-purple-600 border-t-transparent" />
              </div>
            ) : cashItems.length === 0 ? (
              <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-10 text-center">
                <p className="text-sm font-medium text-gray-500">No cash income entries yet</p>
                <p className="mt-1 text-xs text-gray-400">Add rent payments, freelance income, or any cash you receive outside your bank statements.</p>
                <button onClick={() => { if (token) loadCashIncome(token); openAddCash(); }}
                  className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-700 transition">
                  + Add income source
                </button>
              </div>
            ) : (
              <div className="rounded-xl border border-gray-200 bg-white shadow-sm divide-y divide-gray-100">
                {cashItems.map((item) => {
                  const monthly = toMonthly(item.amount, item.frequency);
                  const color   = CATEGORY_COLORS[item.category] ?? "#9ca3af";
                  const isOnce  = item.frequency === "once";
                  return (
                    <div key={item.id} className="flex items-center gap-3 px-4 py-3.5 group hover:bg-gray-50 transition">
                      {/* Navigable area */}
                      <Link
                        href={`/account/income/${encodeURIComponent(item.name)}`}
                        className="flex flex-1 items-center gap-3 min-w-0"
                      >
                        <div className="mt-0.5 h-8 w-8 shrink-0 rounded-full flex items-center justify-center text-white text-xs font-bold"
                          style={{ backgroundColor: color }}>
                          {item.category.slice(0, 1)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-semibold text-gray-800 truncate group-hover:text-purple-600 transition-colors">{item.name}</p>
                            {isOnce && <span className="shrink-0 rounded-full bg-amber-50 border border-amber-200 px-1.5 py-0.5 text-[10px] font-medium text-amber-600">one-off</span>}
                          </div>
                          <p className="text-xs text-gray-400 mt-0.5">
                            {item.category}
                            {!isOnce && ` · ${CASH_INCOME_FREQ_OPTIONS.find((f) => f.value === item.frequency)?.label ?? item.frequency}`}
                            {item.nextDate && ` · ${isOnce ? "On" : "Next"} ${fmtDateFull(item.nextDate)}`}
                          </p>
                          {item.notes && <p className="text-xs text-gray-400 mt-0.5 italic">{item.notes}</p>}
                          {!isOnce && monthly > 0 && (
                            <p className="text-[11px] text-gray-400 mt-0.5">≈ {fmt(Math.round(monthly), homeCurrency)}/mo · {fmt(Math.round(monthly * 12), homeCurrency)}/yr</p>
                          )}
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="font-semibold text-sm text-green-600 tabular-nums">+{fmt(item.amount, homeCurrency)}</p>
                          {!isOnce && <p className="text-[10px] text-gray-400 mt-0.5">{CASH_INCOME_FREQ_OPTIONS.find((f) => f.value === item.frequency)?.label}</p>}
                        </div>
                        <svg className="h-4 w-4 shrink-0 text-gray-300 group-hover:text-purple-400 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                        </svg>
                      </Link>
                      {/* Edit / delete — separate from nav */}
                      <div className="shrink-0 flex gap-1.5 opacity-0 group-hover:opacity-100 transition">
                        <button onClick={() => openEditCash(item)} title="Edit" className="rounded-full p-1 text-gray-300 hover:text-purple-500 hover:bg-purple-50 transition">
                          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                        </button>
                        <button onClick={() => deleteCashItem(item.id)} title="Delete" className="rounded-full p-1 text-gray-300 hover:text-red-400 hover:bg-red-50 transition">
                          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <p className="text-[11px] text-gray-400 text-center">Cash income is added to your monthly total and included in Next Up predictions.</p>
          </>
        )}

      </div>

      {/* ── Cash income modal ───────────────────────────────────────────────────── */}
      {showCashModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h3 className="text-base font-bold text-gray-900 mb-4">
              {cashForm.id ? "Edit income source" : "Add income source"}
            </h3>
            <div className="space-y-3">
              {/* Name */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Name *</label>
                <input
                  value={cashForm.name}
                  onChange={(e) => setCashForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Rent from tenant, Freelance client"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400"
                />
              </div>
              {/* Amount + Frequency row */}
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Amount *</label>
                  <input
                    type="number" min="0" step="0.01"
                    value={cashForm.amount}
                    onChange={(e) => setCashForm((f) => ({ ...f, amount: e.target.value }))}
                    placeholder="0.00"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400"
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Frequency *</label>
                  <select value={cashForm.frequency} onChange={(e) => setCashForm((f) => ({ ...f, frequency: e.target.value as CashIncomeFrequency }))}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400">
                    {CASH_INCOME_FREQ_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
              </div>
              {/* Category */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Category *</label>
                <select value={cashForm.category} onChange={(e) => setCashForm((f) => ({ ...f, category: e.target.value as CashIncomeCategory }))}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400">
                  {CASH_INCOME_CATEGORY_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              {/* Next date */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">
                  {cashForm.frequency === "once" ? "Date *" : "Next date (optional)"}
                </label>
                <input type="date" value={cashForm.nextDate} onChange={(e) => setCashForm((f) => ({ ...f, nextDate: e.target.value }))}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400" />
              </div>
              {/* When did this start — hidden for one-offs */}
              {cashForm.frequency !== "once" && (
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">When did this start?</label>
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {START_DATE_PRESETS.map((p) => {
                      const ymd = monthsAgoYmd(p.monthsAgo);
                      const active = cashForm.startDate?.slice(0, 7) === ymd.slice(0, 7);
                      return (
                        <button
                          key={p.label}
                          type="button"
                          onClick={() => setCashForm((f) => ({ ...f, startDate: ymd }))}
                          className={`rounded-full px-3 py-1 text-xs font-medium border transition ${
                            active
                              ? "bg-purple-600 text-white border-purple-600"
                              : "bg-white text-gray-600 border-gray-300 hover:border-purple-400"
                          }`}
                        >
                          {p.label}
                        </button>
                      );
                    })}
                  </div>
                  <input
                    type="month"
                    value={cashForm.startDate?.slice(0, 7) ?? ""}
                    onChange={(e) => setCashForm((f) => ({ ...f, startDate: e.target.value ? `${e.target.value}-01` : "" }))}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400"
                  />
                </div>
              )}
              {/* Notes */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Notes</label>
                <input value={cashForm.notes} onChange={(e) => setCashForm((f) => ({ ...f, notes: e.target.value }))}
                  placeholder="Optional"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400" />
              </div>
              {/* Preview */}
              {cashForm.amount && cashForm.frequency && cashForm.frequency !== "once" && (
                <div className="rounded-lg bg-green-50 border border-green-100 px-3 py-2 text-xs text-green-700">
                  ≈ {fmt(Math.round(parseFloat(cashForm.amount || "0") * (CASH_INCOME_FREQ_MONTHLY[cashForm.frequency] ?? 0)), homeCurrency)}/mo
                  {" · "}
                  {fmt(Math.round(parseFloat(cashForm.amount || "0") * (CASH_INCOME_FREQ_MONTHLY[cashForm.frequency] ?? 0) * 12), homeCurrency)}/yr
                </div>
              )}
            </div>
            <div className="mt-5 flex gap-3">
              <button onClick={() => setShowCashModal(false)}
                className="flex-1 rounded-lg border border-gray-200 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-50 transition">
                Cancel
              </button>
              <button onClick={saveCashItem} disabled={savingCash || !cashForm.name || !cashForm.amount}
                className="flex-1 rounded-lg bg-purple-600 py-2 text-sm font-semibold text-white hover:bg-purple-700 disabled:opacity-50 transition">
                {savingCash ? "Saving…" : cashForm.id ? "Save changes" : "Add"}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

export default function IncomePage() {
  return (
    <Suspense>
      <IncomePageInner />
    </Suspense>
  );
}
