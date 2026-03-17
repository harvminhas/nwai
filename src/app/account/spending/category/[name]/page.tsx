"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useParams } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseClient } from "@/lib/firebase";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, ReferenceLine,
} from "recharts";
import { categoryColor } from "@/app/account/spending/page";

// ── helpers ───────────────────────────────────────────────────────────────────

function fmt(v: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD",
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(v);
}
function fmtDec(v: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD",
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(v);
}
function fmtAxis(v: number) {
  if (v >= 1000) return `$${Math.round(v / 1000)}k`;
  return v === 0 ? "$0" : fmt(v);
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

interface ExpenseTxn {
  merchant: string;
  amount: number;
  category: string;
  date?: string;
}

// ── page ──────────────────────────────────────────────────────────────────────

export default function SpendingCategoryPage() {
  const router = useRouter();
  const params = useParams();
  const rawName    = decodeURIComponent(params.name as string);
  // Normalise to title case for display
  const categoryName = rawName.replace(/\b\w/g, (c) => c.toUpperCase());

  const [transactions, setTransactions]     = useState<ExpenseTxn[]>([]);
  const [categoryTotal, setCategoryTotal]   = useState(0);
  const [monthTotal, setMonthTotal]         = useState(0);
  const [yearMonth, setYearMonth]           = useState<string | null>(null);
  const [monthlyHistory, setMonthlyHistory] = useState<{ label: string; amount: number; ym: string }[]>([]);
  const [loading, setLoading]               = useState(true);
  const [error, setError]                   = useState<string | null>(null);

  useEffect(() => {
    const { auth } = getFirebaseClient();
    return onAuthStateChanged(auth, async (user) => {
      if (!user) { router.push("/account/login"); return; }
      setLoading(true); setError(null);
      try {
        const token = await user.getIdToken();

        // Fetch current month
        const res = await fetch("/api/user/statements/consolidated", {
          headers: { Authorization: `Bearer ${token}` },
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) { setError(json.error ?? "Failed to load"); return; }

        const ym = json.yearMonth ?? null;
        setYearMonth(ym);
        setMonthTotal(json.data?.expenses?.total ?? 0);

        // Filter transactions for this category
        const allTxns: ExpenseTxn[] = (json.data?.expenses?.transactions ?? []);
        const catTxns = allTxns
          .filter((t) => t.category?.toLowerCase() === rawName)
          .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
        setTransactions(catTxns);
        setCategoryTotal(catTxns.reduce((s, t) => s + t.amount, 0));

        // Fetch each month in history for category trend
        const history: { yearMonth: string }[] = json.history ?? [];
        const pastMonths = history
          .filter((h) => h.yearMonth !== ym)
          .sort((a, b) => a.yearMonth.localeCompare(b.yearMonth))
          .slice(-5);

        const monthData: { label: string; amount: number; ym: string }[] = [];

        // Add historical months
        await Promise.all(pastMonths.map(async (h) => {
          const r = await fetch(`/api/user/statements/consolidated?month=${h.yearMonth}`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          const j = await r.json().catch(() => ({}));
          if (r.ok) {
            const txns: ExpenseTxn[] = (j.data?.expenses?.transactions ?? []);
            const amt = txns
              .filter((t) => t.category?.toLowerCase() === rawName)
              .reduce((s, t) => s + t.amount, 0);
            monthData.push({ label: shortMonth(h.yearMonth), amount: amt, ym: h.yearMonth });
          }
        }));

        // Add current month
        monthData.push({ label: shortMonth(ym ?? ""), amount: catTxns.reduce((s, t) => s + t.amount, 0), ym: ym ?? "" });
        monthData.sort((a, b) => a.ym.localeCompare(b.ym));
        setMonthlyHistory(monthData);
      } catch { setError("Failed to load category data"); }
      finally { setLoading(false); }
    });
  }, [router, rawName]);

  // ── derived ───────────────────────────────────────────────────────────────

  const pctOfTotal = monthTotal > 0 ? Math.round((categoryTotal / monthTotal) * 100) : 0;
  const avg = monthlyHistory.length > 0
    ? Math.round(monthlyHistory.filter((m) => m.amount > 0).reduce((s, m) => s + m.amount, 0) /
        Math.max(monthlyHistory.filter((m) => m.amount > 0).length, 1))
    : 0;

  // Top merchants
  const merchantTotals = new Map<string, number>();
  for (const t of transactions) {
    merchantTotals.set(t.merchant, (merchantTotals.get(t.merchant) ?? 0) + t.amount);
  }
  const topMerchants = Array.from(merchantTotals.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  const color = categoryColor(rawName);

  if (loading) return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <div className="h-10 w-10 animate-spin rounded-full border-4 border-purple-600 border-t-transparent" />
    </div>
  );
  if (error) return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <p className="text-red-600">{error}</p>
    </div>
  );

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">

      {/* Back nav */}
      <Link href="/account/spending" className="mb-5 inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-700 transition">
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
              {fmt(categoryTotal)} · {pctOfTotal}% of total · {new Date(parseInt(yearMonth.slice(0,4)), parseInt(yearMonth.slice(5,7)) - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" })}
            </p>
          )}
        </div>
      </div>

      <div className="space-y-4">

        {/* KPI strip */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "This month",    value: fmt(categoryTotal) },
            { label: "Monthly avg",   value: avg > 0 ? fmt(avg) : "—" },
            { label: "% of spending", value: `${pctOfTotal}%` },
          ].map(({ label, value }) => (
            <div key={label} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm text-center">
              <p className="text-xs text-gray-400">{label}</p>
              <p className="mt-1 text-lg font-bold text-gray-900">{value}</p>
            </div>
          ))}
        </div>

        {/* Monthly trend chart */}
        {monthlyHistory.filter((m) => m.amount > 0).length >= 2 && (
          <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <p className="mb-4 text-xs font-semibold uppercase tracking-wider text-gray-400">Monthly trend</p>
            <div className="h-44">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthlyHistory} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#9ca3af" }} tickLine={false} axisLine={false} />
                  <YAxis tickFormatter={fmtAxis} tick={{ fontSize: 11, fill: "#9ca3af" }} tickLine={false} axisLine={false} width={48} />
                  <Tooltip
                    formatter={(v) => [typeof v === "number" ? fmt(v) : String(v), categoryName]}
                    contentStyle={{ borderRadius: "8px", border: "1px solid #e5e7eb", fontSize: "13px" }}
                    labelStyle={{ fontWeight: 600, color: "#111827" }}
                  />
                  {avg > 0 && (
                    <ReferenceLine y={avg} stroke="#d1d5db" strokeDasharray="4 4"
                      label={{ value: "avg", position: "insideTopRight", fontSize: 10, fill: "#9ca3af" }} />
                  )}
                  <Bar dataKey="amount" fill={color} radius={[4, 4, 0, 0]} maxBarSize={48} />
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
                      <span className="tabular-nums text-gray-500 shrink-0 ml-2">{fmt(amount)}</span>
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

        {/* All transactions */}
        {transactions.length > 0 && (
          <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-5 pt-5 pb-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Transactions</p>
              <span className="text-xs text-gray-400">{transactions.length} total</span>
            </div>
            <div className="divide-y divide-gray-100">
              {transactions.map((txn, i) => (
                <div key={i} className="flex items-center justify-between px-5 py-3.5">
                  <div>
                    <p className="text-sm font-medium text-gray-800">{txn.merchant}</p>
                    {txn.date && <p className="text-xs text-gray-400">{fmtDate(txn.date)}</p>}
                  </div>
                  <p className="text-sm font-medium text-gray-700 tabular-nums">−{fmtDec(Math.abs(txn.amount))}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {transactions.length === 0 && (
          <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-10 text-center">
            <p className="text-sm text-gray-500">No transactions in {categoryName} this month.</p>
          </div>
        )}

      </div>
    </div>
  );
}
