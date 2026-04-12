"use client";

import { useEffect, useState, useRef, useCallback, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { getFirebaseClient } from "@/lib/firebase";
import type { ParsedStatementData, ExpenseTransaction, Subscription, DebtType } from "@/lib/types";
import { isBalanceMarker, txIgnoreKey } from "@/lib/balanceMarkers";
import { CORE_EXCLUDE_RE } from "@/lib/spendingMetrics";
import { merchantSlug } from "@/lib/applyRules";
import { detectFrequency, FREQUENCY_CONFIG, type Frequency } from "@/lib/incomeEngine";
import { SCHEDULED_DEBT_TYPES, debtTxKey, defaultDebtTag, splitDebtPayments } from "@/lib/debtUtils";
import {
  BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ResponsiveContainer, PieChart, Pie,
  AreaChart, Area,
} from "recharts";
import { CATEGORY_COLORS, categoryColor, ALL_CATEGORIES, CategoryPicker, RecurringIcon } from "./shared";
import type { CashFrequency } from "./shared";
import { getParentCategory, isSubtype, CATEGORY_TAXONOMY } from "@/lib/categoryTaxonomy";
import { fmt, getCurrencySymbol } from "@/lib/currencyUtils";
import RefreshToast from "@/components/RefreshToast";
import { PROFILE_REFRESHED_EVENT, useProfileRefresh } from "@/contexts/ProfileRefreshContext";

// Re-export shared items for other pages that used to import from this file
export { CATEGORY_COLORS, categoryColor, ALL_CATEGORIES, CategoryPicker, RecurringIcon } from "./shared";
export type { CashFrequency } from "./shared";

// ── Toast ─────────────────────────────────────────────────────────────────────

function Toast({ message, onDone }: { message: string; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 3000);
    return () => clearTimeout(t);
  }, [onDone]);
  return (
    <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full bg-gray-900 px-5 py-2.5 text-sm font-medium text-white shadow-lg">
      {message}
    </div>
  );
}

// ── Monthly spending chart ────────────────────────────────────────────────────

function SpendingChart({ history, avg, median, selectedMonth, effectiveExp }: {
  history: HistoryPoint[];
  avg: number | null;
  median: number | null;
  selectedMonth: string | null;
  effectiveExp: (h: HistoryPoint) => number;
}) {
  const data = history
    .filter((h) => (h.expensesTotal ?? 0) > 0)
    .map((h) => ({
      ym: h.yearMonth,
      label: shortMonth(h.yearMonth),
      amount: effectiveExp(h),
    }));

  if (data.length === 0) return null;

  const CustomTooltip = ({ active, payload }: { active?: boolean; payload?: { payload: { ym: string; amount: number } }[] }) => {
    if (!active || !payload?.length) return null;
    const { ym, amount } = payload[0].payload;
    return (
      <div className="rounded-lg border border-gray-100 bg-white px-3 py-2 shadow-lg text-xs">
        <p className="font-semibold text-gray-800">{monthLabel(ym)}</p>
        <p className="text-gray-600">{fmt(amount)}</p>
      </div>
    );
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-widest text-gray-400">Monthly Spending</p>
      {median !== null && (
        <p className="mb-4 text-sm font-medium text-gray-600">
          {data.length}-month median{" "}
          <span className="font-bold text-gray-900">{fmt(median)} / mo</span>
          {avg !== null && avg !== median && (
            <span className="ml-2 text-xs text-gray-400">(avg {fmt(avg)})</span>
          )}
        </p>
      )}
      <div style={{ pointerEvents: "none" }}>
        <ResponsiveContainer width="100%" height={140}>
          <BarChart data={data} barSize={22} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
            <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="#f3f4f6" />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#9ca3af" }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 10, fill: "#9ca3af" }} axisLine={false} tickLine={false}
              tickFormatter={(v: number) => { const s = getCurrencySymbol(); return v >= 1000 ? `${s}${Math.round(v / 1000)}k` : `${s}${v}`; }} />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: "#f5f3ff" }} />
            {median !== null && (
              <ReferenceLine y={median} stroke="#a78bfa" strokeDasharray="4 3" strokeWidth={1.5}
                label={{ value: "median", position: "right", fontSize: 10, fill: "#a78bfa" }} />
            )}
            <Bar dataKey="amount" radius={[4, 4, 0, 0]} label={false}>
              {data.map((entry) => (
                <Cell key={entry.ym} fill={entry.ym === selectedMonth ? "#7c3aed" : "#c4b5fd"} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}


// ── recurring item icon helper ─────────────────────────────────────────────
// Returns "subscription" for digital service subscriptions, "recurring" for fees/memberships

const SUBSCRIPTION_KEYWORDS = /netflix|spotify|apple|google|amazon|claude|openai|chatgpt|gpt|youtube|disney|hulu|crave|sirius|audible|xbox|playstation|adobe|microsoft|dropbox|icloud|uber.*one|tidal|deezer|shudder|crunchyroll|subscri|paramount|peacock|iqx|goodlife|gym|learning|patreon|github|figma|notion|slack|zoom/i;

function isSubscriptionService(name: string): boolean {
  return SUBSCRIPTION_KEYWORDS.test(name);
}

function RecurringListIcon({ name }: { name: string }) {
  if (isSubscriptionService(name)) {
    // Play/stream icon for digital subscriptions
    return (
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-purple-100">
        <svg className="h-4 w-4 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      </span>
    );
  }
  // Calendar/repeat icon for fees and memberships
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-100">
      <svg className="h-4 w-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
      </svg>
    </span>
  );
}

// ── tabs ──────────────────────────────────────────────────────────────────────

const TABS = [
  { id: "overview",       label: "Overview" },
  { id: "transactions",   label: "Transactions" },
  { id: "merchants",      label: "By Merchant" },
  { id: "subscriptions",  label: "Recurring" },
  { id: "cash",           label: "Cash" },
] as const;
type TabId = typeof TABS[number]["id"];

// ── cash commitment types ─────────────────────────────────────────────────────


export interface CashCommitment {
  id: string;
  name: string;
  amount: number;
  frequency: CashFrequency;
  category: string;
  notes?: string;
  nextDate?: string;  // ISO date e.g. "2026-03-28" — required when frequency is "once"
  startDate?: string; // ISO year-month e.g. "2026-01" — backfill floor for historical totals
  createdAt: string;
  updatedAt: string;
}

export const CASH_FREQ_OPTIONS: { value: CashFrequency; label: string; perYear: number }[] = [
  { value: "weekly",    label: "Weekly",    perYear: 52 },
  { value: "biweekly",  label: "Biweekly",  perYear: 26 },
  { value: "monthly",   label: "Monthly",   perYear: 12 },
  { value: "quarterly", label: "Quarterly", perYear: 4 },
  { value: "annual",    label: "Annual",    perYear: 1 },
  { value: "once",      label: "One-off",   perYear: 0 },
];

function toMonthly(amount: number, freq: CashFrequency): number {
  if (freq === "once") return 0; // one-offs don't count toward monthly estimate
  const opt = CASH_FREQ_OPTIONS.find((o) => o.value === freq);
  return amount * (opt ? opt.perYear / 12 : 1);
}

// ── helpers ───────────────────────────────────────────────────────────────────

/** Returns the YYYY-MM string for N months ago (0 = current month). */
function monthsAgoYm(n: number): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

const START_DATE_PRESETS = [
  { label: "This month", value: () => monthsAgoYm(0) },
  { label: "1 month ago", value: () => monthsAgoYm(1) },
  { label: "3 months ago", value: () => monthsAgoYm(3) },
  { label: "6 months ago", value: () => monthsAgoYm(6) },
  { label: "1 year ago", value: () => monthsAgoYm(12) },
];

function fmtDec(v: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
}
function monthLabel(ym: string) {
  const [y, m] = ym.split("-");
  if (!m) return ym;
  return new Date(parseInt(y), parseInt(m) - 1, 1).toLocaleDateString("en-US", { month: "short", year: "numeric" });
}
function shortMonth(ym: string) {
  const [y, m] = ym.split("-");
  if (!m) return ym;
  return new Date(parseInt(y), parseInt(m) - 1, 1).toLocaleDateString("en-US", { month: "short" });
}
function fmtDate(iso: string) {
  return new Date(iso + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

type HistoryPoint = { yearMonth: string; netWorth: number; expensesTotal?: number; coreExpensesTotal?: number };


const DEBT_TYPE_LABELS: Record<string, string> = {
  mortgage: "Mortgage",
  auto_loan: "Auto Loan",
  personal_loan: "Personal Loan",
  credit_card: "Credit Card",
  line_of_credit: "Line of Credit",
  other_debt: "Debt",
};

// ── inner page ────────────────────────────────────────────────────────────────

function SpendingPageInner() {
  const router       = useRouter();
  const pathname     = usePathname();
  const searchParams = useSearchParams();

  const [activeTab, setActiveTab] = useState<TabId>(() => {
    const t = searchParams.get("tab");
    return TABS.some((tb) => tb.id === t) ? (t as TabId) : "overview";
  });

  const [data, setData]                 = useState<ParsedStatementData | null>(null);
  const [paymentsMade, setPaymentsMade] = useState<number>(0);
  const [yearMonth, setYearMonth]       = useState<string | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  const [history, setHistory]           = useState<HistoryPoint[]>([]);
  const [prevExpenses, setPrevExpenses] = useState<number | null>(null);
  const [loading, setLoading]           = useState(true);
  const [debtSectionOpen, setDebtSectionOpen] = useState(false);
  const [transferSectionOpen, setTransferSectionOpen] = useState(false);
  const [ignoredTxKeys, setIgnoredTxKeys] = useState<Set<string>>(new Set());
  const [debtTags, setDebtTags] = useState<Record<string, string>>({});
  const [uid, setUid]                     = useState<string | null>(null);
  const [monthLoading, setMonthLoading] = useState(false);
  const [chartExpanded, setChartExpanded] = useState(false);
  const [error, setError]               = useState<string | null>(null);
  const [token, setToken]               = useState<string | null>(null);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [expenseSuggestions, setExpenseSuggestions] = useState<import("@/lib/sourceMappings").SourceSuggestion[]>([]);
  const [suggestionDecisions, setSuggestionDecisions] = useState<Record<string, "confirmed" | "rejected">>({});
  const [applyingMappings, setApplyingMappings] = useState(false);
  const [suggestionListExpanded, setSuggestionListExpanded] = useState(false);

  // All-time merchant aggregation (loaded lazily when By Merchant tab is opened)
  const [merchants, setMerchants]         = useState<import("@/app/api/user/spending/merchants/route").MerchantSummary[] | null>(null);
  const [merchantsLoading, setMerchantsLoading] = useState(false);
  const [merchantSearch, setMerchantSearch]     = useState("");
  const [merchantsMonth, setMerchantsMonth]     = useState<string | null>(null); // which month is currently loaded

  // Transactions with optimistic category overrides
  const [txns, setTxns]             = useState<ExpenseTransaction[]>([]);
  // Show all transactions (including those outside the selected calendar month)
  const [showAllTxns, setShowAllTxns] = useState(false);
  // Sort for the Transactions tab: field + direction
  const [txnSort, setTxnSort] = useState<{ field: "date" | "amount"; dir: "asc" | "desc" }>({ field: "date", dir: "desc" });
  // Which transaction row has the category picker open (index)
  const [openPicker, setOpenPicker] = useState<number | null>(null);
  // Per-row button refs for portal positioning
  const btnRefs = useRef<Map<number, HTMLButtonElement>>(new Map());

  // Category picker for the cash commitment form
  const [cashCatPickerOpen, setCashCatPickerOpen] = useState(false);
  const cashCatBtnRef = useRef<HTMLButtonElement>(null);

  // User-marked recurring rules { slug → Subscription }
  const [recurringRules, setRecurringRules] = useState<Map<string, Subscription>>(new Map());
  // Auto-detected frequency per merchant slug (from cross-month gap analysis)
  const [merchantFrequency, setMerchantFrequency] = useState<Map<string, Frequency>>(new Map());
  // Pending recurring mark — awaiting frequency selection
  const [pendingRecurring, setPendingRecurring] = useState<{ txn: ExpenseTransaction; anchor: HTMLElement } | null>(null);
  const [pendingFreq, setPendingFreq] = useState<CashFrequency>("monthly");

  const [toast, setToast]         = useState<string | null>(null);
  const [catExpanded, setCatExpanded] = useState(false);
  const [expandedCatRows, setExpandedCatRows] = useState<Set<string>>(new Set());

  // ── cash commitments ────────────────────────────────────────────────────────
  const [cashItems, setCashItems] = useState<CashCommitment[]>([]);
  const [cashLoading, setCashLoading] = useState(false);
  const [cashForm, setCashForm] = useState<Partial<CashCommitment> | null>(null); // null = closed
  const [cashSaving, setCashSaving] = useState(false);

  const { requestProfileRefresh } = useProfileRefresh();
  const handleMonthSelectRef = useRef<(ym: string) => Promise<void>>(async () => {});
  const selectedMonthRef = useRef<string | null>(null);

  function switchTab(id: TabId) {
    setActiveTab(id);
    const p = new URLSearchParams(searchParams.toString());
    p.set("tab", id);
    router.replace(`${pathname}?${p.toString()}`, { scroll: false });
    if (id === "merchants" && token) loadMerchants(token, selectedMonth ?? yearMonth ?? "");
  }

  const loadRecurring = useCallback(async (tok: string) => {
    try {
      const res = await fetch("/api/user/recurring-rules", { headers: { Authorization: `Bearer ${tok}` } });
      const json = await res.json().catch(() => ({}));
      const map = new Map<string, Subscription>();
      for (const r of (json.rules ?? [])) {
        map.set(r.slug as string, { name: r.merchant, amount: r.amount, frequency: r.frequency });
      }
      setRecurringRules(map);
    } catch { /* non-fatal */ }
  }, []);

  const loadCash = useCallback(async (tok: string) => {
    try {
      setCashLoading(true);
      const res = await fetch("/api/user/cash-commitments", { headers: { Authorization: `Bearer ${tok}` } });
      const json = await res.json().catch(() => ({}));
      setCashItems(json.items ?? []);
    } catch { /* non-fatal */ }
    finally { setCashLoading(false); }
  }, []);

  const loadMerchants = useCallback(async (tok: string, month: string) => {
    if (merchantsMonth === month && merchants !== null) return; // already loaded for this month
    setMerchantsLoading(true);
    try {
      const url = `/api/user/spending/merchants?month=${encodeURIComponent(month)}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${tok}` } });
      const json = await res.json().catch(() => ({}));
      setMerchants(json.merchants ?? []);
      setMerchantsMonth(month);
    } catch { /* non-fatal */ }
    finally { setMerchantsLoading(false); }
  }, [merchants, merchantsMonth]);

  useEffect(() => {
    const { auth } = getFirebaseClient();
    return onAuthStateChanged(auth, async (user) => {
      if (!user) { router.push("/login"); return; }
      setUid(user.uid);
      setLoading(true); setError(null);
      try {
        const tok = await user.getIdToken();
        setToken(tok);
        // Load ignored transaction keys + debt payment tags from Firestore prefs
        const { db } = getFirebaseClient();
        const [prefsSnap, tagsSnap] = await Promise.all([
          getDoc(doc(db, `users/${user.uid}/prefs/ignoredTxs`)),
          getDoc(doc(db, `users/${user.uid}/prefs/debtPaymentTags`)),
        ]);
        if (prefsSnap.exists()) {
          const keys: string[] = prefsSnap.data()?.keys ?? [];
          setIgnoredTxKeys(new Set(keys));
        }
        if (tagsSnap.exists()) {
          setDebtTags(tagsSnap.data()?.tags ?? {});
        }
        const [res] = await Promise.all([
          fetch("/api/user/statements/consolidated", { headers: { Authorization: `Bearer ${tok}` } }),
          loadRecurring(tok),
          loadCash(tok),
        ]);
        const json = await res.json().catch(() => ({}));
        if (!res.ok) { setError(json.error || "Failed to load"); return; }
        const currentYM = json.yearMonth ?? null;
        setData(json.data ?? null);
        setPaymentsMade(json.paymentsMade ?? 0);
        setNeedsRefresh(json.needsRefresh ?? false);
        const expSugg = json.expenseSuggestions ?? [];
        setExpenseSuggestions(expSugg);
        const defaultDecisions: Record<string, "confirmed" | "rejected"> = {};
        for (const s of expSugg) defaultDecisions[s.pairKey] = "confirmed";
        setSuggestionDecisions(defaultDecisions);
        setYearMonth(currentYM);
        setSelectedMonth(currentYM);
        setHistory(Array.isArray(json.history) ? json.history : []);
        setPrevExpenses(json.previousMonth?.expenses ?? null);
        const raw: ExpenseTransaction[] = (json.data?.expenses?.transactions ?? [])
          .slice()
          .sort((a: ExpenseTransaction, b: ExpenseTransaction) => (b.date ?? "").localeCompare(a.date ?? ""));
        setTxns(raw);

        // If landing directly on the merchants tab, pre-load merchant data now that we have the month
        if (activeTab === "merchants" && currentYM) loadMerchants(tok, currentYM);

        // Build frequency map from cross-month recurring history
        const rh: Record<string, { yearMonth: string; dates: string[] }[]> = json.recurringHistory ?? {};
        const freqMap = new Map<string, Frequency>();
        for (const [slug, months] of Object.entries(rh)) {
          // Flatten all transaction dates across all months
          const allDates = months.flatMap((m) => m.dates).sort();
          if (allDates.length >= 2) {
            const result = detectFrequency(allDates);
            freqMap.set(slug, result.frequency);
          }
        }
        setMerchantFrequency(freqMap);
      } catch { setError("Failed to load spending data"); }
      finally { setLoading(false); }
    });
  }, [router, loadRecurring, loadCash]);

  // ── month switching ───────────────────────────────────────────────────────

  async function handleMonthSelect(ym: string) {
    if (!token || ym === selectedMonth) return;
    setSelectedMonth(ym);
    setChartExpanded(false);
    setShowAllTxns(false);
    setCatExpanded(false);
    setMonthLoading(true);
    try {
      const url = ym === yearMonth
        ? "/api/user/statements/consolidated"
        : `/api/user/statements/consolidated?month=${encodeURIComponent(ym)}`;
      const res  = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return;
      setData(json.data ?? null);
      setPaymentsMade(json.paymentsMade ?? 0);
      setPrevExpenses(json.previousMonth?.expenses ?? null);
      const raw: ExpenseTransaction[] = (json.data?.expenses?.transactions ?? [])
        .slice()
        .sort((a: ExpenseTransaction, b: ExpenseTransaction) => (b.date ?? "").localeCompare(a.date ?? ""));
      setTxns(raw);
      // Reload merchant data for the new month if that tab is active
      if (activeTab === "merchants") loadMerchants(token, ym);
    } finally { setMonthLoading(false); }
  }

  handleMonthSelectRef.current = handleMonthSelect;
  selectedMonthRef.current = selectedMonth;

  useEffect(() => {
    if (!token) return;
    const onProfileRefreshed = () => {
      const ym = selectedMonthRef.current;
      if (ym) void handleMonthSelectRef.current(ym);
    };
    window.addEventListener(PROFILE_REFRESHED_EVENT, onProfileRefreshed);
    return () => window.removeEventListener(PROFILE_REFRESHED_EVENT, onProfileRefreshed);
  }, [token]);

  // ── category change ───────────────────────────────────────────────────────

  async function handleCategoryChange(txnIndex: number, newCategory: string) {
    const txn = txns[txnIndex];
    if (!txn || !token) return;
    setOpenPicker(null);
    setTxns((prev) => prev.map((t, i) => i === txnIndex ? { ...t, category: newCategory } : t));
    try {
      const res = await fetch("/api/user/category-rules", {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ merchant: txn.merchant, category: newCategory }),
      });
      if (res.ok) {
        setToast(`Rule saved: "${txn.merchant}" → ${newCategory}`);
        requestProfileRefresh();
      } else {
        setToast("Failed to save rule");
      }
    } catch {
      setToast("Failed to save rule");
    }
  }

  // ── recurring toggle ──────────────────────────────────────────────────────

  async function handleIgnoreTx(txn: ExpenseTransaction) {
    const key = txIgnoreKey(txn.date, txn.amount, txn.merchant);
    const next = new Set(ignoredTxKeys);
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
    }
    setIgnoredTxKeys(next);
    if (uid) {
      const { db } = getFirebaseClient();
      await setDoc(doc(db, `users/${uid}/prefs/ignoredTxs`), { keys: Array.from(next) });
    }
  }

  async function handleApplyExpenseMappings() {
    if (!token) return;
    const suggestions = expenseSuggestions;
    const confirmed = suggestions.filter((s) => suggestionDecisions[s.pairKey] === "confirmed");
    const rejected  = suggestions.filter((s) => suggestionDecisions[s.pairKey] === "rejected");
    const toSave = [
      ...confirmed.map((s) => ({ ...s, status: "confirmed" as const, createdAt: new Date().toISOString() })),
      ...rejected.map((s)  => ({ ...s, status: "rejected"  as const, createdAt: new Date().toISOString() })),
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
      setExpenseSuggestions((prev) => prev.filter((s) => !appliedKeys.has(s.pairKey)));
      setSuggestionDecisions({});
      // If any confirmed mapping affects cache, trigger a refresh
      if (confirmed.some((s) => s.affectsCache)) setNeedsRefresh(true);
    } finally {
      setApplyingMappings(false);
    }
  }

  async function handleDebtTagChange(txKey: string, tag: string) {
    const next = { ...debtTags, [txKey]: tag };
    setDebtTags(next);
    if (uid) {
      const { db } = getFirebaseClient();
      await setDoc(doc(db, `users/${uid}/prefs/debtPaymentTags`), { tags: next });
    }
  }

  function handleRecurringToggle(txn: ExpenseTransaction, anchorEl: HTMLElement) {
    if (!token) return;
    const slug = merchantSlug(txn.merchant);
    const isCurrentlyRecurring = recurringRules.has(slug);

    if (isCurrentlyRecurring) {
      // Unmark immediately
      setRecurringRules((prev) => { const next = new Map(prev); next.delete(slug); return next; });
      fetch(`/api/user/recurring-rules?slug=${encodeURIComponent(slug)}`, {
        method: "DELETE", headers: { Authorization: `Bearer ${token}` },
      }).catch(() => {});
      setToast(`"${txn.merchant}" unmarked as recurring`);
    } else {
      // Open frequency picker
      setPendingFreq("monthly");
      setPendingRecurring({ txn, anchor: anchorEl });
    }
  }

  async function confirmRecurring() {
    if (!token || !pendingRecurring) return;
    const { txn } = pendingRecurring;
    const slug = merchantSlug(txn.merchant);
    setRecurringRules((prev) => {
      const next = new Map(prev);
      next.set(slug, { name: txn.merchant, amount: txn.amount, frequency: pendingFreq });
      return next;
    });
    setPendingRecurring(null);
    try {
      await fetch("/api/user/recurring-rules", {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ merchant: txn.merchant, amount: txn.amount, frequency: pendingFreq, category: txn.category }),
      });
      setToast(`"${txn.merchant}" marked as recurring (${pendingFreq})`);
    } catch { setToast("Failed to save"); }
  }

  async function dismissRecurring() {
    if (!token || !pendingRecurring) return;
    const { txn } = pendingRecurring;
    const slug = merchantSlug(txn.merchant);
    setRecurringRules((prev) => {
      const next = new Map(prev);
      next.set(slug, { name: txn.merchant, amount: txn.amount, frequency: "never" });
      return next;
    });
    setPendingRecurring(null);
    try {
      await fetch("/api/user/recurring-rules", {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ merchant: txn.merchant, amount: txn.amount, frequency: "never", category: txn.category }),
      });
      setToast(`"${txn.merchant}" marked as not recurring`);
    } catch { setToast("Failed to save"); }
  }

  // ── cash commitment handlers ───────────────────────────────────────────────

  async function handleCashSave() {
    if (!token || !cashForm) return;
    const { name, amount, frequency, category } = cashForm;
    if (!name?.trim() || !amount || !frequency || !category) {
      setToast("Please fill in all required fields"); return;
    }
    if (frequency === "once" && !cashForm.nextDate) {
      setToast("Please set the date for this one-off payment"); return;
    }
    // Build clean payload — omit optional fields when empty to avoid Firestore undefined errors
    const payload: Partial<CashCommitment> = {
      ...cashForm,
      notes:    cashForm.notes?.trim()    || undefined,
      nextDate: cashForm.nextDate?.trim() || undefined,
    };
    setCashSaving(true);
    try {
      if (cashForm.id) {
        // Update
        await fetch("/api/user/cash-commitments", {
          method: "PUT",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        setCashItems((prev) => prev.map((c) => c.id === cashForm.id ? { ...c, ...payload } as CashCommitment : c));
        setToast("Commitment updated");
      } else {
        // Create
        const res = await fetch("/api/user/cash-commitments", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const json = await res.json().catch(() => ({}));
        if (json.item) setCashItems((prev) => [...prev, json.item as CashCommitment]);
        setToast("Commitment added");
      }
      setCashForm(null);
      setCashCatPickerOpen(false);
      await fetch("/api/user/invalidate-cache", { method: "POST", headers: { Authorization: `Bearer ${token}` } });
      requestProfileRefresh();
    } catch { setToast("Failed to save"); }
    finally { setCashSaving(false); }
  }

  async function handleCashDelete(id: string) {
    if (!token) return;
    setCashItems((prev) => prev.filter((c) => c.id !== id));
    await fetch(`/api/user/cash-commitments?id=${encodeURIComponent(id)}`, {
      method: "DELETE", headers: { Authorization: `Bearer ${token}` },
    });
    await fetch("/api/user/invalidate-cache", { method: "POST", headers: { Authorization: `Bearer ${token}` } });
    requestProfileRefresh();
    setToast("Commitment removed");
  }

  const cashMonthlyTotal = cashItems.reduce((s, c) => s + toMonthly(c.amount, c.frequency), 0);

  // AI-detected subscriptions from the statement
  const aiSubscriptions: Subscription[] = data?.subscriptions ?? [];

  // Slug set for fast lookup in transaction rows
  const aiSubSlugs = new Set(aiSubscriptions.map((s) => merchantSlug(s.name)));

  // Helper: get best known frequency for a merchant
  function resolvedFrequency(name: string, fallback: string): string {
    const slug = merchantSlug(name);
    const detected = merchantFrequency.get(slug);
    if (detected && detected !== "irregular") return FREQUENCY_CONFIG[detected].label;
    return fallback || "monthly";
  }

  // Merge AI subs + user-marked recurring (user-marked take precedence by name)
  // Exclude "never" rules from both lists — those are user-dismissed entries
  const manualOnly = Array.from(recurringRules.values()).filter(
    (r) => !aiSubSlugs.has(merchantSlug(r.name)) && r.frequency !== "never"
  );
  const dismissedSlugs = new Set(
    Array.from(recurringRules.entries())
      .filter(([, r]) => r.frequency === "never")
      .map(([slug]) => slug)
  );
  const allSubscriptions: (Subscription & { source: "ai" | "manual"; detectedFrequency: string })[] = [
    ...aiSubscriptions
      .filter((s) => !dismissedSlugs.has(merchantSlug(s.name)))
      .map((s) => ({
        ...s,
        source: "ai" as const,
        detectedFrequency: resolvedFrequency(s.name, s.frequency),
      })),
    ...manualOnly.map((s) => ({
      ...s,
      source: "manual" as const,
      detectedFrequency: resolvedFrequency(s.name, s.frequency),
    })),
  ];

  // Transactions matching the selected calendar month, transfers excluded.
  // Statement billing periods can span two calendar months — we only count
  // transactions whose DATE falls in the selected month (transaction-date principle).
  const filterMonth = selectedMonth ?? yearMonth ?? "";
  const monthTxns = txns.filter(
    (t) => (!t.date || t.date.startsWith(filterMonth))
      && !isBalanceMarker(t.merchant)
      && !ignoredTxKeys.has(txIgnoreKey(t.date, t.amount, t.merchant))
  );

  // Core transactions: excludes transfers and debt payments (CORE_EXCLUDE_RE)
  const coreTxns = monthTxns.filter((t) => !CORE_EXCLUDE_RE.test((t.category ?? "").trim()));
  // Excluded transactions: transfers + debt payments — shown in a separate section
  const excludedTxns = monthTxns.filter((t) => CORE_EXCLUDE_RE.test((t.category ?? "").trim()));

  // Cash commitment amount for a specific yearMonth — defined here so it's available
  // for both the total and the categories breakdown below.
  function cashCommitmentAmountForMonth(item: CashCommitment, ym: string): number {
    if (item.frequency === "once") return 0;
    const floor = item.startDate?.slice(0, 7) ?? item.createdAt?.slice(0, 7);
    if (floor && ym < floor) return 0;
    return toMonthly(item.amount, item.frequency as CashFrequency);
  }
  const cashCommitmentsForMonth = cashItems.reduce(
    (s, c) => s + cashCommitmentAmountForMonth(c, filterMonth), 0
  );

  const statementTotal = coreTxns.length > 0
    ? coreTxns.reduce((s, t) => s + t.amount, 0)
    : (data?.expenses?.total ?? 0);
  const total        = statementTotal + cashCommitmentsForMonth;
  const displayTotal = total;

  const excludedTotal = excludedTxns.reduce((s, t) => s + t.amount, 0);

  // Split excluded transactions into debt payments / interest / transfers
  const DEBT_PAY_RE  = /^debt payments$/i;
  const INTEREST_RE  = /^interest$/i;
  const debtTxns     = excludedTxns.filter((t) =>  DEBT_PAY_RE.test((t.category ?? "").trim()));
  const interestTxns = excludedTxns.filter((t) =>  INTEREST_RE.test((t.category ?? "").trim()));
  const transferTxns = excludedTxns.filter((t) =>
    !DEBT_PAY_RE.test((t.category ?? "").trim()) && !INTEREST_RE.test((t.category ?? "").trim())
  );
  const debtTotal     = debtTxns.reduce((s, t) => s + t.amount, 0);
  const interestTotal = interestTxns.reduce((s, t) => s + t.amount, 0);
  const transferTotal = transferTxns.reduce((s, t) => s + t.amount, 0);

  // categories: parent-level rollup with subtypes nested inside each entry
  // includes cash commitments so the chart matches what the Cash tab shows
  const categories = (() => {
    // Build parent → total and parent → subtype breakdown maps
    const parentMap  = new Map<string, number>();
    const subtypeMap = new Map<string, Map<string, number>>();

    const buildMaps = (txns: typeof coreTxns) => {
      for (const tx of txns) {
        const cat    = tx.category || "Other";
        const parent = getParentCategory(cat);
        parentMap.set(parent, (parentMap.get(parent) ?? 0) + tx.amount);
        if (isSubtype(cat)) {
          if (!subtypeMap.has(parent)) subtypeMap.set(parent, new Map());
          const sm = subtypeMap.get(parent)!;
          sm.set(cat, (sm.get(cat) ?? 0) + tx.amount);
        }
      }
    };

    if (coreTxns.length > 0) {
      buildMaps(coreTxns);
    } else {
      // Fall back to AI-computed categories aggregated to parent
      for (const c of (data?.expenses?.categories ?? [])) {
        if (CORE_EXCLUDE_RE.test((c.name ?? "").trim())) continue;
        const parent = getParentCategory(c.name ?? "Other");
        parentMap.set(parent, (parentMap.get(parent) ?? 0) + c.amount);
      }
    }

    // Inject cash commitments for the selected month
    for (const item of cashItems) {
      const amt = cashCommitmentAmountForMonth(item, filterMonth);
      if (amt <= 0) continue;
      const parent = getParentCategory(item.category || "Other");
      parentMap.set(parent, (parentMap.get(parent) ?? 0) + amt);
    }

    return Array.from(parentMap.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([name, amount]) => {
        const subs = subtypeMap.get(name);
        const subtypeEntries = subs
          ? Array.from(subs.entries())
              .sort((a, b) => b[1] - a[1])
              .map(([subName, subAmt]) => ({ name: subName, amount: subAmt }))
          : [];
        const subtypeTotal = subtypeEntries.reduce((s, e) => s + e.amount, 0);
        const remainder = amount - subtypeTotal;
        // Transactions tagged with the parent name directly (no subtype chosen) — show as a catch-all row
        if (remainder > 0.005 && subtypeEntries.length > 0) {
          subtypeEntries.push({ name: `Other ${name}`, amount: remainder });
        }
        return {
          name,
          amount,
          percentage: total > 0 ? Math.round((amount / total) * 100) : 0,
          subtypes: subtypeEntries,
        };
      });
  })();

  // Always use coreExpensesTotal (transfers + debt payments excluded)
  const effectiveExp = (h: HistoryPoint) =>
    h.coreExpensesTotal !== undefined ? h.coreExpensesTotal : (h.expensesTotal ?? 0);

  // Typical month = median/avg of HISTORICAL months only — exclude the selected
  // month so the current period never contaminates its own baseline.
  const historicalHistory = history.filter((h) => h.yearMonth < filterMonth);
  const monthsTracked = historicalHistory.length;
  const avgExpenses = monthsTracked > 0
    ? Math.round(historicalHistory.reduce((s, h) => s + effectiveExp(h), 0) / monthsTracked)
    : null;
  const medianExpenses = (() => {
    if (monthsTracked === 0) return null;
    const sorted = [...historicalHistory].map(effectiveExp).sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0
      ? sorted[mid]
      : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
  })();
  // Use the previous month from historicalHistory (already core-filtered) so the
  // delta is apples-to-apples with `total`. prevExpenses from the API uses the raw
  // expense total (transfers included) and always points to the same month.
  const prevHistMonth   = historicalHistory.slice(-1)[0] ?? null;
  const prevCoreExp     = prevHistMonth ? effectiveExp(prevHistMonth) : null;
  const prevMonthLabel  = prevHistMonth ? shortMonth(prevHistMonth.yearMonth) : "last month";
  const expDelta        = prevCoreExp !== null && total > 0 ? total - prevCoreExp : null;
  const subsYearly = allSubscriptions.reduce((s, sub) => {
    const monthly = sub.frequency === "annual" ? sub.amount / 12 : sub.amount;
    return s + monthly * 12;
  }, 0);
  const hasData = total > 0 || excludedTotal > 0 || allSubscriptions.length > 0 || txns.length > 0 || cashItems.length > 0;
  const mergingExpenseSuggestions = expenseSuggestions.filter((s) => suggestionDecisions[s.pairKey] !== "rejected");

  if (loading) return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <div className="h-10 w-10 animate-spin rounded-full border-4 border-purple-600 border-t-transparent" />
    </div>
  );

  return (
    <div className="mx-auto max-w-2xl px-4 pt-4 pb-8 sm:py-8 sm:px-6">

      {token && needsRefresh && (
        <RefreshToast
          token={token}
          onRefreshed={() => {
            setNeedsRefresh(false);
            // Reload data by re-fetching for the current selected month
            if (selectedMonth) handleMonthSelect(selectedMonth);
          }}
        />
      )}

      {/* Header */}
      <div className="mb-1 flex items-start justify-between gap-4">
        <div>
          <h1 className="font-bold text-3xl text-gray-900">Spending</h1>
          {selectedMonth && (
            <p className="mt-0.5 text-sm text-gray-400">
              {displayTotal > 0 && <>{fmt(displayTotal)} · </>}{monthLabel(selectedMonth)}
              {monthLoading && <span className="ml-2 text-xs text-gray-300">loading…</span>}
            </p>
          )}
        </div>
        <p className="mt-3 text-[10px] text-gray-400 text-right shrink-0">
          excl. transfers<br />& debt pmts
        </p>
      </div>

      {/* Month pills */}
      {history.filter((h) => (h.expensesTotal ?? 0) > 0).length > 1 && (
        <div className="mt-4 -mx-1 flex gap-1.5 overflow-x-auto pb-1 scrollbar-none">
          {history
            .filter((h) => (h.expensesTotal ?? 0) > 0)
            .map((h) => (
              <button
                key={h.yearMonth}
                onClick={() => handleMonthSelect(h.yearMonth)}
                className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition ${
                  selectedMonth === h.yearMonth
                    ? "bg-purple-600 text-white"
                    : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                }`}
              >
                {shortMonth(h.yearMonth)} {h.yearMonth.slice(0, 4).slice(-2)}
              </button>
            ))}
        </div>
      )}

      {error && <p className="mt-4 text-red-600 text-sm">{error}</p>}

      {!hasData && !error && (
        <div className="mt-6 rounded-xl border border-dashed border-gray-200 bg-gray-50 p-12 text-center">
          <p className="text-gray-500">No spending data yet.</p>
          <Link href="/upload" className="mt-3 inline-block text-sm font-medium text-purple-600 hover:underline">
            Upload a statement to get started →
          </Link>
        </div>
      )}

      {hasData && (
        <>
          {/* Tab bar */}
          <div className="mt-5 mb-6 flex border-b border-gray-200">
            {TABS.map((tab) => (
              <button key={tab.id} onClick={() => switchTab(tab.id)}
                className={`relative mr-6 pb-3 text-sm font-medium transition-colors ${
                  activeTab === tab.id
                    ? "text-gray-900 after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:rounded-full after:bg-gray-900 after:content-['']"
                    : "text-gray-400 hover:text-gray-600"
                }`}>
                {tab.label}
                {tab.id === "transactions" && txns.length > 0 && (
                  <span className="ml-1.5 rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-500">
                    {txns.length}
                  </span>
                )}
                {tab.id === "subscriptions" && allSubscriptions.length > 0 && (
                  <span className="ml-1.5 rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-500">
                    {allSubscriptions.length}
                  </span>
                )}
                {tab.id === "cash" && cashItems.length > 0 && (
                  <span className="ml-1.5 rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-500">
                    {cashItems.length}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* ── Overview tab ──────────────────────────────────────────────── */}
          {activeTab === "overview" && (
            <div className="space-y-5">

              {/* Expense merchant suggestions */}
              {expenseSuggestions.length > 0 && (
                <div className="rounded-xl border border-purple-200 bg-purple-50/40 overflow-hidden">
                    <div className="flex items-center justify-between px-4 py-3">
                      <div>
                        <p className="text-sm font-semibold text-purple-900">
                          {mergingExpenseSuggestions.length} duplicate merchant{mergingExpenseSuggestions.length !== 1 ? "s" : ""} found
                        </p>
                        <button
                          onClick={() => setSuggestionListExpanded((v) => !v)}
                          className="text-[11px] text-purple-400 underline underline-offset-2 hover:text-purple-600"
                        >
                          {suggestionListExpanded ? "Hide list" : "Review before merging"}
                        </button>
                      </div>
                      <button
                        onClick={handleApplyExpenseMappings}
                        disabled={applyingMappings}
                        className="shrink-0 rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-700 disabled:opacity-50 transition"
                      >
                        {applyingMappings ? "Saving…" : "Merge All"}
                      </button>
                    </div>
                    {suggestionListExpanded && (
                      <div className="border-t border-purple-100 divide-y divide-purple-100/60 max-h-72 overflow-y-auto">
                        {expenseSuggestions.map((s) => {
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
                              {s.affectsCache && !excluded && (
                                <span className="shrink-0 text-[10px] font-semibold text-orange-500">↻</span>
                              )}
                            </button>
                          );
                        })}
                        {mergingExpenseSuggestions.length !== expenseSuggestions.length && (
                          <div className="px-4 py-2 text-[11px] text-purple-500 bg-purple-50">
                            {mergingExpenseSuggestions.length} will merge · {expenseSuggestions.length - mergingExpenseSuggestions.length} excluded
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              {history.filter((h) => (h.expensesTotal ?? 0) > 0).length >= 2 && (
                <>
                  <SpendingChart
                    history={history}
                    avg={avgExpenses}
                    median={medianExpenses}
                    selectedMonth={selectedMonth}
                    effectiveExp={effectiveExp}
                  />

                  {/* Expand toggle — centered chevron below chart */}
                  {selectedMonth && (
                    <div className="flex flex-col items-center -mt-2">
                      <button
                        onClick={() => setChartExpanded((v) => !v)}
                        className="flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-medium text-gray-500 shadow-sm hover:border-purple-300 hover:text-purple-600 transition-colors"
                      >
                        {chartExpanded ? "Hide breakdown" : `${monthLabel(selectedMonth)} breakdown`}
                        <svg
                          className={`h-3.5 w-3.5 transition-transform duration-200 ${chartExpanded ? "rotate-180" : ""}`}
                          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>

                      {/* Breakdown panel */}
                      {chartExpanded && (
                        <div className="mt-3 w-full rounded-xl border border-purple-100 bg-purple-50/40 p-4 space-y-4">
                          {/* Header */}
                          <div>
                            <p className="text-sm font-semibold text-gray-800">{monthLabel(selectedMonth)}</p>
                            <p className="text-xs text-gray-400">
                              Total:{" "}
                              <span className="font-semibold text-gray-700">
                                {monthLoading ? "…" : fmt(total)}
                              </span>
                              {expDelta !== null && !monthLoading && (
                                <span className={`ml-2 font-semibold ${expDelta > 0 ? "text-red-500" : "text-green-600"}`}>
                                  {expDelta > 0 ? "↑ " : "↓ "}{fmt(Math.abs(expDelta))} vs prev
                                </span>
                              )}
                            </p>
                          </div>

                          {monthLoading ? (
                            <p className="text-xs text-gray-400">Loading…</p>
                          ) : (
                            <>
                              {/* By category */}
                              {categories.length > 0 && (
                                <div>
                                  <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">By Category</p>
                                  <div className="space-y-1.5">
                                    {categories.slice(0, 6).map((cat) => (
                                      <div key={cat.name} className="flex items-center gap-3 rounded-lg bg-white px-3 py-2 shadow-sm">
                                        <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: categoryColor(cat.name) }} />
                                        <span className="flex-1 text-sm text-gray-700 truncate">{cat.name}</span>
                                        <span className="text-xs text-gray-400 tabular-nums w-8 text-right">{cat.percentage}%</span>
                                        <span className="text-sm font-semibold tabular-nums text-gray-800">{fmt(cat.amount)}</span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {/* Top 5 transactions */}
                              {txns.length > 0 && (
                                <div>
                                  <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">Top Expenses</p>
                                  <div className="space-y-1.5">
                                    {[...txns].sort((a, b) => b.amount - a.amount).slice(0, 5).map((txn, i) => (
                                      <div key={i} className="flex items-center gap-3 rounded-lg bg-white px-3 py-2 shadow-sm">
                                        <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: categoryColor(txn.category || "Other") }} />
                                    <div className="flex-1 min-w-0">
                                      <p className="text-sm font-medium text-gray-800 truncate">{txn.merchant}</p>
                                      <p className="text-xs text-gray-400">
                                        {txn.category || "Other"}
                                        {txn.date ? ` · ${txn.date.slice(5)}` : ""}
                                        {txn.accountLabel ? ` · ${txn.accountLabel}` : ""}
                                      </p>
                                    </div>
                                        <span className="text-sm font-semibold tabular-nums text-gray-800 shrink-0">{fmt(txn.amount)}</span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
              {(total > 0 || excludedTotal > 0) && (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    {/* Discretionary spending this month */}
                    {(() => {
                      // Spark: last 5 historical months + current month as final point
                      const prevPoints = historicalHistory.slice(-5).map((h) => ({ v: effectiveExp(h), ym: h.yearMonth }));
                      const thisMonthSpark = total > 0 ? [...prevPoints, { v: total, ym: filterMonth }] : prevPoints;
                      const trend: "up" | "down" | "flat" = (() => {
                        if (thisMonthSpark.length < 2 || total <= 0) return "flat";
                        const baseline = prevPoints.length > 0
                          ? prevPoints.reduce((s, p) => s + p.v, 0) / prevPoints.length
                          : total;
                        if (total > baseline * 1.04) return "up";
                        if (total < baseline * 0.96) return "down";
                        return "flat";
                      })();
                      const trendColor = trend === "up" ? "#ef4444" : trend === "down" ? "#22c55e" : "#9ca3af";
                      return (
                        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
                          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">This Month</p>
                          <p className="mt-2 font-bold text-2xl text-gray-900">{total > 0 ? fmt(displayTotal) : "—"}</p>
                          {expDelta !== null && total > 0 && (
                            <p className={`mt-1 text-xs font-medium ${expDelta > 0 ? "text-red-500" : "text-green-600"}`}>
                              {expDelta > 0 ? "↑" : "↓"} {fmt(Math.abs(expDelta))} vs {prevMonthLabel}
                            </p>
                          )}
                          {/* Sparkline + trend vs recent average */}
                          {thisMonthSpark.length >= 3 && total > 0 && (
                            <div className="mt-3 space-y-1">
                              <div className="h-10">
                                <ResponsiveContainer width="100%" height="100%">
                                  <AreaChart data={thisMonthSpark} margin={{ top: 2, right: 2, left: 2, bottom: 2 }}>
                                    <defs>
                                      <linearGradient id="thisMonthGrad" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor={trendColor} stopOpacity={0.25} />
                                        <stop offset="95%" stopColor={trendColor} stopOpacity={0} />
                                      </linearGradient>
                                    </defs>
                                    <Area
                                      type="monotone"
                                      dataKey="v"
                                      stroke={trendColor}
                                      strokeWidth={1.5}
                                      fill="url(#thisMonthGrad)"
                                      dot={false}
                                      isAnimationActive={false}
                                    />
                                  </AreaChart>
                                </ResponsiveContainer>
                              </div>
                              <p className="text-[11px] font-medium" style={{ color: trendColor }}>
                                {trend === "up" ? "↑ above recent avg" : trend === "down" ? "↓ below recent avg" : "→ in line with avg"}
                              </p>
                            </div>
                          )}
                        </div>
                      );
                    })()}

                    {/* Typical month */}
                    {(() => {
                      const sparkPoints = historicalHistory.slice(-6).map((h) => ({ v: effectiveExp(h) }));
                      const trend: "up" | "down" | "flat" = (() => {
                        if (sparkPoints.length < 3) return "flat";
                        const half = Math.ceil(sparkPoints.length / 2);
                        const older = sparkPoints.slice(0, half).reduce((s, p) => s + p.v, 0) / half;
                        const newer = sparkPoints.slice(-half).reduce((s, p) => s + p.v, 0) / half;
                        if (newer > older * 1.04) return "up";
                        if (newer < older * 0.96) return "down";
                        return "flat";
                      })();
                      const trendColor = trend === "up" ? "#ef4444" : trend === "down" ? "#22c55e" : "#9ca3af";
                      const trendLabel = trend === "up" ? "↑ trending up" : trend === "down" ? "↓ trending down" : "→ stable";
                      return (
                        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
                          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Typical Month</p>
                          <p className="mt-2 font-bold text-2xl text-gray-900">{medianExpenses !== null ? fmt(medianExpenses) : "—"}</p>
                          <p className="mt-1 text-xs text-gray-400">
                            {monthsTracked > 0
                              ? <>median · {monthsTracked} month{monthsTracked !== 1 ? "s" : ""}</>
                              : "No history yet"}
                          </p>
                          {/* Sparkline + trend */}
                          {sparkPoints.length >= 3 && (
                            <div className="mt-3 space-y-1">
                              <div className="h-10">
                                <ResponsiveContainer width="100%" height="100%">
                                  <AreaChart data={sparkPoints} margin={{ top: 2, right: 2, left: 2, bottom: 2 }}>
                                    <defs>
                                      <linearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor={trendColor} stopOpacity={0.25} />
                                        <stop offset="95%" stopColor={trendColor} stopOpacity={0} />
                                      </linearGradient>
                                    </defs>
                                    <Area
                                      type="monotone"
                                      dataKey="v"
                                      stroke={trendColor}
                                      strokeWidth={1.5}
                                      fill="url(#sparkGrad)"
                                      dot={false}
                                      isAnimationActive={false}
                                    />
                                  </AreaChart>
                                </ResponsiveContainer>
                              </div>
                              <p className="text-[11px] font-medium" style={{ color: trendColor }}>{trendLabel}</p>
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </div>

                  {/* ── Debt Payments card (prominent) ───────────────────────── */}
                  {(debtTotal > 0 || interestTotal > 0) && (() => {
                    const sortedDebt = debtTxns.slice().sort((a, b) => b.amount - a.amount);
                    const { minPaymentsTotal: committedTotal, extraPaymentsTotal: extraTotal } =
                      splitDebtPayments(
                        sortedDebt as (ExpenseTransaction & { debtType?: DebtType })[],
                        debtTags,
                        filterMonth,
                      );
                    return (
                      <div className="rounded-xl border border-orange-200 bg-white overflow-hidden shadow-sm">
                        {/* Header */}
                        <button
                          onClick={() => setDebtSectionOpen((v) => !v)}
                          className="flex w-full items-center justify-between px-5 py-4 hover:bg-orange-50/40 transition"
                        >
                          <div className="flex items-center gap-3">
                            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-orange-100 shrink-0">
                              <svg className="h-4 w-4 text-orange-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                              </svg>
                            </div>
                            <div className="text-left">
                              <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Debt Payments</p>
                              <p className="text-xl font-bold text-gray-900 tabular-nums leading-tight">{fmt(debtTotal)}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="text-[11px] text-gray-400">not in spending</span>
                            <svg
                              className={`h-3.5 w-3.5 text-gray-400 transition-transform ${debtSectionOpen ? "rotate-180" : ""}`}
                              fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
                            >
                              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                            </svg>
                          </div>
                        </button>

                        {/* Summary — always visible */}
                        <div className="flex items-center gap-4 border-t border-orange-100 px-5 py-3 bg-orange-50/60">
                          {committedTotal > 0 && (
                            <div className="flex-1">
                              <p className="text-[10px] font-semibold uppercase tracking-wider text-orange-400 mb-0.5">Min Payments</p>
                              <p className="text-base font-bold text-orange-700 tabular-nums">{fmt(committedTotal)}</p>
                            </div>
                          )}
                          {extraTotal > 0 && (
                            <div className="flex-1">
                              <p className="text-[10px] font-semibold uppercase tracking-wider text-green-500 mb-0.5">Extra Payments</p>
                              <p className="text-base font-bold text-green-600 tabular-nums">{fmt(extraTotal)}</p>
                            </div>
                          )}
                          {interestTotal > 0 && (
                            <div className="flex-1">
                              <p className="text-[10px] font-semibold uppercase tracking-wider text-red-400 mb-0.5">Interest</p>
                              <p className="text-base font-bold text-red-500 tabular-nums">{fmt(interestTotal)}</p>
                            </div>
                          )}
                        </div>

                        {/* Expanded body — individual rows */}
                        {debtSectionOpen && (
                          <div className="border-t border-orange-100">
                            {/* Individual rows */}
                            <div className="divide-y divide-gray-50">
                              {sortedDebt.map((tx, i) => {
                                const txType = (tx as ExpenseTransaction & { debtType?: DebtType }).debtType;
                                const key = debtTxKey(tx, filterMonth);
                                const isScheduled = SCHEDULED_DEBT_TYPES.has(txType ?? "");
                                const currentTag = debtTags[key] ?? defaultDebtTag(txType);
                                // Two states: required (minimum) ↔ extra (above minimum); full_balance treated as extra
                                const normalizedTag = (currentTag === "full_balance" || currentTag === "extra") ? "extra" : "minimum";
                                const nextTag = normalizedTag === "minimum" ? "extra" : "minimum";
                                const tagLabel = isScheduled ? "Scheduled" : (normalizedTag === "extra" ? "Extra payment" : "Min Payment");
                                const tagColor = isScheduled
                                  ? "bg-gray-100 text-gray-500"
                                  : normalizedTag === "extra"
                                    ? "bg-green-100 text-green-700"
                                    : "bg-purple-100 text-purple-700";
                                return (
                                  <div key={i} className="flex items-center gap-3 px-5 py-3">
                                    <div className="min-w-0 flex-1">
                                      <p className="text-sm font-medium text-gray-800 truncate">{tx.merchant ?? "Debt Payment"}</p>
                                      <p className="text-[11px] text-gray-400 mt-0.5">
                                        {tx.date ?? ""}
                                        {txType && <span className="ml-1 text-orange-400">· {DEBT_TYPE_LABELS[txType] ?? txType}</span>}
                                      </p>
                                    </div>
                                    <div className="flex items-center gap-2 shrink-0">
                                      <p className="text-sm font-semibold text-gray-700 tabular-nums">{fmt(tx.amount)}</p>
                                      {isScheduled ? (
                                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${tagColor}`}>{tagLabel}</span>
                                      ) : (
                                        <button
                                          onClick={() => handleDebtTagChange(key, nextTag)}
                                          title={normalizedTag === "minimum" ? "Tap to mark as extra payment" : "Tap to mark as minimum payment"}
                                          className={`rounded-full px-2 py-0.5 text-[11px] font-semibold transition hover:opacity-70 ${tagColor}`}
                                        >
                                          {tagLabel} ↻
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>

                            {interestTxns.length > 0 && (
                              <div className="border-t border-red-50">
                                <div className="flex items-center gap-2 px-5 py-2 bg-red-50/60">
                                  <svg className="h-3 w-3 text-red-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                  </svg>
                                  <p className="text-[10px] font-semibold uppercase tracking-wider text-red-400">Interest charges — cost of debt</p>
                                </div>
                                <div className="divide-y divide-gray-50">
                                  {interestTxns
                                    .slice()
                                    .sort((a, b) => b.amount - a.amount)
                                    .map((tx, i) => (
                                      <div key={i} className="flex items-center gap-3 px-5 py-2.5">
                                        <div className="min-w-0 flex-1">
                                          <p className="text-sm font-medium text-gray-700 truncate">{tx.merchant ?? "Interest"}</p>
                                          {tx.date && <p className="text-[11px] text-gray-400">{tx.date}{tx.accountLabel ? ` · ${tx.accountLabel}` : ""}</p>}
                                        </div>
                                        <p className="text-sm font-semibold text-red-500 tabular-nums shrink-0">{fmt(tx.amount)}</p>
                                      </div>
                                    ))}
                                </div>
                              </div>
                            )}

                            {paymentsMade > 0 && (
                              <div className="flex items-center gap-2 px-5 py-3 bg-blue-50/50 border-t border-blue-100/50">
                                <svg className="h-3.5 w-3.5 text-blue-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                                <p className="text-[11px] text-blue-700">
                                  {fmt(paymentsMade)} received by your CC / loan accounts — offsets the payments above.
                                </p>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {/* ── Transfers collapsible (secondary) ────────────────────── */}
                  {transferTotal > 0 && (
                    <div className="rounded-xl border border-gray-100 bg-gray-50 overflow-hidden">
                      <button
                        onClick={() => setTransferSectionOpen((v) => !v)}
                        className="flex w-full items-center justify-between px-5 py-3 hover:bg-gray-100/60 transition"
                      >
                        <div className="flex items-center gap-2">
                          <svg className="h-3.5 w-3.5 text-gray-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                          </svg>
                          <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">Transfers</span>
                          <span className="text-xs text-gray-400">not counted above</span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-xs font-semibold text-gray-500 tabular-nums">{fmt(transferTotal)}</span>
                          <svg
                            className={`h-3.5 w-3.5 text-gray-400 transition-transform ${transferSectionOpen ? "rotate-180" : ""}`}
                            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                          </svg>
                        </div>
                      </button>
                      {transferSectionOpen && (
                        <div className="border-t border-gray-200 divide-y divide-gray-50">
                          {transferTxns
                            .slice()
                            .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))
                            .map((tx, i) => (
                              <div key={i} className="flex items-center justify-between px-5 py-2.5 bg-white">
                                <div className="min-w-0">
                                  <p className="text-sm text-gray-700 truncate">{tx.merchant ?? "Transfer"}</p>
                                  {tx.date && <p className="text-[11px] text-gray-400">{tx.date}</p>}
                                </div>
                                <p className="text-sm text-gray-600 tabular-nums shrink-0 ml-4">{fmt(tx.amount)}</p>
                              </div>
                            ))}
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}

              {categories.length > 0 && (() => {
                const COLLAPSE_CAT = 5;
                const pieData = categories.map((cat) => ({
                  name: cat.name,
                  value: cat.amount,
                  color: categoryColor(cat.name),
                }));
                const visibleCats = catExpanded ? categories : categories.slice(0, COLLAPSE_CAT);
                const hiddenCount = Math.max(0, categories.length - COLLAPSE_CAT);
                return (
                  <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
                    {/* Donut chart */}
                    <div className="px-5 pt-5 pb-2">
                      <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">By Category</p>
                      <div className="relative h-52">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart style={{ outline: "none" }}>
                            <Pie
                              data={pieData}
                              cx="50%"
                              cy="50%"
                              innerRadius="52%"
                              outerRadius="76%"
                              dataKey="value"
                              paddingAngle={2}
                              stroke="none"
                            >
                              {pieData.map((entry) => (
                                <Cell key={entry.name} fill={entry.color} />
                              ))}
                            </Pie>
                            <Tooltip
                              formatter={(value, name) => [fmt(Number(value)), String(name)]}
                              contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e5e7eb" }}
                            />
                          </PieChart>
                        </ResponsiveContainer>
                        {/* Centre label */}
                        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                          <p className="text-[11px] text-gray-400">Total</p>
                          <p className="text-lg font-bold text-gray-900 tabular-nums">
                            {(() => {
                              const sym = getCurrencySymbol();
                              const abs = Math.abs(displayTotal);
                              if (abs >= 1_000_000) return `${sym}${(abs / 1_000_000).toFixed(1)}M`;
                              if (abs >= 10_000)    return `${sym}${Math.round(abs / 1_000)}k`;
                              if (abs >= 1_000)     return `${sym}${(abs / 1_000).toFixed(1)}k`;
                              return fmt(displayTotal);
                            })()}
                          </p>
                          {categories.length > 0 && (
                            <p className="text-[11px] text-gray-400">{categories.length} cats</p>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Category rows */}
                    <div className="divide-y divide-gray-100 border-t border-gray-100">
                      {visibleCats.map((cat) => {
                        const color      = categoryColor(cat.name);
                        const hasSubs    = cat.subtypes && cat.subtypes.length > 0;
                        const isRowOpen  = expandedCatRows.has(cat.name);
                        const catHref    = `/account/spending/category/${encodeURIComponent(cat.name.toLowerCase())}${filterMonth ? `?month=${filterMonth}` : ""}`;
                        return (
                          <div key={cat.name}>
                            {/* Parent row */}
                            <div className="flex items-center gap-0 group hover:bg-gray-50 transition">
                              <Link href={catHref} className="flex flex-1 items-center gap-4 px-5 py-3 min-w-0">
                                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center justify-between mb-1">
                                    <span className="text-sm font-medium text-gray-800 group-hover:text-purple-600 transition-colors">{cat.name}</span>
                                    <div className="flex items-center gap-2 shrink-0">
                                      <span className="text-sm font-semibold text-gray-700 tabular-nums">{fmt(cat.amount)}</span>
                                      <span className="text-xs text-gray-400 w-8 text-right">{cat.percentage}%</span>
                                    </div>
                                  </div>
                                  <div className="h-1 overflow-hidden rounded-full bg-gray-100">
                                    <div className="h-full rounded-full" style={{ width: `${Math.min(cat.percentage, 100)}%`, backgroundColor: color }} />
                                  </div>
                                </div>
                              </Link>
                              {/* Expand/collapse subtypes button */}
                              {hasSubs ? (
                                <button
                                  onClick={() => setExpandedCatRows((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(cat.name)) next.delete(cat.name); else next.add(cat.name);
                                    return next;
                                  })}
                                  className="shrink-0 px-3 py-3 text-gray-300 hover:text-gray-500 transition"
                                  title={isRowOpen ? "Hide breakdown" : "Show breakdown"}
                                >
                                  <svg className={`h-4 w-4 transition-transform ${isRowOpen ? "rotate-180" : ""}`}
                                    fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                                  </svg>
                                </button>
                              ) : (
                                <Link href={catHref} className="shrink-0 px-3 py-3">
                                  <svg className="h-4 w-4 text-gray-300 group-hover:text-purple-400 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                                  </svg>
                                </Link>
                              )}
                            </div>

                            {/* Subtype rows (expanded) */}
                            {hasSubs && isRowOpen && (
                              <div className="border-t border-gray-50 bg-gray-50/60">
                                {cat.subtypes.map((sub) => {
                                  const subColor = categoryColor(sub.name);
                                  const subPct   = cat.amount > 0 ? Math.round((sub.amount / cat.amount) * 100) : 0;
                                  const isRemainder = sub.name.startsWith("Other ");
                                  const subHref  = `/account/spending/category/${encodeURIComponent(sub.name.toLowerCase())}${filterMonth ? `?month=${filterMonth}` : ""}`;
                                  const rowContent = (
                                    <>
                                      <span className="h-1.5 w-1.5 shrink-0 rounded-full opacity-50" style={{ backgroundColor: subColor }} />
                                      <span className={`flex-1 text-[13px] truncate ${isRemainder ? "text-gray-400 italic" : "text-gray-600 group-hover/sub:text-purple-600 transition-colors"}`}>{sub.name}</span>
                                      <span className="text-[13px] text-gray-500 tabular-nums shrink-0">{fmt(sub.amount)}</span>
                                      <span className="text-xs text-gray-400 w-7 text-right shrink-0">{subPct}%</span>
                                      {!isRemainder && (
                                        <svg className="h-3.5 w-3.5 text-gray-300 group-hover/sub:text-purple-400 transition-colors shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                                        </svg>
                                      )}
                                    </>
                                  );
                                  return isRemainder ? (
                                    <div key={sub.name} className="flex items-center gap-3 pl-10 pr-5 py-2.5">
                                      {rowContent}
                                    </div>
                                  ) : (
                                    <Link key={sub.name} href={subHref}
                                      className="flex items-center gap-3 pl-10 pr-5 py-2.5 hover:bg-gray-100 transition group/sub">
                                      {rowContent}
                                    </Link>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {/* Expand / collapse */}
                    {hiddenCount > 0 && (
                      <button
                        onClick={() => setCatExpanded((v) => !v)}
                        className="flex w-full items-center justify-center gap-1.5 border-t border-gray-100 py-3 text-xs font-medium text-gray-400 hover:bg-gray-50 hover:text-gray-600 transition"
                      >
                        {catExpanded ? "Show less" : `Show ${hiddenCount} more`}
                        <svg
                          className={`h-3.5 w-3.5 transition-transform ${catExpanded ? "rotate-180" : ""}`}
                          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                    )}
                  </div>
                );
              })()}
            </div>
          )}

          {/* ── Cash overview callout in Overview tab ─────────────────────── */}
          {activeTab === "overview" && cashItems.length > 0 && (
            <div className="mt-1">
              <button
                onClick={() => switchTab("cash")}
                className="w-full flex items-center justify-between rounded-xl border border-amber-100 bg-amber-50 px-5 py-3.5 hover:bg-amber-100/60 transition group"
              >
                <div className="flex items-center gap-2.5">
                  <svg className="h-4 w-4 text-amber-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
                  </svg>
                  <div className="text-left">
                    <p className="text-sm font-medium text-amber-800">Cash spending</p>
                    <p className="text-xs text-amber-600">{cashItems.length} commitment{cashItems.length !== 1 ? "s" : ""} — not on your statement</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-amber-800">{fmt(cashMonthlyTotal)}/mo</span>
                  <svg className="h-4 w-4 text-amber-400 group-hover:text-amber-600 transition" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </button>
            </div>
          )}
          {activeTab === "transactions" && (
            <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
              {txns.length === 0 ? (
                <p className="px-5 py-10 text-center text-sm text-gray-400">No transactions found for this month.</p>
              ) : (() => {
                // Filter to calendar month by default; billing periods can span prior month
                const filteredTxns = showAllTxns
                  ? txns
                  : txns.filter((t) => !t.date || t.date.startsWith(selectedMonth ?? yearMonth ?? ""));
                const hiddenCount = txns.length - filteredTxns.length;
                // Apply sort
                const visibleTxns = [...filteredTxns].sort((a, b) => {
                  if (txnSort.field === "date") {
                    const cmp = (a.date ?? "").localeCompare(b.date ?? "");
                    return txnSort.dir === "desc" ? -cmp : cmp;
                  } else {
                    const cmp = Math.abs(a.amount) - Math.abs(b.amount);
                    return txnSort.dir === "desc" ? -cmp : cmp;
                  }
                });
                function SortBtn({ field, label }: { field: "date" | "amount"; label: string }) {
                  const active = txnSort.field === field;
                  return (
                    <button
                      onClick={() => setTxnSort((s) =>
                        s.field === field ? { field, dir: s.dir === "desc" ? "asc" : "desc" } : { field, dir: "desc" }
                      )}
                      className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-xs font-medium transition ${
                        active ? "bg-gray-100 text-gray-700" : "text-gray-400 hover:text-gray-600"
                      }`}
                    >
                      {label}
                      {active && (
                        <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round"
                            d={txnSort.dir === "desc" ? "M19 9l-7 7-7-7" : "M5 15l7-7 7 7"} />
                        </svg>
                      )}
                    </button>
                  );
                }
                return (
                <>
                  <div className="flex items-center justify-between px-5 pt-4 pb-1 gap-2">
                    <p className="text-xs text-gray-400 min-w-0 truncate">
                      Tap the category pill to recategorise · tap ↻ to mark as recurring
                    </p>
                    <div className="flex shrink-0 items-center gap-1">
                      <span className="text-xs text-gray-400">Sort:</span>
                      <SortBtn field="date" label="Date" />
                      <SortBtn field="amount" label="Amount" />
                      {hiddenCount > 0 && !showAllTxns && (
                        <button
                          onClick={() => setShowAllTxns(true)}
                          className="ml-1 text-xs text-blue-500 hover:underline"
                        >
                          +{hiddenCount} from billing period
                        </button>
                      )}
                      {showAllTxns && hiddenCount > 0 && (
                        <button
                          onClick={() => setShowAllTxns(false)}
                          className="ml-1 text-xs text-gray-400 hover:underline"
                        >
                          This month only
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="divide-y divide-gray-100">
                    {visibleTxns.map((txn, i) => {
                      const color = categoryColor(txn.category ?? "other");
                      const slug = merchantSlug(txn.merchant);
                      // AI recurring: either the subscriptions list OR a per-transaction recurring tag
                      const isAiSub        = aiSubSlugs.has(slug) || !!txn.recurring;
                      const aiFreq         = txn.recurring ?? resolvedFrequency(txn.merchant, "monthly");
                      const isManualSub    = recurringRules.has(slug);
                      const isNeverRule    = recurringRules.get(slug)?.frequency === "never";
                      const isManualActive = isManualSub && !isNeverRule;
                      const isRecurring    = isAiSub || isManualActive;
                      return (
                        <div key={i} className="flex items-center justify-between px-5 py-3.5">
                          <div className="min-w-0 flex-1">
                            <Link
                              href={`/account/spending/merchant/${encodeURIComponent(merchantSlug(txn.merchant))}`}
                              className="block truncate text-sm font-medium text-gray-800 hover:text-purple-600 hover:underline"
                            >
                              {txn.merchant}
                            </Link>
                            <div className="mt-1 flex items-center gap-2 flex-wrap">
                              {txn.date && <span className="text-xs text-gray-400">{fmtDate(txn.date)}</span>}
                              {txn.accountLabel && (
                                <span className="text-xs text-gray-400 bg-gray-100 rounded px-1.5 py-0.5">{txn.accountLabel}</span>
                              )}
                              {txn.category && (
                                <>
                                  <button
                                    ref={(el) => { if (el) btnRefs.current.set(i, el); else btnRefs.current.delete(i); }}
                                    onClick={() => setOpenPicker(openPicker === i ? null : i)}
                                    className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-xs font-medium text-gray-600 transition hover:border-purple-300 hover:bg-purple-50 hover:text-purple-700"
                                  >
                                    <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
                                    {txn.category}
                                    <svg className="h-3 w-3 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                                    </svg>
                                  </button>
                                  {openPicker === i && btnRefs.current.has(i) && (
                                    <CategoryPicker
                                      anchorRef={{ current: btnRefs.current.get(i)! }}
                                      current={txn.category}
                                      onSelect={(cat) => handleCategoryChange(i, cat)}
                                      onClose={() => setOpenPicker(null)}
                                    />
                                  )}
                                </>
                              )}
                              {/* Recurring badge / toggle
                                  1. Manual active (user rule, not "never")  → purple, click to remove
                                  2. AI-detected, not dismissed               → teal, click to override/dismiss
                                  3. Dismissed ("never" rule)                 → muted, click to undo
                                  4. Neither                                  → faint add button */}
                              {(() => {
                                const manualFreq = resolvedFrequency(txn.merchant, "monthly");
                                const manualFreqLabel = manualFreq !== "monthly" ? manualFreq : null;
                                if (isManualActive) {
                                  return (
                                    <button
                                      onClick={(e) => handleRecurringToggle(txn, e.currentTarget)}
                                      title="Remove from recurring"
                                      className="inline-flex items-center gap-1 rounded-full border border-purple-200 bg-purple-50 px-2 py-0.5 text-xs font-medium text-purple-600 transition hover:border-purple-300"
                                    >
                                      <RecurringIcon active={true} />
                                      {manualFreqLabel ?? "recurring"}
                                    </button>
                                  );
                                }
                                if (isAiSub && !isNeverRule) {
                                  return (
                                    <button
                                      onClick={(e) => handleRecurringToggle(txn, e.currentTarget)}
                                      title="Auto-detected as recurring — click to change frequency or dismiss"
                                      className="inline-flex items-center gap-1 rounded-full border border-teal-200 bg-teal-50 px-2 py-0.5 text-xs font-medium text-teal-600 transition hover:border-teal-300"
                                    >
                                      <RecurringIcon active={true} />
                                      {aiFreq !== "monthly" ? aiFreq : "recurring"}
                                    </button>
                                  );
                                }
                                if (isNeverRule) {
                                  return (
                                    <button
                                      onClick={(e) => handleRecurringToggle(txn, e.currentTarget)}
                                      title="Marked as not recurring — click to undo"
                                      className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-xs font-medium text-gray-400 transition hover:border-gray-300 line-through"
                                    >
                                      not recurring
                                    </button>
                                  );
                                }
                                return (
                                  <button
                                    onClick={(e) => handleRecurringToggle(txn, e.currentTarget)}
                                    title="Mark as recurring"
                                    className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-xs font-medium text-gray-400 transition hover:border-purple-200 hover:bg-purple-50 hover:text-purple-500"
                                  >
                                    <RecurringIcon active={false} />
                                    ↻
                                  </button>
                                );
                              })()}
                            </div>
                          </div>
                          <div className="ml-4 flex items-center gap-2 shrink-0">
                            <p className="text-sm font-medium text-gray-700 tabular-nums">
                              −{fmtDec(Math.abs(txn.amount))}
                            </p>
                            <button
                              onClick={() => handleIgnoreTx(txn)}
                              title="Hide this transaction"
                              className="text-gray-300 hover:text-red-400 transition text-base leading-none"
                            >
                              ✕
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {ignoredTxKeys.size > 0 && (
                    <p className="px-5 py-2 text-[11px] text-gray-400 border-t border-gray-100">
                      {ignoredTxKeys.size} transaction{ignoredTxKeys.size !== 1 ? "s" : ""} hidden ·{" "}
                      <button
                        className="underline hover:text-gray-600"
                        onClick={async () => {
                          setIgnoredTxKeys(new Set());
                          if (uid) {
                            const { db } = getFirebaseClient();
                            await setDoc(doc(db, `users/${uid}/prefs/ignoredTxs`), { keys: [] });
                          }
                        }}
                      >
                        show all
                      </button>
                    </p>
                  )}
                </>
                );
              })()}
            </div>
          )}

          {/* ── By Merchant tab ───────────────────────────────────────── */}
          {activeTab === "merchants" && (
            <div className="space-y-4">
              {merchantsLoading ? (
                <div className="flex justify-center py-16">
                  <div className="h-8 w-8 animate-spin rounded-full border-4 border-purple-200 border-t-purple-600" />
                </div>
              ) : !merchants || merchants.length === 0 ? (
                <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-10 text-center">
                  <p className="text-sm text-gray-500">No merchant data yet.</p>
                </div>
              ) : (
                <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
                  {/* Search bar */}
                  <div className="px-5 pt-4 pb-3 border-b border-gray-100">
                    <div className="relative">
                      <svg className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 115 11a6 6 0 0112 0z" />
                      </svg>
                      <input
                        type="text"
                        placeholder="Search merchants…"
                        value={merchantSearch}
                        onChange={(e) => setMerchantSearch(e.target.value)}
                        className="w-full rounded-lg border border-gray-200 bg-gray-50 py-2 pl-9 pr-4 text-sm text-gray-800 placeholder-gray-400 focus:border-purple-400 focus:bg-white focus:outline-none focus:ring-1 focus:ring-purple-400"
                      />
                    </div>
                  </div>
                  {/* Column headers */}
                  <div className="grid grid-cols-12 gap-2 px-5 py-2 text-xs font-medium text-gray-400 border-b border-gray-100">
                    <div className="col-span-5">Merchant</div>
                    <div className="col-span-2 text-center">Visits</div>
                    <div className="col-span-2 text-right">Avg/visit</div>
                    <div className="col-span-3 text-right">Total</div>
                  </div>
                  {/* Rows */}
                  <div className="divide-y divide-gray-100">
                    {merchants
                      .filter((m) =>
                        !merchantSearch ||
                        m.name.toLowerCase().includes(merchantSearch.toLowerCase()) ||
                        m.category.toLowerCase().includes(merchantSearch.toLowerCase())
                      )
                      .map((m) => {
                        const color = categoryColor(m.category);
                        const maxTotal = merchants[0]?.total ?? 1;
                        const barPct = Math.round((m.total / maxTotal) * 100);
                        return (
                          <Link
                            key={m.slug}
                            href={`/account/spending/merchant/${encodeURIComponent(m.slug)}`}
                            className="grid grid-cols-12 gap-2 items-center px-5 py-3 transition hover:bg-gray-50"
                          >
                            <div className="col-span-5 min-w-0">
                              <p className="truncate text-sm font-medium text-gray-800">{m.name}</p>
                              <div className="mt-1 flex items-center gap-1.5">
                                <span
                                  className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] capitalize font-medium"
                                  style={{ backgroundColor: color + "18", color }}
                                >
                                  {m.category}
                                </span>
                                {/* spend bar */}
                                <div className="h-1.5 flex-1 rounded-full bg-gray-100 overflow-hidden max-w-[60px]">
                                  <div
                                    className="h-full rounded-full"
                                    style={{ width: `${barPct}%`, backgroundColor: color + "88" }}
                                  />
                                </div>
                              </div>
                            </div>
                            <div className="col-span-2 text-center text-sm text-gray-600">{m.count}</div>
                            <div className="col-span-2 text-right text-sm text-gray-600 tabular-nums">
                              {fmt(m.avgAmount)}
                            </div>
                            <div className="col-span-3 text-right">
                              <span className="text-sm font-semibold text-gray-800 tabular-nums">
                                {fmt(m.total)}
                              </span>
                              <svg className="ml-1 inline h-3.5 w-3.5 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                              </svg>
                            </div>
                          </Link>
                        );
                      })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Recurring tab ─────────────────────────────────────────── */}
          {activeTab === "subscriptions" && (
            <div className="space-y-4">
              {allSubscriptions.length === 0 ? (
                <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-10 text-center">
                  <p className="text-sm text-gray-500">No recurring charges yet.</p>
                  <p className="mt-1 text-xs text-gray-400">
                    Go to the Transactions tab and tap ↻ on any transaction to mark it as recurring.
                  </p>
                </div>
              ) : (
                <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
                  <div className="flex items-center gap-3 px-5 pt-5 pb-3">
                    <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Recurring charges</p>
                    {subsYearly > 0 && (
                      <span className="rounded-md bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">
                        {fmt(subsYearly)}/yr
                      </span>
                    )}
                  </div>
                  <div className="divide-y divide-gray-100">
                    {allSubscriptions.map((sub) => {
                      const monthly = sub.frequency === "annual" ? sub.amount / 12 : sub.amount;
                      const yearly  = monthly * 12;
                      const slug    = merchantSlug(sub.name);
                      return (
                        <div key={sub.name} className="flex items-center gap-3 px-5 py-3.5">
                          <RecurringListIcon name={sub.name} />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <p className="text-sm font-medium text-gray-800">{sub.name}</p>
                              {sub.source === "ai" ? (
                                <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-400">auto-detected</span>
                              ) : (
                                <span className="rounded-full bg-purple-50 px-1.5 py-0.5 text-[10px] font-medium text-purple-500">manual</span>
                              )}
                            </div>
                            <p className="text-xs text-gray-400">
                              {sub.detectedFrequency}
                              {sub.detectedFrequency !== (sub.frequency ?? "monthly") && (
                                <span className="ml-1 text-teal-500">(detected)</span>
                              )}
                            </p>
                          </div>
                          <div className="flex items-center gap-3 shrink-0">
                            <div className="text-right">
                              <p className="text-sm font-medium text-gray-800">{fmtDec(sub.amount)}</p>
                              {yearly !== sub.amount && (
                                <p className="text-xs text-gray-400">{fmt(yearly)}/yr</p>
                              )}
                            </div>
                            {/* Only allow removing manually-added ones */}
                            {sub.source === "manual" && (
                              <button
                                onClick={async () => {
                                  if (!token) return;
                                  setRecurringRules((prev) => { const next = new Map(prev); next.delete(slug); return next; });
                                  await fetch(`/api/user/recurring-rules?slug=${encodeURIComponent(slug)}`, {
                                    method: "DELETE", headers: { Authorization: `Bearer ${token}` },
                                  });
                                }}
                                className="text-xs text-red-400 hover:text-red-600 transition"
                                title="Remove"
                              >
                                ✕
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <p className="text-xs text-gray-400 px-1">
                <span className="font-medium text-gray-500">Auto-detected</span> entries come from your statement.{" "}
                <span className="font-medium text-gray-500">Manual</span> entries are ones you&apos;ve tagged as recurring in the Transactions tab.
              </p>
            </div>
          )}

          {/* ── Cash tab ──────────────────────────────────────────────────── */}
          {activeTab === "cash" && (
            <div className="space-y-4">
              {/* Header row */}
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-700">Recurring cash spending</p>
                  <p className="text-xs text-gray-400 mt-0.5">Track payments that never appear on your bank statement.</p>
                </div>
                <button
                  onClick={() => setCashForm({ frequency: "monthly", category: "Other", startDate: monthsAgoYm(0) })}
                  className="flex items-center gap-1.5 rounded-lg bg-purple-600 px-3 py-2 text-xs font-semibold text-white hover:bg-purple-700 transition"
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                  </svg>
                  Add
                </button>
              </div>

              {/* Monthly estimate banner */}
              {cashItems.length > 0 && (
                <div className="rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 flex items-center justify-between">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-amber-600">Est. monthly cash</p>
                    <p className="text-2xl font-bold text-amber-800 mt-1">{fmt(cashMonthlyTotal)}</p>
                    {cashItems.some((c) => c.frequency === "once") && (
                      <p className="text-[11px] text-amber-500 mt-0.5">recurring only — one-offs excluded</p>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-amber-600">{cashItems.length} item{cashItems.length !== 1 ? "s" : ""}</p>
                    <p className="text-xs text-amber-500 mt-0.5">{fmt(cashMonthlyTotal * 12)}/yr</p>
                  </div>
                </div>
              )}

              {/* ATM correlation */}
              {(() => {
                const atmTxns = txns.filter((t) => (t.category ?? "").toLowerCase() === "cash & atm");
                const atmTotal = atmTxns.reduce((s, t) => s + t.amount, 0);
                if (atmTotal === 0 || cashItems.length === 0) return null;
                const unaccounted = atmTotal - cashMonthlyTotal;
                return (
                  <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">ATM withdrawals this month</p>
                    <div className="flex items-center gap-4 text-sm">
                      <div>
                        <p className="text-xs text-gray-400">Withdrawn</p>
                        <p className="font-semibold text-gray-800">{fmt(atmTotal)}</p>
                      </div>
                      <div className="text-gray-200">|</div>
                      <div>
                        <p className="text-xs text-gray-400">Tracked cash</p>
                        <p className="font-semibold text-gray-800">{fmt(cashMonthlyTotal)}</p>
                      </div>
                      <div className="text-gray-200">|</div>
                      <div>
                        <p className="text-xs text-gray-400">Unaccounted</p>
                        <p className={`font-semibold ${unaccounted > 0 ? "text-amber-600" : "text-green-600"}`}>
                          {fmt(Math.max(0, unaccounted))}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Empty state */}
              {cashItems.length === 0 && !cashLoading && (
                <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-10 text-center">
                  <p className="text-sm text-gray-500">No cash commitments yet.</p>
                  <p className="mt-1 text-xs text-gray-400">
                    Add recurring cash expenses like house cleaning, allowances, or market trips.
                  </p>
                </div>
              )}

              {/* List */}
              {cashItems.length > 0 && (
                <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
                  <div className="divide-y divide-gray-100">
                    {cashItems.map((item) => {
                      const isOnce = item.frequency === "once";
                      const monthly = toMonthly(item.amount, item.frequency);
                      const freqLabel = CASH_FREQ_OPTIONS.find((o) => o.value === item.frequency)?.label ?? item.frequency;

                      // Shared date display logic
                      const dateDisplay = item.nextDate ? (() => {
                        const today = new Date();
                        today.setHours(0, 0, 0, 0);
                        const d = new Date(item.nextDate + "T00:00:00");
                        const diff = Math.round((d.getTime() - today.getTime()) / 86400000);
                        const timeLabel = diff === 0 ? "Today"
                          : diff === 1 ? "Tomorrow"
                          : diff < 0  ? `${Math.abs(diff)}d overdue`
                          : `in ${diff}d`;
                        const cls = diff < 0 ? "text-red-500" : diff <= 2 ? "text-amber-500" : "text-gray-400";
                        return { d, diff, timeLabel, cls };
                      })() : null;

                      return (
                        <div key={item.id} className={`flex items-center justify-between px-5 py-3.5 ${isOnce ? "bg-gray-50/50" : ""}`}>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="text-sm font-medium text-gray-800">{item.name}</p>
                              {isOnce && (
                                <span className="rounded-full bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-500">one-off</span>
                              )}
                            </div>
                            <p className="text-xs text-gray-400 mt-0.5">
                              {isOnce ? item.category : `${freqLabel} · ${item.category}`}
                              {item.notes && <span className="ml-2 text-gray-300">— {item.notes}</span>}
                            </p>
                            {dateDisplay && (
                              <p className={`text-xs mt-0.5 ${dateDisplay.cls}`}>
                                {isOnce ? "" : "Next: "}
                                {dateDisplay.d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                                {" "}— {dateDisplay.timeLabel}
                              </p>
                            )}
                          </div>
                          <div className="flex items-center gap-3 shrink-0">
                            <div className="text-right">
                              <p className="text-sm font-semibold text-gray-800">{fmtDec(item.amount)}</p>
                              {!isOnce && item.frequency !== "monthly" && (
                                <p className="text-xs text-gray-400">{fmt(monthly)}/mo</p>
                              )}
                              {isOnce && (
                                <p className="text-xs text-gray-400">one-time</p>
                              )}
                            </div>
                            <button
                              onClick={() => setCashForm({ ...item })}
                              className="text-xs text-gray-400 hover:text-gray-600 transition px-1"
                              title="Edit"
                            >
                              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536M9 11l6-6 3 3-6 6H9v-3z" />
                              </svg>
                            </button>
                            <button
                              onClick={() => handleCashDelete(item.id)}
                              className="text-xs text-red-400 hover:text-red-600 transition"
                              title="Remove"
                            >
                              ✕
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <p className="text-xs text-gray-400 px-1">
                Cash commitments are estimates and are not included in your statement totals.
              </p>

              {/* Add / Edit form modal */}
              {cashForm !== null && (
                <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/30 px-4">
                  <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
                    <h3 className="text-base font-semibold text-gray-900 mb-4">
                      {cashForm.id ? "Edit commitment" : "Add cash commitment"}
                    </h3>
                    <div className="space-y-3">
                      <div>
                        <label className="text-xs font-medium text-gray-500 mb-1 block">Name *</label>
                        <input
                          type="text"
                          placeholder="e.g. House cleaning"
                          value={cashForm.name ?? ""}
                          onChange={(e) => setCashForm((f) => ({ ...f, name: e.target.value }))}
                          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-purple-400 focus:outline-none focus:ring-1 focus:ring-purple-200"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-xs font-medium text-gray-500 mb-1 block">Amount *</label>
                          <input
                            type="number"
                            min={0}
                            step={0.01}
                            placeholder="0.00"
                            value={cashForm.amount ?? ""}
                            onChange={(e) => setCashForm((f) => ({ ...f, amount: parseFloat(e.target.value) || 0 }))}
                            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-purple-400 focus:outline-none focus:ring-1 focus:ring-purple-200"
                          />
                        </div>
                        <div>
                          <label className="text-xs font-medium text-gray-500 mb-1 block">Frequency *</label>
                          <select
                            value={cashForm.frequency ?? "monthly"}
                            onChange={(e) => setCashForm((f) => ({ ...f, frequency: e.target.value as CashFrequency }))}
                            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-purple-400 focus:outline-none focus:ring-1 focus:ring-purple-200"
                          >
                            {CASH_FREQ_OPTIONS.map((o) => (
                              <option key={o.value} value={o.value}>{o.label}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                      <div>
                        <label className="text-xs font-medium text-gray-500 mb-1 block">Category *</label>
                        <button
                          ref={cashCatBtnRef}
                          type="button"
                          onClick={() => setCashCatPickerOpen((v) => !v)}
                          className="w-full flex items-center justify-between rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 hover:border-purple-300 focus:border-purple-400 focus:outline-none focus:ring-1 focus:ring-purple-200"
                        >
                          <span className="flex items-center gap-2">
                            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: categoryColor(cashForm.category ?? "Other") }} />
                            {cashForm.category ?? "Other"}
                          </span>
                          <svg className="h-3.5 w-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                          </svg>
                        </button>
                        {cashCatPickerOpen && (
                          <CategoryPicker
                            anchorRef={cashCatBtnRef}
                            current={cashForm.category ?? "Other"}
                            onSelect={(cat) => { setCashForm((f) => ({ ...f, category: cat })); setCashCatPickerOpen(false); }}
                            onClose={() => setCashCatPickerOpen(false)}
                          />
                        )}
                      </div>
                      <div>
                        <label className="text-xs font-medium text-gray-500 mb-1 block">Notes (optional)</label>
                        <input
                          type="text"
                          placeholder="e.g. Every other Friday"
                          value={cashForm.notes ?? ""}
                          onChange={(e) => setCashForm((f) => ({ ...f, notes: e.target.value || undefined }))}
                          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-purple-400 focus:outline-none focus:ring-1 focus:ring-purple-200"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-gray-500 mb-1 block">
                          {cashForm.frequency === "once" ? "Date *" : "Next date (optional)"}
                        </label>
                        <input
                          type="date"
                          value={cashForm.nextDate ?? ""}
                          onChange={(e) => setCashForm((f) => ({ ...f, nextDate: e.target.value || undefined }))}
                          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-purple-400 focus:outline-none focus:ring-1 focus:ring-purple-200"
                        />
                        {cashForm.frequency !== "once" && (
                          <p className="mt-1 text-[11px] text-gray-400">When the next payment is due — helps track upcoming cash outflows.</p>
                        )}
                      </div>
                      {/* When did this start? — only for recurring entries */}
                      {cashForm.frequency && cashForm.frequency !== "once" && (
                        <div>
                          <label className="text-xs font-medium text-gray-500 mb-1 block">When did this start?</label>
                          <div className="flex flex-wrap gap-1.5 mb-2">
                            {START_DATE_PRESETS.map((p) => {
                              const v = p.value();
                              return (
                                <button
                                  key={p.label}
                                  type="button"
                                  onClick={() => setCashForm((f) => ({ ...f, startDate: v }))}
                                  className={`rounded-full border px-2.5 py-0.5 text-xs font-medium transition ${cashForm.startDate === v ? "border-purple-500 bg-purple-50 text-purple-700" : "border-gray-200 text-gray-500 hover:border-purple-300 hover:text-purple-600"}`}
                                >
                                  {p.label}
                                </button>
                              );
                            })}
                          </div>
                          <input
                            type="month"
                            value={cashForm.startDate?.slice(0, 7) ?? ""}
                            onChange={(e) => setCashForm((f) => ({ ...f, startDate: e.target.value || undefined }))}
                            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-purple-400 focus:outline-none focus:ring-1 focus:ring-purple-200"
                          />
                          <p className="mt-1 text-[11px] text-gray-400">Used to backfill historical spending totals.</p>
                        </div>
                      )}
                      {/* Monthly preview */}
                      {cashForm.amount && cashForm.frequency && cashForm.frequency !== "once" && (
                        <p className="text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2">
                          ≈ {fmt(toMonthly(cashForm.amount, cashForm.frequency as CashFrequency))}/mo · {fmt(toMonthly(cashForm.amount, cashForm.frequency as CashFrequency) * 12)}/yr
                        </p>
                      )}
                    </div>
                    <div className="mt-5 flex gap-2">
                      <button
                        onClick={() => setCashForm(null)}
                        className="flex-1 rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 transition"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleCashSave}
                        disabled={cashSaving}
                        className="flex-1 rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-700 disabled:opacity-50 transition"
                      >
                        {cashSaving ? "Saving…" : cashForm.id ? "Update" : "Add"}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {toast && <Toast message={toast} onDone={() => setToast(null)} />}

      {/* ── Frequency picker popover ─────────────────────────────────────── */}
      {pendingRecurring && (() => {
        const rect = pendingRecurring.anchor.getBoundingClientRect();
        const FREQS: { value: CashFrequency; label: string }[] = [
          { value: "weekly",    label: "Weekly" },
          { value: "biweekly",  label: "Bi-weekly" },
          { value: "monthly",   label: "Monthly" },
          { value: "quarterly", label: "Quarterly" },
          { value: "annual",    label: "Annual" },
        ];
        return (
          <>
            {/* Backdrop */}
            <div className="fixed inset-0 z-40" onClick={() => setPendingRecurring(null)} />
            {/* Popover */}
            <div
              className="fixed z-50 w-56 rounded-xl border border-gray-200 bg-white shadow-lg"
              style={{ top: rect.bottom + 6, left: Math.min(rect.left, window.innerWidth - 232) }}
            >
              <div className="border-b border-gray-100 px-3 py-2.5">
                <p className="text-xs font-semibold text-gray-700 truncate">{pendingRecurring.txn.merchant}</p>
                <p className="text-[11px] text-gray-400 mt-0.5">
                  {aiSubSlugs.has(merchantSlug(pendingRecurring.txn.merchant))
                    ? "Override AI detection — set frequency or dismiss"
                    : "How often does this recur?"}
                </p>
              </div>
              <div className="p-1.5 space-y-0.5">
                {FREQS.map(({ value, label }) => (
                  <button
                    key={value}
                    onClick={() => setPendingFreq(value)}
                    className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm transition ${
                      pendingFreq === value
                        ? "bg-purple-50 text-purple-700 font-medium"
                        : "text-gray-700 hover:bg-gray-50"
                    }`}
                  >
                    {label}
                    {pendingFreq === value && (
                      <svg className="h-3.5 w-3.5 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </button>
                ))}
              </div>
              <div className="border-t border-gray-100 p-2 space-y-1.5">
                <button
                  onClick={confirmRecurring}
                  className="w-full rounded-lg bg-purple-600 py-2 text-sm font-semibold text-white hover:bg-purple-700 transition"
                >
                  Mark as recurring
                </button>
                <button
                  onClick={dismissRecurring}
                  className="w-full rounded-lg border border-gray-200 py-2 text-sm font-medium text-gray-500 hover:border-red-200 hover:text-red-500 transition"
                >
                  Not recurring
                </button>
              </div>
            </div>
          </>
        );
      })()}
    </div>
  );
}

export default function SpendingPage() {
  return (
    <Suspense fallback={
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-purple-600 border-t-transparent" />
      </div>
    }>
      <SpendingPageInner />
    </Suspense>
  );
}
