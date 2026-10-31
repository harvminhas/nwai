"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { DrawerData, DrawerErrorResponse } from "@/lib/drawerTypes";
import { formatMonthYear } from "@/lib/dateFormatting";
import { getSignColor, getSignBgColor } from "@/lib/colorHelpers";
import { ReviewList } from "./ReviewList";

export type DrawerType = "income" | "fixed" | "essentials" | "flexible" | "savings";

interface DrawerProps {
  type: DrawerType;
  isOpen: boolean;
  onClose: () => void;
  token: string | null;
  currency: string;
  initialWindow?: TimeWindow; // Sync with dashboard range
}

type TimeWindow = "last3" | "12month" | "ytd";

const WINDOW_LABELS: Record<TimeWindow, string> = {
  last3: "Last 3 months",
  "12month": "12-month avg",
  ytd: "This year",
};

// Convert TimeWindow to URL range parameter
function windowToRange(window: TimeWindow): string {
  switch (window) {
    case "last3": return "3mo";
    case "12month": return "12mo";
    case "ytd": return "ytd";
  }
}

export function Drawer({ type, isOpen, onClose, token, currency, initialWindow }: DrawerProps) {
  const [window, setWindow] = useState<TimeWindow>(initialWindow || "last3");
  
  // Reset window when initialWindow changes
  useEffect(() => {
    if (initialWindow) {
      setWindow(initialWindow);
    }
  }, [initialWindow]);
  const [data, setData] = useState<DrawerData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isOpen || !token) return;

    setLoading(true);
    setError(null);
    
    fetch(`/api/user/dashboard-drawers?window=${window}&bucket=${type}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (res) => {
        const json = await res.json();
        
        if (!res.ok) {
          const errData = json as DrawerErrorResponse;
          throw new Error(errData.error || `Request failed with status ${res.status}`);
        }
        
        // Validate response structure
        if (!json.type) {
          throw new Error("Invalid response: missing type");
        }
        
        if (json.type === "bucket" && !json.breakdown) {
          throw new Error("Invalid response: missing breakdown");
        }
        
        if (json.type === "income" && !json.metrics) {
          throw new Error("Invalid response: missing metrics");
        }
        
        setData(json as DrawerData);
        setError(null);
      })
      .catch((err) => {
        console.error("Drawer load error:", err);
        setError(err.message || "Failed to load data");
        setData(null);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [isOpen, type, window, token]);

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Drawer */}
      <div className="fixed right-0 top-0 z-50 h-full w-full max-w-2xl overflow-y-auto bg-white shadow-2xl sm:w-[640px]">
        {/* Header */}
        <div className="sticky top-0 z-10 border-b border-gray-200 bg-white px-6 py-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold text-gray-900">
              {type === "income" && "Income"}
              {type === "fixed" && "Fixed costs"}
              {type === "essentials" && "Essentials"}
              {type === "flexible" && "Flexible spending"}
              {type === "savings" && "Net savings"}
            </h2>
            <button
              onClick={onClose}
              className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Basis Switch */}
          <div className="mt-4 flex gap-2">
            {(["last3", "12month", "ytd"] as TimeWindow[]).map((w) => (
              <button
                key={w}
                onClick={() => setWindow(w)}
                disabled={loading}
                className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
                  window === w
                    ? "bg-purple-600 text-white"
                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                } disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                {WINDOW_LABELS[w]}
              </button>
            ))}
          </div>
          
          {/* Link to full page */}
          {(type === "income" || ["fixed", "essentials", "flexible"].includes(type)) && (
            <div className="mt-3">
              <Link
                href={type === "income" 
                  ? `/account/income?range=${windowToRange(window)}`
                  : `/account/spending?range=${windowToRange(window)}`
                }
                className="text-sm font-medium text-purple-600 hover:text-purple-700 hover:underline"
              >
                View full details →
              </Link>
            </div>
          )}
        </div>

        {/* Content */}
        <div className="px-6 py-6">
          {loading && (
            <div className="flex items-center justify-center py-12">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-purple-600" />
            </div>
          )}

          {error && !loading && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-6">
              <p className="text-sm font-semibold text-red-900">Unable to load data</p>
              <p className="mt-1 text-sm text-red-700">{error}</p>
              <button
                onClick={() => {
                  setError(null);
                  setWindow("last3");
                }}
                className="mt-4 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
              >
                Try again
              </button>
            </div>
          )}

          {!loading && !error && !data && (
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-6 text-center">
              <p className="text-sm text-gray-600">No data available</p>
            </div>
          )}

          {!loading && !error && data && data.type === "income" && (
            <IncomeDrawerContent data={data} currency={currency} />
          )}

          {!loading && !error && data && data.type === "bucket" && (
            <BucketDrawerContent data={data} currency={currency} type={type} />
          )}

          {!loading && !error && data && data.type === "savings" && (
            <SavingsDrawerContent 
              data={data} 
              currency={currency} 
              token={token}
              onRefresh={() => {
                setError(null);
                setData(null);
                // Trigger refetch
                fetch(`/api/user/dashboard-drawers?window=${window}&bucket=${type}`, {
                  headers: { Authorization: `Bearer ${token}` },
                })
                  .then(async (res) => {
                    if (res.ok) {
                      setData(await res.json());
                    }
                  })
                  .catch(console.error);
              }}
            />
          )}
        </div>
      </div>
    </>
  );
}

function IncomeDrawerContent({ data, currency }: { data: import("@/lib/drawerTypes").IncomeDrawerData; currency: string }) {
  const [expandedSources, setExpandedSources] = useState<Set<number>>(new Set());
  
  const fmt = (amount: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency || "USD",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);

  const { metrics, chartData } = data;

  if (!chartData || chartData.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200 bg-gray-50 p-6 text-center">
        <p className="text-sm text-gray-600">No income data available for this time period</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Current Amount */}
      <div className="rounded-xl border border-gray-200 bg-gray-50 p-6">
        <p className="text-sm font-medium text-gray-600">Average monthly income</p>
        <p className="mt-1 text-3xl font-bold text-gray-900">
          {fmt(metrics.windowAmount)}
        </p>
        <p className="mt-1 text-xs text-gray-500">
          Based on {metrics.windowLabel}
        </p>
      </div>

      {/* 12-Month Chart */}
      <div>
        <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-gray-500">
          Last 12 months
        </h3>
        <div className="space-y-2">
          {chartData.map((month) => {
            const monthLabel = new Date(month.month + "-15").toLocaleDateString("en-US", {
              month: "short",
              year: "2-digit",
            });
            const isInWindow = month.isInWindow;
            const isCurrent = month.isCurrentMonth;
            const hasData = month.hasData;
            const maxIncome = Math.max(...chartData.filter(m => m.hasData).map(m => m.regularIncome), 1);

            return (
              <div key={month.month} className="flex items-center gap-3">
                <span
                  className={`w-16 text-xs ${
                    isInWindow ? "font-semibold text-gray-900" : "text-gray-400"
                  }`}
                >
                  {monthLabel}
                </span>
                <div className="relative h-8 flex-1 rounded bg-gray-100">
                  {hasData ? (
                    <>
                      <div
                        className={`h-full rounded ${
                          isCurrent
                            ? "bg-gradient-to-r from-green-400 to-green-600 bg-[length:200%_100%]"
                            : "bg-green-500"
                        }`}
                        style={{
                          width: `${Math.min(100, (month.regularIncome / maxIncome) * 100)}%`,
                        }}
                      />
                      {isInWindow && (
                        <div className="absolute inset-0 rounded border-2 border-purple-500" />
                      )}
                    </>
                  ) : (
                    <div className="flex h-full items-center justify-center">
                      <span className="text-xs text-gray-400">no data</span>
                    </div>
                  )}
                </div>
                <span className="w-20 text-right text-xs font-medium text-gray-900">
                  {hasData ? (
                    isCurrent ? (
                      <span className="text-xs text-gray-500">in progress</span>
                    ) : (
                      fmt(month.regularIncome)
                    )
                  ) : (
                    <span className="text-xs text-gray-400">—</span>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Income Sources */}
      {metrics.sourcesList && metrics.sourcesList.length > 0 && (
        <div>
          <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-gray-500">
            Included sources
          </h3>
          <div className="space-y-2">
            {metrics.sourcesList.map((sourceGroup, idx) => {
              const isExpanded = expandedSources.has(idx);
              const toggleExpanded = () => {
                setExpandedSources(prev => {
                  const next = new Set(prev);
                  if (next.has(idx)) {
                    next.delete(idx);
                  } else {
                    next.add(idx);
                  }
                  return next;
                });
              };
              
              return (
                <div
                  key={idx}
                  className="overflow-hidden rounded-lg border border-gray-200 bg-white"
                >
                  {/* Source header - clickable to expand */}
                  <button
                    onClick={toggleExpanded}
                    className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-900">{sourceGroup.source}</span>
                      <span className="text-xs text-gray-500">({sourceGroup.transactions.length})</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-semibold text-gray-900">
                        {fmt(sourceGroup.total)}
                      </span>
                      <svg
                        className={`h-4 w-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>
                  </button>
                  
                  {/* Transaction details - shown when expanded */}
                  {isExpanded && (
                    <div className="border-t border-gray-200 bg-gray-50 px-4 py-2">
                      <div className="space-y-1">
                        {sourceGroup.transactions.map((txn, txIdx) => (
                          <div
                            key={txIdx}
                            className="flex items-center justify-between py-1.5"
                          >
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-gray-600">
                                {new Date(txn.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                              </span>
                              {txn.isBonus && (
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-semibold bg-amber-50 text-amber-700 uppercase tracking-wide">
                                  Bonus
                                </span>
                              )}
                              {txn.needsReview && (
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-semibold bg-orange-50 text-orange-700 uppercase tracking-wide">
                                  Needs review
                                </span>
                              )}
                            </div>
                            <span className="text-xs font-medium text-gray-900">
                              {fmt(txn.amount)}
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
      )}
      
      {/* Legacy fallback - only show if sourcesList not available */}
      {!metrics.sourcesList && metrics.regularSources && metrics.regularSources.length > 0 && (
        <div>
          <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-gray-500">
            Included sources
          </h3>
          <div className="space-y-2">
            {metrics.regularSources.map((source, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between rounded-lg border border-gray-200 bg-white px-4 py-3"
              >
                <span className="text-sm font-medium text-gray-900">{source.source}</span>
                <span className="text-sm font-semibold text-gray-900">
                  {fmt(source.amount)}/mo
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* One-Off Sources */}
      {metrics.oneOffSources && metrics.oneOffSources.length > 0 && (
        <div>
          <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-gray-500">
            Kept separate (one-off)
          </h3>
          <div className="space-y-2">
            {metrics.oneOffSources.map((source, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 px-4 py-3"
              >
                <span className="text-sm font-medium text-gray-900">{source.source}</span>
                <span className="text-sm font-semibold text-amber-900">
                  {fmt(source.amount)} (bonus)
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Year Summary */}
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-gray-500">
          This year
        </h3>
        <div className="grid grid-cols-3 gap-4 text-center">
          <div>
            <p className="text-xs text-gray-500">So far</p>
            <p className="mt-1 text-lg font-bold text-gray-900">{fmt(metrics.ytdTotal)}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Projected</p>
            <p className="mt-1 text-lg font-bold text-gray-900">
              {fmt(metrics.projectedFullYear)}
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Of which bonus</p>
            <p className="mt-1 text-lg font-bold text-amber-900">
              {fmt(metrics.ytdOneOff)}
            </p>
          </div>
        </div>
      </div>

      {/* Coach Note */}
      <div className="rounded-xl border border-purple-200 bg-purple-50 p-4">
        <p className="text-sm leading-relaxed text-purple-900">
          <strong>💡 Coach:</strong> Your take-home is based on {metrics.windowLabel}.{" "}
          {metrics.oneOffSources.length > 0 &&
            "We've excluded one-off bonuses from your monthly average to give you a more reliable baseline."}
        </p>
      </div>
    </div>
  );
}

function BucketDrawerContent({
  data,
  currency,
  type,
}: {
  data: import("@/lib/drawerTypes").BucketDrawerData;
  currency: string;
  type: DrawerType;
}) {
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);

  const fmt = (amount: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency || "USD",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);

  const { breakdown, trend } = data;

  if (!breakdown || !breakdown.categories) {
    return (
      <div className="rounded-xl border border-gray-200 bg-gray-50 p-6 text-center">
        <p className="text-sm text-gray-600">No data available for this time period</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Monthly Average */}
      <div className="rounded-xl border border-gray-200 bg-gray-50 p-6">
        <p className="text-sm font-medium text-gray-600">Monthly average</p>
        <p className="mt-1 text-3xl font-bold text-gray-900">
          {fmt(breakdown.monthlyAverage)}
        </p>
        <p className="mt-1 text-xs text-gray-500">{data.basisLabel}</p>
      </div>

      {/* 3-Month Trend Sparkline */}
      {trend && trend.values && trend.values.length > 0 && (
        <div>
          <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-gray-500">
            Last 3 months
          </h3>
          <div className="flex items-end gap-1.5">
            {trend.values.map((value, idx) => {
              const maxValue = Math.max(...trend.values);
              const heightPct = maxValue > 0 ? (value / maxValue) * 100 : 0;

              return (
                <div key={idx} className="flex-1">
                  <div
                    className="w-full rounded-full bg-purple-500"
                    style={{ height: `${Math.max(8, heightPct * 0.6)}px` }}
                  />
                  <p className="mt-1 text-center text-xs text-gray-500">
                    {trend.months[idx] ? new Date(trend.months[idx] + "-15").toLocaleDateString("en-US", {
                      month: "short",
                    }) : "—"}
                  </p>
                  <p className="text-center text-xs font-medium text-gray-900 whitespace-nowrap">{fmt(value)}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Category Breakdown */}
      <div>
        <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-gray-500">
          Avg. monthly by category ({data.basisLabel.toLowerCase()})
        </h3>
        {breakdown.categories.length === 0 ? (
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-center">
            <p className="text-sm text-gray-600">No spending in this bucket for the selected period</p>
          </div>
        ) : (
          <div className="space-y-2">
            {breakdown.categories.map((category, idx) => {
              const isExpanded = expandedCategory === category.category;

              return (
                <div key={idx} className="rounded-lg border border-gray-200 bg-white overflow-hidden">
                  <button
                    onClick={() =>
                      setExpandedCategory(isExpanded ? null : category.category)
                    }
                    className="w-full px-4 py-3 text-left hover:bg-gray-50"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-gray-900">
                            {category.category}
                          </span>
                          {category.isScheduled && (
                            <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold text-blue-900">
                              scheduled
                            </span>
                          )}
                          {category.isEstimated && (
                            <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-600">
                              est.
                            </span>
                          )}
                        </div>
                        <div className="mt-1 h-1.5 w-full max-w-xs rounded-full bg-gray-100">
                          <div
                            className="h-full rounded-full bg-purple-500"
                            style={{ width: `${Math.min(100, category.pctOfBucket)}%` }}
                          />
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-semibold text-gray-900">
                          {fmt(category.amount)}
                        </p>
                        <p className="text-xs text-gray-500">
                          avg/mo · {Math.round(category.pctOfBucket)}%
                        </p>
                      </div>
                    </div>
                  </button>

                  {/* Expanded Merchants */}
                  {isExpanded && category.merchants && category.merchants.length > 0 && (
                    <div className="border-t border-gray-200 bg-gray-50 px-4 py-3">
                      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                        Top merchants
                      </p>
                      <div className="space-y-1">
                        {category.merchants.map((merchant, mIdx) => (
                          <div
                            key={mIdx}
                            className="flex items-center justify-between text-xs"
                          >
                            <span className="text-gray-700">{merchant.merchant}</span>
                            <span className="font-medium text-gray-900">
                              {fmt(merchant.amount)}
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
        )}
      </div>

      {/* Not Counted Here */}
      {breakdown.notCountedHere && breakdown.notCountedHere.length > 0 && (
        <div>
          <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-gray-500">
            Not counted here
          </h3>
          <div className="space-y-2">
            {breakdown.notCountedHere.map((item, idx) => (
              <div
                key={idx}
                className="rounded-lg border border-gray-300 bg-gray-50 px-4 py-3"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-700">{item.label}</p>
                    <p className="mt-0.5 text-xs text-gray-500">{item.reason}</p>
                  </div>
                  {item.amount !== undefined && (
                    <span className="text-sm font-semibold text-gray-600">
                      {fmt(item.amount)}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Coach Note */}
      <div className="rounded-xl border border-purple-200 bg-purple-50 p-4">
        <p className="text-sm leading-relaxed text-purple-900">
          <strong>💡 Coach:</strong> This shows your average spending over the selected time
          period. {type === "fixed" && "Fixed costs typically include rent, insurance, and scheduled debt payments."}{" "}
          {type === "essentials" && "Essentials cover necessities like groceries and transportation."}{" "}
          {type === "flexible" && "Flexible spending includes dining, shopping, and entertainment."}{" "}
          {type === "savings" && "This includes investments, extra debt payments beyond minimums, and savings contributions."}
        </p>
      </div>
    </div>
  );
}

function SavingsDrawerContent({
  data,
  currency,
  token,
  onRefresh,
}: {
  data: import("@/lib/drawerTypes").SavingsDrawerData;
  currency: string;
  token: string | null;
  onRefresh: () => void;
}) {
  const [expandedMonth, setExpandedMonth] = useState<string | null>(null);
  const [expandedCategories, setExpandedCategories] = useState<Record<string, Set<string>>>({});
  
  const fmt = (amount: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency || "USD",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  
  const fmtChange = (amount: number) => {
    if (amount === 0) {
      return fmt(0).replace(/^[+-]/, ''); // Remove any sign for zero
    }
    const formatted = fmt(amount);
    return amount > 0 ? `+${formatted}` : formatted;
  };

  const { windowSavings, basisLabel } = data;
  const { monthlyBreakdown, monthlyAverage, windowPeriodAccounts } = windowSavings;
  
  const toggleMonth = (month: string) => {
    setExpandedMonth(expandedMonth === month ? null : month);
  };
  
  const toggleCategory = (month: string, category: string) => {
    setExpandedCategories(prev => {
      const monthCategories = prev[month] || new Set<string>();
      const newMonthCategories = new Set(monthCategories);
      
      if (newMonthCategories.has(category)) {
        newMonthCategories.delete(category);
      } else {
        newMonthCategories.add(category);
      }
      
      return {
        ...prev,
        [month]: newMonthCategories
      };
    });
  };
  
  const isCategoryExpanded = (month: string, category: string) => {
    return expandedCategories[month]?.has(category) || false;
  };

  return (
    <div className="space-y-6">
      {/* Savings Reviews */}
      <ReviewList 
        token={token} 
        reviewType="savings_item"
        onReviewComplete={onRefresh}
      />
      
      {/* Monthly Average Summary */}
      <div className="rounded-xl border border-gray-200 bg-white p-6">
        <div className="text-center">
          <p className="text-sm font-medium uppercase tracking-wide text-gray-500">
            Monthly average
          </p>
          <p className={`mt-2 text-4xl font-bold ${getSignColor(monthlyAverage.total)}`}>
            {fmt(monthlyAverage.total)}
          </p>
          <p className="mt-1 text-xs text-gray-500">{basisLabel}</p>
        </div>
      </div>

      {/* Per-Month Bars */}
      <div>
        <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-gray-500">
          Monthly breakdown
        </h3>
        <div className="space-y-1.5">
          {monthlyBreakdown.map((month) => {
            const isExpanded = expandedMonth === month.month;
            
            return (
              <div key={month.month}>
                <button
                  onClick={() => toggleMonth(month.month)}
                  className="w-full text-left hover:bg-gray-50 rounded p-1.5 -mx-1.5 transition flex items-center gap-2"
                >
                  <span className="w-12 text-xs font-medium text-gray-700">
                    {formatMonthYear(month.month).split(' ')[0]}
                  </span>
                  <div className="flex-1">
                    <div className="relative h-2 rounded-full bg-gray-100">
                      {month.total !== 0 && (
                        <div
                          className={`absolute top-0 h-full rounded-full ${getSignBgColor(month.total)}`}
                          style={{
                            width: `${Math.min(Math.abs(month.total) / Math.max(...monthlyBreakdown.map(m => Math.abs(m.total)), 1) * 100, 100)}%`,
                            left: month.total >= 0 ? '0' : 'auto',
                            right: month.total < 0 ? '0' : 'auto',
                          }}
                        />
                      )}
                    </div>
                  </div>
                  <span className={`w-20 text-right text-xs font-semibold whitespace-nowrap ${getSignColor(month.total)}`}>
                    {fmt(month.total)}
                  </span>
                  <svg
                    className={`w-3.5 h-3.5 text-gray-400 transition-transform flex-shrink-0 ${isExpanded ? 'rotate-180' : ''}`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                
                {/* Expanded per-account detail */}
                {isExpanded && (
                  <div className="mt-2 ml-2 p-4 bg-gray-50 rounded-lg border border-gray-200 space-y-3">
                    {/* Cash & Savings accounts */}
                    {month.accounts.cashAccounts.length > 0 && (
                      <div>
                        {/* Category Header - Collapsible */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleCategory(month.month, 'cash');
                          }}
                          className="w-full flex items-center justify-between py-2 rounded hover:bg-gray-50 transition"
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-base">💵</span>
                            <span className="text-xs font-semibold uppercase tracking-wide text-gray-700">
                              Cash & Savings
                            </span>
                            <span className="text-xs text-gray-500">
                              ({month.accounts.cashAccounts.length})
                            </span>
                            <svg
                              className={`w-3 h-3 text-gray-400 transition-transform ${
                                isCategoryExpanded(month.month, 'cash') ? 'rotate-180' : ''
                              }`}
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                            >
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                          </div>
                          <span className={`text-sm font-bold whitespace-nowrap ${getSignColor(month.netCashChange)}`}>
                            {fmtChange(month.netCashChange)}
                          </span>
                        </button>
                        
                        {/* Account Cards - Expandable */}
                        {isCategoryExpanded(month.month, 'cash') && (
                          <div className="space-y-2 mt-2">
                            {month.accounts.cashAccounts.map((acc) => {
                              // Helper to format month label
                              const formatMonth = (ym: string) => {
                                if (!ym) return '';
                                const [year, monthNum] = ym.split('-');
                                const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                                return `${monthNames[parseInt(monthNum) - 1]} ${year}`;
                              };
                              
                              // Determine badge text based on derived status
                              let badgeText = null;
                              let badgeTitle = '';
                              
                              if (acc.currentDerived && acc.currentSourceStatement) {
                                badgeText = `Calculated from ${formatMonth(acc.currentSourceStatement)} statement`;
                                badgeTitle = 'This month\'s balance was calculated from a multi-month statement';
                              } else if (acc.currentCarriedForward && !acc.currentDerived) {
                                badgeText = `No ${formatMonthYear(month.month).split(' ')[0]} statement`;
                                badgeTitle = 'No statement uploaded for this month, so the last known balance is used';
                              }
                              
                              // Show actual months used for Prior and Current
                              const priorMonthShort = acc.priorActualMonth ? formatMonth(acc.priorActualMonth) : '';
                              const currentMonthShort = acc.currentActualMonth ? formatMonth(acc.currentActualMonth) : '';
                              
                              // For current: show "End of X" if it matches the month, otherwise "Latest (X)"
                              let currentLabel: string;
                              if (acc.currentActualMonth === month.month) {
                                currentLabel = `End of ${formatMonthYear(month.month).split(' ')[0]}`;
                              } else if (acc.currentCarriedForward) {
                                currentLabel = `Latest (${currentMonthShort})`;
                              } else {
                                currentLabel = 'Latest';
                              }
                              
                              // For prior: show month if it's not the immediately previous month
                              const expectedPriorMonth = (() => {
                                const [year, monthNum] = month.month.split('-').map(Number);
                                const priorDate = new Date(year, monthNum - 2, 1); // -2 because month-1 gets current, -2 gets prior
                                return `${priorDate.getFullYear()}-${String(priorDate.getMonth() + 1).padStart(2, '0')}`;
                              })();
                              
                              let priorLabel: string;
                              if (!acc.priorActualMonth) {
                                priorLabel = 'Prior';
                              } else if (acc.priorActualMonth === expectedPriorMonth) {
                                priorLabel = 'Prior';
                              } else {
                                priorLabel = `Prior (${priorMonthShort})`;
                              }
                              
                              return (
                                <div key={acc.slug} className="bg-white rounded p-2 text-xs border border-gray-200">
                                  <div className="flex items-start justify-between mb-1">
                                    <div>
                                      <span className="font-medium text-gray-900">{acc.accountLabel.split(' (')[0]}</span>
                                      <span className="text-gray-500 ml-1">(...{acc.accountLast4})</span>
                                      {badgeText && (
                                        <span 
                                          className={`ml-2 rounded px-1.5 py-0.5 text-[10px] font-medium ${
                                            acc.currentDerived ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'
                                          }`}
                                          title={badgeTitle}
                                        >
                                          {badgeText}
                                        </span>
                                      )}
                                    </div>
                                    <span className={`font-semibold whitespace-nowrap ${getSignColor(acc.change)}`}>
                                      {fmtChange(acc.change)}
                                    </span>
                                  </div>
                                  <div className="flex gap-4 text-gray-600">
                                    <span>{priorLabel}: {fmt(acc.priorBalance)}</span>
                                    <span>→</span>
                                    <span>{currentLabel}: {fmt(acc.currentBalance)}</span>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}
                    
                    {/* Debt accounts */}
                    {month.accounts.debtAccounts.length > 0 && (
                      <div>
                        {/* Category Header - Collapsible */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleCategory(month.month, 'debt');
                          }}
                          className="w-full flex items-center justify-between py-2 rounded hover:bg-gray-50 transition"
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-base">💳</span>
                            <span className="text-xs font-semibold uppercase tracking-wide text-gray-700">
                              Debt
                            </span>
                            <span className="text-xs text-gray-500">
                              ({month.accounts.debtAccounts.length})
                            </span>
                            <svg
                              className={`w-3 h-3 text-gray-400 transition-transform ${
                                isCategoryExpanded(month.month, 'debt') ? 'rotate-180' : ''
                              }`}
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                            >
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                          </div>
                          <span className={`text-sm font-bold whitespace-nowrap ${getSignColor(month.netDebtChange)}`}>
                            {fmtChange(month.netDebtChange)}
                          </span>
                        </button>
                        
                        {/* Account Cards - Expandable */}
                        {isCategoryExpanded(month.month, 'debt') && (
                          <div className="space-y-2 mt-2">
                            {month.accounts.debtAccounts.map((acc) => {
                              const isPaidDown = acc.change > 0;
                              const isBorrowing = acc.change < 0;
                              
                              // Helper to format month label
                              const formatMonth = (ym: string) => {
                                if (!ym) return '';
                                const [year, monthNum] = ym.split('-');
                                const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                                return `${monthNames[parseInt(monthNum) - 1]} ${year}`;
                              };
                              
                              // Determine badge text based on derived status
                              let badgeText = null;
                              let badgeTitle = '';
                              
                              if (acc.currentDerived && acc.currentSourceStatement) {
                                badgeText = `Calculated from ${formatMonth(acc.currentSourceStatement)} statement`;
                                badgeTitle = 'This month\'s balance was calculated from a multi-month statement';
                              } else if (acc.currentCarriedForward && !acc.currentDerived) {
                                badgeText = `No ${formatMonthYear(month.month).split(' ')[0]} statement`;
                                badgeTitle = 'No statement uploaded for this month, so the last known balance is used';
                              }
                              
                              // Show actual months used for Prior and Current
                              const priorMonthShort = acc.priorActualMonth ? formatMonth(acc.priorActualMonth) : '';
                              const currentMonthShort = acc.currentActualMonth ? formatMonth(acc.currentActualMonth) : '';
                              
                              // For current: show "End of X" if it matches the month, otherwise "Latest (X)"
                              let currentLabel: string;
                              if (acc.currentActualMonth === month.month) {
                                currentLabel = `End of ${formatMonthYear(month.month).split(' ')[0]}`;
                              } else if (acc.currentCarriedForward) {
                                currentLabel = `Latest (${currentMonthShort})`;
                              } else {
                                currentLabel = 'Latest';
                              }
                              
                              // For prior: show month if it's not the immediately previous month
                              const expectedPriorMonth = (() => {
                                const [year, monthNum] = month.month.split('-').map(Number);
                                const priorDate = new Date(year, monthNum - 2, 1); // -2 because month-1 gets current, -2 gets prior
                                return `${priorDate.getFullYear()}-${String(priorDate.getMonth() + 1).padStart(2, '0')}`;
                              })();
                              
                              let priorLabel: string;
                              if (!acc.priorActualMonth) {
                                priorLabel = 'Prior';
                              } else if (acc.priorActualMonth === expectedPriorMonth) {
                                priorLabel = 'Prior';
                              } else {
                                priorLabel = `Prior (${priorMonthShort})`;
                              }
                              
                              return (
                                <div key={acc.slug} className="bg-white rounded p-2 text-xs border border-gray-200">
                                  <div className="flex items-start justify-between mb-1">
                                    <div>
                                      <span className="font-medium text-gray-900">{acc.accountLabel.split(' (')[0]}</span>
                                      <span className="text-gray-500 ml-1">(...{acc.accountLast4})</span>
                                      {badgeText && (
                                        <span 
                                          className={`ml-2 rounded px-1.5 py-0.5 text-[10px] font-medium ${
                                            acc.currentDerived ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'
                                          }`}
                                          title={badgeTitle}
                                        >
                                          {badgeText}
                                        </span>
                                      )}
                                    </div>
                                    <div className="text-right">
                                      <div className={`font-semibold whitespace-nowrap ${getSignColor(acc.change)}`}>
                                        {fmtChange(acc.change)}
                                      </div>
                                      <div className="text-xs text-gray-500">
                                        {isPaidDown ? 'Paid down' : isBorrowing ? 'New borrowing' : 'No change'}
                                      </div>
                                    </div>
                                  </div>
                                  <div className="flex gap-4 text-gray-600">
                                    <span>{priorLabel}: {fmt(acc.priorBalance)}</span>
                                    <span>→</span>
                                    <span>{currentLabel}: {fmt(acc.currentBalance)}</span>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}
                    
                    {/* Outside contributions */}
                    {month.accounts.contributions.length > 0 && (
                      <div>
                        {/* Category Header - Collapsible */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleCategory(month.month, 'contributions');
                          }}
                          className="w-full flex items-center justify-between py-2 rounded hover:bg-gray-50 transition"
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-base">🏦</span>
                            <span className="text-xs font-semibold uppercase tracking-wide text-gray-700">
                              Outside Contributions
                            </span>
                            <span className="text-xs text-gray-500">
                              ({month.accounts.contributions.length})
                            </span>
                            <svg
                              className={`w-3 h-3 text-gray-400 transition-transform ${
                                isCategoryExpanded(month.month, 'contributions') ? 'rotate-180' : ''
                              }`}
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                            >
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                          </div>
                          <span className={`text-sm font-bold whitespace-nowrap ${getSignColor(month.contributionsToOutside)}`}>
                            {fmtChange(month.contributionsToOutside)}
                          </span>
                        </button>
                        
                        {/* Contribution Cards - Expandable */}
                        {isCategoryExpanded(month.month, 'contributions') && (
                          <div className="space-y-2 mt-2">
                            {month.accounts.contributions.map((contrib, idx) => (
                              <div key={idx} className="bg-white rounded p-2 text-xs border border-gray-200">
                                <div className="flex items-start justify-between">
                                  <div>
                                    <span className="font-medium text-gray-900">{contrib.merchant}</span>
                                    <div className="text-gray-500">{contrib.category}</div>
                                    {contrib.needsConfirmation && (
                                      <span className="text-orange-600 font-semibold">⚠️ Needs confirmation</span>
                                    )}
                                  </div>
                                  <span className="font-semibold text-gray-900 whitespace-nowrap">
                                    {fmt(contrib.amount)}
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Reconciliation Table */}
      <div>
        <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-gray-500">
          How the numbers add up
        </h3>
        <p className="mb-3 text-xs text-gray-500">Tap a month to see accounts</p>
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="border-b border-gray-300">
                <th className="text-left py-2 pr-2 font-semibold text-gray-700 w-12">
                  <div className="flex items-center gap-1">
                    Month
                    <svg className="w-3 h-3 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </th>
                <th className="text-right py-2 px-2 font-semibold text-gray-700">Cash</th>
                <th className="text-right py-2 px-2 font-semibold text-gray-700">Debt</th>
                <th className="text-right py-2 px-2 font-semibold text-gray-700">Contrib</th>
                <th className="text-right py-2 pl-2 font-semibold text-gray-700">Net</th>
              </tr>
            </thead>
            <tbody>
              {monthlyBreakdown.map((month) => (
                <tr
                  key={month.month}
                  onClick={() => toggleMonth(month.month)}
                  className={`border-b border-gray-200 cursor-pointer hover:bg-gray-50 transition ${
                    expandedMonth === month.month ? 'bg-gray-50' : ''
                  }`}
                >
                  <td className="py-2 pr-2 text-gray-900">
                    <div className="flex items-center gap-1">
                      {formatMonthYear(month.month).split(' ')[0]}
                      <svg
                        className={`w-3 h-3 text-gray-400 transition-transform ${
                          expandedMonth === month.month ? 'rotate-180' : ''
                        }`}
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>
                  </td>
                  <td className={`text-right py-2 px-2 whitespace-nowrap ${getSignColor(month.netCashChange)}`}>
                    {fmt(month.netCashChange)}
                  </td>
                  <td className={`text-right py-2 px-2 whitespace-nowrap ${getSignColor(month.netDebtChange)}`}>
                    {fmt(month.netDebtChange)}
                  </td>
                  <td className="text-right py-2 px-2 text-gray-900 whitespace-nowrap">
                    {fmt(month.contributionsToOutside)}
                  </td>
                  <td className={`text-right py-2 pl-2 font-semibold whitespace-nowrap ${getSignColor(month.total)}`}>
                    {fmt(month.total)}
                  </td>
                </tr>
              ))}
              {/* Monthly average row */}
              <tr className="border-t-2 border-gray-400 bg-gray-50 font-semibold">
                <td className="py-2 pr-2 text-gray-900">Avg</td>
                <td className={`text-right py-2 px-2 whitespace-nowrap ${getSignColor(monthlyAverage.netCashChange)}`}>
                  {fmt(monthlyAverage.netCashChange)}
                </td>
                <td className={`text-right py-2 px-2 whitespace-nowrap ${getSignColor(monthlyAverage.netDebtChange)}`}>
                  {fmt(monthlyAverage.netDebtChange)}
                </td>
                <td className="text-right py-2 px-2 text-gray-900 whitespace-nowrap">
                  {fmt(monthlyAverage.contributionsToOutside)}
                </td>
                <td className={`text-right py-2 pl-2 whitespace-nowrap ${getSignColor(monthlyAverage.total)}`}>
                  {fmt(monthlyAverage.total)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Coach Note */}
      <div className="rounded-xl border border-purple-200 bg-purple-50 p-4">
        <p className="text-sm leading-relaxed text-purple-900">
          <strong>💡 Coach:</strong> This shows your NET savings using month-end balances.
          Savings = (cash account changes) + (debt paid down) + (outside contributions).
          Debt transfers (like paying off a credit card with a line of credit) net to zero.
          Negative months mean you spent more than you saved.
        </p>
      </div>
    </div>
  );
}
