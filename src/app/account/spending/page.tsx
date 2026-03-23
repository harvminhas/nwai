"use client";

import { useEffect, useState, useRef, useCallback, Suspense } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseClient } from "@/lib/firebase";
import type { ParsedStatementData, ExpenseTransaction, Subscription } from "@/lib/types";
import { merchantSlug } from "@/lib/applyRules";
import { detectFrequency, FREQUENCY_CONFIG, type Frequency } from "@/lib/incomeEngine";
import {
  BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ResponsiveContainer,
} from "recharts";

// ── constants ─────────────────────────────────────────────────────────────────

export const CATEGORY_COLORS: Record<string, string> = {
  housing: "#3b82f6",
  groceries: "#22c55e",
  dining: "#fb923c",
  transportation: "#f59e0b",
  shopping: "#a855f7",
  entertainment: "#ec4899",
  subscriptions: "#94a3b8",
  healthcare: "#14b8a6",
  "transfers & payments": "#06b6d4",
  "cash & atm": "#f87171",
  other: "#d1d5db",
};

export function categoryColor(name: string): string {
  return CATEGORY_COLORS[name.toLowerCase()] ?? "#a855f7";
}

// "Subscriptions" removed — it is a payment behaviour (recurring), not a spend category
export const ALL_CATEGORIES = [
  "Housing",
  "Groceries",
  "Dining",
  "Transportation",
  "Shopping",
  "Entertainment",
  "Healthcare",
  "Transfers & Payments",
  "Cash & ATM",
  "Other",
] as const;

// ── CategoryPicker (portal, fixed-position) ───────────────────────────────────

interface CategoryPickerProps {
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  current: string;
  onSelect: (cat: string) => void;
  onClose: () => void;
}
function CategoryPicker({ anchorRef, current, onSelect, onClose }: CategoryPickerProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<React.CSSProperties>({ visibility: "hidden" });

  useEffect(() => {
    if (!anchorRef.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    const menuHeight = 340;
    const spaceBelow = window.innerHeight - rect.bottom;
    const top = spaceBelow >= menuHeight ? rect.bottom + 6 : rect.top - menuHeight - 6;
    setStyle({
      position: "fixed", top,
      left: Math.min(rect.left, window.innerWidth - 216),
      width: 208, zIndex: 9999, visibility: "visible",
    });
  }, [anchorRef]);

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node) &&
          anchorRef.current && !anchorRef.current.contains(e.target as Node)) onClose();
    }
    function onScroll() { onClose(); }
    document.addEventListener("mousedown", handle);
    window.addEventListener("scroll", onScroll, true);
    return () => { document.removeEventListener("mousedown", handle); window.removeEventListener("scroll", onScroll, true); };
  }, [onClose, anchorRef]);

  return createPortal(
    <div ref={menuRef} style={style}
      className="rounded-xl border border-gray-200 bg-white py-1 shadow-xl ring-1 ring-black/5">
      <p className="px-3 pb-1.5 pt-2 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
        Change category · saves as rule
      </p>
      {ALL_CATEGORIES.map((cat) => {
        const color = categoryColor(cat.toLowerCase());
        const isActive = cat.toLowerCase() === current.toLowerCase();
        return (
          <button key={cat} onClick={() => onSelect(cat)}
            className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition hover:bg-gray-50 ${isActive ? "font-semibold text-gray-900" : "text-gray-700"}`}>
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
            {cat}
            {isActive && <span className="ml-auto text-xs text-gray-400">current</span>}
          </button>
        );
      })}
    </div>,
    document.body
  );
}

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

function SpendingChart({ history, avg, selectedMonth, onSelect }: {
  history: HistoryPoint[];
  avg: number | null;
  selectedMonth: string | null;
  onSelect: (ym: string) => void;
}) {
  const data = history
    .filter((h) => (h.expensesTotal ?? 0) > 0)
    .map((h) => ({
      ym: h.yearMonth,
      label: shortMonth(h.yearMonth),
      amount: h.expensesTotal ?? 0,
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
      {avg !== null && (
        <p className="mb-4 text-sm font-medium text-gray-600">
          {data.length}-month avg <span className="font-bold text-gray-900">{fmt(avg)} / mo</span>
        </p>
      )}
      <ResponsiveContainer width="100%" height={140}>
        <BarChart data={data} barSize={22} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}
          onClick={(s) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const ym = (s as any)?.activePayload?.[0]?.payload?.ym as string | undefined;
            if (ym) onSelect(ym);
          }}>
          <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="#f3f4f6" />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#9ca3af" }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 10, fill: "#9ca3af" }} axisLine={false} tickLine={false}
            tickFormatter={(v: number) => v >= 1000 ? `$${Math.round(v / 1000)}k` : `$${v}`} />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: "#f5f3ff" }} />
          {avg !== null && (
            <ReferenceLine y={avg} stroke="#a78bfa" strokeDasharray="4 3" strokeWidth={1.5}
              label={{ value: "avg", position: "right", fontSize: 10, fill: "#a78bfa" }} />
          )}
          <Bar dataKey="amount" radius={[4, 4, 0, 0]} label={false}>
            {data.map((entry) => (
              <Cell key={entry.ym} fill={entry.ym === selectedMonth ? "#7c3aed" : "#c4b5fd"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Recurring toggle icon ─────────────────────────────────────────────────────

function RecurringIcon({ active }: { active: boolean }) {
  return (
    <svg className={`h-3.5 w-3.5 ${active ? "text-purple-600" : "text-gray-300"}`}
      fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round"
        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
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
  { id: "subscriptions",  label: "Recurring" },
  { id: "cash",           label: "Cash" },
] as const;
type TabId = typeof TABS[number]["id"];

// ── cash commitment types ─────────────────────────────────────────────────────

export type CashFrequency = "weekly" | "biweekly" | "monthly" | "quarterly" | "once";

export interface CashCommitment {
  id: string;
  name: string;
  amount: number;
  frequency: CashFrequency;
  category: string;
  notes?: string;
  nextDate?: string; // ISO date e.g. "2026-03-28" — required when frequency is "once"
  createdAt: string;
  updatedAt: string;
}

export const CASH_FREQ_OPTIONS: { value: CashFrequency; label: string; perYear: number }[] = [
  { value: "weekly",    label: "Weekly",    perYear: 52 },
  { value: "biweekly",  label: "Biweekly",  perYear: 26 },
  { value: "monthly",   label: "Monthly",   perYear: 12 },
  { value: "quarterly", label: "Quarterly", perYear: 4 },
  { value: "once",      label: "One-off",   perYear: 0 },
];

function toMonthly(amount: number, freq: CashFrequency): number {
  if (freq === "once") return 0; // one-offs don't count toward monthly estimate
  const opt = CASH_FREQ_OPTIONS.find((o) => o.value === freq);
  return amount * (opt ? opt.perYear / 12 : 1);
}

// ── helpers ───────────────────────────────────────────────────────────────────

function fmt(v: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(v);
}
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

type HistoryPoint = { yearMonth: string; netWorth: number; expensesTotal?: number };

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
  const [yearMonth, setYearMonth]       = useState<string | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  const [history, setHistory]           = useState<HistoryPoint[]>([]);
  const [prevExpenses, setPrevExpenses] = useState<number | null>(null);
  const [loading, setLoading]           = useState(true);
  const [monthLoading, setMonthLoading] = useState(false);
  const [error, setError]               = useState<string | null>(null);
  const [token, setToken]               = useState<string | null>(null);

  // Transactions with optimistic category overrides
  const [txns, setTxns]             = useState<ExpenseTransaction[]>([]);
  // Which transaction row has the category picker open (index)
  const [openPicker, setOpenPicker] = useState<number | null>(null);
  // Per-row button refs for portal positioning
  const btnRefs = useRef<Map<number, HTMLButtonElement>>(new Map());

  // User-marked recurring rules { slug → Subscription }
  const [recurringRules, setRecurringRules] = useState<Map<string, Subscription>>(new Map());
  // Auto-detected frequency per merchant slug (from cross-month gap analysis)
  const [merchantFrequency, setMerchantFrequency] = useState<Map<string, Frequency>>(new Map());

  const [toast, setToast] = useState<string | null>(null);

  // ── cash commitments ────────────────────────────────────────────────────────
  const [cashItems, setCashItems] = useState<CashCommitment[]>([]);
  const [cashLoading, setCashLoading] = useState(false);
  const [cashForm, setCashForm] = useState<Partial<CashCommitment> | null>(null); // null = closed
  const [cashSaving, setCashSaving] = useState(false);

  function switchTab(id: TabId) {
    setActiveTab(id);
    const p = new URLSearchParams(searchParams.toString());
    p.set("tab", id);
    router.replace(`${pathname}?${p.toString()}`, { scroll: false });
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

  useEffect(() => {
    const { auth } = getFirebaseClient();
    return onAuthStateChanged(auth, async (user) => {
      if (!user) { router.push("/login"); return; }
      setLoading(true); setError(null);
      try {
        const tok = await user.getIdToken();
        setToken(tok);
        const [res] = await Promise.all([
          fetch("/api/user/statements/consolidated", { headers: { Authorization: `Bearer ${tok}` } }),
          loadRecurring(tok),
          loadCash(tok),
        ]);
        const json = await res.json().catch(() => ({}));
        if (!res.ok) { setError(json.error || "Failed to load"); return; }
        const currentYM = json.yearMonth ?? null;
        setData(json.data ?? null);
        setYearMonth(currentYM);
        setSelectedMonth(currentYM);
        setHistory(Array.isArray(json.history) ? json.history : []);
        setPrevExpenses(json.previousMonth?.expenses ?? null);
        const raw: ExpenseTransaction[] = (json.data?.expenses?.transactions ?? [])
          .slice()
          .sort((a: ExpenseTransaction, b: ExpenseTransaction) => (b.date ?? "").localeCompare(a.date ?? ""));
        setTxns(raw);

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
    setMonthLoading(true);
    try {
      const url = ym === yearMonth
        ? "/api/user/statements/consolidated"
        : `/api/user/statements/consolidated?month=${encodeURIComponent(ym)}`;
      const res  = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return;
      setData(json.data ?? null);
      setPrevExpenses(json.previousMonth?.expenses ?? null);
      const raw: ExpenseTransaction[] = (json.data?.expenses?.transactions ?? [])
        .slice()
        .sort((a: ExpenseTransaction, b: ExpenseTransaction) => (b.date ?? "").localeCompare(a.date ?? ""));
      setTxns(raw);
    } finally { setMonthLoading(false); }
  }

  // ── category change ───────────────────────────────────────────────────────

  async function handleCategoryChange(txnIndex: number, newCategory: string) {
    const txn = txns[txnIndex];
    if (!txn || !token) return;
    setOpenPicker(null);
    setTxns((prev) => prev.map((t, i) => i === txnIndex ? { ...t, category: newCategory } : t));
    try {
      await fetch("/api/user/category-rules", {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ merchant: txn.merchant, category: newCategory }),
      });
      setToast(`Rule saved: "${txn.merchant}" → ${newCategory}`);
    } catch { setToast("Failed to save rule"); }
  }

  // ── recurring toggle ──────────────────────────────────────────────────────

  async function handleRecurringToggle(txn: ExpenseTransaction) {
    if (!token) return;
    const slug = merchantSlug(txn.merchant);
    const isCurrentlyRecurring = recurringRules.has(slug);

    // Optimistic update
    setRecurringRules((prev) => {
      const next = new Map(prev);
      if (isCurrentlyRecurring) {
        next.delete(slug);
      } else {
        next.set(slug, { name: txn.merchant, amount: txn.amount, frequency: "monthly" });
      }
      return next;
    });

    try {
      if (isCurrentlyRecurring) {
        await fetch(`/api/user/recurring-rules?slug=${encodeURIComponent(slug)}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        });
        setToast(`"${txn.merchant}" unmarked as recurring`);
      } else {
        await fetch("/api/user/recurring-rules", {
          method: "PUT",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ merchant: txn.merchant, amount: txn.amount, frequency: "monthly", category: txn.category }),
        });
        setToast(`"${txn.merchant}" marked as recurring`);
      }
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
    } catch { setToast("Failed to save"); }
    finally { setCashSaving(false); }
  }

  async function handleCashDelete(id: string) {
    if (!token) return;
    setCashItems((prev) => prev.filter((c) => c.id !== id));
    await fetch(`/api/user/cash-commitments?id=${encodeURIComponent(id)}`, {
      method: "DELETE", headers: { Authorization: `Bearer ${token}` },
    });
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
  const manualOnly = Array.from(recurringRules.values()).filter(
    (r) => !aiSubSlugs.has(merchantSlug(r.name))
  );
  const allSubscriptions: (Subscription & { source: "ai" | "manual"; detectedFrequency: string })[] = [
    ...aiSubscriptions.map((s) => ({
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

  // Derive total and categories from live txns
  const total = txns.length > 0
    ? txns.reduce((s, t) => s + t.amount, 0)
    : (data?.expenses?.total ?? 0);

  const categories = (() => {
    if (txns.length === 0) return (data?.expenses?.categories ?? []).slice().sort((a, b) => b.amount - a.amount);
    const map = new Map<string, number>();
    for (const tx of txns) {
      const key = tx.category || "Other";
      map.set(key, (map.get(key) ?? 0) + tx.amount);
    }
    return Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([name, amount]) => ({
        name, amount,
        percentage: total > 0 ? Math.round((amount / total) * 100) : 0,
      }));
  })();

  const monthsTracked = history.length;
  const avgExpenses   = monthsTracked > 0
    ? Math.round(history.reduce((s, h) => s + (h.expensesTotal ?? 0), 0) / monthsTracked)
    : null;
  const expDelta  = prevExpenses !== null ? total - prevExpenses : null;
  const subsYearly = allSubscriptions.reduce((s, sub) => {
    const monthly = sub.frequency === "annual" ? sub.amount / 12 : sub.amount;
    return s + monthly * 12;
  }, 0);
  const hasData = total > 0 || allSubscriptions.length > 0 || txns.length > 0 || cashItems.length > 0;

  if (loading) return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <div className="h-10 w-10 animate-spin rounded-full border-4 border-purple-600 border-t-transparent" />
    </div>
  );

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">

      {/* Header */}
      <div className="mb-1">
        <h1 className="font-bold text-3xl text-gray-900">Spending</h1>
        {selectedMonth && (
          <p className="mt-0.5 text-sm text-gray-400">
            {total > 0 && <>{fmt(total)} · </>}{monthLabel(selectedMonth)}
            {monthLoading && <span className="ml-2 text-xs text-gray-300">loading…</span>}
          </p>
        )}
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
              {history.filter((h) => (h.expensesTotal ?? 0) > 0).length >= 2 && (
                <SpendingChart
                  history={history}
                  avg={avgExpenses}
                  selectedMonth={selectedMonth}
                  onSelect={handleMonthSelect}
                />
              )}
              {total > 0 && (
                <div className="grid grid-cols-2 gap-4">
                  <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
                    <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">This Month</p>
                    <p className="mt-2 font-bold text-2xl text-gray-900">{fmt(total)}</p>
                    {expDelta !== null && (
                      <p className={`mt-1 text-xs font-medium ${expDelta > 0 ? "text-red-500" : "text-green-600"}`}>
                        {expDelta > 0 ? "↑" : "↓"} {fmt(Math.abs(expDelta))} vs{" "}
                        {yearMonth ? shortMonth(history.filter(h => h.yearMonth < yearMonth).slice(-1)[0]?.yearMonth ?? "") : "last month"}
                      </p>
                    )}
                  </div>
                  <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
                    <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Monthly Avg</p>
                    <p className="mt-2 font-bold text-2xl text-gray-900">{avgExpenses !== null ? fmt(avgExpenses) : "—"}</p>
                    <p className="mt-1 text-xs text-gray-400">
                      {monthsTracked > 0 ? `${monthsTracked} month${monthsTracked !== 1 ? "s" : ""} tracked` : "No history yet"}
                    </p>
                  </div>
                </div>
              )}

              {categories.length > 0 && (
                <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
                  <p className="px-5 pt-5 pb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">By Category</p>
                  <div className="divide-y divide-gray-100">
                    {categories.map((cat) => {
                      const color = categoryColor(cat.name);
                      return (
                        <Link key={cat.name}
                          href={`/account/spending/category/${encodeURIComponent(cat.name.toLowerCase())}`}
                          className="flex items-center gap-4 px-5 py-3.5 group hover:bg-gray-50 transition">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between mb-1.5">
                              <span className="text-sm font-medium text-gray-800 group-hover:text-purple-600 transition-colors">{cat.name}</span>
                              <div className="flex items-center gap-2 shrink-0">
                                <span className="text-sm font-semibold text-gray-700 tabular-nums">{fmt(cat.amount)}</span>
                                <span className="text-xs text-gray-400 w-8 text-right">{cat.percentage}%</span>
                                <svg className="h-4 w-4 text-gray-300 group-hover:text-purple-400 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                                </svg>
                              </div>
                            </div>
                            <div className="h-1.5 overflow-hidden rounded-full bg-gray-100">
                              <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(cat.percentage, 100)}%`, backgroundColor: color }} />
                            </div>
                          </div>
                        </Link>
                      );
                    })}
                  </div>
                </div>
              )}
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
              ) : (
                <>
                  <p className="px-5 pt-4 pb-1 text-xs text-gray-400">
                    Tap the category pill to recategorise · tap ↻ to mark as recurring
                  </p>
                  <div className="divide-y divide-gray-100">
                    {txns.map((txn, i) => {
                      const color = categoryColor(txn.category ?? "other");
                      const slug = merchantSlug(txn.merchant);
                      const isAiSub      = aiSubSlugs.has(slug);
                      const isManualSub  = recurringRules.has(slug);
                      const isRecurring  = isAiSub || isManualSub;
                      return (
                        <div key={i} className="flex items-center justify-between px-5 py-3.5">
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-gray-800 truncate">{txn.merchant}</p>
                            <div className="mt-1 flex items-center gap-2 flex-wrap">
                              {txn.date && <span className="text-xs text-gray-400">{fmtDate(txn.date)}</span>}
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
                                  - AI-detected: shown as read-only teal badge
                                  - Manual: purple, clickable to remove
                                  - Neither: faint button to add  */}
                              {(() => {
                                const freq = resolvedFrequency(txn.merchant, "monthly");
                                const freqLabel = freq !== "monthly" ? freq : null;
                                return isAiSub ? (
                                  <span
                                    title="Auto-detected as recurring"
                                    className="inline-flex items-center gap-1 rounded-full border border-teal-200 bg-teal-50 px-2 py-0.5 text-xs font-medium text-teal-600"
                                  >
                                    <RecurringIcon active={true} />
                                    {freqLabel ?? "recurring"}
                                  </span>
                                ) : (
                                  <button
                                    onClick={() => handleRecurringToggle(txn)}
                                    title={isManualSub ? "Remove from recurring" : "Mark as recurring"}
                                    className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium transition ${
                                      isManualSub
                                        ? "border-purple-200 bg-purple-50 text-purple-600"
                                        : "border-gray-200 bg-gray-50 text-gray-400 hover:border-purple-200 hover:bg-purple-50 hover:text-purple-500"
                                    }`}
                                  >
                                    <RecurringIcon active={isRecurring} />
                                    {isManualSub ? (freqLabel ?? "recurring") : "↻"}
                                  </button>
                                );
                              })()}
                            </div>
                          </div>
                          <p className="ml-4 shrink-0 text-sm font-medium text-gray-700 tabular-nums">
                            −{fmtDec(Math.abs(txn.amount))}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </>
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
                  onClick={() => setCashForm({ frequency: "monthly", category: "Other" })}
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
                        <select
                          value={cashForm.category ?? "Other"}
                          onChange={(e) => setCashForm((f) => ({ ...f, category: e.target.value }))}
                          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-purple-400 focus:outline-none focus:ring-1 focus:ring-purple-200"
                        >
                          {ALL_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                        </select>
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
