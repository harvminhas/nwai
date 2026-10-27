"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useParams } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseClient } from "@/lib/firebase";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";
import type { IncomeSummary, IncomeSource } from "@/lib/incomeSummary";
import { formatMonth, formatMonthYear, formatDate } from "@/lib/dateFormatting";
import { formatCurrency, getCurrencySymbol } from "@/lib/currencyUtils";
import { FREQUENCY_CONFIG, RELIABILITY_CONFIG } from "@/lib/incomeEngine";

export default function IncomeSourcePage() {
  const router = useRouter();
  const params = useParams();
  const sourceName = decodeURIComponent(params.source as string);

  const [summary, setSummary] = useState<IncomeSummary | null>(null);
  const [source, setSource] = useState<IncomeSource | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [expandedMonth, setExpandedMonth] = useState<string | null>(null);

  useEffect(() => {
    const { auth } = getFirebaseClient();
    return onAuthStateChanged(auth, async (user) => {
      if (!user) {
        router.push("/login");
        return;
      }

      setLoading(true);
      setError(null);
      const tok = await user.getIdToken();
      setToken(tok);

      try {
        const res = await fetch("/api/user/income-summary", {
          headers: { Authorization: `Bearer ${tok}` },
        });

        if (!res.ok) {
          throw new Error("Failed to load income data");
        }

        const data: IncomeSummary = await res.json();
        setSummary(data);

        // Find the matching source (may be clustered with amount suffix)
        const matchedSource = data.sources.find(
          s => s.canonicalName === sourceName || s.description === sourceName
        );

        if (matchedSource) {
          setSource(matchedSource);
          // Expand the most recent month
          const recentMonth = matchedSource.transactions
            .map(t => t.date.slice(0, 7))
            .sort()
            .reverse()[0];
          if (recentMonth) setExpandedMonth(recentMonth);
        } else {
          setError(`Source "${sourceName}" not found`);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load");
      } finally {
        setLoading(false);
      }
    });
  }, [router, sourceName]);

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-purple-600 border-t-transparent" />
      </div>
    );
  }

  if (error || !source || !summary) {
    return (
      <div className="mx-auto max-w-5xl px-4 pt-4 pb-8 sm:py-8">
        <p className="text-red-600">{error || "Source not found"}</p>
        <Link href="/account/income" className="mt-4 inline-block text-purple-600 hover:underline">
          ← Back to Income
        </Link>
      </div>
    );
  }

  // Group transactions by month
  const monthMap = new Map<string, typeof source.transactions>();
  for (const txn of source.transactions) {
    const ym = txn.date.slice(0, 7);
    const existing = monthMap.get(ym) || [];
    existing.push(txn);
    monthMap.set(ym, existing);
  }

  const monthlyData = Array.from(monthMap.entries())
    .map(([ym, txns]) => ({
      yearMonth: ym,
      amount: txns.reduce((s, t) => s + t.amount, 0),
      transactions: txns.sort((a, b) => b.date.localeCompare(a.date))
    }))
    .sort((a, b) => b.yearMonth.localeCompare(a.yearMonth));

  // Chart data
  const chartData = [...monthlyData].reverse().slice(-12).map(m => ({
    month: formatMonth(m.yearMonth),
    amount: m.amount
  }));

  const freqConfig = FREQUENCY_CONFIG[source.frequency];
  const reliabilityConfig = RELIABILITY_CONFIG[source.reliability];
  const currency = summary.currency;

  const fmtAxis = (v: number) => {
    const sym = getCurrencySymbol(currency);
    const abs = Math.abs(v);
    if (abs >= 1_000_000) return `${sym}${(abs / 1_000_000).toFixed(1)}M`;
    if (abs >= 1_000) return `${sym}${Math.round(abs / 1_000)}k`;
    return v === 0 ? `${sym}0` : formatCurrency(v, currency, undefined, true);
  };

  return (
    <div className="mx-auto max-w-5xl px-4 pt-4 pb-12 sm:py-8 space-y-6">
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

      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-gray-900">{source.description}</h1>
        <div className="mt-2 flex items-center gap-2">
          <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-purple-50 text-purple-700 uppercase tracking-wide">
            {freqConfig.label}
          </span>
          <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${reliabilityConfig.badge}`}>
            {reliabilityConfig.label} ({source.reliabilityScore}% reliable)
          </span>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-xs text-gray-500 mb-1">TOTAL RECEIVED</p>
          <p className="text-3xl font-bold text-gray-900 tabular-nums">
            {formatCurrency(source.total, currency, undefined, true)}
          </p>
          <p className="text-xs text-gray-400 mt-1">
            {source.count} deposit{source.count !== 1 ? "s" : ""} · {monthlyData.length} months
          </p>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-xs text-gray-500 mb-1">AVERAGE PER DEPOSIT</p>
          <p className="text-3xl font-bold text-gray-900 tabular-nums">
            {formatCurrency(source.avgAmount, currency, undefined, true)}
          </p>
          <p className="text-xs text-gray-400 mt-1">
            Monthly equivalent: {formatCurrency(source.monthlyEquivalent, currency, undefined, true)}
          </p>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-xs text-gray-500 mb-1">LAST RECEIVED</p>
          <p className="text-3xl font-bold text-gray-900">
            {formatMonth(monthlyData[0].yearMonth)}
          </p>
          <p className="text-xs text-gray-400 mt-1">
            {formatCurrency(monthlyData[0].amount, currency)}
          </p>
        </div>
      </div>

      {/* Chart */}
      {chartData.length > 1 && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">Monthly History</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#9ca3af" }} tickLine={false} axisLine={false} />
                <YAxis tickFormatter={fmtAxis} tick={{ fontSize: 11, fill: "#9ca3af" }} tickLine={false} axisLine={false} width={60} />
                <Tooltip
                  formatter={(v) => [formatCurrency(Number(v), currency), "Amount"]}
                  contentStyle={{ fontSize: 11, borderRadius: 8, border: "1px solid #e5e7eb" }}
                />
                <Bar dataKey="amount" fill="#7c3aed" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Transaction history */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h3 className="text-sm font-semibold text-gray-900">Deposit History</h3>
        </div>

        <div className="divide-y divide-gray-100">
          {monthlyData.map((month) => {
            const isOpen = expandedMonth === month.yearMonth;
            return (
              <div key={month.yearMonth}>
                <button
                  className="w-full px-6 py-4 flex items-center justify-between hover:bg-gray-50 transition text-left"
                  onClick={() => setExpandedMonth(isOpen ? null : month.yearMonth)}
                >
                  <div>
                    <p className="text-sm font-semibold text-gray-900">{formatMonthYear(month.yearMonth)}</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {month.transactions.length} deposit{month.transactions.length !== 1 ? "s" : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-base font-semibold text-gray-900 tabular-nums">
                      {formatCurrency(month.amount, currency)}
                    </span>
                    <svg
                      className={`w-4 h-4 text-gray-400 transition-transform ${isOpen ? "rotate-180" : ""}`}
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </button>

                {isOpen && (
                  <div className="bg-gray-50 border-t border-gray-100">
                    <div className="divide-y divide-gray-100">
                      {month.transactions.map((txn, i) => (
                        <div key={i} className="px-6 py-3 flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <span className="text-xs text-gray-500 w-20">{formatDate(txn.date)}</span>
                            {txn.accountLabel && (
                              <span className="text-xs text-gray-400">{txn.accountLabel}</span>
                            )}
                          </div>
                          <span className="text-sm font-semibold text-green-600 tabular-nums">
                            +{formatCurrency(txn.amount, currency)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
