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
          onClick={(s) => { if (s?.activePayload?.[0]) onSelect((s.activePayload[0].payload as { ym: string }).ym); }}>
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

// ── tabs ──────────────────────────────────────────────────────────────────────

const TABS = [
  { id: "overview",       label: "Overview" },
  { id: "transactions",   label: "Transactions" },
  { id: "subscriptions",  label: "Subscriptions" },
] as const;
type TabId = typeof TABS[number]["id"];

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

  useEffect(() => {
    const { auth } = getFirebaseClient();
    return onAuthStateChanged(auth, async (user) => {
      if (!user) { router.push("/account/login"); return; }
      setLoading(true); setError(null);
      try {
        const tok = await user.getIdToken();
        setToken(tok);
        const [res] = await Promise.all([
          fetch("/api/user/statements/consolidated", { headers: { Authorization: `Bearer ${tok}` } }),
          loadRecurring(tok),
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
  }, [router, loadRecurring]);

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

  // ── derived data ──────────────────────────────────────────────────────────

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
  const hasData = total > 0 || allSubscriptions.length > 0 || txns.length > 0;

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

          {/* ── Transactions tab ──────────────────────────────────────────── */}
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

          {/* ── Subscriptions tab ─────────────────────────────────────────── */}
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
                        <div key={sub.name} className="flex items-center justify-between px-5 py-3.5">
                            <div className="min-w-0">
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
