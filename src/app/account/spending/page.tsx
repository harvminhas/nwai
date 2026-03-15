"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseClient } from "@/lib/firebase";
import type { ParsedStatementData } from "@/lib/types";

const CATEGORY_COLORS: Record<string, string> = {
  housing: "bg-blue-500",
  groceries: "bg-green-500",
  dining: "bg-orange-400",
  transportation: "bg-amber-500",
  shopping: "bg-purple-500",
  entertainment: "bg-pink-500",
  subscriptions: "bg-gray-400",
  healthcare: "bg-teal-500",
  "transfers & payments": "bg-cyan-500",
  "cash & atm": "bg-red-400",
  other: "bg-gray-300",
};

function barColor(name: string) {
  return CATEGORY_COLORS[name.toLowerCase()] ?? "bg-purple-400";
}

function formatCurrency(v: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD",
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(v);
}

function formatCurrencyDecimals(v: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD",
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(v);
}

function monthLabel(ym: string) {
  const [y, m] = ym.split("-");
  if (!m) return ym;
  return new Date(parseInt(y), parseInt(m) - 1, 1)
    .toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

function shortMonth(ym: string) {
  const [y, m] = ym.split("-");
  if (!m) return ym;
  return new Date(parseInt(y), parseInt(m) - 1, 1)
    .toLocaleDateString("en-US", { month: "short" });
}

type HistoryPoint = { yearMonth: string; netWorth: number; expensesTotal?: number };

export default function SpendingPage() {
  const router = useRouter();
  const [data, setData] = useState<ParsedStatementData | null>(null);
  const [yearMonth, setYearMonth] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [prevExpenses, setPrevExpenses] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAllSubs, setShowAllSubs] = useState(false);
  const [showAllTransactions, setShowAllTransactions] = useState(false);

  useEffect(() => {
    const { auth } = getFirebaseClient();
    return onAuthStateChanged(auth, async (user) => {
      if (!user) { router.push("/account/login"); return; }
      setLoading(true); setError(null);
      try {
        const token = await user.getIdToken();
        const res = await fetch("/api/user/statements/consolidated", {
          headers: { Authorization: `Bearer ${token}` },
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) { setError(json.error || "Failed to load"); return; }
        setData(json.data ?? null);
        setYearMonth(json.yearMonth ?? null);
        const hist: HistoryPoint[] = Array.isArray(json.history) ? json.history : [];
        setHistory(hist);
        // Previous month expenses from previousMonth object
        setPrevExpenses(json.previousMonth?.expenses ?? null);
      } catch { setError("Failed to load spending data"); }
      finally { setLoading(false); }
    });
  }, [router]);

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-purple-600 border-t-transparent" />
      </div>
    );
  }

  const expenses = data?.expenses;
  const total = expenses?.total ?? 0;
  const categories = (expenses?.categories ?? []).slice().sort((a, b) => b.amount - a.amount);
  const transactions = (expenses?.transactions ?? [])
    .slice()
    .sort((a, b) => {
      if (a.date && b.date) return b.date.localeCompare(a.date);
      return 0;
    });
  const subscriptions = data?.subscriptions ?? [];
  const monthsTracked = history.length;
  const avgExpenses = monthsTracked > 0
    ? Math.round(history.reduce((s, h) => s + (h.expensesTotal ?? 0), 0) / monthsTracked)
    : null;
  const expDelta = prevExpenses !== null ? total - prevExpenses : null;

  // Subscriptions yearly total
  const subsYearly = subscriptions.reduce((s, sub) => {
    const monthly = sub.frequency === "annual" ? sub.amount / 12 : sub.amount;
    return s + monthly * 12;
  }, 0);
  const SUBS_PREVIEW = 4;
  const visibleSubs = showAllSubs ? subscriptions : subscriptions.slice(0, SUBS_PREVIEW);
  const hiddenSubsCount = subscriptions.length - SUBS_PREVIEW;

  const TXNS_PREVIEW = 3;
  const visibleTxns = showAllTransactions ? transactions : transactions.slice(0, TXNS_PREVIEW);

  const hasData = total > 0 || subscriptions.length > 0 || transactions.length > 0;

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="font-bold text-3xl text-gray-900">Spending</h1>
        {yearMonth && (
          <p className="mt-0.5 text-sm text-gray-400">
            {total > 0 && <>{formatCurrency(total)} · </>}
            {monthLabel(yearMonth)}
          </p>
        )}
      </div>

      {error && <p className="mb-4 text-red-600 text-sm">{error}</p>}

      {!hasData && !error && (
        <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-12 text-center">
          <p className="text-gray-500">No spending data yet.</p>
          <Link href="/upload" className="mt-3 inline-block text-sm font-medium text-purple-600 hover:underline">
            Upload a statement to get started →
          </Link>
        </div>
      )}

      {hasData && (
        <div className="space-y-5">
          {/* KPI cards */}
          {total > 0 && (
            <div className="grid grid-cols-2 gap-4">
              <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">This Month</p>
                <p className="mt-2 font-bold text-2xl text-gray-900">{formatCurrency(total)}</p>
                {expDelta !== null && (
                  <p className={`mt-1 text-xs font-medium ${expDelta > 0 ? "text-red-500" : "text-green-600"}`}>
                    {expDelta > 0 ? "↑" : "↓"} {formatCurrency(Math.abs(expDelta))} vs {prevExpenses !== null && yearMonth ? shortMonth(history.find(h => h.yearMonth < yearMonth)?.yearMonth ?? "") : "last month"}
                  </p>
                )}
              </div>
              <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Monthly Avg</p>
                <p className="mt-2 font-bold text-2xl text-gray-900">
                  {avgExpenses !== null ? formatCurrency(avgExpenses) : "—"}
                </p>
                <p className="mt-1 text-xs text-gray-400">
                  {monthsTracked > 0 ? `${monthsTracked} month${monthsTracked !== 1 ? "s" : ""} tracked` : "No history yet"}
                </p>
              </div>
            </div>
          )}

          {/* By Category */}
          {categories.length > 0 && (
            <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
              <p className="mb-4 text-xs font-semibold uppercase tracking-wider text-gray-400">By Category</p>
              <div className="space-y-3">
                {categories.map((cat) => (
                  <div key={cat.name}>
                    <div className="flex items-center justify-between text-sm mb-1">
                      <span className="text-gray-700 font-medium">{cat.name}</span>
                      <span className="tabular-nums text-gray-500">
                        {formatCurrency(cat.amount)}
                        <span className="ml-2 text-gray-400 text-xs">{cat.percentage}%</span>
                      </span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-gray-100">
                      <div
                        className={`h-full rounded-full ${barColor(cat.name)}`}
                        style={{ width: `${Math.min(cat.percentage, 100)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Subscriptions */}
          {subscriptions.length > 0 && (
            <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
              <div className="mb-4 flex items-center gap-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                  Subscriptions Detected
                </p>
                {subsYearly > 0 && (
                  <span className="rounded-md bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">
                    {formatCurrency(subsYearly)}/yr
                  </span>
                )}
              </div>
              <div className="divide-y divide-gray-100">
                {visibleSubs.map((sub) => {
                  const monthly = sub.frequency === "annual" ? sub.amount / 12 : sub.amount;
                  const yearly = monthly * 12;
                  return (
                    <div key={sub.name} className="flex items-center justify-between py-3">
                      <div>
                        <p className="text-sm font-medium text-gray-800">{sub.name}</p>
                        <p className="text-xs text-gray-400">{sub.frequency ?? "monthly"}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-medium text-gray-800">{formatCurrencyDecimals(sub.amount)}</p>
                        {yearly !== sub.amount && (
                          <p className="text-xs text-gray-400">{formatCurrency(yearly)}/yr</p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              {subscriptions.length > SUBS_PREVIEW && (
                <div className="mt-3 flex items-center justify-between border-t border-gray-100 pt-3">
                  {!showAllSubs && hiddenSubsCount > 0 ? (
                    <span className="text-xs text-gray-400">+ {hiddenSubsCount} more</span>
                  ) : <span />}
                  <button
                    onClick={() => setShowAllSubs((v) => !v)}
                    className="text-xs font-medium text-purple-600 hover:underline"
                  >
                    {showAllSubs ? "Show less" : `View all ${subscriptions.length} →`}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Recent Transactions */}
          {transactions.length > 0 && (
            <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
              <p className="mb-4 text-xs font-semibold uppercase tracking-wider text-gray-400">
                Recent Transactions
              </p>
              <div className="divide-y divide-gray-100">
                {visibleTxns.map((txn, i) => {
                  const dateStr = txn.date
                    ? new Date(txn.date + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })
                    : null;
                  const subtitle = [dateStr, txn.category].filter(Boolean).join(" · ");
                  return (
                    <div key={i} className="flex items-center justify-between py-3">
                      <div>
                        <p className="text-sm font-medium text-gray-800">{txn.merchant}</p>
                        {subtitle && (
                          <p className="text-xs text-teal-600">{subtitle}</p>
                        )}
                      </div>
                      <p className="text-sm font-medium text-gray-700 tabular-nums">
                        −{formatCurrencyDecimals(Math.abs(txn.amount))}
                      </p>
                    </div>
                  );
                })}
              </div>
              {transactions.length > TXNS_PREVIEW && (
                <div className="mt-3 border-t border-gray-100 pt-3 text-center">
                  <button
                    onClick={() => setShowAllTransactions((v) => !v)}
                    className="text-xs font-medium text-purple-600 hover:underline"
                  >
                    {showAllTransactions
                      ? "Show less"
                      : `View all ${transactions.length} transactions →`}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
