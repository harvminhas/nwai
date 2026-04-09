"use client";

import { useEffect, useState, useRef, useCallback, Suspense } from "react";
import Link from "next/link";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
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
  INCOME_CATEGORIES,
} from "@/lib/incomeEngine";
import type { SourceMonthData } from "@/lib/incomeEngine";
import { fmt, getCurrencySymbol } from "@/lib/currencyUtils";
import type { SourceSuggestion } from "@/lib/sourceMappings";
import { INCOME_TRANSFER_RE } from "@/lib/spendingMetrics";
import type { CashIncomeEntry, CashIncomeFrequency, CashIncomeCategory } from "@/lib/cashIncome";
import { CASH_INCOME_FREQ_MONTHLY, occurrencesInMonth } from "@/lib/cashIncome";
import { PROFILE_REFRESHED_EVENT, useProfileRefresh } from "@/contexts/ProfileRefreshContext";

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
      result.push({ description: `${description} — ${fmt(Math.round(avg))}`, transactions: cluster.txns });
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
  { id: "transactions", label: "Transactions" },
  { id: "sources",      label: "By Source" },
  { id: "cash",         label: "Cash" },
] as const;
type TabId = typeof TABS[number]["id"];

// ── local types ───────────────────────────────────────────────────────────────

interface HistoryPoint { yearMonth: string; incomeTotal: number; expensesTotal: number }
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
  const [suggestions, setSuggestions]     = useState<SourceSuggestion[]>([]);
  const [suggestionDecisions, setSuggestionDecisions] = useState<Record<string, "confirmed" | "rejected">>({});
  const [applyingMappings, setApplyingMappings] = useState(false);
  const [token, setToken]                 = useState<string | null>(null);
  const tokenRef                          = useRef<string | null>(null);
  const [suggestionListExpanded, setSuggestionListExpanded] = useState(false);

  // Income category rules: source slug → category
  const [incomeCategoryRules, setIncomeCategoryRules] = useState<Record<string, string>>({});
  const [savingCategoryRule, setSavingCategoryRule]   = useState<string | null>(null);

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
        setIncomeCategoryRules(json.incomeCategoryRules ?? {});
        setCashItems((json.cashIncomeItems ?? []) as CashIncomeEntry[]);

        const incomeSugg = json.incomeSuggestions ?? [];
        setSuggestions(incomeSugg);
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
              txIncome: json.txMonthlyIncome ?? json.data.income?.total ?? 0,
              txExpenses: json.txMonthlyExpenses ?? json.data.expenses?.total ?? 0,
            },
          });
        }
      } catch { setError("Failed to load income data"); }
      finally { setLoading(false); }
    });
  }, [router]);

  // Re-fetches history + cash items when the financial profile is rebuilt.
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
        (h: { yearMonth: string; incomeTotal?: number; expensesTotal?: number }) => ({
          yearMonth: h.yearMonth,
          incomeTotal: h.incomeTotal ?? 0,
          expensesTotal: h.expensesTotal ?? 0,
        })
      );
      setHistory(hist);
      setTotalMonths(json.totalMonthsTracked ?? hist.length);
      setSourceHistory(json.incomeSourceHistory ?? {});
      setIncomeCategoryRules(json.incomeCategoryRules ?? {});
      setCashItems((json.cashIncomeItems ?? []) as CashIncomeEntry[]);
      const latestYm: string = json.yearMonth ?? null;
      if (latestYm && json.data) {
        setDataByMonth((prev) => ({
          ...prev,
          [latestYm]: {
            income: json.data.income ?? { total: 0, sources: [], transactions: [] },
            expenses: json.data.expenses ?? { total: 0 },
            savingsRate: json.data.savingsRate ?? 0,
            txIncome: json.txMonthlyIncome ?? json.data.income?.total ?? 0,
            txExpenses: json.txMonthlyExpenses ?? json.data.expenses?.total ?? 0,
          },
        }));
      }
    } catch { /* best-effort */ }
  }, []);

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
      } else {
        // No statement for this month — synthesise a cash-income-only entry so the
        // Overview tab can still show the user's declared recurring cash income.
        const cashTotal = cashItems.reduce((sum, entry) =>
          sum + occurrencesInMonth(entry, ym) * entry.amount, 0);
        setDataByMonth((prev) => ({
          ...prev,
          [ym]: {
            income: { total: cashTotal, sources: [], transactions: [] },
            expenses: { total: 0 },
            savingsRate: 0,
            txIncome: cashTotal,
            txExpenses: 0,
            cashOnly: true,
          } as ConsolidatedData & { cashOnly?: boolean },
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
  const chartData       = sortedHistory.map((h) => ({ label: shortMonth(h.yearMonth), income: h.incomeTotal, ym: h.yearMonth }));
  const regularHistoryPoints = sortedHistory.filter((h) => h.incomeTotal > 0);
  const avgIncome       = regularHistoryPoints.length > 0
    ? Math.round(regularHistoryPoints.reduce((s, h) => s + h.incomeTotal, 0) / regularHistoryPoints.length)
    : 0;
  const currentIdx      = selectedMonth ? sortedHistory.findIndex((h) => h.yearMonth === selectedMonth) : -1;
  const prevPoint       = currentIdx > 0 ? sortedHistory[currentIdx - 1] : null;
  const incomeDelta     = prevPoint != null ? (current?.txIncome ?? income?.total ?? 0) - prevPoint.incomeTotal : null;
  const tabMonths       = sortedHistory.slice(-6).map((h) => h.yearMonth);
  const txCount         = transactions.length;

  // Cash income derived
  const cashMonthlyTotal = cashItems.reduce((s, c) => s + toMonthly(c.amount, c.frequency), 0);

  // ── render helpers ────────────────────────────────────────────────────────────

  const mergingCount = suggestions.filter((s) => suggestionDecisions[s.pairKey] !== "rejected").length;

  // ── loading / error states ────────────────────────────────────────────────────

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

  // ── main render ───────────────────────────────────────────────────────────────

  return (
    <div className="mx-auto max-w-2xl px-4 pt-4 pb-8 sm:py-8 sm:px-6">

      {/* Header */}
      <div className="mb-1">
        <h1 className="font-bold text-3xl text-gray-900">Income</h1>
        <p className="mt-0.5 text-sm text-gray-400">
          {current?.txIncome != null ? fmt(current.txIncome) : ""}{selectedMonth ? ` · ${longMonth(selectedMonth)}` : ""}
        </p>
      </div>

      {/* Month tabs */}
      {tabMonths.length > 1 && (
        <div className="mt-3 flex gap-1.5 overflow-x-auto pb-1">
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

      {/* Section tabs */}
      <div className="mt-3 flex border-b border-gray-200">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => switchTab(tab.id)}
            className={`relative mr-4 pb-2.5 text-sm font-medium transition-colors ${
              activeTab === tab.id
                ? "text-gray-900 after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-purple-600"
                : "text-gray-400 hover:text-gray-600"
            }`}
          >
            {tab.label}
            {tab.id === "transactions" && txCount > 0 && (
              <span className="ml-1.5 rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-500">{txCount}</span>
            )}
            {tab.id === "cash" && cashItems.length > 0 && (
              <span className="ml-1.5 rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-500">{cashItems.length}</span>
            )}
          </button>
        ))}
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

            {/* Summary card */}
            <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                total received · {selectedMonth ? longMonth(selectedMonth) : ""}
              </p>
              {(current as (ConsolidatedData & { cashOnly?: boolean }) | null | undefined)?.cashOnly ? (
                // Month has no statement — show cash income breakdown only
                <div className="mt-3">
                  <p className="mt-2 font-bold text-4xl text-gray-900">{fmt(current?.txIncome ?? 0)}</p>
                  <p className="mt-1 text-xs text-amber-600 font-medium">Cash income only · no statement uploaded</p>
                  <div className="mt-3 space-y-1.5">
                    {cashItems.filter((c) => selectedMonth && occurrencesInMonth(c, selectedMonth) > 0).map((c) => (
                      <div key={c.id} className="flex items-center justify-between text-sm">
                        <span className="text-gray-700">{c.name}</span>
                        <span className="font-medium text-green-700">+{fmt(c.amount * (selectedMonth ? occurrencesInMonth(c, selectedMonth) : 0))}</span>
                      </div>
                    ))}
                  </div>
                  <Link href="/upload" className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-purple-200 bg-purple-50 px-3 py-1.5 text-xs font-semibold text-purple-700 hover:bg-purple-100 transition">
                    Upload a statement →
                  </Link>
                </div>
              ) : (current?.txIncome ?? income?.total ?? 0) === 0 && avgIncome > 0 ? (
                <div className="mt-3">
                  <p className="font-semibold text-gray-500 text-lg">No deposits detected</p>
                  <p className="mt-1 text-xs text-gray-400 leading-relaxed">
                    No chequing or savings statement uploaded for {selectedMonth ? longMonth(selectedMonth) : "this period"}.
                    Your {regularHistoryPoints.length}-month average is{" "}
                    <span className="font-semibold text-gray-600">{fmt(avgIncome)}/mo</span>.
                  </p>
                  <Link href="/upload" className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-purple-200 bg-purple-50 px-3 py-1.5 text-xs font-semibold text-purple-700 hover:bg-purple-100 transition">
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
                  {oneTimeTotal > 0 && (
                    <div className="mt-1">
                      <button onClick={() => setShowOneTime((v) => !v)}
                        className="flex items-center gap-1 text-xs text-amber-600 hover:text-amber-700 transition">
                        <span>{fmt(oneTimeTotal)} in one-time deposits — excluded from averages</span>
                        <svg className={`h-3 w-3 transition-transform ${showOneTime ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                      {showOneTime && (
                        <div className="mt-1.5 space-y-0.5 pl-2 border-l-2 border-amber-100">
                          {oneTimeSources.map((s) => {
                            const acct = transactions.find((t) => (t.source ?? "Other").trim() === s.description)?.accountLabel;
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
                  {regularTotal > 0 && (
                    <div className="mt-4 flex flex-wrap gap-2">
                      <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${surplus >= 0 ? "border-green-200 bg-green-50 text-green-700" : "border-amber-200 bg-amber-50 text-amber-700"}`}>
                        {surplus >= 0 ? "surplus" : "deficit"} {surplus >= 0 ? "+" : ""}{fmt(surplus)}
                      </span>
                      {expensesTotal > 0 && (
                        <span className="rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs font-semibold text-gray-600">spent {fmt(expensesTotal)}</span>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Monthly income trend chart */}
            {chartData.length >= 2 && (
              <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
                <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-gray-400">Monthly income</p>
                {avgIncome > 0 && (
                  <p className="mb-3 text-xs text-gray-400">
                    {regularHistoryPoints.length}-month avg <span className="font-semibold text-gray-600">{fmt(avgIncome)} / mo</span>
                  </p>
                )}
                <div className="h-44">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}
                      onClick={(d) => {
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        const ym = (d as any)?.activePayload?.[0]?.payload?.ym as string | undefined;
                        if (ym) void fetchMonth(ym);
                      }}
                      style={{ cursor: "pointer" }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
                      <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#9ca3af" }} tickLine={false} axisLine={false} />
                      <YAxis tickFormatter={fmtAxis} tick={{ fontSize: 11, fill: "#9ca3af" }} tickLine={false} axisLine={false} width={52} />
                      <Tooltip formatter={(v) => [typeof v === "number" ? fmt(v) : String(v), "Income"]}
                        contentStyle={{ borderRadius: "8px", border: "1px solid #e5e7eb", fontSize: "13px" }}
                        labelStyle={{ fontWeight: 600, color: "#111827" }} />
                      <Line type="monotone" dataKey="income" stroke="#7c3aed" strokeWidth={2}
                        dot={{ fill: "#7c3aed", strokeWidth: 0, r: 3 }}
                        activeDot={{ r: 5, fill: "#7c3aed", stroke: "#fff", strokeWidth: 2 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}
          </>
        )}

        {/* ══════════════════════════════════════════════════════════════════════ */}
        {/* TRANSACTIONS TAB                                                      */}
        {/* ══════════════════════════════════════════════════════════════════════ */}
        {activeTab === "transactions" && (
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
                  const rawSrc  = (txn.source ?? "Other").trim();
                  const slug    = sourceSlug(rawSrc);
                  const currentCategory = incomeCategoryRules[slug] ?? "";
                  const isTransfer = isTransferSource(rawSrc) || transferSources.has(rawSrc) || currentCategory === "Transfer";
                  const isSaving  = savingCategoryRule === slug;
                  return (
                    <div key={i} className={`flex items-center gap-3 px-5 py-3 ${isTransfer ? "opacity-50" : ""}`}>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-800 truncate">{sourceLabels[rawSrc] ?? rawSrc}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          {txn.date && <span className="text-xs text-gray-400">{fmtDate(txn.date)}</span>}
                          {txn.accountLabel && <span className="text-xs text-gray-300">· {txn.accountLabel}</span>}
                          {isTransfer && <span className="text-[10px] font-semibold rounded-full bg-gray-100 px-1.5 py-0.5 text-gray-400">transfer</span>}
                        </div>
                      </div>
                      {/* Category picker */}
                      <div className="shrink-0">
                        {isSaving ? (
                          <span className="text-xs text-gray-400">Saving…</span>
                        ) : (
                          <select
                            value={currentCategory}
                            onChange={(e) => handleSetCategory(rawSrc, e.target.value)}
                            className="rounded-lg border border-gray-200 bg-gray-50 px-2 py-1 text-xs font-medium text-gray-700 hover:border-purple-300 focus:outline-none focus:ring-1 focus:ring-purple-400 cursor-pointer"
                          >
                            <option value="">Categorize…</option>
                            {INCOME_CATEGORIES.map((cat) => (
                              <option key={cat} value={cat}>{cat}</option>
                            ))}
                          </select>
                        )}
                      </div>
                      <span className={`shrink-0 font-semibold text-sm tabular-nums ${isTransfer ? "text-gray-400" : "text-green-600"}`}>
                        +{fmt(txn.amount)}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════════ */}
        {/* BY SOURCE TAB                                                         */}
        {/* ══════════════════════════════════════════════════════════════════════ */}
        {activeTab === "sources" && (
          <>
            {scoredSources.length === 0 ? (
              <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-8 text-center">
                <p className="text-sm text-gray-500">No income sources for this month.</p>
              </div>
            ) : (
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
                    const srcTxns     = (expandedTxnMap.get(src.description) ?? []).slice().sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
                    const srcAccounts = [...new Set(srcTxns.map((t) => t.accountLabel).filter(Boolean))];
                    const baseDescription = src.description.replace(/#\d+$/, "");
                    const customLabel     = sourceLabels[src.description];
                    const displayName     = customLabel ?? baseDescription;
                    const needsName       = !customLabel && isGenericSourceName(baseDescription);
                    const isEditing       = editingLabel === src.description;
                    return (
                      <div key={src.description} className={src.reliability === "one-time" ? "opacity-60" : ""}>
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
                          className={`block w-full text-left group ${isEditing ? "pointer-events-none" : ""}`}>
                          <div className="flex items-start justify-between gap-2 mb-1.5">
                            <div className="flex items-center gap-2 min-w-0">
                              {!isEditing && <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: src.color }} />}
                              <span className="font-medium text-sm text-gray-800 truncate group-hover:text-purple-600 transition-colors">{displayName}</span>
                              {needsName && <span className="shrink-0 rounded-full border border-dashed border-purple-300 px-2 py-0.5 text-[10px] text-purple-400 italic">tap ✎ to name</span>}
                              {srcAccounts.length > 0 && <span className="text-[10px] text-gray-400 truncate">→ {srcAccounts.join(", ")}</span>}
                              <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); startEditLabel(src.description); }}
                                title="Rename source"
                                className="shrink-0 rounded-full p-0.5 text-gray-300 hover:text-purple-500 hover:bg-purple-50 transition opacity-0 group-hover:opacity-100">
                                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                              </button>
                              <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleMarkAsTransfer(src.description); }}
                                title="Mark as transfer (not income)"
                                className="shrink-0 rounded-full p-0.5 text-gray-300 hover:text-blue-400 hover:bg-blue-50 transition opacity-0 group-hover:opacity-100">
                                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" /></svg>
                              </button>
                              <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleExcludeSource(src.description); }}
                                title="Exclude from income"
                                className="shrink-0 rounded-full p-0.5 text-gray-300 hover:text-red-400 hover:bg-red-50 transition opacity-0 group-hover:opacity-100">
                                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                              </button>
                            </div>
                            <div className="shrink-0 flex items-center gap-2">
                              <div className="text-right">
                                <span className="font-semibold text-sm text-gray-900 tabular-nums">{fmt(src.amount)}</span>
                                <span className="ml-2 text-xs text-gray-400">{src.pct}%</span>
                              </div>
                              <svg className="h-4 w-4 text-gray-300 group-hover:text-purple-400 transition-colors shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
                            </div>
                          </div>
                          <div className="mb-2 h-1.5 w-full rounded-full bg-gray-100 overflow-hidden">
                            <div className="h-full rounded-full transition-all" style={{ width: `${src.pct}%`, backgroundColor: src.color }} />
                          </div>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold border ${fcfg.badge}`}>{fcfg.label}</span>
                            {gapHint && <span className="text-[10px] text-gray-400 tabular-nums">{gapHint}</span>}
                            {src.reliability === "one-time" && <span className="text-[10px] text-gray-400">· excluded from avg</span>}
                            {srcTxns.length > 0 && <span className="text-[10px] text-gray-300">· {srcTxns.length} deposit{srcTxns.length !== 1 ? "s" : ""} this month</span>}
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
                          <button onClick={() => handleRestoreTransfer(s.description)} className="text-[10px] text-purple-400 hover:text-purple-600 hover:underline">restore</button>
                        )}
                      </div>
                    ))}
                    {manuallyExcludedSources.map((s) => (
                      <div key={s.description} className="flex items-center justify-between text-xs text-gray-400">
                        <span>{s.description} <span className="text-gray-300">{fmt(s.amount)}</span></span>
                        <button onClick={() => handleRestoreSource(s.description)} className="text-[10px] text-purple-400 hover:text-purple-600 hover:underline">restore</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Reliability */}
            {scoredSources.filter((s) => s.reliability !== "one-time").length > 0 && (
              <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
                <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-gray-400">Reliability by source</p>
                <p className="mb-4 text-xs text-gray-400">Based on amount consistency, timing, and frequency across months</p>
                <div className="space-y-4">
                  {scoredSources.filter((s) => s.reliability !== "one-time").map((src) => {
                    const rcfg = RELIABILITY_CONFIG[src.reliability];
                    const fcfg = FREQUENCY_CONFIG[src.freqResult.frequency];
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
                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold border ${rcfg.badge}`}>{rcfg.label}</span>
                          )}
                        </div>
                        <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
                          {needsMoreData ? (
                            <div className="h-full w-1/4 rounded-full bg-gray-200 animate-pulse" />
                          ) : (
                            <div className="h-full rounded-full transition-all" style={{ width: `${src.score}%`, backgroundColor: rcfg.barColor }} />
                          )}
                        </div>
                        {src.freqResult.sampleCount >= 2 && (
                          <div className="mt-2 flex items-center gap-2">
                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold border ${fcfg.badge}`}>{fcfg.label}</span>
                            <span className="text-[10px] text-gray-400">
                              {fcfg.description}
                              {src.freqResult.medianGap != null && <> · median gap <span className="font-medium text-gray-600">{src.freqResult.medianGap}d</span></>}
                              {src.freqResult.stdDev != null && src.freqResult.stdDev > 0 && <> ±{src.freqResult.stdDev}d</>}
                            </span>
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
                  <p className="font-bold text-lg text-green-700">{fmt(Math.round(cashMonthlyTotal))}<span className="text-sm font-normal">/mo</span></p>
                  <p className="text-xs text-green-500">{fmt(Math.round(cashMonthlyTotal * 12))}/yr</p>
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
                    <div key={item.id} className="flex items-start gap-3 px-4 py-3.5 group">
                      <div className="mt-0.5 h-8 w-8 shrink-0 rounded-full flex items-center justify-center text-white text-xs font-bold"
                        style={{ backgroundColor: color }}>
                        {item.category.slice(0, 1)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-semibold text-gray-800 truncate">{item.name}</p>
                          {isOnce && <span className="shrink-0 rounded-full bg-amber-50 border border-amber-200 px-1.5 py-0.5 text-[10px] font-medium text-amber-600">one-off</span>}
                        </div>
                        <p className="text-xs text-gray-400 mt-0.5">
                          {item.category}
                          {!isOnce && ` · ${CASH_INCOME_FREQ_OPTIONS.find((f) => f.value === item.frequency)?.label ?? item.frequency}`}
                          {item.nextDate && ` · ${isOnce ? "On" : "Next"} ${fmtDateFull(item.nextDate)}`}
                        </p>
                        {item.notes && <p className="text-xs text-gray-400 mt-0.5 italic">{item.notes}</p>}
                        {!isOnce && monthly > 0 && (
                          <p className="text-[11px] text-gray-400 mt-0.5">≈ {fmt(Math.round(monthly))}/mo · {fmt(Math.round(monthly * 12))}/yr</p>
                        )}
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="font-semibold text-sm text-green-600 tabular-nums">+{fmt(item.amount)}</p>
                        {!isOnce && <p className="text-[10px] text-gray-400 mt-0.5">{CASH_INCOME_FREQ_OPTIONS.find((f) => f.value === item.frequency)?.label}</p>}
                      </div>
                      <div className="shrink-0 flex gap-1.5 mt-0.5 opacity-0 group-hover:opacity-100 transition">
                        <button onClick={() => openEditCash(item)} className="rounded-full p-1 text-gray-300 hover:text-purple-500 hover:bg-purple-50 transition">
                          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                        </button>
                        <button onClick={() => deleteCashItem(item.id)} className="rounded-full p-1 text-gray-300 hover:text-red-400 hover:bg-red-50 transition">
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
                  ≈ {fmt(Math.round(parseFloat(cashForm.amount || "0") * (CASH_INCOME_FREQ_MONTHLY[cashForm.frequency] ?? 0)))}/mo
                  {" · "}
                  {fmt(Math.round(parseFloat(cashForm.amount || "0") * (CASH_INCOME_FREQ_MONTHLY[cashForm.frequency] ?? 0) * 12))}/yr
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
