"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseClient } from "@/lib/firebase";
import ConsolidatedProgressHero from "@/components/ConsolidatedProgressHero";
import NetWorthChart from "@/components/NetWorthChart";
import InsightsSection from "@/components/InsightsSection";
import DashboardCtas from "@/components/DashboardCtas";
import type { ParsedStatementData } from "@/lib/types";

const CATEGORY_COLORS: Record<string, string> = {
  housing: "bg-blue-500",
  dining: "bg-orange-400",
  shopping: "bg-purple-500",
  transportation: "bg-yellow-500",
  groceries: "bg-green-500",
  entertainment: "bg-pink-500",
  subscriptions: "bg-indigo-500",
  healthcare: "bg-teal-500",
  "transfers & payments": "bg-cyan-500",
  "cash & atm": "bg-red-400",
  other: "bg-gray-400",
};

function barColor(name: string): string {
  return CATEGORY_COLORS[name.toLowerCase()] ?? "bg-purple-400";
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

function monthLabel(yearMonth: string): string {
  const [y, m] = yearMonth.split("-");
  if (!m) return yearMonth;
  const date = new Date(parseInt(y, 10), parseInt(m, 10) - 1, 1);
  return date.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

function shortMonth(yearMonth: string): string {
  const [y, m] = yearMonth.split("-");
  if (!m) return yearMonth;
  const date = new Date(parseInt(y, 10), parseInt(m, 10) - 1, 1);
  return date.toLocaleDateString("en-US", { month: "short" }).toUpperCase();
}

function greeting(name: string): string {
  const h = new Date().getHours();
  const time = h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
  return name ? `${time}, ${name}.` : `${time}.`;
}

function firstName(displayName: string | null | undefined, email: string | null | undefined): string {
  if (displayName) return displayName.split(" ")[0];
  if (email) return email.split("@")[0];
  return "";
}

export default function ConsolidatedCurrentDashboard({ refreshKey }: { refreshKey?: number }) {
  const router = useRouter();
  const [data, setData] = useState<ParsedStatementData | null>(null);
  const [previousMonth, setPreviousMonth] = useState<{ netWorth: number; assets: number; debts: number } | null>(null);
  const [yearMonth, setYearMonth] = useState<string | null>(null);
  const [history, setHistory] = useState<{ yearMonth: string; netWorth: number; isEstimate?: boolean }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statementCount, setStatementCount] = useState(0);
  const [userName, setUserName] = useState("");
  const [incompleteMonths, setIncompleteMonths] = useState<string[]>([]);

  useEffect(() => {
    const { auth } = getFirebaseClient();
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user) { router.push("/account/login"); return; }
      setUserName(firstName(user.displayName, user.email));
      setLoading(true); setError(null);
      try {
        const token = await user.getIdToken();
        const res = await fetch("/api/user/statements/consolidated", {
          headers: { Authorization: `Bearer ${token}` },
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) { setError(json.error || "Failed to load dashboard"); return; }
        setData(json.data ?? null);
        setStatementCount(json.count ?? 0);
        setPreviousMonth(json.previousMonth ?? null);
        setYearMonth(json.yearMonth ?? null);
        const incomplete: string[] = json.incompleteMonths ?? [];
        setIncompleteMonths(incomplete);
        setHistory(Array.isArray(json.history)
          ? json.history.map((h: { yearMonth: string; netWorth: number; expensesTotal?: number }) => ({
              ...h,
              isEstimate: incomplete.includes(h.yearMonth),
            }))
          : []);
      } catch { setError("Failed to load dashboard"); }
      finally { setLoading(false); }
    });
    return () => unsubscribe();
  }, [router, refreshKey]);

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-purple-600 border-t-transparent" />
      </div>
    );
  }

  if (error || !data || !yearMonth) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-8 text-center">
        <p className="text-gray-600">{error || "No data yet."}</p>
        <Link href="/upload" className="mt-3 inline-block text-sm font-medium text-purple-600 hover:underline">
          Upload your first statement →
        </Link>
      </div>
    );
  }

  const topCategories = (data.expenses?.categories ?? [])
    .slice()
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 3);

  const hasSpending = (data.expenses?.total ?? 0) > 0;

  return (
    <div className="space-y-6">
      {/* Greeting */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 md:text-3xl">{greeting(userName)}</h1>
        <p className="mt-0.5 text-sm text-gray-400">
          as of {monthLabel(yearMonth)}
          {statementCount > 0 && ` · ${statementCount} statement${statementCount !== 1 ? "s" : ""} combined`}
        </p>
      </div>

      {/* Incomplete months banner */}
      {incompleteMonths.length > 0 && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <svg className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          </svg>
          <div className="text-sm">
            <p className="font-medium text-amber-800">Trends still building</p>
            <p className="mt-0.5 text-amber-700">
              {incompleteMonths.length} month{incompleteMonths.length !== 1 ? "s" : ""} use estimated balances — not all accounts had statements uploaded.
              The chart shows a dashed line for those months.{" "}
              <Link href="/account/accounts" className="font-medium underline hover:text-amber-900">
                Review accounts →
              </Link>
            </p>
          </div>
        </div>
      )}

      {/* KPI cards */}
      <ConsolidatedProgressHero
        data={data}
        previousMonth={previousMonth}
        monthLabel={monthLabel(yearMonth)}
        currentMonthIncomplete={incompleteMonths.includes(yearMonth)}
      />

      {/* Net worth chart */}
      {history.length >= 2 && <NetWorthChart history={history} />}

      {/* Insights */}
      {(data.insights?.length ?? 0) > 0 && (
        <InsightsSection insights={data.insights ?? []} />
      )}

      {/* Top spending preview */}
      {hasSpending && (
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">
              Top Spending · {shortMonth(yearMonth)}
            </p>
            <Link href="/account/spending" className="text-xs font-medium text-purple-600 hover:underline">
              See all →
            </Link>
          </div>
          <div className="space-y-3">
            {topCategories.map((cat) => (
              <div key={cat.name}>
                <div className="flex items-center justify-between text-sm mb-1">
                  <span className="text-gray-700 font-medium">{cat.name}</span>
                  <span className="text-gray-500 tabular-nums">
                    {formatCurrency(cat.amount)}
                    <span className="ml-2 text-gray-400">{cat.percentage}%</span>
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

      <DashboardCtas />
    </div>
  );
}
