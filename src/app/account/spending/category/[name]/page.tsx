"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import Link from "next/link";
import { useRouter, useParams, useSearchParams } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseClient } from "@/lib/firebase";
import {
  ResponsiveContainer, BarChart, Bar, Cell, XAxis, YAxis,
  CartesianGrid, Tooltip, ReferenceLine,
} from "recharts";
import { merchantSlug } from "@/lib/applyRules";
import {
  categoryColor, ALL_CATEGORIES, CategoryPicker, RecurringIcon,
  type CashFrequency,
  getParentCategory,
} from "@/app/account/spending/shared";
import { fmt, getCurrencySymbol, formatCurrency } from "@/lib/currencyUtils";
import { PROFILE_REFRESHED_EVENT, useProfileRefresh } from "@/contexts/ProfileRefreshContext";

// ── helpers ───────────────────────────────────────────────────────────────────

function fmtDec(v: number, originalCurrency?: string, homeCurrency = "USD") {
  const cur = originalCurrency ?? homeCurrency;
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency: cur,
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(v);
}
function fmtAxis(v: number) {
  const sym = getCurrencySymbol();
  if (v >= 1000) return `${sym}${Math.round(v / 1000)}k`;
  return v === 0 ? `${sym}0` : fmt(v);
}
function shortMonth(ym: string) {
  const [y, m] = ym.split("-");
  if (!m) return ym;
  return new Date(parseInt(y), parseInt(m) - 1, 1)
    .toLocaleDateString("en-US", { month: "short", year: "2-digit" });
}
function fmtDate(iso: string) {
  return new Date(iso + "T12:00:00")
    .toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const FREQ_OPTIONS: { value: CashFrequency; label: string }[] = [
  { value: "weekly",    label: "Weekly" },
  { value: "biweekly",  label: "Bi-weekly" },
  { value: "monthly",   label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "annual",    label: "Annual" },
];

interface ExpenseTxn {
  merchant: string;
  amount: number;
  category: string;
  accountLabel?: string;
  date?: string;
  isCashCommitment?: boolean;
  currency?: string;
}

interface CashCommitmentItem {
  id: string;
  name: string;
  amount: number;
  frequency: string;
  category: string;
  startDate?: string;
  createdAt: string;
}

/** Monthly spend amount for a commitment in a given yearMonth. */
function commitmentAmountForMonth(entry: CashCommitmentItem, yearMonth: string): number {
  if (entry.frequency === "once") return 0;
  const floor = entry.startDate?.slice(0, 7) ?? entry.createdAt?.slice(0, 7);
  if (floor && yearMonth < floor) return 0;
  const multipliers: Record<string, number> = {
    weekly: 52 / 12, biweekly: 26 / 12, monthly: 1, quarterly: 1 / 3, annual: 1 / 12,
  };
  return entry.amount * (multipliers[entry.frequency] ?? 0);
}

interface Subscription {
  name: string; amount: number; frequency: string;
}

// ── page ──────────────────────────────────────────────────────────────────────

export default function SpendingCategoryPage() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const rawName     = decodeURIComponent(params.name as string);
  const categoryName = rawName.replace(/\b\w/g, (c) => c.toUpperCase());
  // Month context passed from the spending page (e.g. "2025-12")
  const monthParam  = searchParams.get("month") ?? null;

  const [token, setToken]                   = useState<string | null>(null);
  const [transactions, setTransactions]     = useState<ExpenseTxn[]>([]);
  const [categoryTotal, setCategoryTotal]   = useState(0);
  const [monthTotal, setMonthTotal]         = useState(0);
  const [yearMonth, setYearMonth]           = useState<string | null>(null);
  const [monthlyHistory, setMonthlyHistory] = useState<{ label: string; amount: number; ym: string }[]>([]);
  const [loading, setLoading]               = useState(true);
  const [error, setError]                   = useState<string | null>(null);
  const [toast, setToast]                   = useState<string | null>(null);
  const [homeCurrency, setHomeCurrency]     = useState<string>("USD");
  const [cashCommitments, setCashCommitments] = useState<CashCommitmentItem[]>([]);

  // Category picker
  const [openPicker, setOpenPicker]         = useState<number | null>(null);
  const btnRefs = useRef<Map<number, HTMLButtonElement>>(new Map());

  // Recurring rules
  const [recurringRules, setRecurringRules] = useState<Map<string, Subscription>>(new Map());
  // Pending recurring — frequency picker
  const [pendingRecurring, setPendingRecurring] = useState<{ txn: ExpenseTxn; anchor: HTMLElement } | null>(null);
  const [pendingFreq, setPendingFreq]           = useState<CashFrequency>("monthly");

  // Auto-dismiss toast
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(t);
  }, [toast]);

  const loadPage = useCallback(async (tok: string, name: string, month: string | null) => {
    setLoading(true); setError(null);
    try {
      const consolidatedUrl = month
        ? `/api/user/statements/consolidated?month=${month}`
        : "/api/user/statements/consolidated";
      const [consolidatedRes, recurringRes] = await Promise.all([
        fetch(consolidatedUrl, { headers: { Authorization: `Bearer ${tok}` } }),
        fetch("/api/user/recurring-rules", { headers: { Authorization: `Bearer ${tok}` } }),
      ]);
      const json   = await consolidatedRes.json().catch(() => ({}));
      const rJson  = recurringRes.ok ? await recurringRes.json().catch(() => ({})) : {};

      if (!consolidatedRes.ok) { setError(json.error ?? "Failed to load"); return; }
      if (json.homeCurrency) setHomeCurrency(json.homeCurrency);

      // Cash commitments come from the consolidated response — same source as overview
      const allCommitments: CashCommitmentItem[] = json.cashCommitmentItems ?? [];
      setCashCommitments(allCommitments);

      // Recurring rules
      const rMap = new Map<string, Subscription>();
      for (const r of (rJson.rules ?? [])) {
        rMap.set(r.slug as string, { name: r.merchant, amount: r.amount, frequency: r.frequency });
      }
      setRecurringRules(rMap);

      const ym = json.yearMonth ?? null;
      setYearMonth(ym);

      const allTxns: ExpenseTxn[] = json.data?.expenses?.transactions ?? [];
      const catTxns = allTxns
        .filter((t) => t.category?.toLowerCase() === name)
        .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));

      // Inject matching cash commitments as synthetic transactions for this month.
      // Match both exact category ("Maintenance & Repairs") and parent rollup ("housing").
      const matchesCategory = (cat: string | undefined) => {
        if (!cat) return false;
        if (cat.toLowerCase() === name) return true;
        return getParentCategory(cat).toLowerCase() === name;
      };
      const matchingCommitments: ExpenseTxn[] = ym
        ? allCommitments
            .filter((c) => matchesCategory(c.category) && commitmentAmountForMonth(c, ym) > 0)
            .map((c) => ({
              merchant: c.name,
              amount: commitmentAmountForMonth(c, ym),
              category: c.category,
              isCashCommitment: true,
            }))
        : [];

      const allCatTxns = [...catTxns, ...matchingCommitments];
      setTransactions(allCatTxns);
      const catTotal = allCatTxns.reduce((s, t) => s + t.amount, 0);
      setCategoryTotal(catTotal);
      setMonthTotal((json.data?.expenses?.total ?? 0) + matchingCommitments.reduce((s, t) => s + t.amount, 0));

      // History trend
      const history: { yearMonth: string }[] = json.history ?? [];
      const pastMonths = history
        .filter((h) => h.yearMonth !== ym)
        .sort((a, b) => a.yearMonth.localeCompare(b.yearMonth))
        .slice(-5);

      const monthData: { label: string; amount: number; ym: string }[] = [];
      await Promise.all(pastMonths.map(async (h) => {
        const r = await fetch(`/api/user/statements/consolidated?month=${h.yearMonth}`, {
          headers: { Authorization: `Bearer ${tok}` },
        });
        const j = await r.json().catch(() => ({}));
        if (r.ok) {
          const txns: ExpenseTxn[] = j.data?.expenses?.transactions ?? [];
          const stmtAmt = txns
            .filter((t) => t.category?.toLowerCase() === name)
            .reduce((s, t) => s + t.amount, 0);
          const cashAmt = allCommitments
            .filter((c) => matchesCategory(c.category))
            .reduce((s, c) => s + commitmentAmountForMonth(c, h.yearMonth), 0);
          monthData.push({ label: shortMonth(h.yearMonth), amount: stmtAmt + cashAmt, ym: h.yearMonth });
        }
      }));
      monthData.push({ label: shortMonth(ym ?? ""), amount: catTotal, ym: ym ?? "" });
      monthData.sort((a, b) => a.ym.localeCompare(b.ym));
      setMonthlyHistory(monthData);
    } catch { setError("Failed to load category data"); }
    finally { setLoading(false); }
  }, []);

  const { requestProfileRefresh } = useProfileRefresh();
  const loadPageRef = useRef(loadPage);
  loadPageRef.current = loadPage;

  useEffect(() => {
    if (!token) return;
    const onProfileRefreshed = () => {
      loadPageRef.current(token, rawName, monthParam);
    };
    window.addEventListener(PROFILE_REFRESHED_EVENT, onProfileRefreshed);
    return () => window.removeEventListener(PROFILE_REFRESHED_EVENT, onProfileRefreshed);
  }, [token, rawName, monthParam]);

  useEffect(() => {
    const { auth } = getFirebaseClient();
    return onAuthStateChanged(auth, async (user) => {
      if (!user) { router.push("/login"); return; }
      const tok = await user.getIdToken();
      setToken(tok);
      loadPage(tok, rawName, monthParam);
    });
  }, [router, rawName, monthParam, loadPage]);

  // ── category change ─────────────────────────────────────────────────────────

  async function handleCategoryChange(idx: number, newCategory: string) {
    const txn = transactions[idx];
    if (!txn || !token) return;
    setOpenPicker(null);
    setTransactions((prev) => prev.map((t, i) => i === idx ? { ...t, category: newCategory } : t));
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

  // ── recurring toggle ────────────────────────────────────────────────────────

  function handleRecurringToggle(txn: ExpenseTxn, anchorEl: HTMLElement) {
    if (!token) return;
    const slug = merchantSlug(txn.merchant);
    if (recurringRules.has(slug)) {
      setRecurringRules((prev) => { const next = new Map(prev); next.delete(slug); return next; });
      fetch(`/api/user/recurring-rules?slug=${encodeURIComponent(slug)}`, {
        method: "DELETE", headers: { Authorization: `Bearer ${token}` },
      }).catch(() => {});
      setToast(`"${txn.merchant}" unmarked as recurring`);
    } else {
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

  // ── derived ─────────────────────────────────────────────────────────────────

  const pctOfTotal = monthTotal > 0 ? Math.round((categoryTotal / monthTotal) * 100) : 0;
  const avg = monthlyHistory.length > 0
    ? Math.round(monthlyHistory.filter((m) => m.amount > 0).reduce((s, m) => s + m.amount, 0) /
        Math.max(monthlyHistory.filter((m) => m.amount > 0).length, 1))
    : 0;

  const merchantTotals = new Map<string, number>();
  for (const t of transactions) {
    merchantTotals.set(t.merchant, (merchantTotals.get(t.merchant) ?? 0) + t.amount);
  }
  const topMerchants = Array.from(merchantTotals.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const color = categoryColor(rawName);

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

  return (
    <div className="mx-auto max-w-2xl px-4 pt-4 pb-8 sm:py-8 sm:px-6">

      {/* Back nav */}
      <Link href={monthParam ? `/account/spending?month=${monthParam}` : "/account/spending"} className="mb-5 inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-700 transition">
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
        Spending
      </Link>

      {/* Header */}
      <div className="mb-6 flex items-center gap-3">
        <span className="h-3.5 w-3.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
        <div>
          <h1 className="text-3xl font-bold text-gray-900">{categoryName}</h1>
          {yearMonth && (
            <p className="mt-0.5 text-sm text-gray-400">
              {formatCurrency(categoryTotal, homeCurrency, undefined, true)} · {pctOfTotal}% of total · {new Date(parseInt(yearMonth.slice(0,4)), parseInt(yearMonth.slice(5,7)) - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" })}
            </p>
          )}
        </div>
      </div>

      <div className="space-y-4">

        {/* KPI strip */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: yearMonth ? new Date(parseInt(yearMonth.slice(0,4)), parseInt(yearMonth.slice(5,7)) - 1, 1).toLocaleDateString("en-US", { month: "short", year: "numeric" }) : "This month", value: formatCurrency(categoryTotal, homeCurrency, undefined, true) },
            { label: "Monthly avg",   value: avg > 0 ? formatCurrency(avg, homeCurrency, undefined, true) : "—" },
            { label: "% of spending", value: `${pctOfTotal}%` },
          ].map(({ label, value }) => (
            <div key={label} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm text-center">
              <p className="text-xs text-gray-400">{label}</p>
              <p className="mt-1 text-lg font-bold text-gray-900">{value}</p>
            </div>
          ))}
        </div>

        {/* Monthly trend chart — click a bar to see that month's detail */}
        {monthlyHistory.filter((m) => m.amount > 0).length >= 2 && (
          <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-gray-400">Monthly trend</p>
            <p className="mb-4 text-[11px] text-gray-400">Tap a bar to view that month</p>
            <div className="h-44">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={monthlyHistory}
                  margin={{ top: 4, right: 8, left: 0, bottom: 0 }}
                  style={{ outline: "none" }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#9ca3af" }} tickLine={false} axisLine={false} />
                  <YAxis tickFormatter={fmtAxis} tick={{ fontSize: 11, fill: "#9ca3af" }} tickLine={false} axisLine={false} width={48} />
                  <Tooltip
                    formatter={(v) => [typeof v === "number" ? formatCurrency(v, homeCurrency, undefined, true) : String(v), categoryName]}
                    contentStyle={{ borderRadius: "8px", border: "1px solid #e5e7eb", fontSize: "13px" }}
                    labelStyle={{ fontWeight: 600, color: "#111827" }}
                    cursor={{ fill: "rgba(0,0,0,0.04)" }}
                  />
                  {avg > 0 && (
                    <ReferenceLine y={avg} stroke="#d1d5db" strokeDasharray="4 4"
                      label={{ value: "avg", position: "insideTopRight", fontSize: 10, fill: "#9ca3af" }} />
                  )}
                  <Bar
                    dataKey="amount"
                    radius={[4, 4, 0, 0]}
                    maxBarSize={48}
                    style={{ cursor: "pointer" }}
                    onClick={(data) => {
                      const ym = (data as unknown as { ym?: string })?.ym;
                      if (ym) router.push(`/account/spending/category/${encodeURIComponent(rawName)}?month=${ym}`);
                    }}
                  >
                    {monthlyHistory.map((entry) => (
                      <Cell
                        key={entry.ym}
                        fill={color}
                        opacity={entry.ym === (monthParam ?? yearMonth) ? 1 : 0.45}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* Top merchants */}
        {topMerchants.length > 0 && (
          <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">Top merchants this month</p>
            <div className="space-y-2.5">
              {topMerchants.map(([merchant, amount]) => {
                const pct = categoryTotal > 0 ? (amount / categoryTotal) * 100 : 0;
                return (
                  <div key={merchant}>
                    <div className="flex items-center justify-between text-sm mb-1">
                      <span className="font-medium text-gray-700 truncate">{merchant}</span>
                      <span className="tabular-nums text-gray-500 shrink-0 ml-2">{formatCurrency(amount, homeCurrency, undefined, true)}</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-gray-100">
                      <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Transactions */}
        {transactions.length > 0 && (
          <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-5 pt-5 pb-1">
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Transactions</p>
              <span className="text-xs text-gray-400">{transactions.length} total</span>
            </div>
            <p className="px-5 pt-1 pb-3 text-xs text-gray-400">
              Tap the category pill to recategorise · tap ↻ to mark as recurring
            </p>
            <div className="divide-y divide-gray-100">
              {transactions.map((txn, i) => {
                const slug        = merchantSlug(txn.merchant);
                const isManualSub = recurringRules.has(slug);
                const txnColor    = categoryColor(txn.category?.toLowerCase() ?? "other");
                return (
                  <div key={i} className="flex items-center justify-between px-5 py-3.5">
                    <div className="min-w-0 flex-1">
                      {txn.isCashCommitment ? (
                        <span className="block truncate text-sm font-medium text-gray-800">{txn.merchant}</span>
                      ) : (
                        <Link
                          href={`/account/spending/merchant/${encodeURIComponent(merchantSlug(txn.merchant))}`}
                          className="block truncate text-sm font-medium text-gray-800 hover:text-purple-600 hover:underline"
                        >
                          {txn.merchant}
                        </Link>
                      )}
                      <div className="mt-1 flex items-center gap-2 flex-wrap">
                        {txn.isCashCommitment && (
                          <span className="text-xs font-medium text-amber-600 bg-amber-50 rounded px-1.5 py-0.5">Cash</span>
                        )}
                        {txn.date && <span className="text-xs text-gray-400">{fmtDate(txn.date)}</span>}
                        {txn.accountLabel && (
                          <span className="text-xs text-gray-400 bg-gray-100 rounded px-1.5 py-0.5">{txn.accountLabel}</span>
                        )}

                        {/* Category pill — not shown for cash commitments (managed from Spending › Cash) */}
                        {!txn.isCashCommitment && (
                          <>
                            <button
                              ref={(el) => { if (el) btnRefs.current.set(i, el); else btnRefs.current.delete(i); }}
                              onClick={() => setOpenPicker(openPicker === i ? null : i)}
                              className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-xs font-medium text-gray-600 transition hover:border-purple-300 hover:bg-purple-50 hover:text-purple-700"
                            >
                              <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: txnColor }} />
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

                        {/* Recurring toggle — not shown for cash commitments */}
                        {!txn.isCashCommitment && (
                        <button
                          onClick={(e) => handleRecurringToggle(txn, e.currentTarget)}
                          title={isManualSub ? "Remove from recurring" : "Mark as recurring"}
                          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium transition ${
                            isManualSub
                              ? "border-purple-200 bg-purple-50 text-purple-600"
                              : "border-gray-200 bg-gray-50 text-gray-400 hover:border-purple-200 hover:bg-purple-50 hover:text-purple-500"
                          }`}
                        >
                          <RecurringIcon active={isManualSub} />
                          {isManualSub
                            ? (recurringRules.get(slug)?.frequency ?? "recurring")
                            : "↻"}
                        </button>
                        )}
                      </div>
                    </div>
                    <p className="ml-4 shrink-0 text-sm font-medium text-gray-700 tabular-nums">
                      −{fmtDec(Math.abs(txn.amount), txn.currency, homeCurrency)}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {transactions.length === 0 && (
          <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-10 text-center">
            <p className="text-sm text-gray-500">No transactions in {categoryName} this month.</p>
          </div>
        )}

      </div>

      {/* Frequency picker popover */}
      {pendingRecurring && (() => {
        const rect = pendingRecurring.anchor.getBoundingClientRect();
        return (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setPendingRecurring(null)} />
            <div
              className="fixed z-50 w-56 rounded-xl border border-gray-200 bg-white shadow-lg"
              style={{ top: rect.bottom + 6, left: Math.min(rect.left, window.innerWidth - 232) }}
            >
              <div className="border-b border-gray-100 px-3 py-2.5">
                <p className="text-xs font-semibold text-gray-700 truncate">{pendingRecurring.txn.merchant}</p>
                <p className="text-[11px] text-gray-400 mt-0.5">How often does this recur?</p>
              </div>
              <div className="p-1.5 space-y-0.5">
                {FREQ_OPTIONS.map(({ value, label }) => (
                  <button key={value} onClick={() => setPendingFreq(value)}
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
              <div className="border-t border-gray-100 p-2">
                <button onClick={confirmRecurring}
                  className="w-full rounded-lg bg-purple-600 py-2 text-sm font-semibold text-white hover:bg-purple-700 transition">
                  Mark as recurring
                </button>
              </div>
            </div>
          </>
        );
      })()}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 rounded-full bg-gray-900 px-4 py-2 text-sm text-white shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}
