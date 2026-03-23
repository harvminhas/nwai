"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useParams } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseClient } from "@/lib/firebase";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, Cell,
} from "recharts";
import { categoryColor } from "@/app/account/spending/shared";
import type { MerchantSummary } from "@/app/api/user/spending/merchants/route";

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
  if (v >= 1_000) return `$${Math.round(v / 1_000)}k`;
  return v === 0 ? "$0" : `$${Math.round(v)}`;
}
function shortMonth(ym: string) {
  const [y, m] = ym.split("-");
  if (!m) return ym;
  return new Date(parseInt(y), parseInt(m) - 1, 1)
    .toLocaleDateString("en-US", { month: "short", year: "2-digit" });
}
function fmtDate(iso: string) {
  return new Date(iso + "T12:00:00")
    .toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
function fmtDateShort(iso: string) {
  return new Date(iso + "T12:00:00")
    .toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ── page ──────────────────────────────────────────────────────────────────────

export default function MerchantDetailPage() {
  const router = useRouter();
  const params = useParams();
  const slug = decodeURIComponent(params.slug as string);

  const [merchant, setMerchant] = useState<MerchantSummary | null>(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [sortField, setSortField] = useState<"date" | "amount">("date");
  const [sortDir, setSortDir]     = useState<"asc" | "desc">("desc");

  useEffect(() => {
    const { auth } = getFirebaseClient();
    return onAuthStateChanged(auth, async (user) => {
      if (!user) { router.push("/login"); return; }
      setLoading(true);
      try {
        const tok = await user.getIdToken();
        const res = await fetch(
          `/api/user/spending/merchants?slug=${encodeURIComponent(slug)}`,
          { headers: { Authorization: `Bearer ${tok}` } }
        );
        const json = await res.json().catch(() => ({}));
        if (!res.ok) { setError(json.error || "Failed to load"); return; }
        setMerchant(json.merchant ?? null);
      } catch {
        setError("Failed to load merchant data");
      } finally {
        setLoading(false);
      }
    });
  }, [router, slug]);

  function toggleSort(field: "date" | "amount") {
    if (sortField === field) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortField(field);
      setSortDir("desc");
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-purple-200 border-t-purple-600" />
      </div>
    );
  }
  if (error || !merchant) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-12 text-center">
        <p className="text-sm text-red-500">{error ?? "Merchant not found."}</p>
        <Link href="/account/spending?tab=merchants" className="mt-4 inline-block text-sm text-purple-600 hover:underline">
          ← Back to Merchants
        </Link>
      </div>
    );
  }

  const color = categoryColor(merchant.category);
  const chartData = merchant.monthly.map((m) => ({
    label: shortMonth(m.ym),
    ym: m.ym,
    total: m.total,
    count: m.count,
  }));
  const maxMonthly = Math.max(...merchant.monthly.map((m) => m.total), 1);

  // Sort transactions
  const sortedTxns = [...merchant.transactions].sort((a, b) => {
    if (sortField === "date") {
      const cmp = (a.date ?? a.ym).localeCompare(b.date ?? b.ym);
      return sortDir === "desc" ? -cmp : cmp;
    } else {
      const cmp = Math.abs(a.amount) - Math.abs(b.amount);
      return sortDir === "desc" ? -cmp : cmp;
    }
  });

  const activeMonths = merchant.monthly.length;
  const firstSeen = merchant.firstDate ? fmtDate(merchant.firstDate) : (merchant.monthly[0]?.ym ? shortMonth(merchant.monthly[0].ym) : "—");
  const lastSeen  = merchant.lastDate  ? fmtDate(merchant.lastDate)  : (merchant.monthly.at(-1)?.ym ? shortMonth(merchant.monthly.at(-1)!.ym) : "—");

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-8">
      {/* Header */}
      <div>
        <Link
          href="/account/spending?tab=merchants"
          className="mb-4 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Merchants
        </Link>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{merchant.name}</h1>
            <span
              className="mt-1 inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium capitalize"
              style={{ backgroundColor: color + "18", color }}
            >
              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
              {merchant.category}
            </span>
          </div>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Total spent", value: fmt(merchant.total) },
          { label: "Transactions", value: merchant.count.toString() },
          { label: "Avg per visit", value: fmtDec(merchant.avgAmount) },
          { label: "Active months", value: activeMonths.toString() },
        ].map(({ label, value }) => (
          <div key={label} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <p className="text-xs text-gray-500">{label}</p>
            <p className="mt-1 text-xl font-bold text-gray-900">{value}</p>
          </div>
        ))}
      </div>

      {/* Timeline KPIs */}
      <div className="flex gap-6 rounded-xl border border-gray-200 bg-white px-5 py-4 shadow-sm text-sm">
        <div>
          <p className="text-xs text-gray-500">First seen</p>
          <p className="mt-0.5 font-medium text-gray-800">{firstSeen}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500">Last seen</p>
          <p className="mt-0.5 font-medium text-gray-800">{lastSeen}</p>
        </div>
        <div className="ml-auto text-right">
          <p className="text-xs text-gray-500">Monthly avg (active months)</p>
          <p className="mt-0.5 font-medium text-gray-800">
            {fmt(activeMonths > 0 ? merchant.total / activeMonths : 0)}
          </p>
        </div>
      </div>

      {/* Monthly bar chart */}
      {chartData.length >= 2 && (
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <p className="mb-4 text-sm font-semibold text-gray-700">Monthly spending</p>
          <div className="h-44">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#9ca3af" }} tickLine={false} axisLine={false} />
                <YAxis tickFormatter={fmtAxis} tick={{ fontSize: 11, fill: "#9ca3af" }} tickLine={false} axisLine={false} width={48} />
                <Tooltip
                  formatter={(v) => [fmtDec(Number(v)), "Spent"]}
                  contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e5e7eb" }}
                />
                <Bar dataKey="total" radius={[4, 4, 0, 0]}>
                  {chartData.map((entry, idx) => {
                    const isMax = entry.total === maxMonthly;
                    return (
                      <Cell
                        key={idx}
                        fill={isMax ? color : color + "66"}
                      />
                    );
                  })}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Transaction list */}
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-5 pt-4 pb-2">
          <p className="text-sm font-semibold text-gray-700">
            All transactions <span className="ml-1 text-xs font-normal text-gray-400">({merchant.count})</span>
          </p>
          <div className="flex items-center gap-1">
            <span className="text-xs text-gray-400">Sort:</span>
            {(["date", "amount"] as const).map((field) => {
              const active = sortField === field;
              return (
                <button
                  key={field}
                  onClick={() => toggleSort(field)}
                  className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-xs font-medium transition capitalize ${
                    active ? "bg-gray-100 text-gray-700" : "text-gray-400 hover:text-gray-600"
                  }`}
                >
                  {field}
                  {active && (
                    <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round"
                        d={sortDir === "desc" ? "M19 9l-7 7-7-7" : "M5 15l7-7 7 7"} />
                    </svg>
                  )}
                </button>
              );
            })}
          </div>
        </div>
        <div className="divide-y divide-gray-100">
          {sortedTxns.map((txn, i) => (
            <div key={i} className="flex items-center justify-between px-5 py-3">
              <div className="min-w-0">
                <p className="text-xs text-gray-500">
                  {txn.date ? fmtDateShort(txn.date) : shortMonth(txn.ym)}
                  <span className="ml-2 text-gray-400">{shortMonth(txn.ym)}</span>
                </p>
                <span
                  className="mt-0.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs capitalize"
                  style={{ backgroundColor: categoryColor(txn.category) + "18", color: categoryColor(txn.category) }}
                >
                  {txn.category}
                </span>
              </div>
              <p className="ml-4 shrink-0 text-sm font-semibold text-gray-800 tabular-nums">
                −{fmtDec(Math.abs(txn.amount))}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
