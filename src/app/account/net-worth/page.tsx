"use client";

import { useEffect, useState, Suspense } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseClient } from "@/lib/firebase";
import { formatCurrency } from "@/lib/currencyUtils";
import type { MonthNetWorthSummary, ChangeItemType } from "@/lib/netWorthChanges";

const CHANGE_TYPE_LABELS: Record<ChangeItemType, string> = {
  account_added: "Account Added",
  account_paid_off: "Account Paid Off",
  account_closed: "Account Closed",
  balance_increase: "Balance Increase",
  balance_decrease: "Balance Decrease",
};

function NetWorthPageContent() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<MonthNetWorthSummary[]>([]);
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  const [filterType, setFilterType] = useState<ChangeItemType | "all">("all");

  const loadData = async (tok: string) => {
    try {
      // Get last 12 months of data
      const res = await fetch("/api/user/net-worth-changes", {
        headers: { Authorization: `Bearer ${tok}` },
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({ error: "Failed to load net worth data" }));
        throw new Error(errorData.error || "Failed to load net worth data");
      }

      const result = await res.json();
      const changes = (result.changes || []) as MonthNetWorthSummary[];
      
      // Take last 12 months
      const last12 = changes.slice(0, 12).reverse(); // Reverse to show oldest first
      setData(last12);

      // Select most recent month by default
      if (last12.length > 0 && !selectedMonth) {
        setSelectedMonth(last12[last12.length - 1].month);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load net worth data");
    } finally {
      setLoading(false);
    }
  };

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
      await loadData(tok);
    });
  }, [router]);

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-purple-600 border-t-transparent" />
      </div>
    );
  }

  if (error || data.length === 0) {
    return (
      <div className="mx-auto max-w-5xl px-4 pt-4 pb-8 sm:py-8">
        <p className="text-red-600">{error || "No net worth data available yet. Upload some statements to get started."}</p>
      </div>
    );
  }

  const latestMonth = data[data.length - 1];
  const selectedData = data.find(d => d.month === selectedMonth) || latestMonth;
  const currency = selectedData.currency;

  // Filter items based on selected type
  const filteredItems = filterType === "all" 
    ? selectedData.items 
    : selectedData.items.filter(i => i.type === filterType);

  // Calculate breakdown summary
  const breakdownByType = new Map<ChangeItemType, number>();
  for (const item of selectedData.items) {
    const current = breakdownByType.get(item.type) || 0;
    breakdownByType.set(item.type, current + item.netWorthImpact);
  }

  return (
    <div className="mx-auto max-w-5xl px-4 pt-4 pb-8 sm:py-8">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-1">
          <Link href="/account" className="text-sm text-gray-500 hover:text-gray-700">
            Account
          </Link>
          <span className="text-gray-400">/</span>
          <span className="text-sm font-medium text-gray-900">Net Worth</span>
        </div>
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Net Worth</h1>
            <p className="text-sm text-gray-500 mt-1">
              Track your wealth over time
            </p>
          </div>
          <div className="text-right">
            <div className="text-3xl font-bold text-gray-900 tabular-nums">
              {formatCurrency(latestMonth.netWorth, currency)}
            </div>
            {latestMonth.change !== null && (
              <div className={`text-sm font-medium ${
                latestMonth.change > 0 ? "text-green-600" : 
                latestMonth.change < 0 ? "text-red-600" : "text-gray-500"
              }`}>
                {latestMonth.change > 0 ? "+" : ""}
                {formatCurrency(latestMonth.change, currency)}
                {latestMonth.changePercent !== null && (
                  <span className="ml-1">
                    ({latestMonth.changePercent > 0 ? "+" : ""}
                    {latestMonth.changePercent.toFixed(1)}%)
                  </span>
                )}
                <span className="text-gray-400 ml-2">vs last month</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 12-Month Chart */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">12-Month Trend</h2>
        <div className="relative" style={{ height: "300px" }}>
          {/* Simple bar chart */}
          <div className="flex items-end justify-between h-full gap-2">
            {data.map((monthData) => {
              const maxValue = Math.max(...data.map(d => Math.abs(d.netWorth)));
              const height = maxValue > 0 ? (Math.abs(monthData.netWorth) / maxValue) * 100 : 0;
              const isSelected = monthData.month === selectedMonth;
              const isPositive = monthData.netWorth >= 0;

              return (
                <button
                  key={monthData.month}
                  onClick={() => setSelectedMonth(monthData.month)}
                  className="flex-1 flex flex-col items-center justify-end group"
                  style={{ height: "100%" }}
                >
                  <div className="flex-1 flex items-end w-full">
                    <div
                      className={`w-full transition-all ${
                        isSelected 
                          ? isPositive ? "bg-green-600" : "bg-red-600"
                          : isPositive ? "bg-green-400 group-hover:bg-green-500" : "bg-red-400 group-hover:bg-red-500"
                      }`}
                      style={{ height: `${height}%` }}
                    />
                  </div>
                  <div className={`text-xs mt-2 ${isSelected ? "font-semibold text-gray-900" : "text-gray-500"}`}>
                    {formatMonthLabel(monthData.month)}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* What Moved It Breakdown */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">
          What Moved It: {formatMonthLabel(selectedData.month)}
        </h2>
        
        {selectedData.change !== null && (
          <div className="mb-4 p-4 bg-gray-50 rounded-lg">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-gray-700">Total Change</span>
              <span className={`text-lg font-bold ${
                selectedData.change > 0 ? "text-green-600" : 
                selectedData.change < 0 ? "text-red-600" : "text-gray-900"
              }`}>
                {selectedData.change > 0 ? "+" : ""}
                {formatCurrency(selectedData.change, currency)}
              </span>
            </div>
          </div>
        )}

        <div className="space-y-2">
          {Array.from(breakdownByType.entries()).map(([type, impact]) => (
            <div key={type} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
              <span className="text-sm text-gray-700">{CHANGE_TYPE_LABELS[type]}</span>
              <span className={`text-sm font-semibold ${
                impact > 0 ? "text-green-600" : impact < 0 ? "text-red-600" : "text-gray-900"
              }`}>
                {impact > 0 ? "+" : ""}
                {formatCurrency(impact, currency)}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Changes Feed */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Changes</h2>
          
          {/* Filter Dropdown */}
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value as ChangeItemType | "all")}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-600"
          >
            <option value="all">All Changes</option>
            <option value="account_added">Accounts Added</option>
            <option value="account_paid_off">Accounts Paid Off</option>
            <option value="account_closed">Accounts Closed</option>
            <option value="balance_increase">Balance Increases</option>
            <option value="balance_decrease">Balance Decreases</option>
          </select>
        </div>

        {filteredItems.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-8">
            No changes for {formatMonthLabel(selectedData.month)}
          </p>
        ) : (
          <div className="space-y-3">
            {filteredItems.map((item, idx) => (
              <div key={idx} className="flex items-start justify-between py-3 border-b border-gray-100 last:border-0">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-medium text-gray-900">{item.accountLabel}</span>
                    <span className="px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-700 rounded">
                      {CHANGE_TYPE_LABELS[item.type]}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 capitalize">
                    {item.accountType.replace("_", " ")}
                  </p>
                  {(item.previousBalance !== undefined || item.currentBalance !== undefined) && (
                    <p className="text-xs text-gray-500 mt-1">
                      {item.previousBalance !== undefined && formatCurrency(item.previousBalance, item.currency)}
                      {item.previousBalance !== undefined && item.currentBalance !== undefined && " → "}
                      {item.currentBalance !== undefined && formatCurrency(item.currentBalance, item.currency)}
                    </p>
                  )}
                </div>
                <div className={`text-sm font-semibold tabular-nums ${
                  item.netWorthImpact > 0 ? "text-green-600" : 
                  item.netWorthImpact < 0 ? "text-red-600" : "text-gray-900"
                }`}>
                  {item.netWorthImpact > 0 ? "+" : ""}
                  {formatCurrency(item.netWorthImpact, item.currency)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function formatMonthLabel(month: string): string {
  const [year, monthNum] = month.split("-");
  const date = new Date(parseInt(year), parseInt(monthNum) - 1);
  return date.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

export default function NetWorthPage() {
  return (
    <Suspense fallback={
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-purple-600 border-t-transparent" />
      </div>
    }>
      <NetWorthPageContent />
    </Suspense>
  );
}
