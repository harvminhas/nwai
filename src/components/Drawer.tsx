"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { DrawerData, DrawerErrorResponse } from "@/lib/drawerTypes";
import { formatMonthYear } from "@/lib/dateFormatting";
import { getSignColor, getSignBgColor } from "@/lib/colorHelpers";
import type { TimeRange } from "@/lib/rangeUtils";
import { formatMonthName, formatAccountLast4 } from "@/lib/rangeUtils";

export type DrawerType = "income" | "fixed" | "essentials" | "flexible" | "savings";

interface DrawerProps {
  type: DrawerType;
  isOpen: boolean;
  onClose: () => void;
  token: string | null;
  currency: string;
  initialRange?: TimeRange; // Sync with dashboard range
}

function getRangeLabel(range: TimeRange): string {
  if (range.startsWith("month:")) {
    return formatMonthName(range.substring(6));
  }
  switch (range) {
    case "3mo": return "Last 3 months";
    case "12mo": return "12-month avg";
    case "ytd": return "This year";
    default: return "Last 3 months";
  }
}

export function Drawer({ type, isOpen, onClose, token, currency, initialRange }: DrawerProps) {
  const [range, setRange] = useState<TimeRange>(initialRange || "3mo");
  
  // Reset range when initialRange changes
  useEffect(() => {
    if (initialRange) {
      setRange(initialRange);
    }
  }, [initialRange]);
  const [data, setData] = useState<DrawerData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isOpen || !token) return;

    setLoading(true);
    setError(null);
    
    fetch(`/api/user/dashboard-drawers?range=${range}&bucket=${type}`, {
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
  }, [isOpen, type, range, token]);

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

          {/* Range Label (read-only) */}
          <div className="mt-3">
            <p className="text-sm text-gray-600">
              {getRangeLabel(range)}
            </p>
          </div>
          
          {/* Link to full page */}
          {(type === "income" || ["fixed", "essentials", "flexible"].includes(type)) && (
            <div className="mt-3">
              <Link
                href={type === "income" 
                  ? `/account/income?range=${range}`
                  : `/account/spending?range=${range}`
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
                  setRange("3mo");
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
            <SavingsDrawerContent data={data} currency={currency} />
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
  const [expandedMerchant, setExpandedMerchant] = useState<string | null>(null);

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
        {data.windowNote && (
          <p className="mt-1 text-xs text-gray-400">{data.windowNote}</p>
        )}
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
                        {category.merchants.map((merchant, mIdx) => {
                          const merchantKey = `${category.category}-${mIdx}`;
                          const isMerchantExpanded = expandedMerchant === merchantKey;
                          const hasTransactions = merchant.transactions && merchant.transactions.length > 0;
                          
                          // Calculate period total from transactions
                          const periodTotal = hasTransactions && merchant.transactions
                            ? merchant.transactions.reduce((sum, t) => sum + t.amount, 0)
                            : 0;
                          
                          return (
                            <div key={mIdx} className="border-b border-gray-200 last:border-b-0">
                              <button
                                onClick={() => setExpandedMerchant(isMerchantExpanded ? null : merchantKey)}
                                disabled={!hasTransactions}
                                className={`w-full flex items-center justify-between text-xs py-2 ${
                                  hasTransactions ? 'hover:bg-gray-100 cursor-pointer' : ''
                                }`}
                              >
                                <div className="flex items-center gap-2">
                                  {hasTransactions && (
                                    <svg
                                      className={`w-3 h-3 text-gray-400 transition-transform ${
                                        isMerchantExpanded ? 'rotate-90' : ''
                                      }`}
                                      fill="none"
                                      viewBox="0 0 24 24"
                                      stroke="currentColor"
                                    >
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                    </svg>
                                  )}
                                  <span className="text-gray-700">{merchant.merchant}</span>
                                </div>
                                <span className="font-medium text-gray-900">
                                  {fmt(merchant.amount)}
                                </span>
                              </button>
                              
                              {/* Expanded Transactions */}
                              {isMerchantExpanded && hasTransactions && merchant.transactions && (
                                <div className="pl-5 pr-2 pb-2 space-y-1">
                                  {merchant.transactions
                                    .sort((a, b) => b.date.localeCompare(a.date)) // Newest first
                                    .map((txn, txIdx) => (
                                      <div key={txIdx} className="flex items-start justify-between text-[11px] text-gray-600 py-1">
                                        <div className="flex-1 min-w-0">
                                          <div className="flex items-center gap-2">
                                            <span className="font-mono text-gray-500">
                                              {formatMonthYear(txn.date)}
                                            </span>
                                            <span className="truncate">{txn.description}</span>
                                          </div>
                                          {txn.accountSlug && (
                                            <div className="text-gray-400 mt-0.5">
                                              {formatAccountLast4(txn.accountSlug)}
                                            </div>
                                          )}
                                        </div>
                                        <span className="ml-2 font-medium text-gray-700 shrink-0">
                                          {fmt(txn.amount)}
                                        </span>
                                      </div>
                                    ))
                                  }
                                  <div className="pt-1 mt-1 border-t border-gray-200 text-[11px] text-gray-500">
                                    {merchant.txCount} {merchant.txCount === 1 ? 'transaction' : 'transactions'} · {fmt(periodTotal)} total
                                    {data.range && !data.range.startsWith('month:') && ` over ${data.range === '3mo' ? '3 months' : data.range === '12mo' ? '12 months' : 'this year'}`}
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
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
}: {
  data: import("@/lib/drawerTypes").SavingsDrawerData;
  currency: string;
}) {
  const [expandedMonth, setExpandedMonth] = useState<string | null>(null);

  const fmt = (amount: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency || "USD",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);

  const { monthlyAverage, monthlyBreakdown, basisLabel, moneyIn, moneyOut } = data;
  const maxAbs = Math.max(...monthlyBreakdown.map((m) => Math.abs(m.leftover)), 1);

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-gray-200 bg-white p-6">
        <div className="text-center">
          <p className="text-sm font-medium uppercase tracking-wide text-gray-500">
            Monthly average leftover
          </p>
          <p className={`mt-2 text-4xl font-bold ${getSignColor(monthlyAverage)}`}>
            {fmt(monthlyAverage)}
          </p>
          <p className="mt-1 text-xs text-gray-500">{basisLabel}</p>
          {data.windowNote && (
            <p className="mt-1 text-xs text-gray-400">{data.windowNote}</p>
          )}
          <p className="mt-3 text-xs text-gray-500">
            Money in {fmt(moneyIn)} − money out {fmt(moneyOut)}
          </p>
        </div>
      </div>

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
                  onClick={() => setExpandedMonth(isExpanded ? null : month.month)}
                  className="w-full text-left hover:bg-gray-50 rounded p-1.5 -mx-1.5 transition flex items-center gap-2"
                >
                  <span className="w-12 text-xs font-medium text-gray-700">
                    {formatMonthYear(month.month).split(" ")[0]}
                  </span>
                  <div className="flex-1">
                    <div className="relative h-2 rounded-full bg-gray-100">
                      {month.leftover !== 0 && (
                        <div
                          className={`absolute top-0 h-full rounded-full ${getSignBgColor(month.leftover)}`}
                          style={{
                            width: `${Math.min((Math.abs(month.leftover) / maxAbs) * 100, 100)}%`,
                            left: month.leftover >= 0 ? "0" : "auto",
                            right: month.leftover < 0 ? "0" : "auto",
                          }}
                        />
                      )}
                    </div>
                  </div>
                  <span className={`w-20 text-right text-xs font-semibold whitespace-nowrap ${getSignColor(month.leftover)}`}>
                    {fmt(month.leftover)}
                  </span>
                  <svg
                    className={`w-3.5 h-3.5 text-gray-400 transition-transform flex-shrink-0 ${isExpanded ? "rotate-180" : ""}`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {isExpanded && (
                  <div className="mt-2 ml-2 p-4 bg-gray-50 rounded-lg border border-gray-200 space-y-2 text-xs">
                    <div className="flex justify-between">
                      <span className="text-gray-600">Money in</span>
                      <span className="font-semibold text-gray-900">{fmt(month.moneyIn)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Money out</span>
                      <span className="font-semibold text-gray-900">{fmt(month.moneyOut)}</span>
                    </div>
                    <div className="pl-3 space-y-1 text-gray-500">
                      <div className="flex justify-between">
                        <span>Fixed</span>
                        <span>{fmt(month.buckets.fixed)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Essentials</span>
                        <span>{fmt(month.buckets.essentials)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Flexible</span>
                        <span>{fmt(month.buckets.flexible)}</span>
                      </div>
                    </div>
                    <div className="flex justify-between border-t border-gray-200 pt-2">
                      <span className="font-semibold text-gray-700">Leftover</span>
                      <span className={`font-semibold ${getSignColor(month.leftover)}`}>
                        {fmt(month.leftover)}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-gray-500">
          How the numbers add up
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="border-b border-gray-300">
                <th className="text-left py-2 pr-2 font-semibold text-gray-700">Month</th>
                <th className="text-right py-2 px-2 font-semibold text-gray-700">In</th>
                <th className="text-right py-2 px-2 font-semibold text-gray-700">Out</th>
                <th className="text-right py-2 pl-2 font-semibold text-gray-700">Leftover</th>
              </tr>
            </thead>
            <tbody>
              {monthlyBreakdown.map((month) => (
                <tr key={month.month} className="border-b border-gray-200">
                  <td className="py-2 pr-2 text-gray-900">
                    {formatMonthYear(month.month).split(" ")[0]}
                  </td>
                  <td className="text-right py-2 px-2 text-gray-900 whitespace-nowrap">
                    {fmt(month.moneyIn)}
                  </td>
                  <td className="text-right py-2 px-2 text-gray-900 whitespace-nowrap">
                    {fmt(month.moneyOut)}
                  </td>
                  <td className={`text-right py-2 pl-2 font-semibold whitespace-nowrap ${getSignColor(month.leftover)}`}>
                    {fmt(month.leftover)}
                  </td>
                </tr>
              ))}
              <tr className="border-t-2 border-gray-400 bg-gray-50 font-semibold">
                <td className="py-2 pr-2 text-gray-900">Avg</td>
                <td className="text-right py-2 px-2 text-gray-900 whitespace-nowrap">{fmt(moneyIn)}</td>
                <td className="text-right py-2 px-2 text-gray-900 whitespace-nowrap">{fmt(moneyOut)}</td>
                <td className={`text-right py-2 pl-2 whitespace-nowrap ${getSignColor(monthlyAverage)}`}>
                  {fmt(monthlyAverage)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-xl border border-purple-200 bg-purple-50 p-4">
        <p className="text-sm leading-relaxed text-purple-900">
          <strong>Coach:</strong> Net savings is leftover: money in minus money out,
          the same number as the dashboard card. Transfers, credit card payments,
          and investments are left out of money out, same as Income and Spending.
        </p>
      </div>
    </div>
  );
}
