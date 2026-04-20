"use client";

import { useEffect, useState, useRef, useCallback, Suspense, Fragment } from "react";
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
  ReferenceLine, ResponsiveContainer,
  AreaChart, Area,
} from "recharts";
import { CATEGORY_COLORS, categoryColor, ALL_CATEGORIES, CategoryPicker, RecurringIcon } from "./shared";
import type { CashFrequency } from "./shared";
import { getParentCategory, isSubtype, CATEGORY_TAXONOMY } from "@/lib/categoryTaxonomy";
import { fmt, getCurrencySymbol, formatCurrency } from "@/lib/currencyUtils";
import RefreshToast from "@/components/RefreshToast";
import { PROFILE_REFRESHED_EVENT, useProfileRefresh } from "@/contexts/ProfileRefreshContext";
import { FORECAST_FREQUENCY_OPTIONS } from "@/lib/merchantForecast";

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

function SpendingChart({ history, avg, median, selectedMonth, effectiveExp, homeCurrency = "USD" }: {
  history: HistoryPoint[];
  avg: number | null;
  median: number | null;
  selectedMonth: string | null;
  effectiveExp: (h: HistoryPoint) => number;
  homeCurrency?: string;
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
        <p className="text-gray-600">{formatCurrency(amount, homeCurrency, undefined, true)}</p>
      </div>
    );
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-widest text-gray-400">Monthly Spending</p>
      {median !== null && (
        <p className="mb-4 text-sm font-medium text-gray-600">
          {data.length}-month median{" "}
          <span className="font-bold text-gray-900">{formatCurrency(median, homeCurrency, undefined, true)} / mo</span>
          {avg !== null && avg !== median && (
            <span className="ml-2 text-xs text-gray-400">(avg {formatCurrency(avg, homeCurrency, undefined, true)})</span>
          )}
        </p>
      )}
      <div style={{ pointerEvents: "none" }}>
        <ResponsiveContainer width="100%" height={140}>
          <BarChart data={data} barSize={22} margin={{ top: 4, right: 4, left: -8, bottom: 0 }}>
            <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="#f3f4f6" />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#9ca3af" }} axisLine={false} tickLine={false} />
            <YAxis width={52} tick={{ fontSize: 10, fill: "#9ca3af" }} axisLine={false} tickLine={false}
              tickFormatter={(v: number) => { const s = getCurrencySymbol(homeCurrency); return v >= 1000 ? `${s}${Math.round(v / 1000)}k` : `${s}${v}`; }} />
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
  { id: "categories",     label: "By Category" },
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

// ── subscription avatar helpers ───────────────────────────────────────────────

const SUB_AVATAR_COLORS = [
  "bg-purple-100 text-purple-700",
  "bg-blue-100 text-blue-700",
  "bg-green-100 text-green-700",
  "bg-red-100 text-red-700",
  "bg-amber-100 text-amber-700",
  "bg-teal-100 text-teal-700",
  "bg-pink-100 text-pink-700",
  "bg-indigo-100 text-indigo-700",
  "bg-orange-100 text-orange-700",
  "bg-cyan-100 text-cyan-700",
];

function subAvatarColor(name: string): string {
  let hash = 0;
  for (const c of name) hash = ((hash * 31) + c.charCodeAt(0)) >>> 0;
  return SUB_AVATAR_COLORS[hash % SUB_AVATAR_COLORS.length];
}

function merchantInitials(name: string): string {
  const words = name.trim().split(/\s+/);
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + (words[1][0] ?? "")).toUpperCase();
}

function MerchantSparkline({ monthly, color, fromYm }: {
  monthly: { ym: string; total: number }[];
  color: string;
  fromYm: string;
}) {
  const pts = [...monthly].filter((m) => m.ym >= fromYm).sort((a, b) => a.ym.localeCompare(b.ym));
  if (pts.length < 2) return null;
  const max = Math.max(...pts.map((p) => p.total));
  if (max === 0) return null;
  const W = 64, H = 28, pad = 3;
  const xCoord = (i: number) => (i / (pts.length - 1)) * W;
  const yCoord = (v: number) => H - pad - ((v / max) * (H - pad * 2));
  const linePath = pts.map((p, i) => `${i === 0 ? "M" : "L"}${xCoord(i).toFixed(1)},${yCoord(p.total).toFixed(1)}`).join(" ");
  const fillPath = `${linePath} L${W},${H} L0,${H} Z`;
  return (
    <svg width={W} height={H} className="shrink-0 overflow-visible">
      <path d={fillPath} fill={color} fillOpacity={0.12} />
      <path d={linePath} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * Classify a subscription as fixed (predictable) or variable (usage-based).
 * Variable when: user confirmed a baseAmount and actual charges run ≥5% above it,
 * or when recent per-charge amounts have a coefficient of variation > 15%.
 */
function classifySubscription(
  amount: number,
  merchantMonthly: { ym: string; total: number; count: number }[] | undefined,
  baseAmount: number | null | undefined,
  ym3moAgo: string,
): "fixed" | "variable" {
  if (baseAmount != null && baseAmount > 0 && amount > baseAmount * 1.05) return "variable";
  if (merchantMonthly) {
    const recent = merchantMonthly
      .filter((m) => m.ym >= ym3moAgo && m.count > 0)
      .map((m) => m.total / m.count);
    if (recent.length >= 2) {
      const avg = recent.reduce((s, v) => s + v, 0) / recent.length;
      if (avg > 0) {
        const cv = Math.sqrt(recent.reduce((s, v) => s + (v - avg) ** 2, 0) / recent.length) / avg;
        if (cv > 0.15) return "variable";
      }
    }
  }
  return "fixed";
}

function subInitials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("").slice(0, 2) || "?";
}

/** Compute next occurrence date from last seen date + frequency. */
function nextSubDate(lastDate: string, frequency: string): { date: string; daysFromNow: number } | null {
  const freqDays: Record<string, number> = { weekly: 7, biweekly: 14, monthly: 30, quarterly: 91, annual: 365 };
  const gap = freqDays[frequency] ?? 30;
  const last = new Date(lastDate + "T12:00:00Z");
  const next = new Date(last.getTime() + gap * 86_400_000);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const daysFromNow = Math.round((next.getTime() - today.getTime()) / 86_400_000);
  return { date: next.toISOString().slice(0, 10), daysFromNow };
}

/** Find the most recent month where avg transaction amount jumped ≥4% vs prior months. */
function findHikeMonth(monthly: { ym: string; total: number; count: number }[]): string | null {
  const sorted = [...monthly].filter((m) => m.count > 0).sort((a, b) => a.ym.localeCompare(b.ym));
  if (sorted.length < 2) return null;
  let hikeMo: string | null = null;
  for (let i = 1; i < sorted.length; i++) {
    const curr = sorted[i]; const prev = sorted[i - 1];
    const currAvg = curr.total / curr.count; const prevAvg = prev.total / prev.count;
    if (currAvg > prevAvg * 1.04 && currAvg - prevAvg > 0.5) hikeMo = curr.ym;
  }
  return hikeMo;
}

/** Format a YYYY-MM string as "MMM YYYY", e.g. "2026-01" → "Jan 2026". */
function fmtYM(ym: string): string {
  const [y, m] = ym.split("-");
  if (!y || !m) return ym;
  return new Date(parseInt(y), parseInt(m) - 1, 1).toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

/** Format an ISO date as "MMM D", e.g. "2026-02-14" → "Feb 14". */
function fmtMD(iso: string): string {
  return new Date(iso + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
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

// fmtDec: two-decimal individual-transaction display in native currency.
// homeCurrency is provided at runtime from component state.
function fmtDec(v: number, originalCurrency?: string, homeCurrency = "USD") {
  const cur = originalCurrency ?? homeCurrency;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: cur, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
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

  // All-time merchants (no month filter) — loaded eagerly for Overview insight cards
  const [allTimeMerchants, setAllTimeMerchants] = useState<import("@/app/api/user/spending/merchants/route").MerchantSummary[] | null>(null);

  // By Merchant tab state
  const [merchantTimeFilter, setMerchantTimeFilter] = useState<"3mo" | "6mo" | "12mo" | "all">("12mo");
  const [mShowAllTop, setMShowAllTop] = useState(false);

  // By Category tab state
  const [catTimeFilter, setCatTimeFilter] = useState<"3mo" | "6mo" | "12mo" | "all">("12mo");
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
  const [expandedSubtypes, setExpandedSubtypes] = useState<Set<string>>(new Set());
  const [catShowTransfers, setCatShowTransfers] = useState(false);
  const [catOpenPicker, setCatOpenPicker] = useState<string | null>(null);
  const catPickerBtnRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  // Firestore subscription registry — all-time canonical list from insights pipeline
  const [firestoreSubs, setFirestoreSubs] = useState<import("@/lib/insights/types").SubscriptionRecord[] | null>(null);

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
  const [catIncludeAll, setCatIncludeAll] = useState(false);
  const [homeCurrency, setHomeCurrency] = useState<string>("USD");
  const [fxRates, setFxRates]           = useState<Record<string, number>>({});

  // ── recurring tab view state ─────────────────────────────────────────────────
  const [subViewMode, setSubViewMode] = useState<"monthly" | "annual">("monthly");
  const [subShowAll, setSubShowAll]   = useState(false);
  const [showAllChanges, setShowAllChanges] = useState(false);
  const [showAllFixed,   setShowAllFixed]   = useState(false);
  const [showAllVariable, setShowAllVariable] = useState(false);
  // ── subscription inline confirm state ────────────────────────────────────────
  const [confirmingSlug, setConfirmingSlug] = useState<string | null>(null);
  const [confirmFreq, setConfirmFreq]       = useState<string>("monthly");
  const [confirmBase, setConfirmBase]       = useState<string>("");
  const [confirmSaving, setConfirmSaving]   = useState(false);

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

  const allTimeMerchantsLoaded = useRef(false);
  const loadAllTimeMerchants = useCallback(async (tok: string) => {
    if (allTimeMerchantsLoaded.current) return;
    allTimeMerchantsLoaded.current = true;
    try {
      const res = await fetch("/api/user/spending/merchants", { headers: { Authorization: `Bearer ${tok}` } });
      const json = await res.json().catch(() => ({}));
      setAllTimeMerchants(json.merchants ?? []);
    } catch {
      allTimeMerchantsLoaded.current = false; // allow retry on error
    }
  }, []); // stable — no state deps, guard via ref

  const firestoreSubsLoaded = useRef(false);
  const loadFirestoreSubs = useCallback(async (tok: string) => {
    if (firestoreSubsLoaded.current) return;
    firestoreSubsLoaded.current = true;
    try {
      const res = await fetch("/api/user/subscriptions", { headers: { Authorization: `Bearer ${tok}` } });
      const json = await res.json().catch(() => ({}));
      setFirestoreSubs(json.subscriptions ?? []);
    } catch { firestoreSubsLoaded.current = false; /* allow retry */ }
  }, []); // stable — guard lives in a ref, not state

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
        if (json.homeCurrency) setHomeCurrency(json.homeCurrency);
        if (json.fxRates) setFxRates(json.fxRates);
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

        // Load all-time merchant data for Overview insight cards (fire and forget)
        loadAllTimeMerchants(tok).catch(() => {});
        loadFirestoreSubs(tok).catch(() => {});

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
  }, [router, loadRecurring, loadCash, loadAllTimeMerchants, loadFirestoreSubs]);

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

  async function handleMerchantCategoryChange(merchantName: string, newCategory: string) {
    if (!token) return;
    setCatOpenPicker(null);

    // Capture old category for rollback, then optimistically update the UI
    const prevCategory = allTimeMerchants?.find((m) => m.name === merchantName)?.category ?? "";
    setAllTimeMerchants((prev) =>
      prev?.map((m) => m.name === merchantName ? { ...m, category: newCategory } : m) ?? prev
    );

    try {
      const res = await fetch("/api/user/category-rules", {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ merchant: merchantName, category: newCategory }),
      });
      if (res.ok) {
        setToast(`Category updated: "${merchantName}" → ${newCategory}`);
      } else {
        setToast("Failed to save category");
        setAllTimeMerchants((prev) =>
          prev?.map((m) => m.name === merchantName ? { ...m, category: prevCategory } : m) ?? prev
        );
      }
    } catch {
      setToast("Failed to save category");
      setAllTimeMerchants((prev) =>
        prev?.map((m) => m.name === merchantName ? { ...m, category: prevCategory } : m) ?? prev
      );
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

  async function handleConfirmSub(slug: string) {
    if (!token || confirmSaving) return;
    setConfirmSaving(true);
    const baseRaw = confirmBase.replace(/[^0-9.]/g, "");
    const baseAmt = baseRaw ? parseFloat(baseRaw) : NaN;
    const hasBase = Number.isFinite(baseAmt) && baseAmt > 0;
    try {
      await fetch("/api/user/subscriptions", {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          slug,
          frequency: confirmFreq,
          ...(hasBase ? { baseAmount: baseAmt } : {}),
        }),
      });
      setFirestoreSubs((prev) =>
        prev
          ? prev.map((r) =>
              r.merchantSlug === slug
                ? {
                    ...r,
                    status: "user_confirmed" as const,
                    frequency: confirmFreq as import("@/lib/insights/types").SubscriptionFrequency,
                    ...(hasBase ? { baseAmount: baseAmt } : {}),
                    lockedFields: Array.from(
                      new Set([...(r.lockedFields ?? []), "frequency", ...(hasBase ? ["baseAmount"] : [])])
                    ),
                  }
                : r
            )
          : prev
      );
      setConfirmingSlug(null);
      setToast("Subscription confirmed");
    } catch {
      setToast("Failed to save");
    } finally {
      setConfirmSaving(false);
    }
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

  // ── Canonical subscription list ──────────────────────────────────────────────
  // Primary source: Firestore users/{uid}/subscriptions (all-time, maintained by
  // insights pipeline). Falls back to current-month statement AI subs when the
  // Firestore collection is still loading or empty.
  const statementSubs: Subscription[] = data?.subscriptions ?? [];

  const effectiveSubs: Subscription[] = (() => {
    if (!firestoreSubs) return statementSubs; // still loading — use statement fallback
    if (firestoreSubs.length === 0) return statementSubs; // empty registry — fallback
    // Map SubscriptionRecord → Subscription shape
    return firestoreSubs
      .filter((rec) => rec.name)
      .map((rec) => ({
        name:      rec.name,
        amount:    (rec.amount ?? rec.suggestedAmount) ?? 0,
        frequency: (rec.frequency ?? rec.suggestedFrequency) ?? "monthly",
      }));
  })();

  // Slug-keyed lookup for per-row status/baseAmount access without changing Subscription type
  const firestoreSubsMap = new Map(
    (firestoreSubs ?? []).map((rec) => [rec.merchantSlug, rec])
  );

  // Slug set for fast lookup in transaction rows
  const aiSubSlugs = new Set(effectiveSubs.map((s) => merchantSlug(s.name)));

  // Helper: get best known frequency for a merchant
  function resolvedFrequency(name: string, fallback: string): string {
    const slug = merchantSlug(name);
    const detected = merchantFrequency.get(slug);
    if (detected && detected !== "irregular") return FREQUENCY_CONFIG[detected].label;
    return fallback || "monthly";
  }

  // Merge Firestore subs + user-marked recurring (user-marked take precedence by slug)
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
    ...effectiveSubs
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
  // Aggregate totals — converted to home currency
  function toHomeTxn(amount: number, tx: ExpenseTransaction): number {
    const ccy = tx.currency;
    if (!ccy || ccy.toUpperCase() === homeCurrency.toUpperCase()) return amount;
    const rate = fxRates[ccy.toUpperCase()];
    return rate != null ? amount * rate : amount;
  }
  const debtTotal     = debtTxns.reduce((s, t) => s + toHomeTxn(t.amount, t), 0);
  const interestTotal = interestTxns.reduce((s, t) => s + toHomeTxn(t.amount, t), 0);
  const transferTotal = transferTxns.reduce((s, t) => s + toHomeTxn(t.amount, t), 0);

  // Convert transaction amount to home currency for aggregation (used by category builders)
  function toHomeCat(amount: number, currency?: string | null): number {
    if (!currency || currency.toUpperCase() === homeCurrency.toUpperCase()) return amount;
    const rate = fxRates[currency.toUpperCase()];
    return rate != null ? amount * rate : amount;
  }

  // Shared category builder — accepts any transaction slice
  function buildCategories(txns: typeof coreTxns, baseTotal: number) {
    const parentMap  = new Map<string, number>();
    const subtypeMap = new Map<string, Map<string, number>>();

    for (const tx of txns) {
      const cat    = tx.category || "Other";
      const parent = getParentCategory(cat);
      const amt    = toHomeCat(tx.amount, (tx as ExpenseTransaction).currency);
      parentMap.set(parent, (parentMap.get(parent) ?? 0) + amt);
      if (isSubtype(cat)) {
        if (!subtypeMap.has(parent)) subtypeMap.set(parent, new Map());
        const sm = subtypeMap.get(parent)!;
        sm.set(cat, (sm.get(cat) ?? 0) + amt);
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
        if (remainder > 0.005 && subtypeEntries.length > 0) {
          subtypeEntries.push({ name: `Other ${name}`, amount: remainder });
        }
        return {
          name,
          amount,
          percentage: baseTotal > 0 ? Math.round((amount / baseTotal) * 100) : 0,
          subtypes: subtypeEntries,
        };
      });
  }

  // categories: parent-level rollup — core only (excludes transfers & debt payments)
  const categories = (() => {
    if (coreTxns.length > 0) return buildCategories(coreTxns, total);
    // Fall back to AI-computed categories (assumed home currency)
    const parentMap = new Map<string, number>();
    for (const c of (data?.expenses?.categories ?? [])) {
      if (CORE_EXCLUDE_RE.test((c.name ?? "").trim())) continue;
      const parent = getParentCategory(c.name ?? "Other");
      parentMap.set(parent, (parentMap.get(parent) ?? 0) + c.amount);
    }
    return Array.from(parentMap.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([name, amount]) => ({
        name, amount,
        percentage: total > 0 ? Math.round((amount / total) * 100) : 0,
        subtypes: [] as { name: string; amount: number }[],
      }));
  })();

  // categoriesAll: includes transfers & debt payments
  const allTxnsTotal = monthTxns.reduce((s, t) => s + toHomeTxn(t.amount, t as ExpenseTransaction), 0) + cashCommitmentsForMonth;
  const categoriesAll = buildCategories(monthTxns, allTxnsTotal);

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

  // ── Overview insight cards ─────────────────────────────────────────────────
  const ym12moAgo = monthsAgoYm(12);
  const ym24moAgo = monthsAgoYm(24);
  const ym6moAgo  = monthsAgoYm(6);
  const ym3moAgo  = monthsAgoYm(3);

  // Card 1: Subscriptions
  const subMonthlyTotal = allSubscriptions.reduce((s, sub) => {
    return s + (sub.frequency === "annual" ? sub.amount / 12 : sub.amount);
  }, 0);

  // Card 2: Top Merchants 12 MO
  const topMerchantsData = (() => {
    if (!allTimeMerchants || allTimeMerchants.length === 0) return null;
    const withTotals = allTimeMerchants.map((m) => ({
      ...m,
      total12mo: m.monthly.filter((mo) => mo.ym >= ym12moAgo).reduce((s, mo) => s + mo.total, 0),
    })).filter((m) => m.total12mo > 0);
    if (withTotals.length === 0) return null;
    withTotals.sort((a, b) => b.total12mo - a.total12mo);
    const grand12mo = withTotals.reduce((s, m) => s + m.total12mo, 0);
    const top3 = withTotals.slice(0, 3);
    const top3Total = top3.reduce((s, m) => s + m.total12mo, 0);
    const top3Pct = grand12mo > 0 ? Math.round((top3Total / grand12mo) * 100) : 0;
    return { top3, top3Total, top3Pct, grand12mo };
  })();

  // Card 3: Cash withdrawals 12 MO
  const cashWithdrawalsData = (() => {
    if (!allTimeMerchants) return null;
    const cashMerchants = allTimeMerchants.filter((m) =>
      /^cash(\/atm)?$/i.test((m.category ?? "").trim()) ||
      /\batm\b|cash withdrawal|interac cash|petty cash/i.test(m.name)
    );
    if (cashMerchants.length === 0) return null;
    const total12 = cashMerchants.reduce((s, m) =>
      s + m.monthly.filter((mo) => mo.ym >= ym12moAgo).reduce((ms, mo) => ms + mo.total, 0), 0);
    const count12 = cashMerchants.reduce((s, m) =>
      s + m.monthly.filter((mo) => mo.ym >= ym12moAgo).reduce((ms, mo) => ms + mo.count, 0), 0);
    const totalPrev = cashMerchants.reduce((s, m) =>
      s + m.monthly.filter((mo) => mo.ym >= ym24moAgo && mo.ym < ym12moAgo).reduce((ms, mo) => ms + mo.total, 0), 0);
    if (total12 === 0) return null;
    const vsLastYear = totalPrev > 0 ? Math.round(((total12 - totalPrev) / totalPrev) * 100) : null;
    return { total12, count12, vsLastYear };
  })();

  // Card 4: New recurring costs 6 MO
  const newRecurringData = (() => {
    if (!allTimeMerchants || allSubscriptions.length === 0) return null;
    const newSubs: { name: string; monthlyAmt: number }[] = [];
    for (const sub of allSubscriptions) {
      const slug = merchantSlug(sub.name);
      if (!slug) continue;
      const m = allTimeMerchants.find((mc) => mc.slug === slug);
      if (!m || !m.firstDate) continue;
      if (m.firstDate >= ym6moAgo) {
        const monthly = sub.frequency === "annual" ? sub.amount / 12 : sub.amount;
        newSubs.push({ name: sub.name, monthlyAmt: monthly });
      }
    }
    if (newSubs.length === 0) return null;
    newSubs.sort((a, b) => b.monthlyAmt - a.monthlyAmt);
    const totalNewMonthly = newSubs.reduce((s, n) => s + n.monthlyAmt, 0);
    return { newSubs, totalNewMonthly };
  })();

  // ── By Merchant tab computed data ─────────────────────────────────────────
  const merchantFilterYm = merchantTimeFilter === "3mo" ? ym3moAgo
    : merchantTimeFilter === "6mo" ? ym6moAgo
    : merchantTimeFilter === "12mo" ? ym12moAgo
    : "0000-00"; // "all"
  const mFilterLabel = merchantTimeFilter === "3mo" ? "3 MO"
    : merchantTimeFilter === "6mo" ? "6 MO"
    : merchantTimeFilter === "12mo" ? "12 MO" : "ALL TIME";

  // Aggregate each merchant for the selected period
  const mFiltered = !allTimeMerchants ? [] : allTimeMerchants.map((m) => {
    const slice = merchantTimeFilter === "all" ? m.monthly : m.monthly.filter((mo) => mo.ym >= merchantFilterYm);
    const total = slice.reduce((s, mo) => s + mo.total, 0);
    const count = slice.reduce((s, mo) => s + mo.count, 0);
    return { ...m, total, count, avgAmount: count > 0 ? total / count : 0 };
  }).filter((m) => m.total > 0).sort((a, b) => b.total - a.total);

  const mGrandTotal   = mFiltered.reduce((s, m) => s + m.total, 0);
  const mTotalTxns    = mFiltered.reduce((s, m) => s + m.count, 0);
  const mRepeat       = mFiltered.filter((m) => m.count > 1);
  const mOneOff       = mFiltered.filter((m) => m.count === 1);
  const mAllRepeat    = (allTimeMerchants ?? []).filter((m) => {
    const c = m.monthly.reduce((s, mo) => s + mo.count, 0);
    return c > 1;
  });
  const mAllOneOff    = (allTimeMerchants ?? []).filter((m) => {
    const c = m.monthly.reduce((s, mo) => s + mo.count, 0);
    return c === 1;
  });

  // Summary card: 12-month total spend + top-3 share (fixed 12mo window for the card)
  const mGrandTotal12 = !allTimeMerchants ? 0
    : allTimeMerchants.reduce((s, m) => s + m.monthly.filter((mo) => mo.ym >= ym12moAgo).reduce((t, mo) => t + mo.total, 0), 0);
  const mTotalCount12 = !allTimeMerchants ? 0
    : allTimeMerchants.reduce((s, m) => s + m.monthly.filter((mo) => mo.ym >= ym12moAgo).reduce((t, mo) => t + mo.count, 0), 0);
  const mTop3         = mFiltered.slice(0, 3);
  const mTop3Total    = mTop3.reduce((s, m) => s + m.total, 0);
  const mTop3Pct      = mGrandTotal > 0 ? Math.round((mTop3Total / mGrandTotal) * 100) : 0;
  const mTop3Names    = mTop3.map((m) => m.name);

  // New · 90 days: first seen in last ~3 months
  const mNew90d = (allTimeMerchants ?? [])
    .filter((m) => m.firstDate && m.firstDate >= ym3moAgo)
    .sort((a, b) => (b.firstDate ?? "").localeCompare(a.firstDate ?? ""));

  // Trending: 3 mo vs prior 3 mo, merchants with |change| >= 15% and min $30 spend
  const mTrending = (allTimeMerchants ?? []).map((m) => {
    const recentTotal = m.monthly.filter((mo) => mo.ym >= ym3moAgo).reduce((s, mo) => s + mo.total, 0);
    const priorTotal  = m.monthly.filter((mo) => mo.ym >= ym6moAgo && mo.ym < ym3moAgo).reduce((s, mo) => s + mo.total, 0);
    if (recentTotal < 30 || priorTotal < 30) return null;
    const delta = recentTotal - priorTotal;
    const pct   = Math.round((delta / priorTotal) * 100);
    const mult  = recentTotal / priorTotal;
    if (Math.abs(pct) < 15) return null;
    return { ...m, recentTotal, priorTotal, delta, pct, mult };
  }).filter((m): m is NonNullable<typeof m> => m !== null)
    .sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct))
    .slice(0, 6);

  // One-offs: summary category breakdown
  const mOneOffTotal = mOneOff.reduce((s, m) => s + m.total, 0);
  const mOneOffCatCounts: Record<string, number> = {};
  for (const m of mOneOff) mOneOffCatCounts[m.category] = (mOneOffCatCounts[m.category] ?? 0) + 1;
  const mOneOffTopCats = Object.entries(mOneOffCatCounts).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([cat]) => cat);

  // ── By Category tab computed data ─────────────────────────────────────────
  type MerchantSummaryItem = NonNullable<typeof allTimeMerchants>[0];
  const catFilterYm    = catTimeFilter === "3mo" ? ym3moAgo : catTimeFilter === "6mo" ? ym6moAgo : catTimeFilter === "12mo" ? ym12moAgo : "0000-00";
  const catFilterLabel = catTimeFilter === "3mo" ? "3 MO" : catTimeFilter === "6mo" ? "6 MO" : catTimeFilter === "12mo" ? "12 MO" : "ALL TIME";

  const NON_SPENDING_CATS = new Set([
    "Transfers", "Transfer Out", "Transfers & Payments",
    "Interest", "Investments & Savings",
  ]);

  const categoryRows = (() => {
    if (!allTimeMerchants) return [];
    // Roll every merchant's category up to its parent before grouping
    const byCategory = new Map<string, MerchantSummaryItem[]>();
    for (const m of allTimeMerchants) {
      const key = getParentCategory(m.category || "Other");
      if (!byCategory.has(key)) byCategory.set(key, []);
      byCategory.get(key)!.push(m);
    }
    return Array.from(byCategory.entries()).map(([name, merchants]) => {
      // Aggregate monthly data across all merchants in this category
      const monthlyMap = new Map<string, { total: number; count: number }>();
      for (const m of merchants) {
        for (const mo of m.monthly) {
          const ex = monthlyMap.get(mo.ym) ?? { total: 0, count: 0 };
          monthlyMap.set(mo.ym, { total: ex.total + mo.total, count: ex.count + mo.count });
        }
      }
      const monthly = Array.from(monthlyMap.entries())
        .map(([ym, v]) => ({ ym, ...v }))
        .sort((a, b) => a.ym.localeCompare(b.ym));

      // Total for selected period
      const slice = catTimeFilter === "all" ? monthly : monthly.filter((mo) => mo.ym >= catFilterYm);
      const total = slice.reduce((s, mo) => s + mo.total, 0);
      const count = slice.reduce((s, mo) => s + mo.count, 0);

      // 3 mo vs prior 3 mo trend (independent of time filter — always shows recent velocity)
      const recentTotal = monthly.filter((mo) => mo.ym >= ym3moAgo).reduce((s, mo) => s + mo.total, 0);
      const priorTotal  = monthly.filter((mo) => mo.ym >= ym6moAgo && mo.ym < ym3moAgo).reduce((s, mo) => s + mo.total, 0);
      const trendPct: number | null = priorTotal > 10
        ? Math.round(((recentTotal - priorTotal) / priorTotal) * 100)
        : null;

      // Top merchants for this category in selected period
      const topMerchants = merchants.map((m) => {
        const mSlice = catTimeFilter === "all" ? m.monthly : m.monthly.filter((mo) => mo.ym >= catFilterYm);
        const mTotal = mSlice.reduce((s, mo) => s + mo.total, 0);
        const mCount = mSlice.reduce((s, mo) => s + mo.count, 0);
        return { ...m, total: mTotal, count: mCount, avgAmount: mCount > 0 ? mTotal / mCount : 0 };
      }).filter((m) => m.total > 0).sort((a, b) => b.total - a.total);

      return { name, color: categoryColor(name), total, count, avgAmount: count > 0 ? total / count : 0, monthly, topMerchants, recentTotal, priorTotal, trendPct };
    }).filter((c) => c.total > 0 && (catShowTransfers || !NON_SPENDING_CATS.has(c.name))).sort((a, b) => b.total - a.total);
  })();

  const catGrandTotal   = categoryRows.reduce((s, c) => s + c.total, 0);
  const catTop3Total    = categoryRows.slice(0, 3).reduce((s, c) => s + c.total, 0);
  const catTop3Pct      = catGrandTotal > 0 ? Math.round((catTop3Total / catGrandTotal) * 100) : 0;
  const catTop3Names    = categoryRows.slice(0, 3).map((c) => c.name);
  const catFastest      = categoryRows
    .filter((c) => c.trendPct != null && c.trendPct > 0)
    .sort((a, b) => (b.trendPct ?? 0) - (a.trendPct ?? 0))[0] ?? null;
  const catAllTxns12    = !allTimeMerchants ? 0
    : allTimeMerchants.reduce((s, m) => s + m.monthly.filter((mo) => mo.ym >= ym12moAgo).reduce((t, mo) => t + mo.count, 0), 0);

  // ── Enriched subscriptions for the Recurring tab ──────────────────────────
  const ym9moAgo = monthsAgoYm(9);

  // Oldest month we have any spending data for — used to gate "New" and "Price Hike"
  const oldestHistoryYm = history
    .filter((h) => (h.expensesTotal ?? 0) > 0)
    .map((h) => h.yearMonth)
    .sort()[0] ?? null;
  // We can only detect "new" subscriptions if we have data older than 6 months to
  // compare against. If all statements are within 6 months, everything looks "new".
  const hasOldEnoughHistory = oldestHistoryYm !== null && oldestHistoryYm < ym6moAgo;

  const enrichedSubs = allSubscriptions.map((sub) => {
    const slug     = merchantSlug(sub.name);
    const merchant = allTimeMerchants?.find((m) => m.slug === slug) ?? null;

    // Derive per-charge amount from actual merchant transaction history when available.
    // Firestore amounts may reflect stale AI-extracted totals (e.g. a multi-line bill
    // total instead of the true per-charge amount). Using the average per-transaction
    // from recent months matches what the merchant page shows.
    let amount = sub.amount;
    if (merchant?.monthly) {
      const recentMos = merchant.monthly.filter((m) => m.ym >= ym6moAgo && m.count > 0);
      if (recentMos.length > 0) {
        const totalSpend = recentMos.reduce((s, m) => s + m.total, 0);
        const totalCount = recentMos.reduce((s, m) => s + m.count, 0);
        amount = totalSpend / totalCount; // avg per-transaction = per-charge amount
      }
    }

    const freq    = sub.frequency ?? "monthly";
    const monthly = freq === "annual"    ? amount / 12
                  : freq === "quarterly" ? amount / 3
                  : freq === "biweekly"  ? amount * (30 / 14)
                  : freq === "weekly"    ? amount * (30 / 7)
                  : amount;
    const yearly  = monthly * 12;

    // Next charge
    const nextChargePrediction = merchant?.lastDate
      ? nextSubDate(merchant.lastDate, sub.frequency ?? "monthly")
      : null;

    // Price hike detection — requires:
    //   1. Merchant has been around > 6 months (not a new subscription)
    //   2. ≥ 2 months of data in both the recent (0–3 mo) and older (3–9 mo) windows
    //   3. Recent avg > older avg by ≥ 4% AND > $1.00 absolute
    const hikeMonth = merchant?.monthly ? findHikeMonth(merchant.monthly) : null;
    let priceHikeAmt: number | null = null;
    const merchantIsEstablished = merchant?.firstDate ? merchant.firstDate < ym6moAgo : false;
    if (hikeMonth && merchant?.monthly && merchantIsEstablished) {
      const recentMos = merchant.monthly.filter((m) => m.ym >= ym3moAgo && m.count > 0);
      const olderMos  = merchant.monthly.filter((m) => m.ym >= ym9moAgo && m.ym < ym3moAgo && m.count > 0);
      if (recentMos.length >= 2 && olderMos.length >= 2) {
        const recentAvg = recentMos.reduce((s, m) => s + m.total / m.count, 0) / recentMos.length;
        const olderAvg  = olderMos.reduce((s, m) => s + m.total / m.count, 0) / olderMos.length;
        if (recentAvg > olderAvg * 1.04 && recentAvg - olderAvg > 1.0)
          priceHikeAmt = Math.round((recentAvg - olderAvg) * 100) / 100;
      }
    }

    // "New" = subscription has NO transactions in any statement older than 6 months,
    // but DOES have recent transactions — AND we have old enough data to compare against.
    // Using merchant.monthly directly is more reliable than firstDate, because firstDate
    // only reflects the oldest uploaded statement for that merchant's account.
    const merchantHasOldTxns    = merchant?.monthly?.some((m) => m.ym < ym6moAgo && m.count > 0) ?? false;
    const merchantHasRecentTxns = merchant?.monthly?.some((m) => m.ym >= ym3moAgo && m.count > 0) ?? false;
    const isNew = hasOldEnoughHistory && !merchantHasOldTxns && merchantHasRecentTxns;
    const sinceDate = merchant?.firstDate ?? null;
    const lastDate  = merchant?.lastDate  ?? null;

    return { ...sub, amount, monthly, yearly, lastDate, sinceDate, nextChargePrediction, priceHikeAmt, hikeMonth, isNew };
  });

  const subAnnualCount  = enrichedSubs.filter((s) => (s.frequency ?? "monthly") === "annual").length;
  const subMonthlyCount = enrichedSubs.length - subAnnualCount;
  const priceHikeCount  = enrichedSubs.filter((s) => s.priceHikeAmt).length;
  const priceHikeTotalMo = enrichedSubs.reduce((s, sub) => s + (sub.priceHikeAmt ?? 0), 0);
  const newSubCount     = enrichedSubs.filter((s) => s.isNew).length;
  const newSubTotalMo   = enrichedSubs.filter((s) => s.isNew).reduce((s, sub) => s + sub.monthly, 0);

  const subNextCharge = [...enrichedSubs]
    .filter((s) => s.nextChargePrediction && s.nextChargePrediction.daysFromNow >= -3)
    .sort((a, b) => (a.nextChargePrediction!.daysFromNow) - (b.nextChargePrediction!.daysFromNow))[0] ?? null;

  const allRecurringSorted = [...enrichedSubs].sort((a, b) => b.yearly - a.yearly);
  const SUB_PREVIEW_COUNT  = 3;
  const hiddenSubs         = allRecurringSorted.slice(SUB_PREVIEW_COUNT);
  const hiddenSubsMo       = hiddenSubs.reduce((s, sub) => s + sub.monthly, 0);

  // ── Fixed / Variable classification ──────────────────────────────────────────
  const fixedSubs    = allRecurringSorted.filter((sub) => {
    const subRec   = firestoreSubsMap.get(merchantSlug(sub.name));
    const merchant = allTimeMerchants?.find((m) => m.slug === merchantSlug(sub.name));
    return classifySubscription(sub.amount, merchant?.monthly, subRec?.baseAmount, ym3moAgo) === "fixed";
  });
  const variableSubs = allRecurringSorted.filter((sub) => {
    const subRec   = firestoreSubsMap.get(merchantSlug(sub.name));
    const merchant = allTimeMerchants?.find((m) => m.slug === merchantSlug(sub.name));
    return classifySubscription(sub.amount, merchant?.monthly, subRec?.baseAmount, ym3moAgo) === "variable";
  });
  const fixedMonthly    = fixedSubs.reduce((s, sub) => s + sub.monthly, 0);
  const variableMonthly = variableSubs.reduce((s, sub) => s + sub.monthly, 0);

  // Variable: min/max per-charge range across recent months
  const variableRecentAmounts = variableSubs.flatMap((sub) => {
    const merchant = allTimeMerchants?.find((m) => m.slug === merchantSlug(sub.name));
    if (!merchant?.monthly) return [sub.amount];
    const recent = merchant.monthly.filter((m) => m.ym >= ym3moAgo && m.count > 0);
    return recent.length > 0 ? recent.map((m) => m.total / m.count) : [sub.amount];
  });
  const variableMin = variableRecentAmounts.length > 0 ? Math.min(...variableRecentAmounts) : 0;
  const variableMax = variableRecentAmounts.length > 0 ? Math.max(...variableRecentAmounts) : 0;

  // Variable sparkline: sum per-charge amounts by month for last 6 months
  const variableSparkData: { ym: string; v: number }[] = (() => {
    const months: string[] = [];
    for (let i = 5; i >= 0; i--) months.push(monthsAgoYm(i));
    return months.map((ym) => {
      const v = variableSubs.reduce((s, sub) => {
        const merchant = allTimeMerchants?.find((m) => m.slug === merchantSlug(sub.name));
        const mo = merchant?.monthly?.find((m) => m.ym === ym);
        return s + (mo && mo.count > 0 ? mo.total / mo.count : 0);
      }, 0);
      return { ym, v };
    });
  })();

  // Fixed: charges due in next 30 days
  const fixedNext30Days = fixedSubs.reduce((s, sub) => {
    const d = sub.nextChargePrediction?.daysFromNow;
    return d != null && d >= 0 && d <= 30 ? s + sub.amount : s;
  }, 0);

  // Subscription creep chart: monthly fixed commitment over last 12 months
  const creepChartData: { ym: string; baseline: number; added: number }[] = (() => {
    if (!yearMonth) return [];
    const months: string[] = [];
    for (let i = 11; i >= 0; i--) months.push(monthsAgoYm(i));
    const windowStart = months[0];
    return months.map((ym) => {
      let baseline = 0, added = 0;
      for (const sub of fixedSubs) {
        const merchant = allTimeMerchants?.find((m) => m.slug === merchantSlug(sub.name));
        const firstYm   = merchant?.monthly?.filter((m) => m.count > 0).map((m) => m.ym).sort()[0];
        if (!firstYm || firstYm > ym) continue;
        if (firstYm <= windowStart) baseline += sub.monthly;
        else added += sub.monthly;
      }
      return { ym, baseline, added };
    });
  })();
  const creepBaseline = creepChartData[0]?.baseline ?? 0;
  const creepAdded    = creepChartData.at(-1)?.added ?? 0;

  // Recent changes: NEW · USAGE UP · PRICE HIKE · DORMANT (last 6 months)
  type SubChangeType = "new" | "usage-up" | "hike" | "dormant";
  const recentChanges: { sub: typeof allRecurringSorted[0]; changeType: SubChangeType; detail: string }[] = (() => {
    const out: { sub: typeof allRecurringSorted[0]; changeType: SubChangeType; detail: string }[] = [];
    for (const sub of allRecurringSorted) {
      const subRec   = firestoreSubsMap.get(merchantSlug(sub.name));
      const merchant = allTimeMerchants?.find((m) => m.slug === merchantSlug(sub.name));
      const isVar    = classifySubscription(sub.amount, merchant?.monthly, subRec?.baseAmount, ym3moAgo) === "variable";
      if (sub.isNew) {
        const freq = sub.frequency ?? "monthly";
        out.push({ sub, changeType: "new", detail: `${freq} · since ${sub.sinceDate ? fmtMD(sub.sinceDate) : "—"}` });
      } else if (sub.priceHikeAmt && sub.priceHikeAmt > 0) {
        if (isVar) {
          const base = sub.amount - sub.priceHikeAmt;
          const pct  = base > 0 ? Math.round((sub.priceHikeAmt / base) * 100) : 0;
          out.push({ sub, changeType: "usage-up", detail: `up ${pct}% vs 3 mo ago` });
        } else {
          out.push({ sub, changeType: "hike", detail: `+${formatCurrency(sub.priceHikeAmt, homeCurrency, undefined, true)}/mo · ${sub.hikeMonth ? shortMonth(sub.hikeMonth) : ""}` });
        }
      } else if (sub.lastDate && sub.lastDate < ym3moAgo && sub.sinceDate && sub.sinceDate < ym6moAgo) {
        out.push({ sub, changeType: "dormant", detail: `no charge since ${fmtMD(sub.lastDate)}` });
      }
    }
    return out.slice(0, 6);
  })();

  // ── Month pills — shared across Transactions, Merchants and Cash tabs ────────
  const monthPillsHistory = history.filter((h) => (h.expensesTotal ?? 0) > 0);
  const monthPills = monthPillsHistory.length > 1 ? (
    <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none -mx-1 mb-4">
      {monthPillsHistory.map((h) => (
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
  ) : null;

  if (loading) return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <div className="h-10 w-10 animate-spin rounded-full border-4 border-purple-600 border-t-transparent" />
    </div>
  );

  return (
    <div className="mx-auto max-w-2xl lg:max-w-5xl px-4 pt-4 pb-8 sm:py-8 sm:px-6">

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
              {displayTotal > 0 && <>{formatCurrency(displayTotal, homeCurrency, undefined, true)} · </>}{monthLabel(selectedMonth)}
              {monthLoading && <span className="ml-2 text-xs text-gray-300">loading…</span>}
            </p>
          )}
        </div>
        <p className="mt-3 text-[10px] text-gray-400 text-right shrink-0">
          excl. transfers<br />{catIncludeAll ? "" : "& debt pmts"}
        </p>
      </div>

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
          <div className="mt-5 mb-6 flex overflow-x-auto border-b border-gray-200 scrollbar-none [-ms-overflow-style:none] [scrollbar-width:none]">
            {TABS.map((tab) => (
              <button key={tab.id} onClick={() => switchTab(tab.id)}
                className={`relative shrink-0 mr-6 pb-3 text-sm font-medium transition-colors ${
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
                {tab.id === "categories" && allTimeMerchants && allTimeMerchants.length > 0 && (
                  <span className="ml-1.5 rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-500">
                    {new Set(allTimeMerchants.map((m) => m.category || "Other")).size}
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
                    homeCurrency={homeCurrency}
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
                                {monthLoading ? "…" : formatCurrency(total, homeCurrency, undefined, true)}
                              </span>
                              {expDelta !== null && !monthLoading && (
                                <span className={`ml-2 font-semibold ${expDelta > 0 ? "text-red-500" : "text-green-600"}`}>
                                  {expDelta > 0 ? "↑ " : "↓ "}{formatCurrency(Math.abs(expDelta), homeCurrency, undefined, true)} vs prev
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
                                        <span className="text-sm font-semibold tabular-nums text-gray-800">{formatCurrency(cat.amount, homeCurrency, undefined, true)}</span>
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
                                        <span className="text-sm font-semibold tabular-nums text-gray-800 shrink-0">{formatCurrency(txn.amount, homeCurrency, txn.currency, false)}</span>
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
                          <p className="mt-2 font-bold text-2xl text-gray-900">{total > 0 ? formatCurrency(displayTotal, homeCurrency, undefined, true) : "—"}</p>
                          {expDelta !== null && total > 0 && (
                            <p className={`mt-1 text-xs font-medium ${expDelta > 0 ? "text-red-500" : "text-green-600"}`}>
                              {expDelta > 0 ? "↑" : "↓"} {formatCurrency(Math.abs(expDelta), homeCurrency, undefined, true)} vs {prevMonthLabel}
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
                          <p className="mt-2 font-bold text-2xl text-gray-900">{medianExpenses !== null ? formatCurrency(medianExpenses, homeCurrency, undefined, true) : "—"}</p>
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
                              <p className="text-xl font-bold text-gray-900 tabular-nums leading-tight">{formatCurrency(debtTotal, homeCurrency, undefined, true)}</p>
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
                              <p className="text-base font-bold text-orange-700 tabular-nums">{formatCurrency(committedTotal, homeCurrency, undefined, true)}</p>
                            </div>
                          )}
                          {extraTotal > 0 && (
                            <div className="flex-1">
                              <p className="text-[10px] font-semibold uppercase tracking-wider text-green-500 mb-0.5">Extra Payments</p>
                              <p className="text-base font-bold text-green-600 tabular-nums">{formatCurrency(extraTotal, homeCurrency, undefined, true)}</p>
                            </div>
                          )}
                          {interestTotal > 0 && (
                            <div className="flex-1">
                              <p className="text-[10px] font-semibold uppercase tracking-wider text-red-400 mb-0.5">Interest</p>
                              <p className="text-base font-bold text-red-500 tabular-nums">{formatCurrency(interestTotal, homeCurrency, undefined, true)}</p>
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
                                      <p className="text-sm font-semibold text-gray-700 tabular-nums">{formatCurrency(tx.amount, homeCurrency, (tx as ExpenseTransaction).currency, false)}</p>
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
                                        <p className="text-sm font-semibold text-red-500 tabular-nums shrink-0">{formatCurrency(tx.amount, homeCurrency, (tx as ExpenseTransaction).currency, false)}</p>
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
                                  {formatCurrency(paymentsMade, homeCurrency, undefined, true)} received by your CC / loan accounts — offsets the payments above.
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
                          <span className="text-xs font-semibold text-gray-500 tabular-nums">{formatCurrency(transferTotal, homeCurrency, undefined, true)}</span>
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
                                <p className="text-sm text-gray-600 tabular-nums shrink-0 ml-4">{formatCurrency(tx.amount, homeCurrency, (tx as ExpenseTransaction).currency, false)}</p>
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
                const activeCats  = catIncludeAll ? categoriesAll : categories;
                const visibleCats = catExpanded ? activeCats : activeCats.slice(0, COLLAPSE_CAT);
                const hiddenCount = Math.max(0, activeCats.length - COLLAPSE_CAT);
                return (
                  <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
                    {/* Card header with toggle */}
                    <div className="px-5 pt-4 pb-3 flex items-center justify-between gap-3">
                      <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">By Category</p>
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] text-gray-400">incl. debt pmts</span>
                        <button
                          onClick={() => setCatIncludeAll((v) => !v)}
                          className={`relative inline-flex h-4 w-8 shrink-0 rounded-full border-2 border-transparent transition-colors focus:outline-none ${
                            catIncludeAll ? "bg-indigo-500" : "bg-gray-200"
                          }`}
                          role="switch"
                          aria-checked={catIncludeAll}
                        >
                          <span className={`inline-block h-3 w-3 rounded-full bg-white shadow transform transition-transform ${catIncludeAll ? "translate-x-4" : "translate-x-0"}`} />
                        </button>
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
                                      <span className="text-sm font-semibold text-gray-700 tabular-nums">{formatCurrency(cat.amount, homeCurrency, undefined, true)}</span>
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
                                  const subHref  = isRemainder
                                    ? `/account/spending/category/${encodeURIComponent(cat.name.toLowerCase())}${filterMonth ? `?month=${filterMonth}` : ""}`
                                    : `/account/spending/category/${encodeURIComponent(sub.name.toLowerCase())}${filterMonth ? `?month=${filterMonth}` : ""}`;
                                  const rowContent = (
                                    <>
                                      <span className="h-1.5 w-1.5 shrink-0 rounded-full opacity-50" style={{ backgroundColor: subColor }} />
                                      <span className={`flex-1 text-[13px] truncate ${isRemainder ? "text-gray-400 italic" : "text-gray-600 group-hover/sub:text-purple-600 transition-colors"}`}>{sub.name}</span>
                                      <span className="text-[13px] text-gray-500 tabular-nums shrink-0">{formatCurrency(sub.amount, homeCurrency, undefined, true)}</span>
                                      <span className="text-xs text-gray-400 w-7 text-right shrink-0">{subPct}%</span>
                                      {/* Always reserve the same width as the chevron so columns stay aligned */}
                                      <svg className="h-3.5 w-3.5 text-gray-300 group-hover/sub:text-purple-400 transition-colors shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                                      </svg>
                                    </>
                                  );
                                  return (
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
                  <span className="text-sm font-semibold text-amber-800">{formatCurrency(cashMonthlyTotal, homeCurrency, undefined, true)}/mo</span>
                  <svg className="h-4 w-4 text-amber-400 group-hover:text-amber-600 transition" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </button>
            </div>
          )}

          {/* ── Overview insight cards ─────────────────────────────────────── */}
          {activeTab === "overview" && (allSubscriptions.length > 0 || topMerchantsData || cashWithdrawalsData || newRecurringData) && (
            <div className="grid grid-cols-2 gap-3 mt-1">

              {/* Subscriptions card */}
              {allSubscriptions.length > 0 && (
                <button
                  onClick={() => switchTab("subscriptions")}
                  className="flex flex-col gap-1.5 rounded-xl border border-gray-200 bg-white p-4 shadow-sm text-left hover:bg-gray-50 transition group"
                >
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">
                    Subscriptions · {Math.min(history.length, 12)} mo
                  </p>
                  <p className="text-xl font-bold text-gray-900 leading-tight tabular-nums">
                    {formatCurrency(subsYearly, homeCurrency, undefined, true)}
                    <span className="text-sm font-medium text-gray-500">/yr</span>
                  </p>
                  <p className="text-xs text-gray-500">{allSubscriptions.length} active</p>
                  <p className="text-xs font-medium text-gray-400 group-hover:text-gray-500 transition mt-auto pt-1">
                    {formatCurrency(subMonthlyTotal, homeCurrency, undefined, true)}/mo avg
                  </p>
                </button>
              )}

              {/* Top Merchants card */}
              {topMerchantsData && (
                <button
                  onClick={() => switchTab("merchants")}
                  className="flex flex-col gap-1.5 rounded-xl border border-gray-200 bg-white p-4 shadow-sm text-left hover:bg-gray-50 transition group"
                >
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">
                    Top Merchants · 12 mo
                  </p>
                  <p className="text-xl font-bold text-gray-900 leading-tight tabular-nums">
                    {topMerchantsData.top3Pct}
                    <span className="text-sm font-medium text-gray-500">%</span>
                  </p>
                  <p className="text-xs text-gray-500">
                    Top 3 · {formatCurrency(topMerchantsData.top3Total, homeCurrency, undefined, true)}
                  </p>
                  <p className="text-xs text-gray-400 mt-auto pt-1 truncate">
                    {topMerchantsData.top3.map((m) => m.name).join(", ")}
                  </p>
                </button>
              )}

              {/* Cash withdrawals card */}
              {cashWithdrawalsData && (
                <div className="flex flex-col gap-1.5 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">
                    Cash · 12 mo
                  </p>
                  <p className="text-xl font-bold text-gray-900 leading-tight tabular-nums">
                    {formatCurrency(cashWithdrawalsData.total12, homeCurrency, undefined, true)}
                  </p>
                  <p className="text-xs text-gray-500">{cashWithdrawalsData.count12} withdrawal{cashWithdrawalsData.count12 !== 1 ? "s" : ""}</p>
                  {cashWithdrawalsData.vsLastYear !== null && (
                    <p className={`text-xs font-medium mt-auto pt-1 ${cashWithdrawalsData.vsLastYear < 0 ? "text-green-600" : cashWithdrawalsData.vsLastYear > 0 ? "text-orange-500" : "text-gray-400"}`}>
                      {cashWithdrawalsData.vsLastYear > 0 ? "↑" : cashWithdrawalsData.vsLastYear < 0 ? "↓" : "→"} {Math.abs(cashWithdrawalsData.vsLastYear)}% vs last year
                    </p>
                  )}
                </div>
              )}

              {/* New recurring costs card */}
              {newRecurringData && (
                <button
                  onClick={() => switchTab("subscriptions")}
                  className="flex flex-col gap-1.5 rounded-xl border border-gray-200 bg-white p-4 shadow-sm text-left hover:bg-gray-50 transition col-span-2"
                >
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">
                    New Recurring Costs · 6 mo
                  </p>
                  <p className="text-xl font-bold text-gray-900 leading-tight tabular-nums">
                    +{formatCurrency(newRecurringData.totalNewMonthly, homeCurrency, undefined, true)}
                    <span className="text-sm font-medium text-gray-500">/mo</span>
                  </p>
                  <p className="text-xs text-gray-500">
                    {newRecurringData.newSubs.length} new subscription{newRecurringData.newSubs.length !== 1 ? "s" : ""} · {newRecurringData.newSubs[0]?.name} is the largest add
                  </p>
                  <div className="flex flex-wrap gap-x-3 gap-y-1 mt-auto pt-1">
                    {newRecurringData.newSubs.slice(0, 4).map((s) => (
                      <span key={s.name} className="text-xs text-blue-500 font-medium">
                        {s.name} +{formatCurrency(s.monthlyAmt, homeCurrency, undefined, true)}
                      </span>
                    ))}
                  </div>
                </button>
              )}
            </div>
          )}

          {activeTab === "transactions" && (
            <>
              {monthPills}
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
                              −{fmtDec(Math.abs(txn.amount), txn.currency, homeCurrency)}
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
            </>
          )}

          {/* ── By Merchant tab ───────────────────────────────────────── */}
          {activeTab === "merchants" && (
            <div className="space-y-4">
              {!allTimeMerchants ? (
                <div className="flex justify-center py-16">
                  <div className="h-8 w-8 animate-spin rounded-full border-4 border-purple-200 border-t-purple-600" />
                </div>
              ) : allTimeMerchants.length === 0 ? (
                <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-10 text-center">
                  <p className="text-sm text-gray-500">No merchant data yet.</p>
                </div>
              ) : (
                <>
                  {/* ── Summary card ── */}
                  <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
                    <div className="grid grid-cols-4 divide-x divide-gray-100">
                      <div className="px-4 py-4">
                        <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 mb-1">Merchants</p>
                        <p className="text-xl font-bold text-gray-900 leading-tight">{allTimeMerchants.length}</p>
                        <p className="text-xs text-gray-400 mt-0.5">{mAllRepeat.length} repeat · {mAllOneOff.length} one-off</p>
                      </div>
                      <div className="px-4 py-4">
                        <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 mb-1">Total Spend</p>
                        <p className="text-xl font-bold text-gray-900 leading-tight tabular-nums">
                          {formatCurrency(mGrandTotal12, homeCurrency, undefined, true)}
                        </p>
                        <p className="text-xs text-gray-400 mt-0.5">{mTotalCount12.toLocaleString()} transactions</p>
                      </div>
                      <div className="px-4 py-4">
                        <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 mb-1">Top 3 Share</p>
                        <p className={`text-xl font-bold leading-tight ${mTop3Pct > 50 ? "text-orange-500" : "text-gray-900"}`}>{mTop3Pct}%</p>
                        <p className="text-xs text-gray-400 mt-0.5 truncate">{mTop3Names.join(", ")}</p>
                      </div>
                      <div className="px-4 py-4">
                        <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 mb-1">New · 90d</p>
                        <p className={`text-xl font-bold leading-tight ${mNew90d.length > 0 ? "text-purple-600" : "text-gray-900"}`}>{mNew90d.length}</p>
                        <p className="text-xs text-gray-400 mt-0.5">first seen this quarter</p>
                      </div>
                    </div>
                  </div>

                  {/* ── Search ── */}
                  <div className="rounded-xl border border-gray-200 bg-white shadow-sm px-4 py-3">
                    <div className="relative">
                      <svg className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 115 11a6 6 0 0112 0z" />
                      </svg>
                      <input
                        type="text"
                        placeholder={`Search ${allTimeMerchants.length} merchants…`}
                        value={merchantSearch}
                        onChange={(e) => setMerchantSearch(e.target.value)}
                        className="w-full rounded-lg border border-gray-200 bg-gray-50 py-2 pl-9 pr-12 text-sm text-gray-800 placeholder-gray-400 focus:border-purple-400 focus:bg-white focus:outline-none focus:ring-1 focus:ring-purple-400"
                      />
                      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-gray-300 font-mono">⌘K</span>
                    </div>
                  </div>

                  {merchantSearch ? (
                    /* ── Search results (flat list) ── */
                    <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
                      <div className="px-5 py-2.5 border-b border-gray-100">
                        <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">
                          {allTimeMerchants.filter((m) => m.name.toLowerCase().includes(merchantSearch.toLowerCase()) || m.category.toLowerCase().includes(merchantSearch.toLowerCase())).length} results
                        </p>
                      </div>
                      <div className="divide-y divide-gray-100">
                        {allTimeMerchants
                          .filter((m) => m.name.toLowerCase().includes(merchantSearch.toLowerCase()) || m.category.toLowerCase().includes(merchantSearch.toLowerCase()))
                          .sort((a, b) => b.total - a.total)
                          .map((m) => {
                            const color = categoryColor(m.category);
                            const allTotal = m.monthly.reduce((s, mo) => s + mo.total, 0);
                            const allCount = m.monthly.reduce((s, mo) => s + mo.count, 0);
                            return (
                              <Link key={m.slug} href={`/account/spending/merchant/${encodeURIComponent(m.slug)}`} className="flex items-center gap-3 px-5 py-3.5 hover:bg-gray-50 transition">
                                <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold ${subAvatarColor(m.name)}`}>{merchantInitials(m.name)}</span>
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-semibold text-gray-900 truncate">{m.name}</p>
                                  <p className="text-[11px] text-gray-400 mt-0.5">
                                    <span className="inline-flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />{m.category}</span>
                                    {" · "}{allCount} visit{allCount !== 1 ? "s" : ""}
                                    {allCount > 0 ? ` · ${formatCurrency(allTotal / allCount, homeCurrency, m.currency, false)} avg` : ""}
                                  </p>
                                </div>
                                <div className="text-right shrink-0">
                                  <p className="text-sm font-bold text-gray-900 tabular-nums">{formatCurrency(allTotal, homeCurrency, m.currency, false)}</p>
                                </div>
                                <svg className="h-3.5 w-3.5 text-gray-300 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
                              </Link>
                            );
                          })}
                      </div>
                    </div>
                  ) : (
                    <>
                      {/* ── Time filter pills ── */}
                      <div className="flex gap-2">
                        {(["3mo", "6mo", "12mo", "all"] as const).map((f) => (
                          <button
                            key={f}
                            onClick={() => { setMerchantTimeFilter(f); setMShowAllTop(false); }}
                            className={`rounded-full px-3 py-1 text-xs font-medium transition ${merchantTimeFilter === f ? "bg-gray-900 text-white" : "bg-white border border-gray-200 text-gray-600 hover:border-gray-300"}`}
                          >
                            {f === "3mo" ? "3 mo" : f === "6mo" ? "6 mo" : f === "12mo" ? "12 mo" : "All time"}
                          </button>
                        ))}
                      </div>

                      {/* ── TOP BY TOTAL ── */}
                      {mRepeat.length > 0 && (
                        <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
                          <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
                            <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">Top by Total · {mFilterLabel}</p>
                            <button onClick={() => setMShowAllTop(true)} className="text-[10px] text-purple-500 hover:text-purple-700 transition">{mRepeat.length} total · view all</button>
                          </div>
                          <div className="divide-y divide-gray-100">
                            {(mShowAllTop ? mRepeat : mRepeat.slice(0, 4)).map((m) => {
                              const color = categoryColor(m.category);
                              const pctOfSpend = mGrandTotal > 0 ? Math.round((m.total / mGrandTotal) * 100) : 0;
                              return (
                                <Link key={m.slug} href={`/account/spending/merchant/${encodeURIComponent(m.slug)}`} className="flex items-center gap-3 px-5 py-3.5 hover:bg-gray-50 transition">
                                  <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold ${subAvatarColor(m.name)}`}>{merchantInitials(m.name)}</span>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-sm font-semibold text-gray-900 truncate">{m.name}</p>
                                    <p className="text-[11px] text-gray-400 mt-0.5">
                                      <span className="inline-flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} /><span className="uppercase text-[9px] tracking-wide font-medium" style={{ color }}>{m.category}</span></span>
                                      {" · "}{m.count} visit{m.count !== 1 ? "s" : ""}
                                      {m.count > 0 ? ` · ${formatCurrency(m.avgAmount, homeCurrency, m.currency, false)} avg` : ""}
                                    </p>
                                  </div>
                                  <MerchantSparkline monthly={m.monthly} color={color} fromYm={ym6moAgo} />
                                  <div className="text-right shrink-0 min-w-[72px]">
                                    <p className="text-sm font-bold text-gray-900 tabular-nums">{formatCurrency(m.total, homeCurrency, m.currency, false)}</p>
                                    <p className="text-[11px] text-gray-400 mt-0.5">{pctOfSpend}% of spend</p>
                                  </div>
                                  <svg className="h-3.5 w-3.5 text-gray-300 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
                                </Link>
                              );
                            })}
                          </div>
                          {!mShowAllTop && mRepeat.length > 4 && (
                            <button
                              onClick={() => setMShowAllTop(true)}
                              className="flex w-full items-center justify-between border-t border-gray-100 px-5 py-3.5 hover:bg-gray-50 transition"
                            >
                              <div className="flex items-center gap-2.5">
                                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gray-100 text-[10px] font-bold text-gray-500">+{mRepeat.length - 4}</span>
                                <div>
                                  <p className="text-sm text-gray-600">{mRepeat.length - 4} more repeat merchants</p>
                                  <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">View all</p>
                                </div>
                              </div>
                              <div className="text-right">
                                <p className="text-sm font-semibold text-gray-700 tabular-nums">{formatCurrency(mRepeat.slice(4).reduce((s, m) => s + m.total, 0), homeCurrency, undefined, true)}</p>
                                <p className="text-[11px] text-gray-400">{mGrandTotal > 0 ? Math.round((mRepeat.slice(4).reduce((s, m) => s + m.total, 0) / mGrandTotal) * 100) : 0}% of spend</p>
                              </div>
                            </button>
                          )}
                          {mShowAllTop && mRepeat.length > 4 && (
                            <button onClick={() => setMShowAllTop(false)} className="flex w-full items-center justify-center gap-1 border-t border-gray-100 px-5 py-3 text-xs font-medium text-gray-400 hover:bg-gray-50 transition">
                              Show less <svg className="h-3.5 w-3.5 rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
                            </button>
                          )}
                        </div>
                      )}

                      {/* ── TRENDING · 3 MO VS PRIOR 3 ── */}
                      {mTrending.length > 0 && (
                        <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
                          <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
                            <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">Trending · 3 mo vs prior 3</p>
                            <span className="text-[10px] text-gray-400">{mTrending.length} notable changes</span>
                          </div>
                          <div className="divide-y divide-gray-100">
                            {mTrending.map((m) => {
                              const isUp     = m.delta > 0;
                              const color    = categoryColor(m.category);
                              const sparkColor = isUp ? "#ef4444" : "#22c55e";
                              const pctLabel = Math.abs(m.pct) >= 100
                                ? `${isUp ? "↑" : "↓"} ${(m.mult).toFixed(1)}×`
                                : `${isUp ? "↑" : "↓"} ${Math.abs(m.pct)}%`;
                              return (
                                <Link key={m.slug} href={`/account/spending/merchant/${encodeURIComponent(m.slug)}`} className="flex items-center gap-3 px-5 py-3.5 hover:bg-gray-50 transition">
                                  <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold ${subAvatarColor(m.name)}`}>{merchantInitials(m.name)}</span>
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-1.5">
                                      <p className="text-sm font-semibold text-gray-900 truncate">{m.name}</p>
                                      <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${isUp ? "bg-red-50 text-red-500" : "bg-green-50 text-green-600"}`}>{pctLabel}</span>
                                    </div>
                                    <p className="text-[11px] text-gray-400 mt-0.5">
                                      {formatCurrency(m.recentTotal, homeCurrency, m.currency, false)} vs {formatCurrency(m.priorTotal, homeCurrency, m.currency, false)} prior 3 mo
                                    </p>
                                  </div>
                                  <MerchantSparkline monthly={m.monthly} color={sparkColor} fromYm={ym6moAgo} />
                                  <div className="text-right shrink-0 min-w-[72px]">
                                    <p className={`text-sm font-bold tabular-nums ${isUp ? "text-red-500" : "text-green-600"}`}>
                                      {isUp ? "+" : ""}{formatCurrency(m.delta, homeCurrency, m.currency, false)}
                                    </p>
                                    <p className="text-[11px] text-gray-400">vs prior 3 mo</p>
                                  </div>
                                  <svg className="h-3.5 w-3.5 text-gray-300 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
                                </Link>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* ── NEW · 90 DAYS ── */}
                      {mNew90d.length > 0 && (
                        <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
                          <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
                            <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">New · 90 Days</p>
                            <span className="text-[10px] text-gray-400">{mNew90d.length} first-seen</span>
                          </div>
                          <div className="divide-y divide-gray-100">
                            {mNew90d.slice(0, 3).map((m) => {
                              const color    = categoryColor(m.category);
                              const allCount = m.monthly.reduce((s, mo) => s + mo.count, 0);
                              const allTotal = m.monthly.reduce((s, mo) => s + mo.total, 0);
                              const isRecurring = allSubscriptions.some((s) => merchantSlug(s.name) === m.slug);
                              return (
                                <Link key={m.slug} href={`/account/spending/merchant/${encodeURIComponent(m.slug)}`} className="flex items-center gap-3 px-5 py-3.5 hover:bg-gray-50 transition">
                                  <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold ${subAvatarColor(m.name)}`}>{merchantInitials(m.name)}</span>
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-1.5">
                                      <p className="text-sm font-semibold text-gray-900 truncate">{m.name}</p>
                                      <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold bg-purple-50 text-purple-600">NEW</span>
                                      {isRecurring && <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium bg-indigo-50 text-indigo-500">recurring</span>}
                                    </div>
                                    <p className="text-[11px] text-gray-400 mt-0.5">
                                      <span className="inline-flex items-center gap-1 mr-1"><span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />{m.category}</span>
                                      · First seen {m.firstDate ? fmtMD(m.firstDate) : "—"} · {allCount} visit{allCount !== 1 ? "s" : ""}
                                    </p>
                                  </div>
                                  <div className="text-right shrink-0">
                                    <p className="text-sm font-bold text-gray-900 tabular-nums">{formatCurrency(allTotal, homeCurrency, m.currency, false)}</p>
                                    <p className="text-[11px] text-gray-400 tabular-nums">{formatCurrency(allTotal / Math.max(allCount, 1), homeCurrency, m.currency, false)} avg</p>
                                  </div>
                                  <svg className="h-3.5 w-3.5 text-gray-300 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
                                </Link>
                              );
                            })}
                          </div>
                          {mNew90d.length > 3 && (
                            <div className="flex items-center justify-between border-t border-gray-100 px-5 py-3.5">
                              <div className="flex items-center gap-2.5">
                                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gray-100 text-[10px] font-bold text-gray-500">+{mNew90d.length - 3}</span>
                                <p className="text-sm text-gray-600">{mNew90d.length - 3} more new merchants</p>
                              </div>
                              <p className="text-sm font-semibold text-gray-700 tabular-nums">{formatCurrency(mNew90d.slice(3).reduce((s, m) => s + m.monthly.reduce((t, mo) => t + mo.total, 0), 0), homeCurrency, undefined, true)}</p>
                            </div>
                          )}
                        </div>
                      )}

                      {/* ── ONE-OFFS ── */}
                      {mOneOff.length > 0 && (
                        <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
                          <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
                            <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">One-offs · {mFilterLabel}</p>
                            <span className="text-[10px] text-gray-400">{mOneOff.length} single-visit · {formatCurrency(mOneOffTotal, homeCurrency, undefined, true)}</span>
                          </div>
                          <div className="flex items-center gap-3 px-5 py-4">
                            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gray-100 text-sm font-bold text-gray-400">…</span>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-semibold text-gray-900">{mOneOff.length} merchants visited once</p>
                              {mOneOffTopCats.length > 0 && (
                                <p className="text-[11px] text-gray-400 mt-0.5">
                                  Mostly {mOneOffTopCats.join(", ").toLowerCase()} · {formatCurrency(mOneOff.length > 0 ? mOneOffTotal / mOneOff.length : 0, homeCurrency, undefined, false)} avg
                                </p>
                              )}
                            </div>
                            <div className="text-right shrink-0">
                              <p className="text-sm font-bold text-gray-900 tabular-nums">{formatCurrency(mOneOffTotal, homeCurrency, undefined, false)}</p>
                              <p className="text-[11px] text-gray-400">{mGrandTotal > 0 ? Math.round((mOneOffTotal / mGrandTotal) * 100) : 0}% of spend</p>
                            </div>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </>
              )}
            </div>
          )}

          {/* ── By Category tab ───────────────────────────────────────── */}
          {activeTab === "categories" && (
            <div className="space-y-4">
              {!allTimeMerchants ? (
                <div className="flex justify-center py-16">
                  <div className="h-8 w-8 animate-spin rounded-full border-4 border-purple-200 border-t-purple-600" />
                </div>
              ) : categoryRows.length === 0 ? (
                <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-10 text-center">
                  <p className="text-sm text-gray-500">No category data yet.</p>
                </div>
              ) : (
                <>
                  {/* ── Summary card ── */}
                  <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
                    <div className="grid grid-cols-2 sm:grid-cols-4 divide-y sm:divide-y-0 divide-x-0 sm:divide-x divide-gray-100">
                      <div className="px-4 py-4 border-b border-r border-gray-100 sm:border-b-0 sm:border-r">
                        <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 mb-1">Categories</p>
                        <p className="text-xl font-bold text-gray-900 leading-tight">{categoryRows.length}</p>
                        <p className="text-xs text-gray-400 mt-0.5">{catAllTxns12.toLocaleString()} txns · 12 mo</p>
                      </div>
                      <div className="px-4 py-4 border-b border-gray-100 sm:border-b-0 sm:border-r">
                        <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 mb-1">Total Spend</p>
                        <p className="text-xl font-bold text-gray-900 leading-tight tabular-nums">
                          {formatCurrency(mGrandTotal12, homeCurrency, undefined, true)}
                        </p>
                        <p className="text-xs text-gray-400 mt-0.5">12-month window</p>
                      </div>
                      <div className="px-4 py-4 border-r border-gray-100 sm:border-r">
                        <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 mb-1">Top 3 Share</p>
                        <p className={`text-xl font-bold leading-tight ${catTop3Pct > 75 ? "text-orange-500" : "text-gray-900"}`}>{catTop3Pct}%</p>
                        <p className="text-xs text-gray-400 mt-0.5 truncate">{catTop3Names.join(", ")}</p>
                      </div>
                      <div className="px-4 py-4">
                        <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 mb-1">Fastest Growing</p>
                        {catFastest ? (
                          <>
                            <p className="text-xl font-bold text-orange-500 leading-tight">↑ {catFastest.trendPct}%</p>
                            <p className="text-xs text-gray-400 mt-0.5 truncate">{catFastest.name} · 3 mo vs prior</p>
                          </>
                        ) : (
                          <p className="text-xl font-bold text-gray-400 leading-tight">—</p>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* ── Time filter pills + transfers toggle ── */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex gap-2">
                      {(["3mo", "6mo", "12mo", "all"] as const).map((f) => (
                        <button
                          key={f}
                          onClick={() => { setCatTimeFilter(f); setExpandedCategory(null); }}
                          className={`rounded-full px-3 py-1 text-xs font-medium transition ${catTimeFilter === f ? "bg-gray-900 text-white" : "bg-white border border-gray-200 text-gray-600 hover:border-gray-300"}`}
                        >
                          {f === "3mo" ? "3 mo" : f === "6mo" ? "6 mo" : f === "12mo" ? "12 mo" : "All time"}
                        </button>
                      ))}
                    </div>
                    <button
                      onClick={() => setCatShowTransfers((v) => !v)}
                      className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium border transition ${catShowTransfers ? "bg-gray-900 border-gray-900 text-white" : "bg-white border-gray-200 text-gray-400 hover:border-gray-300 hover:text-gray-600"}`}
                    >
                      <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                      </svg>
                      {catShowTransfers ? "Hiding transfers" : "Show transfers"}
                    </button>
                  </div>

                  {/* ── All categories ranked ── */}
                  <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
                    <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
                      <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">All Categories · {catFilterLabel}</p>
                      <span className="text-[10px] text-gray-400">{categoryRows.length} categories</span>
                    </div>
                    <div className="divide-y divide-gray-100">
                      {categoryRows.map((cat) => {
                        const pct       = catGrandTotal > 0 ? Math.round((cat.total / catGrandTotal) * 100) : 0;
                        const isExpanded = expandedCategory === cat.name;
                        const hasTrend   = cat.trendPct != null && Math.abs(cat.trendPct) >= 10;
                        const trendUp    = (cat.trendPct ?? 0) > 0;
                        return (
                          <Fragment key={cat.name}>
                            {/* Category row — click name/details to navigate, chevron to expand */}
                            <div className="w-full flex items-center gap-2 sm:gap-3 px-3 sm:px-5 py-3 sm:py-3.5 hover:bg-gray-50 transition">
                              {/* Color swatch */}
                              <Link href={`/account/spending/category/${encodeURIComponent(cat.name)}`} className="flex h-8 w-8 sm:h-9 sm:w-9 shrink-0 items-center justify-center rounded-full hover:opacity-80 transition" style={{ backgroundColor: cat.color + "20" }}>
                                <span className="h-3 w-3 rounded-full" style={{ backgroundColor: cat.color }} />
                              </Link>
                              {/* Name + meta */}
                              <Link href={`/account/spending/category/${encodeURIComponent(cat.name)}`} className="flex-1 min-w-0 group">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <p className="text-sm font-semibold text-gray-900 group-hover:text-purple-600 transition">{cat.name}</p>
                                  {hasTrend && (
                                    <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${trendUp ? "bg-red-50 text-red-500" : "bg-green-50 text-green-600"}`}>
                                      {trendUp ? "↑" : "↓"} {Math.abs(cat.trendPct!)}%
                                    </span>
                                  )}
                                </div>
                                <p className="text-[11px] text-gray-400 mt-0.5 hidden sm:block">
                                  {cat.count.toLocaleString()} txn{cat.count !== 1 ? "s" : ""} · {formatCurrency(cat.avgAmount, homeCurrency, undefined, false)} avg · {cat.topMerchants.length} merchant{cat.topMerchants.length !== 1 ? "s" : ""}
                                </p>
                                <p className="text-[11px] text-gray-400 mt-0.5 sm:hidden">
                                  {cat.count.toLocaleString()} txns · {cat.topMerchants.length} merchants
                                </p>
                                {/* Share bar */}
                                <div className="mt-1.5 h-1 w-full rounded-full bg-gray-100">
                                  <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: cat.color }} />
                                </div>
                              </Link>
                              {/* Sparkline — hidden on mobile */}
                              <div className="hidden sm:block">
                                <MerchantSparkline monthly={cat.monthly} color={cat.color} fromYm={ym12moAgo} />
                              </div>
                              {/* Total + share */}
                              <div className="text-right shrink-0 min-w-[60px] sm:min-w-[72px]">
                                <p className="text-sm font-bold text-gray-900 tabular-nums">{formatCurrency(cat.total, homeCurrency, undefined, true)}</p>
                                <p className="text-[11px] text-gray-400 mt-0.5">{pct}%</p>
                              </div>
                              {/* Chevron — only this toggles the accordion */}
                              <button
                                onClick={() => {
                                  if (isExpanded) {
                                    setExpandedCategory(null);
                                    setExpandedSubtypes(new Set());
                                  } else {
                                    setExpandedCategory(cat.name);
                                  }
                                }}
                                className="p-1 rounded hover:bg-gray-200 transition shrink-0"
                                aria-label={isExpanded ? "Collapse" : "Expand subtypes"}
                              >
                                <svg className={`h-3.5 w-3.5 text-gray-400 transition-transform ${isExpanded ? "rotate-90" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                                </svg>
                              </button>
                            </div>

                            {/* Level 2: subtype rows — each expands to show merchants */}
                            {isExpanded && (() => {
                              const subtypeMap = new Map<string, typeof cat.topMerchants>();
                              for (const m of cat.topMerchants) {
                                const sub = isSubtype(m.category || "") ? m.category : cat.name;
                                if (!subtypeMap.has(sub)) subtypeMap.set(sub, []);
                                subtypeMap.get(sub)!.push(m);
                              }
                              const subtypes = Array.from(subtypeMap.entries())
                                .map(([name, ms]) => ({ name, total: ms.reduce((s, m) => s + m.total, 0), merchants: ms }))
                                .sort((a, b) => b.total - a.total);
                              return (
                                <div className="border-t border-gray-100">
                                  {subtypes.map((st) => {
                                    const stKey = `${cat.name}::${st.name}`;
                                    const stExpanded = expandedSubtypes.has(stKey);
                                    const stColor = categoryColor(st.name) || cat.color;
                                    const stPct = cat.total > 0 ? Math.round((st.total / cat.total) * 100) : 0;
                                    return (
                                      <Fragment key={st.name}>
                                        {/* Subtype row — click to expand/collapse merchants */}
                                        <button
                                          onClick={() => setExpandedSubtypes((prev) => {
                                            const next = new Set(prev);
                                            next.has(stKey) ? next.delete(stKey) : next.add(stKey);
                                            return next;
                                          })}
                                          className="w-full flex items-center gap-3 pl-8 pr-4 py-3 bg-gray-50 hover:bg-gray-100 transition text-left border-b border-gray-200 last:border-0 group"
                                          style={{ borderLeft: `3px solid ${stColor}` }}
                                        >
                                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full" style={{ backgroundColor: stColor + "25" }}>
                                            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: stColor }} />
                                          </span>
                                          <div className="flex-1 min-w-0">
                                            <p className="text-xs font-semibold text-gray-800 group-hover:text-gray-900">{st.name}</p>
                                            <p className="text-[10px] text-gray-400 mt-0.5">{st.merchants.length} merchant{st.merchants.length !== 1 ? "s" : ""} · {stPct}% of {cat.name}</p>
                                          </div>
                                          <p className="text-xs font-bold text-gray-800 tabular-nums shrink-0">{formatCurrency(st.total, homeCurrency, undefined, false)}</p>
                                          {/* Prominent expand indicator */}
                                          <span className={`ml-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full transition-colors ${stExpanded ? "bg-gray-300" : "bg-gray-200 group-hover:bg-gray-300"}`}>
                                            <svg className={`h-3 w-3 text-gray-600 transition-transform ${stExpanded ? "rotate-90" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                                            </svg>
                                          </span>
                                        </button>

                                        {/* Level 3: merchants under this subtype */}
                                        {stExpanded && (
                                          <div className="bg-gray-50/60">
                                            {st.merchants.map((m) => {
                                              const mPct = cat.total > 0 ? Math.round((m.total / cat.total) * 100) : 0;
                                              const mCatColor = categoryColor(m.category || cat.name);
                                              const isPickerOpen = catOpenPicker === m.slug;
                                              return (
                                                <div key={m.slug} className="flex items-center gap-3 pl-16 pr-5 py-2.5 hover:bg-gray-100/60 transition border-b border-gray-100 last:border-0">
                                                  <Link
                                                    href={`/account/spending/merchant/${encodeURIComponent(m.slug)}`}
                                                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold hover:opacity-80 transition ${subAvatarColor(m.name)}`}
                                                  >
                                                    {merchantInitials(m.name)}
                                                  </Link>
                                                  <div className="flex-1 min-w-0">
                                                    <Link href={`/account/spending/merchant/${encodeURIComponent(m.slug)}`} className="text-xs font-medium text-gray-800 truncate hover:text-purple-600 hover:underline block">{m.name}</Link>
                                                    <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                                                      <span className="text-[10px] text-gray-400">{m.count} visit{m.count !== 1 ? "s" : ""} · {formatCurrency(m.avgAmount, homeCurrency, m.currency, false)} avg</span>
                                                      <button
                                                        ref={(el) => { if (el) catPickerBtnRefs.current.set(m.slug, el); else catPickerBtnRefs.current.delete(m.slug); }}
                                                        onClick={() => setCatOpenPicker(isPickerOpen ? null : m.slug)}
                                                        className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[10px] font-medium text-gray-500 transition hover:border-purple-300 hover:bg-purple-50 hover:text-purple-700"
                                                      >
                                                        <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ backgroundColor: mCatColor }} />
                                                        {m.category || cat.name}
                                                        <svg className="h-2.5 w-2.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
                                                      </button>
                                                      {isPickerOpen && catPickerBtnRefs.current.has(m.slug) && (
                                                        <CategoryPicker
                                                          anchorRef={{ current: catPickerBtnRefs.current.get(m.slug)! }}
                                                          current={m.category || cat.name}
                                                          onSelect={(newCat) => handleMerchantCategoryChange(m.name, newCat)}
                                                          onClose={() => setCatOpenPicker(null)}
                                                        />
                                                      )}
                                                    </div>
                                                  </div>
                                                  <div className="text-right shrink-0">
                                                    <p className="text-xs font-semibold text-gray-800 tabular-nums">{formatCurrency(m.total, homeCurrency, m.currency, false)}</p>
                                                    <p className="text-[10px] text-gray-400">{mPct}% of {cat.name}</p>
                                                  </div>
                                                </div>
                                              );
                                            })}
                                          </div>
                                        )}
                                      </Fragment>
                                    );
                                  })}
                                </div>
                              );
                            })()}
                          </Fragment>
                        );
                      })}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {/* ── Recurring tab ─────────────────────────────────────────── */}
          {activeTab === "subscriptions" && (
            <div className="space-y-3">
              {allSubscriptions.length === 0 ? (
                <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-10 text-center">
                  <p className="text-sm text-gray-500">No recurring charges yet.</p>
                  <p className="mt-1 text-xs text-gray-400">
                    Go to the Transactions tab and tap ↻ on any transaction to mark it as recurring.
                  </p>
                </div>
              ) : (
                <>
                  {/* ── FIXED / VARIABLE summary cards ── */}
                  <div className="grid grid-cols-2 gap-3">
                    {/* FIXED */}
                    <div className="rounded-xl border border-gray-200 bg-white shadow-sm p-5">
                      <div className="flex items-center gap-1.5 mb-3">
                        <span className="h-2 w-2 rounded-full bg-indigo-500" />
                        <span className="text-[10px] font-semibold uppercase tracking-widest text-gray-500">Fixed</span>
                        <span className="ml-auto text-[10px] text-gray-400">{fixedSubs.length} items</span>
                      </div>
                      <p className="text-2xl font-bold text-gray-900 tabular-nums leading-tight">
                        {formatCurrency(fixedSubs.reduce((s, sub) => s + sub.yearly, 0), homeCurrency, undefined, true)}
                        <span className="text-xs font-medium text-gray-400">/yr</span>
                      </p>
                      <p className="text-xs text-gray-400 mt-1">
                        {formatCurrency(fixedMonthly, homeCurrency, undefined, true)}/mo · predictable
                      </p>
                      {fixedNext30Days > 0 && (
                        <p className="text-xs text-gray-500 mt-2">
                          Next 30 days: <span className="font-semibold">{formatCurrency(fixedNext30Days, homeCurrency, undefined, true)}</span>
                        </p>
                      )}
                    </div>
                    {/* VARIABLE */}
                    <div className="rounded-xl border border-gray-200 bg-white shadow-sm p-5">
                      <div className="flex items-center gap-1.5 mb-3">
                        <span className="h-2 w-2 rounded-full bg-amber-500" />
                        <span className="text-[10px] font-semibold uppercase tracking-widest text-gray-500">Variable</span>
                        <span className="ml-auto text-[10px] text-gray-400">{variableSubs.length} items</span>
                      </div>
                      {variableSubs.length > 0 ? (
                        <>
                          <p className="text-2xl font-bold text-gray-900 tabular-nums leading-tight">
                            {formatCurrency(variableMin, homeCurrency, undefined, true)}
                            <span className="text-gray-400">–</span>
                            {formatCurrency(variableMax, homeCurrency, undefined, true)}
                            <span className="text-xs font-medium text-gray-400">/mo</span>
                          </p>
                          <p className="text-xs text-gray-400 mt-1">last 3 mo range · varies</p>
                          {variableSparkData.some((d) => d.v > 0) && (
                            <div className="mt-2 -mx-1">
                              <ResponsiveContainer width="100%" height={36}>
                                <AreaChart data={variableSparkData} margin={{ top: 2, bottom: 2, left: 0, right: 0 }}>
                                  <Area type="monotone" dataKey="v" stroke="#f59e0b" fill="#fef3c7" strokeWidth={1.5} dot={false} />
                                </AreaChart>
                              </ResponsiveContainer>
                            </div>
                          )}
                        </>
                      ) : (
                        <p className="text-sm text-gray-400 mt-2">None detected</p>
                      )}
                    </div>
                  </div>

                  {/* ── Subscription creep chart ── */}
                  {creepChartData.length >= 3 && (creepBaseline > 0 || creepAdded > 0) && (
                    <div className="rounded-xl border border-gray-200 bg-white shadow-sm px-5 pt-5 pb-4">
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">Subscription Creep</p>
                        <span className="text-[10px] text-gray-400">12 MO</span>
                      </div>
                      <p className="text-base font-bold text-gray-900">
                        You&apos;ve added <span className="text-indigo-600">{formatCurrency(creepAdded, homeCurrency, undefined, true)}/mo</span> in new commitments
                      </p>
                      <p className="text-xs text-gray-400 mt-0.5 mb-4">
                        A year ago your fixed subscriptions totalled {formatCurrency(creepBaseline, homeCurrency, undefined, true)}/mo. Today: {formatCurrency(fixedMonthly, homeCurrency, undefined, true)}/mo.
                      </p>
                      <ResponsiveContainer width="100%" height={110}>
                        <AreaChart data={creepChartData} margin={{ top: 4, bottom: 0, left: 0, right: 0 }}>
                          <XAxis dataKey="ym" tickFormatter={(ym: string) => shortMonth(ym)} tick={{ fontSize: 10, fill: "#9ca3af" }} axisLine={false} tickLine={false} />
                          <Tooltip
                            formatter={(v) => formatCurrency(Number(v), homeCurrency, undefined, true)}
                            labelFormatter={(ym) => shortMonth(String(ym))}
                            contentStyle={{ fontSize: 11, borderRadius: 8, border: "1px solid #e5e7eb" }}
                          />
                          <Area type="monotone" dataKey="baseline" stackId="1" stroke="#818cf8" fill="#e0e7ff" strokeWidth={1.5} dot={false} name="Existing" />
                          <Area type="monotone" dataKey="added" stackId="1" stroke="#a5b4fc" fill="#ede9fe" strokeWidth={1} dot={false} name="Added" />
                        </AreaChart>
                      </ResponsiveContainer>
                      <div className="flex gap-4 mt-2">
                        <span className="flex items-center gap-1.5 text-[10px] text-gray-400">
                          <span className="h-2 w-4 rounded-sm bg-indigo-200" />Existing commitments
                        </span>
                        <span className="flex items-center gap-1.5 text-[10px] text-gray-400">
                          <span className="h-2 w-4 rounded-sm bg-violet-200" />+ Added in last 12 mo
                        </span>
                      </div>
                    </div>
                  )}

                  {/* ── Next upcoming charge ── */}
                  {subNextCharge && (
                    <div className="rounded-xl border border-gray-200 bg-white shadow-sm px-5 py-3.5 flex items-center gap-3">
                      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${subNextCharge.nextChargePrediction ? subAvatarColor(new Date(subNextCharge.nextChargePrediction.date + "T12:00:00").toLocaleDateString("en-US", { month: "short" }).toUpperCase()) : subAvatarColor(subNextCharge.name)}`}>
                        {subNextCharge.nextChargePrediction
                          ? new Date(subNextCharge.nextChargePrediction.date + "T12:00:00").toLocaleDateString("en-US", { month: "short" }).toUpperCase()
                          : subInitials(subNextCharge.name)}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-gray-900">{subNextCharge.name}</p>
                        <p className="text-xs text-gray-400">
                          Next charge · {subNextCharge.nextChargePrediction ? fmtMD(subNextCharge.nextChargePrediction.date) : "—"}
                          {subNextCharge.nextChargePrediction && (() => {
                            const d = subNextCharge.nextChargePrediction.daysFromNow;
                            if (d === 0) return " · Today";
                            if (d === 1) return " · Tomorrow";
                            if (d < 0) return " · Overdue";
                            return ` · in ${d} days`;
                          })()}
                        </p>
                      </div>
                      <p className="text-sm font-bold text-gray-900 tabular-nums shrink-0">
                        {formatCurrency(subNextCharge.amount, homeCurrency, undefined, false)}
                      </p>
                    </div>
                  )}

                  {/* ── Recent changes ── */}
                  {recentChanges.length > 0 && (
                    <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
                      <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
                        <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-500">Recent Changes</p>
                        <span className="text-[10px] text-gray-400">{recentChanges.length} detected · 6 mo</span>
                      </div>
                      <div className="divide-y divide-gray-100">
                        {(showAllChanges ? recentChanges : recentChanges.slice(0, 4)).map(({ sub, changeType, detail }) => {
                          const slug = merchantSlug(sub.name);
                          const badgeStyle: Record<SubChangeType, string> = {
                            "new":      "bg-purple-50 text-purple-600",
                            "usage-up": "bg-orange-50 text-orange-600",
                            "hike":     "bg-red-50 text-red-500",
                            "dormant":  "bg-gray-100 text-gray-400",
                          };
                          const badgeLabel: Record<SubChangeType, string> = {
                            "new":      "NEW",
                            "usage-up": "USAGE UP",
                            "hike":     "PRICE HIKE",
                            "dormant":  "DORMANT",
                          };
                          const isDormant = changeType === "dormant";
                          const subRec = firestoreSubsMap.get(slug);
                          const baseAmt = subRec?.baseAmount;
                          const freqLabel = sub.frequency ?? "monthly";
                          const periodSuffix = freqLabel === "annual" ? "yr" : freqLabel === "quarterly" ? "qtr" : freqLabel === "weekly" ? "wk" : freqLabel === "biweekly" ? "2wk" : "mo";
                          return (
                            <div key={sub.name} className={`flex items-center gap-3 px-5 py-3 ${isDormant ? "opacity-60" : ""}`}>
                              <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${subAvatarColor(sub.name)}`}>
                                {subInitials(sub.name)}
                              </span>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <p className={`text-sm font-semibold text-gray-900 truncate ${isDormant ? "line-through text-gray-400" : ""}`}>{sub.name}</p>
                                  <span className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase ${badgeStyle[changeType]}`}>
                                    {badgeLabel[changeType]}
                                  </span>
                                </div>
                                <p className="text-[11px] text-gray-400 mt-0.5 capitalize">{detail}</p>
                              </div>
                              <div className="text-right shrink-0">
                                <p className={`text-sm font-bold tabular-nums ${isDormant ? "text-gray-400 line-through" : "text-gray-900"}`}>
                                  {formatCurrency(baseAmt && baseAmt > 0 ? baseAmt : sub.amount, homeCurrency, undefined, false)}/{periodSuffix}
                                </p>
                                <p className="text-[10px] text-gray-400 tabular-nums">
                                  {formatCurrency(sub.yearly, homeCurrency, undefined, true)}/yr
                                </p>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      {recentChanges.length > 4 && (
                        <button
                          onClick={() => setShowAllChanges((v) => !v)}
                          className="flex w-full items-center justify-center gap-1 border-t border-gray-100 px-5 py-3 text-xs font-medium text-gray-400 hover:bg-gray-50 transition"
                        >
                          {showAllChanges ? (
                            <>Show less <svg className="h-3.5 w-3.5 rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg></>
                          ) : (
                            <>+{recentChanges.length - 4} more <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg></>
                          )}
                        </button>
                      )}
                    </div>
                  )}

                  {/* ── Fixed · Predictable list ── */}
                  {fixedSubs.length > 0 && (() => {
                    const renderRow = (sub: typeof allRecurringSorted[0]) => {
                      const slug         = merchantSlug(sub.name);
                      const subRec       = firestoreSubsMap.get(slug);
                      const isUserConf   = subRec?.status === "user_confirmed";
                      const isConfirming = confirmingSlug === slug;
                      const freqLabel    = sub.frequency ?? "monthly";
                      const freqColors: Record<string, string> = {
                        annual: "bg-indigo-50 text-indigo-600", quarterly: "bg-teal-50 text-teal-600",
                        monthly: "bg-gray-100 text-gray-500", biweekly: "bg-purple-50 text-purple-600",
                        weekly: "bg-orange-50 text-orange-600",
                      };
                      const freqColor    = freqColors[freqLabel] ?? freqColors.monthly;
                      const isAnnual     = freqLabel === "annual";
                      const dateParts: string[] = [];
                      if (sub.lastDate) dateParts.push(`Last ${fmtMD(sub.lastDate)}`);
                      if (isAnnual && sub.nextChargePrediction) dateParts.push(`Next ${fmtMD(sub.nextChargePrediction.date)}`);
                      const periodSuffix = freqLabel === "annual" ? "yr" : freqLabel === "quarterly" ? "qtr" : freqLabel === "weekly" ? "wk" : freqLabel === "biweekly" ? "2wk" : "mo";
                      const baseAmt      = subRec?.baseAmount;
                      const baseYearly   = baseAmt != null && baseAmt > 0
                        ? (freqLabel === "annual" ? baseAmt : freqLabel === "quarterly" ? baseAmt * 4 : freqLabel === "biweekly" ? baseAmt * (365 / 14) : freqLabel === "weekly" ? baseAmt * 52 : baseAmt * 12)
                        : null;
                      return (
                        <Fragment key={sub.name}>
                          <div className="flex items-center gap-3 px-5 py-3.5">
                            <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold ${subAvatarColor(sub.name)}`}>
                              {subInitials(sub.name)}
                            </span>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5">
                                <p className="text-sm font-semibold text-gray-900 truncate">{sub.name}</p>
                                <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${freqColor}`}>{freqLabel}</span>
                                {isUserConf && <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold bg-green-50 text-green-600">confirmed</span>}
                              </div>
                              {dateParts.length > 0 && <p className="text-[11px] text-gray-400 mt-0.5">{dateParts.join(" · ")}</p>}
                            </div>
                            <div className="text-right shrink-0">
                              <p className="text-sm font-bold text-gray-900 tabular-nums">{formatCurrency(baseYearly ?? sub.yearly, homeCurrency, undefined, true)}/yr</p>
                              <p className="text-[11px] text-gray-400 tabular-nums">
                                {baseAmt != null && baseAmt > 0
                                  ? <>from {formatCurrency(baseAmt, homeCurrency, undefined, false)}/{periodSuffix}</>
                                  : <>{formatCurrency(sub.amount, homeCurrency, undefined, false)}/{periodSuffix}</>}
                              </p>
                              {baseAmt != null && baseAmt > 0 && Math.abs(sub.amount - baseAmt) / (baseAmt || 1) > 0.03 && (
                                <p className="text-[10px] text-gray-300 tabular-nums">avg {formatCurrency(sub.amount, homeCurrency, undefined, false)}/{periodSuffix}</p>
                              )}
                            </div>
                            {sub.source !== "manual" ? (
                              <button
                                onClick={() => {
                                  if (isConfirming) { setConfirmingSlug(null); return; }
                                  setConfirmFreq(freqLabel);
                                  setConfirmBase(baseAmt != null && baseAmt > 0 ? String(baseAmt) : sub.amount > 0 ? String(Math.round(sub.amount * 100) / 100) : "");
                                  setConfirmingSlug(slug);
                                }}
                                className={`ml-1 shrink-0 rounded px-2 py-1 text-[11px] font-semibold transition ${isConfirming ? "bg-gray-100 text-gray-400 hover:bg-gray-200" : isUserConf ? "text-gray-400 hover:text-gray-600" : "bg-purple-50 text-purple-600 hover:bg-purple-100"}`}
                                title={isConfirming ? "Close" : isUserConf ? "Edit" : "Confirm"}
                              >
                                {isConfirming ? (
                                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                                ) : isUserConf ? (
                                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536M9 13l-4 1 1-4 9.293-9.293a1 1 0 011.414 0l2.586 2.586a1 1 0 010 1.414L9 13z" /></svg>
                                ) : "Confirm"}
                              </button>
                            ) : (
                              <button onClick={async () => { if (!token) return; setRecurringRules((prev) => { const next = new Map(prev); next.delete(slug); return next; }); await fetch(`/api/user/recurring-rules?slug=${encodeURIComponent(slug)}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } }); }} className="ml-1 text-[11px] text-red-400 hover:text-red-600 transition" title="Remove">✕</button>
                            )}
                          </div>
                          {isConfirming && (
                            <div className="border-t border-purple-100 bg-purple-50/40 px-5 py-3">
                              <div className="flex flex-wrap items-end gap-3">
                                <div className="space-y-1">
                                  <label className="text-[10px] font-medium uppercase tracking-wide text-gray-400">Frequency</label>
                                  <div className="relative">
                                    <select value={confirmFreq} onChange={(e) => setConfirmFreq(e.target.value)} className="appearance-none cursor-pointer rounded-lg border border-gray-200 bg-white py-1.5 pl-2.5 pr-7 text-xs font-medium text-gray-700 focus:border-purple-400 focus:outline-none focus:ring-1 focus:ring-purple-400">
                                      {FORECAST_FREQUENCY_OPTIONS.filter((o) => o.id !== "oneoff").map((o) => (
                                        <option key={o.id} value={o.id === "yearly" ? "annual" : o.id}>{o.label}</option>
                                      ))}
                                    </select>
                                    <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-gray-400">▾</span>
                                  </div>
                                </div>
                                <div className="space-y-1">
                                  <label className="text-[10px] font-medium uppercase tracking-wide text-gray-400">Plan price <span className="normal-case font-normal text-gray-300">(optional)</span></label>
                                  <div className="flex items-center gap-1.5">
                                    <input type="number" min="0" step="0.01" value={confirmBase} onChange={(e) => setConfirmBase(e.target.value)} placeholder="e.g. 19.00" className="w-28 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs tabular-nums text-gray-800 placeholder-gray-300 focus:border-purple-400 focus:outline-none focus:ring-1 focus:ring-purple-400" />
                                    <span className="text-xs text-gray-400">/{confirmFreq === "annual" ? "yr" : confirmFreq === "quarterly" ? "qtr" : confirmFreq === "weekly" ? "wk" : confirmFreq === "biweekly" ? "2wk" : "mo"}</span>
                                  </div>
                                </div>
                                <div className="flex items-center gap-2 pb-0.5">
                                  <button onClick={() => handleConfirmSub(slug)} disabled={confirmSaving} className="rounded-lg bg-purple-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-purple-700 disabled:opacity-50 transition">{confirmSaving ? "Saving…" : "Save"}</button>
                                  <button onClick={() => setConfirmingSlug(null)} className="text-xs text-gray-400 hover:text-gray-600 transition">Dismiss</button>
                                </div>
                              </div>
                              <p className="mt-1.5 text-[10px] text-gray-400">avg charge: {formatCurrency(sub.amount, homeCurrency, undefined, false)}/{periodSuffix} · clear to track the full average</p>
                            </div>
                          )}
                        </Fragment>
                      );
                    };
                    return (
                      <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
                        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
                          <div className="flex items-center gap-2">
                            <span className="h-2 w-2 rounded-full bg-indigo-500" />
                            <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-500">Fixed · Predictable</p>
                          </div>
                          <span className="text-[10px] text-gray-400">{fixedSubs.length} active · {formatCurrency(fixedMonthly, homeCurrency, undefined, true)}/mo</span>
                        </div>
                        <div className="divide-y divide-gray-100">
                          {(showAllFixed ? fixedSubs : fixedSubs.slice(0, 4)).map(renderRow)}
                        </div>
                        {fixedSubs.length > 4 && (
                          <button
                            onClick={() => setShowAllFixed((v) => !v)}
                            className="flex w-full items-center justify-center gap-1 border-t border-gray-100 px-5 py-3 text-xs font-medium text-gray-400 hover:bg-gray-50 transition"
                          >
                            {showAllFixed ? (
                              <>Show less <svg className="h-3.5 w-3.5 rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg></>
                            ) : (
                              <>+{fixedSubs.length - 4} more <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg></>
                            )}
                          </button>
                        )}
                      </div>
                    );
                  })()}

                  {/* ── Variable · Usage-based list ── */}
                  {variableSubs.length > 0 && (() => {
                    const renderRow = (sub: typeof allRecurringSorted[0]) => {
                      const slug         = merchantSlug(sub.name);
                      const subRec       = firestoreSubsMap.get(slug);
                      const isUserConf   = subRec?.status === "user_confirmed";
                      const isConfirming = confirmingSlug === slug;
                      const freqLabel    = sub.frequency ?? "monthly";
                      const freqColors: Record<string, string> = {
                        annual: "bg-indigo-50 text-indigo-600", quarterly: "bg-teal-50 text-teal-600",
                        monthly: "bg-gray-100 text-gray-500", biweekly: "bg-purple-50 text-purple-600",
                        weekly: "bg-orange-50 text-orange-600",
                      };
                      const freqColor   = freqColors[freqLabel] ?? freqColors.monthly;
                      const isAnnual    = freqLabel === "annual";
                      const dateParts: string[] = [];
                      if (sub.lastDate) dateParts.push(`Last ${fmtMD(sub.lastDate)}`);
                      if (isAnnual && sub.nextChargePrediction) dateParts.push(`Next ${fmtMD(sub.nextChargePrediction.date)}`);
                      const periodSuffix = freqLabel === "annual" ? "yr" : freqLabel === "quarterly" ? "qtr" : freqLabel === "weekly" ? "wk" : freqLabel === "biweekly" ? "2wk" : "mo";
                      const baseAmt      = subRec?.baseAmount;
                      const overageAmt   = baseAmt != null && baseAmt > 0 ? sub.amount - baseAmt : null;
                      return (
                        <Fragment key={sub.name}>
                          <div className="flex items-center gap-3 px-5 py-3.5">
                            <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold ${subAvatarColor(sub.name)}`}>
                              {subInitials(sub.name)}
                            </span>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5">
                                <p className="text-sm font-semibold text-gray-900 truncate">{sub.name}</p>
                                <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${freqColor}`}>{freqLabel}</span>
                                {isUserConf && <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold bg-green-50 text-green-600">confirmed</span>}
                              </div>
                              {dateParts.length > 0 && <p className="text-[11px] text-gray-400 mt-0.5">{dateParts.join(" · ")}</p>}
                              {overageAmt != null && overageAmt > 0 && (
                                <p className="text-[11px] text-amber-500 mt-0.5">
                                  +{formatCurrency(overageAmt, homeCurrency, undefined, false)}/{periodSuffix} avg usage above plan
                                </p>
                              )}
                            </div>
                            <div className="text-right shrink-0">
                              <p className="text-sm font-bold text-gray-900 tabular-nums">{formatCurrency(sub.amount, homeCurrency, undefined, false)}/{periodSuffix}</p>
                              {baseAmt != null && baseAmt > 0 && (
                                <p className="text-[11px] text-gray-400 tabular-nums">plan {formatCurrency(baseAmt, homeCurrency, undefined, false)}</p>
                              )}
                            </div>
                            {sub.source !== "manual" ? (
                              <button
                                onClick={() => {
                                  if (isConfirming) { setConfirmingSlug(null); return; }
                                  setConfirmFreq(freqLabel);
                                  setConfirmBase(baseAmt != null && baseAmt > 0 ? String(baseAmt) : sub.amount > 0 ? String(Math.round(sub.amount * 100) / 100) : "");
                                  setConfirmingSlug(slug);
                                }}
                                className={`ml-1 shrink-0 rounded px-2 py-1 text-[11px] font-semibold transition ${isConfirming ? "bg-gray-100 text-gray-400 hover:bg-gray-200" : isUserConf ? "text-gray-400 hover:text-gray-600" : "bg-purple-50 text-purple-600 hover:bg-purple-100"}`}
                                title={isConfirming ? "Close" : isUserConf ? "Edit" : "Confirm"}
                              >
                                {isConfirming ? (
                                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                                ) : isUserConf ? (
                                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536M9 13l-4 1 1-4 9.293-9.293a1 1 0 011.414 0l2.586 2.586a1 1 0 010 1.414L9 13z" /></svg>
                                ) : "Confirm"}
                              </button>
                            ) : (
                              <button onClick={async () => { if (!token) return; setRecurringRules((prev) => { const next = new Map(prev); next.delete(slug); return next; }); await fetch(`/api/user/recurring-rules?slug=${encodeURIComponent(slug)}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } }); }} className="ml-1 text-[11px] text-red-400 hover:text-red-600 transition" title="Remove">✕</button>
                            )}
                          </div>
                          {isConfirming && (
                            <div className="border-t border-purple-100 bg-purple-50/40 px-5 py-3">
                              <div className="flex flex-wrap items-end gap-3">
                                <div className="space-y-1">
                                  <label className="text-[10px] font-medium uppercase tracking-wide text-gray-400">Frequency</label>
                                  <div className="relative">
                                    <select value={confirmFreq} onChange={(e) => setConfirmFreq(e.target.value)} className="appearance-none cursor-pointer rounded-lg border border-gray-200 bg-white py-1.5 pl-2.5 pr-7 text-xs font-medium text-gray-700 focus:border-purple-400 focus:outline-none focus:ring-1 focus:ring-purple-400">
                                      {FORECAST_FREQUENCY_OPTIONS.filter((o) => o.id !== "oneoff").map((o) => (
                                        <option key={o.id} value={o.id === "yearly" ? "annual" : o.id}>{o.label}</option>
                                      ))}
                                    </select>
                                    <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-gray-400">▾</span>
                                  </div>
                                </div>
                                <div className="space-y-1">
                                  <label className="text-[10px] font-medium uppercase tracking-wide text-gray-400">Plan price <span className="normal-case font-normal text-gray-300">(optional)</span></label>
                                  <div className="flex items-center gap-1.5">
                                    <input type="number" min="0" step="0.01" value={confirmBase} onChange={(e) => setConfirmBase(e.target.value)} placeholder="e.g. 19.00" className="w-28 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs tabular-nums text-gray-800 placeholder-gray-300 focus:border-purple-400 focus:outline-none focus:ring-1 focus:ring-purple-400" />
                                    <span className="text-xs text-gray-400">/{confirmFreq === "annual" ? "yr" : confirmFreq === "quarterly" ? "qtr" : confirmFreq === "weekly" ? "wk" : confirmFreq === "biweekly" ? "2wk" : "mo"}</span>
                                  </div>
                                </div>
                                <div className="flex items-center gap-2 pb-0.5">
                                  <button onClick={() => handleConfirmSub(slug)} disabled={confirmSaving} className="rounded-lg bg-purple-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-purple-700 disabled:opacity-50 transition">{confirmSaving ? "Saving…" : "Save"}</button>
                                  <button onClick={() => setConfirmingSlug(null)} className="text-xs text-gray-400 hover:text-gray-600 transition">Dismiss</button>
                                </div>
                              </div>
                              <p className="mt-1.5 text-[10px] text-gray-400">avg charge: {formatCurrency(sub.amount, homeCurrency, undefined, false)}/{periodSuffix} · set plan price to separate usage from base cost</p>
                            </div>
                          )}
                        </Fragment>
                      );
                    };
                    return (
                      <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
                        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
                          <div className="flex items-center gap-2">
                            <span className="h-2 w-2 rounded-full bg-amber-500" />
                            <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-500">Variable · Usage-based</p>
                          </div>
                          <span className="text-[10px] text-gray-400">{variableSubs.length} active</span>
                        </div>
                        <div className="divide-y divide-gray-100">
                          {(showAllVariable ? variableSubs : variableSubs.slice(0, 4)).map(renderRow)}
                        </div>
                        {variableSubs.length > 4 && (
                          <button
                            onClick={() => setShowAllVariable((v) => !v)}
                            className="flex w-full items-center justify-center gap-1 border-t border-gray-100 px-5 py-3 text-xs font-medium text-gray-400 hover:bg-gray-50 transition"
                          >
                            {showAllVariable ? (
                              <>Show less <svg className="h-3.5 w-3.5 rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg></>
                            ) : (
                              <>+{variableSubs.length - 4} more <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg></>
                            )}
                          </button>
                        )}
                      </div>
                    );
                  })()}
                </>
              )}
            </div>
          )}


          {/* ── Cash tab ──────────────────────────────────────────────────── */}
          {activeTab === "cash" && (
            <div className="space-y-4">
              {monthPills}
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
                    <p className="text-2xl font-bold text-amber-800 mt-1">{formatCurrency(cashMonthlyTotal, homeCurrency, undefined, true)}</p>
                    {cashItems.some((c) => c.frequency === "once") && (
                      <p className="text-[11px] text-amber-500 mt-0.5">recurring only — one-offs excluded</p>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-amber-600">{cashItems.length} item{cashItems.length !== 1 ? "s" : ""}</p>
                    <p className="text-xs text-amber-500 mt-0.5">{formatCurrency(cashMonthlyTotal * 12, homeCurrency, undefined, true)}/yr</p>
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
                        <p className="font-semibold text-gray-800">{formatCurrency(atmTotal, homeCurrency, undefined, true)}</p>
                      </div>
                      <div className="text-gray-200">|</div>
                      <div>
                        <p className="text-xs text-gray-400">Tracked cash</p>
                        <p className="font-semibold text-gray-800">{formatCurrency(cashMonthlyTotal, homeCurrency, undefined, true)}</p>
                      </div>
                      <div className="text-gray-200">|</div>
                      <div>
                        <p className="text-xs text-gray-400">Unaccounted</p>
                        <p className={`font-semibold ${unaccounted > 0 ? "text-amber-600" : "text-green-600"}`}>
                          {formatCurrency(Math.max(0, unaccounted), homeCurrency, undefined, true)}
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
                                <p className="text-xs text-gray-400">{formatCurrency(monthly, homeCurrency, undefined, true)}/mo</p>
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
                          ≈ {formatCurrency(toMonthly(cashForm.amount, cashForm.frequency as CashFrequency), homeCurrency, undefined, true)}/mo · {formatCurrency(toMonthly(cashForm.amount, cashForm.frequency as CashFrequency) * 12, homeCurrency, undefined, true)}/yr
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
