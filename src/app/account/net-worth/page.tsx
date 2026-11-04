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
  income_change: "Income Change",
  spending_spike: "Spending Spike",
  new_recurring_charge: "New Recurring Charge",
};

type FilterType = "all" | "income" | "spending" | "debt" | "assets";

const FILTER_TYPE_LABELS: Record<FilterType, string> = {
  all: "All Changes",
  income: "Income",
  spending: "Spending",
  debt: "Debt",
  assets: "Assets",
};

interface MonthlyNetWorthData {
  yearMonth: string;
  netWorth: number;
  change: number | null;
  changePercent: number | null;
  items: MonthNetWorthSummary["items"];
  byAccount: Array<{
    slug: string;
    label: string;
    type: string;
    value: number;
  }>;
}

function NetWorthPageContent() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<MonthlyNetWorthData[]>([]);
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  const [viewMonth, setViewMonth] = useState<string | null>(null); // For interactive header
  const [filterType, setFilterType] = useState<FilterType>("all");
  const [currency, setCurrency] = useState<string>("CAD");

  const loadData = async (tok: string) => {
    try {
      // Fetch net worth data from same source as nav pill (getFinancialProfile)
      const summaryRes = await fetch("/api/user/net-worth-summary", {
        headers: { Authorization: `Bearer ${tok}` },
      });

      if (!summaryRes.ok) {
        const errorData = await summaryRes.json().catch(() => ({ error: "Failed to load net worth data" }));
        throw new Error(errorData.error || "Failed to load net worth data");
      }

      const summary = await summaryRes.json();
      const monthlyHistory = (summary.monthlyHistory || []) as Array<{ 
        yearMonth: string; 
        netWorth: number;
        byAccount: Array<{ slug: string; label: string; type: string; value: number }>;
      }>;
      setCurrency(summary.currency || "CAD");

      if (monthlyHistory.length === 0) {
        setError("No net worth data available yet. Upload some statements to get started.");
        setLoading(false);
        return;
      }

      // Fetch change items (may be empty for existing users)
      const changesRes = await fetch("/api/user/net-worth-changes", {
        headers: { Authorization: `Bearer ${tok}` },
      });

      const changesData = await changesRes.json().catch(() => ({ changes: [] }));
      const changes = (changesData.changes || []) as MonthNetWorthSummary[];

      // Build change items map by month
      const changesByMonth = new Map<string, MonthNetWorthSummary["items"]>();
      for (const change of changes) {
        changesByMonth.set(change.month, change.items);
      }

      // Build final data structure: net worth values from profile, change items from feed
      const combinedData: MonthlyNetWorthData[] = monthlyHistory.map((month, idx) => {
        const prevMonth = idx > 0 ? monthlyHistory[idx - 1] : null;
        const change = prevMonth ? month.netWorth - prevMonth.netWorth : null;
        const changePercent = prevMonth && prevMonth.netWorth !== 0 
          ? (change! / Math.abs(prevMonth.netWorth)) * 100 
          : null;

        return {
          yearMonth: month.yearMonth,
          netWorth: month.netWorth,
          change,
          changePercent,
          items: changesByMonth.get(month.yearMonth) || [],
          byAccount: month.byAccount || [],
        };
      });

      setData(combinedData);

      // Select most recent month by default
      if (combinedData.length > 0 && !selectedMonth) {
        setSelectedMonth(combinedData[combinedData.length - 1].yearMonth);
      }

      // Update netWorthLastViewedAt to clear the badge count
      await fetch("/api/user/profile", {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${tok}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          netWorthLastViewedAt: new Date().toISOString(),
        }),
      }).catch(err => console.error("Failed to update netWorthLastViewedAt:", err));

      // Dispatch event to immediately clear nav badge
      window.dispatchEvent(new Event('networth-viewed'));
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

  if (error) {
    return (
      <div className="mx-auto max-w-5xl px-4 pt-4 pb-8 sm:py-8">
        <p className="text-red-600">{error}</p>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="mx-auto max-w-5xl px-4 pt-4 pb-8 sm:py-8">
        <p className="text-gray-600">No net worth data available yet. Upload some statements to get started.</p>
      </div>
    );
  }

  const latestMonth = data[data.length - 1];
  const viewData = viewMonth 
    ? data.find(d => d.yearMonth === viewMonth) || latestMonth 
    : latestMonth;
  const isViewingLatest = !viewMonth || viewMonth === latestMonth.yearMonth;
  const selectedData = data.find(d => d.yearMonth === selectedMonth) || latestMonth;

  // Helper to categorize items by filter type
  const getItemCategory = (item: MonthNetWorthSummary["items"][0]): FilterType => {
    if (item.type === "income_change") return "income";
    if (item.type === "spending_spike" || item.type === "new_recurring_charge") return "spending";
    if (item.type === "account_paid_off") return "debt";
    if (item.accountType === "credit_card" || item.accountType === "loan" || item.accountType === "line_of_credit" || item.accountType === "mortgage") {
      return "debt";
    }
    return "assets";
  };

  // Filter items based on selected type
  const filteredItems = filterType === "all" 
    ? selectedData.items 
    : selectedData.items.filter(i => getItemCategory(i) === filterType);

  // Calculate breakdown using per-account contributions (byAccount)
  // This adds up EXACTLY by construction since it uses the same carry-forward logic
  const selectedIdx = data.findIndex(d => d.yearMonth === selectedMonth);
  const previousData = selectedIdx > 0 ? data[selectedIdx - 1] : null;
  
  interface BreakdownLine {
    category: "assets" | "debts";
    label: string;
    amount: number;
    accountSlug: string;
    isBaseline?: boolean; // First appearance of account (not a real change)
  }
  
  const breakdownLines: BreakdownLine[] = [];
  const baselineLines: BreakdownLine[] = [];
  
  if (previousData) {
    // Build maps of current and previous account values
    const currentBySlug = new Map(selectedData.byAccount.map(a => [a.slug, a]));
    const previousBySlug = new Map(previousData.byAccount.map(a => [a.slug, a]));
    
    // Get all account slugs from both months
    const allSlugs = new Set([...currentBySlug.keys(), ...previousBySlug.keys()]);
    
    for (const slug of allSlugs) {
      const current = currentBySlug.get(slug);
      const previous = previousBySlug.get(slug);
      
      const currentValue = current?.value ?? 0;
      const previousValue = previous?.value ?? 0;
      const change = currentValue - previousValue;
      
      // Skip zero changes
      if (Math.abs(change) < 0.01) continue;
      
      // Determine category (assets are positive, debts are negative)
      const category = currentValue >= 0 || previousValue >= 0 ? "assets" : "debts";
      
      // Check if this is a first appearance (baseline)
      const isBaseline = previous === undefined && current !== undefined;
      
      const line: BreakdownLine = {
        category,
        label: isBaseline 
          ? `${current.label} (first statement)` 
          : (current?.label || previous?.label || slug),
        amount: change,
        accountSlug: slug,
        isBaseline,
      };
      
      if (isBaseline) {
        baselineLines.push(line);
      } else {
        breakdownLines.push(line);
      }
    }
    
    // Verify the sum equals the net worth change (should be exact by construction)
    const realChangeTotal = breakdownLines.reduce((sum, line) => sum + line.amount, 0);
    const baselineTotal = baselineLines.reduce((sum, line) => sum + line.amount, 0);
    const computedTotal = realChangeTotal + baselineTotal;
    const actualChange = selectedData.change || 0;
    const roundingDiff = actualChange - computedTotal;
    
    // Only plug sub-$1 rounding differences
    if (Math.abs(roundingDiff) >= 1.0) {
      console.error(`What moved it breakdown doesn't add up: computed ${computedTotal}, actual ${actualChange}, diff ${roundingDiff}`);
    } else if (Math.abs(roundingDiff) > 0.01 && (breakdownLines.length > 0 || baselineLines.length > 0)) {
      // Apply sub-$1 rounding difference to largest line (prefer real changes over baselines)
      const allLines = [...breakdownLines, ...baselineLines];
      if (allLines.length > 0) {
        const largestLine = allLines.reduce((max, line) => 
          Math.abs(line.amount) > Math.abs(max.amount) ? line : max
        );
        largestLine.amount += roundingDiff;
      }
    }
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
            <div className="flex items-center justify-end gap-2 mb-1">
              <div className="text-3xl font-bold text-gray-900 tabular-nums">
                {formatCurrency(viewData.netWorth, currency)}
              </div>
              {!isViewingLatest && (
                <button
                  onClick={() => setViewMonth(null)}
                  className="flex items-center justify-center w-6 h-6 rounded-md text-purple-600 hover:text-purple-700 hover:bg-purple-50 transition-colors"
                  title="Back to latest"
                  aria-label="Back to latest"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                </button>
              )}
            </div>
            {!isViewingLatest && (
              <div className="text-xs text-gray-500 mb-1">
                as of {new Date(viewData.yearMonth + "-15").toLocaleDateString("en-US", { month: "short", year: "numeric" })}
              </div>
            )}
            {viewData.change !== null && (
              <div className={`text-sm font-medium ${
                viewData.change > 0 ? "text-green-600" : 
                viewData.change < 0 ? "text-red-600" : "text-gray-500"
              }`}>
                {viewData.change > 0 ? "+" : ""}
                {formatCurrency(viewData.change, currency)}
                {viewData.changePercent !== null && (
                  <span className="ml-1">
                    ({viewData.changePercent > 0 ? "+" : ""}
                    {viewData.changePercent.toFixed(1)}%)
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
        <div className="relative" style={{ height: "340px" }}>
          {/* Simple bar chart */}
          <div className="flex items-end justify-between h-full gap-2">
            {data.map((monthData) => {
              const maxValue = Math.max(...data.map(d => Math.abs(d.netWorth)));
              const height = maxValue > 0 ? (Math.abs(monthData.netWorth) / maxValue) * 100 : 0;
              const isSelectedForFeed = monthData.yearMonth === selectedMonth;
              const isSelectedForView = viewMonth 
                ? monthData.yearMonth === viewMonth 
                : monthData.yearMonth === latestMonth.yearMonth;
              const isPositive = monthData.netWorth >= 0;
              
              // Check for event markers
              const hasPaidOff = monthData.items.some(i => i.type === "account_paid_off");
              const hasNewAccount = monthData.items.some(i => i.type === "account_added");

              return (
                <button
                  key={monthData.yearMonth}
                  onClick={() => {
                    setSelectedMonth(monthData.yearMonth);
                    setViewMonth(monthData.yearMonth);
                  }}
                  className="flex-1 flex flex-col items-center justify-end group relative"
                  style={{ height: "100%" }}
                >
                  {/* Event markers above the bar */}
                  {(hasPaidOff || hasNewAccount) && (
                    <div className="absolute -top-6 left-1/2 -translate-x-1/2 flex gap-1">
                      {hasPaidOff && (
                        <div className="w-2 h-2 rounded-full bg-green-600" title="Account paid off" />
                      )}
                      {hasNewAccount && (
                        <div className="w-2 h-2 rounded-full bg-blue-600" title="New account" />
                      )}
                    </div>
                  )}
                  
                  <div className="flex-1 flex items-end w-full">
                    <div
                      className={`w-full transition-all ${
                        isSelectedForView 
                          ? isPositive ? "bg-green-600 ring-2 ring-green-800 ring-offset-2" : "bg-red-600 ring-2 ring-red-800 ring-offset-2"
                          : isPositive ? "bg-green-400 group-hover:bg-green-500" : "bg-red-400 group-hover:bg-red-500"
                      }`}
                      style={{ height: `${height}%` }}
                    />
                  </div>
                  <div className={`text-xs mt-2 ${isSelectedForView ? "font-semibold text-gray-900" : "text-gray-500"}`}>
                    {formatMonthLabel(monthData.yearMonth)}
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
          What Moved It: {formatMonthLabel(selectedData.yearMonth)}
        </h2>
        
        {selectedData.change !== null && (
          <div className="mb-4 p-4 bg-gray-50 rounded-lg">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-gray-700">
                Total Change
                {baselineLines.length > 0 && (
                  <span className="ml-2 text-xs text-gray-500">(includes {baselineLines.length} baseline{baselineLines.length > 1 ? 's' : ''})</span>
                )}
              </span>
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

        {(breakdownLines.length > 0 || baselineLines.length > 0) ? (
          <div className="space-y-4">
            {/* Real changes */}
            {breakdownLines.length > 0 && (
              <div className="space-y-2">
                {breakdownLines.map((line, idx) => {
                  const accountPage = line.accountSlug 
                    ? line.category === "debts" 
                      ? `/account/liabilities`
                      : `/account/assets`
                    : null;
                  
                  const lineContent = (
                    <div className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                      <span className="text-sm text-gray-700">{line.label}</span>
                      <span className={`text-sm font-semibold ${
                        line.amount > 0 ? "text-green-600" : line.amount < 0 ? "text-red-600" : "text-gray-900"
                      }`}>
                        {line.amount > 0 ? "+" : ""}
                        {formatCurrency(line.amount, currency)}
                      </span>
                    </div>
                  );
                  
                  return accountPage ? (
                    <Link key={idx} href={accountPage} className="block hover:bg-gray-50 -mx-2 px-2 rounded transition-colors">
                      {lineContent}
                    </Link>
                  ) : (
                    <div key={idx}>{lineContent}</div>
                  );
                })}
              </div>
            )}

            {/* Real change subtotal (if baselines exist) */}
            {baselineLines.length > 0 && breakdownLines.length > 0 && (
              <div className="py-2 border-t-2 border-gray-300">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-700">Real Change</span>
                  <span className={`text-sm font-bold ${
                    breakdownLines.reduce((sum, line) => sum + line.amount, 0) > 0 ? "text-green-600" : 
                    breakdownLines.reduce((sum, line) => sum + line.amount, 0) < 0 ? "text-red-600" : "text-gray-900"
                  }`}>
                    {breakdownLines.reduce((sum, line) => sum + line.amount, 0) > 0 ? "+" : ""}
                    {formatCurrency(breakdownLines.reduce((sum, line) => sum + line.amount, 0), currency)}
                  </span>
                </div>
              </div>
            )}

            {/* Baseline section */}
            {baselineLines.length > 0 && (
              <div className="space-y-2 pt-2 border-t border-gray-200">
                <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">First Statements (Baseline)</div>
                {baselineLines.map((line, idx) => {
                  const accountPage = line.accountSlug 
                    ? line.category === "debts" 
                      ? `/account/liabilities`
                      : `/account/assets`
                    : null;
                  
                  const lineContent = (
                    <div className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                      <span className="text-sm text-gray-600 italic">{line.label}</span>
                      <span className="text-sm text-gray-600 italic">
                        {line.amount > 0 ? "+" : ""}
                        {formatCurrency(line.amount, currency)}
                      </span>
                    </div>
                  );
                  
                  return accountPage ? (
                    <Link key={idx} href={accountPage} className="block hover:bg-gray-50 -mx-2 px-2 rounded transition-colors">
                      {lineContent}
                    </Link>
                  ) : (
                    <div key={idx}>{lineContent}</div>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-gray-500 text-center py-4">
            No detailed breakdown available yet. Change items will appear here after processing statements.
          </p>
        )}
      </div>

      {/* Changes Feed */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Changes</h2>
          
          {/* Filter Dropdown */}
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value as FilterType)}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-600"
          >
            <option value="all">All Changes</option>
            <option value="income">Income</option>
            <option value="spending">Spending</option>
            <option value="debt">Debt</option>
            <option value="assets">Assets</option>
          </select>
        </div>

        {filteredItems.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-8">
            {selectedData.items.length === 0 
              ? `No detailed changes available yet for ${formatMonthLabel(selectedData.yearMonth)}`
              : `No ${filterType === "all" ? "" : filterType.replace(/_/g, " ") + " "}changes for ${formatMonthLabel(selectedData.yearMonth)}`
            }
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
                  {item.source && (
                    <p className="text-xs text-gray-500">
                      {item.source}
                    </p>
                  )}
                  {!item.source && (
                    <p className="text-xs text-gray-500 capitalize">
                      {item.accountType.replace("_", " ")}
                    </p>
                  )}
                  {item.impactDescription && (
                    <p className="text-xs text-gray-500 mt-1">
                      {item.impactDescription}
                    </p>
                  )}
                  {!item.impactDescription && (item.previousBalance !== undefined || item.currentBalance !== undefined) && (
                    <p className="text-xs text-gray-500 mt-1">
                      {item.previousBalance !== undefined && formatCurrency(item.previousBalance, currency)}
                      {item.previousBalance !== undefined && item.currentBalance !== undefined && " → "}
                      {item.currentBalance !== undefined && formatCurrency(item.currentBalance, currency)}
                    </p>
                  )}
                </div>
                <div className={`text-sm font-semibold tabular-nums ${
                  item.netWorthImpact > 0 ? "text-green-600" : 
                  item.netWorthImpact < 0 ? "text-red-600" : "text-gray-900"
                }`}>
                  {item.netWorthImpact > 0 ? "+" : ""}
                  {formatCurrency(item.netWorthImpact, currency)}
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
