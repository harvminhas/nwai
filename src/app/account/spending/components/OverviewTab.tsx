import { useState, useEffect } from "react";
import type { SpendingSummary } from "@/lib/spendingSummary";
import type { SubscriptionSummary } from "@/lib/subscriptionEngine";
import { formatMonthYear } from "@/lib/dateFormatting";
import { formatCurrency } from "@/lib/currencyUtils";
import { getSignColor } from "@/lib/colorHelpers";
import { ReviewList } from "@/components/ReviewList";
import Link from "next/link";

interface OverviewTabProps {
  summary: SpendingSummary;
  token: string | null;
  onReviewComplete?: () => void;
}

export function OverviewTab({ summary, token, onReviewComplete }: OverviewTabProps) {
  const [subscriptions, setSubscriptions] = useState<SubscriptionSummary | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [expandedMerchants, setExpandedMerchants] = useState<Set<string>>(new Set());

  const loadSubscriptions = async () => {
    if (!token) return;
    
    try {
      const res = await fetch("/api/user/subscriptions", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setSubscriptions(data);
      }
    } catch (err) {
      console.error("Failed to load subscriptions:", err);
    }
  };

  useEffect(() => {
    loadSubscriptions();
  }, [token]);
  const lastMonth = summary.lastCompleteMonth;
  const lastMonthData = summary.monthlyHistory.find(m => m.yearMonth === lastMonth);
  
  if (!lastMonthData) {
    return <div className="text-neutral-500">No data for {formatMonthYear(lastMonth)}</div>;
  }

  const bucketLabels: Record<string, string> = {
    fixed: "Fixed",
    essentials: "Essentials",
    flexible: "Flexible",
  };

  const bucketColors: Record<string, string> = {
    fixed: "bg-purple-600",
    essentials: "bg-blue-600",
    flexible: "bg-green-600",
  };

  return (
    <div className="space-y-6">
      {/* Month comparison */}
      <div>
        <div className="flex items-baseline gap-2 mb-3">
          <h2 className="text-lg font-semibold text-neutral-900">
            {formatMonthYear(lastMonth)}
          </h2>
          <span className="text-sm text-neutral-500">vs typical month</span>
        </div>

        <div className="flex items-center gap-4 mb-2">
          <div className="text-3xl font-semibold text-neutral-900">
            {formatCurrency(lastMonthData.total, summary.currency)}
          </div>
          {summary.vsTypical !== 0 && (
            <div className={`text-sm font-medium ${getSignColor(summary.vsTypical)}`}>
              {summary.vsTypical > 0 ? "+" : ""}
              {formatCurrency(summary.vsTypical, summary.currency)}
              {" "}
              ({summary.vsTypicalPct > 0 ? "+" : ""}
              {summary.vsTypicalPct.toFixed(0)}%)
            </div>
          )}
        </div>

        {/* Stacked bar */}
        <div className="relative w-full h-8 bg-neutral-100 rounded overflow-hidden">
          {["fixed", "essentials", "flexible"].map((bucket, idx) => {
            const bucketData = summary.buckets.find(b => b.bucket === bucket);
            if (!bucketData || bucketData.share === 0) return null;
            
            const widthPct = (bucketData.share * 100).toFixed(1);
            return (
              <div
                key={bucket}
                className={`absolute h-full ${bucketColors[bucket as keyof typeof bucketColors]}`}
                style={{
                  left: idx === 0 
                    ? "0%" 
                    : idx === 1 
                      ? `${(summary.buckets.find(b => b.bucket === "fixed")?.share || 0) * 100}%`
                      : `${((summary.buckets.find(b => b.bucket === "fixed")?.share || 0) + (summary.buckets.find(b => b.bucket === "essentials")?.share || 0)) * 100}%`,
                  width: `${widthPct}%`,
                }}
              />
            );
          })}
        </div>

        {/* Bucket legend */}
        <div className="flex gap-4 mt-2 text-sm">
          {summary.buckets.map(b => (
            <div key={b.bucket} className="flex items-center gap-2">
              <div className={`w-3 h-3 rounded-sm ${bucketColors[b.bucket]}`} />
              <span className="text-neutral-700">{bucketLabels[b.bucket]}</span>
              <span className="text-neutral-900 font-medium">
                {formatCurrency(b.total, summary.currency)}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Top categories */}
      <div>
        <h3 className="text-base font-semibold text-neutral-900 mb-3">Top categories</h3>
        <div className="space-y-3">
          {summary.topCategories.map(cat => {
            // Find change vs typical (average of last 3 months before last)
            const last3 = summary.monthlyHistory.slice(-4, -1);
            const priorAvg = last3.reduce((sum, m) => {
              const c = m.categories.find(c => c.category === cat.category);
              return sum + (c?.amount || 0);
            }, 0) / (last3.length || 1);
            
            const lastMonthCat = lastMonthData.categories.find(c => c.category === cat.category);
            const lastMonthAmt = lastMonthCat?.amount || 0;
            const change = lastMonthAmt - priorAvg;
            const changePct = priorAvg > 0 ? (change / priorAvg) * 100 : 0;

            const barColor = bucketColors[cat.bucket] || bucketColors.flexible;
            
            // Dot color (same as bar but as text color)
            const dotColorMap: Record<string, string> = {
              "bg-purple-600": "text-purple-600",
              "bg-blue-600": "text-blue-600",
              "bg-green-600": "text-green-600",
            };
            const dotColor = dotColorMap[barColor] || "text-gray-500";
            
            return (
              <button
                key={cat.category}
                onClick={() => {
                  setSelectedCategory(cat.category);
                  setExpandedMerchants(new Set()); // Reset expanded state when changing category
                }}
                className="w-full text-left hover:bg-gray-50 rounded-lg p-2 -m-2 transition-colors cursor-pointer group"
              >
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span className={`text-xl ${dotColor}`}>•</span>
                    <div className="text-sm font-medium text-neutral-900">{cat.category}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="text-sm text-neutral-900">
                      {formatCurrency(lastMonthAmt, summary.currency)}
                    </div>
                    {Math.abs(changePct) >= 5 && (
                      <div className={`text-xs ${getSignColor(change)}`}>
                        {change > 0 ? "+" : ""}
                        {changePct.toFixed(0)}%
                      </div>
                    )}
                    <svg className="w-4 h-4 text-gray-400 group-hover:text-gray-600 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                </div>
                <div className="relative w-full h-2 bg-neutral-100 rounded overflow-hidden">
                  <div
                    className={`absolute h-full ${barColor} rounded`}
                    style={{ width: `${Math.min(100, (cat.share * 100))}%` }}
                  />
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Insights */}
      {summary.insights.length > 0 && (
        <div>
          <h3 className="text-base font-semibold text-neutral-900 mb-3">Worth knowing</h3>
          <div className="space-y-2">
            {summary.insights.map((insight, idx) => (
              <div key={idx} className="text-sm text-neutral-700 bg-neutral-50 rounded p-3">
                {insight.message}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Subscriptions summary */}
      {subscriptions && (subscriptions.subscriptions.length > 0 || subscriptions.candidateCount > 0) && (
        <div>
          {/* Subscription ReviewList */}
          {token && subscriptions.candidateCount > 0 && (
            <div className="mb-4">
              <ReviewList
                token={token}
                reviewType="subscription"
                onReviewComplete={() => loadSubscriptions()}
              />
            </div>
          )}
          
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-base font-semibold text-neutral-900">Subscriptions</h3>
            <Link
              href="/account/spending?tab=subscriptions"
              className="text-sm text-purple-600 hover:text-purple-700 font-medium"
            >
              See all →
            </Link>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="grid grid-cols-3 gap-4 mb-4">
              <div>
                <p className="text-xs text-gray-500 mb-1">PER MONTH</p>
                <p className="text-xl font-bold text-gray-900 tabular-nums">
                  {formatCurrency(subscriptions.monthlyTotal, summary.currency, undefined, true)}
                </p>
                <p className="text-xs text-gray-500 mt-0.5">Confirmed only</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-1">PER YEAR</p>
                <p className="text-xl font-bold text-gray-900 tabular-nums">
                  {formatCurrency(subscriptions.yearlyTotal, summary.currency, undefined, true)}
                </p>
                <p className="text-xs text-gray-500 mt-0.5">Confirmed only</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-1">ACTIVE</p>
                <p className="text-xl font-bold text-gray-900 tabular-nums">
                  {subscriptions.activeCount}
                </p>
                {subscriptions.candidateCount > 0 && (
                  <Link
                    href="/account/spending?tab=subscriptions"
                    className="text-xs text-orange-600 font-medium hover:text-orange-700"
                  >
                    {subscriptions.candidateCount} to review →
                  </Link>
                )}
              </div>
            </div>
            
            {(subscriptions.newCount > 0 || subscriptions.priceIncreaseCount > 0) && (
              <div className="border-t border-gray-100 pt-3">
                {subscriptions.newCount > 0 && (
                  <div className="text-sm text-green-700 mb-1">
                    ✓ {subscriptions.newCount} new {subscriptions.newCount === 1 ? "subscription" : "subscriptions"}
                  </div>
                )}
                {subscriptions.priceIncreaseCount > 0 && (
                  <div className="text-sm text-red-700">
                    {subscriptions.subscriptions
                      .filter(s => s.priceIncrease && s.priceIncreaseAmount)
                      .slice(0, 2)
                      .map((s, idx) => (
                        <div key={idx}>
                          • {s.merchant} went up {formatCurrency(s.priceIncreaseAmount!, summary.currency)} (now {formatCurrency(s.amount, summary.currency)}/
                          {s.cadence === "monthly" ? "month" : "year"})
                        </div>
                      ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Review list */}
      {token && (
        <div>
          <ReviewList
            token={token}
            reviewType="debt_payment"
            onReviewComplete={onReviewComplete}
          />
        </div>
      )}

      {/* Category detail drawer */}
      {selectedCategory && (() => {
        const catData = summary.categories.find(c => c.category === selectedCategory);
        if (!catData) return null;

        // Get 12-month history for sparkline
        const monthlyAmounts = summary.monthlyHistory.slice(-12).map(m => {
          const cat = m.categories.find(c => c.category === selectedCategory);
          return cat?.amount || 0;
        });

        // Calculate typical (avg of last 3 months)
        const last3Avg = monthlyAmounts.slice(-3).reduce((s, a) => s + a, 0) / 3;
        const lastMonthCat = lastMonthData.categories.find(c => c.category === selectedCategory);
        const lastMonthAmt = lastMonthCat?.amount || 0;
        const vsTypical = lastMonthAmt - last3Avg;
        const vsTypicalPct = last3Avg > 0 ? (vsTypical / last3Avg) * 100 : 0;

        return (
          <>
            {/* Backdrop */}
            <div
              className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm"
              onClick={() => setSelectedCategory(null)}
            />

            {/* Drawer */}
            <div className="fixed right-0 top-0 z-50 h-full w-full max-w-2xl overflow-y-auto bg-white shadow-2xl sm:w-[640px]">
              {/* Header */}
              <div className="sticky top-0 border-b border-gray-200 bg-white px-6 py-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-xl font-bold text-gray-900">{selectedCategory}</h2>
                  <button
                    onClick={() => setSelectedCategory(null)}
                    className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                  >
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>

              {/* Content */}
              <div className="p-6 space-y-6">
                {/* Total vs typical */}
                <div>
                  <div className="text-3xl font-bold text-gray-900 mb-2">
                    {formatCurrency(lastMonthAmt, summary.currency)}
                  </div>
                  <div className="flex items-center gap-2 text-sm mb-4">
                    <span className="text-gray-600">vs typical</span>
                    <span className="font-medium text-gray-900">{formatCurrency(last3Avg, summary.currency)}</span>
                    {Math.abs(vsTypicalPct) >= 5 && (
                      <span className={`text-xs font-semibold ${getSignColor(vsTypical)}`}>
                        {vsTypical > 0 ? "+" : ""}{vsTypicalPct.toFixed(0)}%
                      </span>
                    )}
                  </div>

                  {/* 12-month sparkline */}
                  <div className="h-16 bg-gray-50 rounded-lg p-2">
                    <div className="flex items-end justify-between h-full gap-1">
                      {monthlyAmounts.map((amt, idx) => {
                        const max = Math.max(...monthlyAmounts, 1);
                        const height = (amt / max) * 100;
                        const isLatest = idx === monthlyAmounts.length - 1;
                        return (
                          <div
                            key={idx}
                            className={`flex-1 rounded-t ${isLatest ? "bg-slate-600" : "bg-slate-400"}`}
                            style={{ height: `${height}%` }}
                          />
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* Merchants or Debt Accounts */}
                <div>
                  <h3 className="text-sm font-semibold text-gray-900 mb-3">
                    {selectedCategory === "Loan payments" || selectedCategory === "Credit card minimums" 
                      ? "By account" 
                      : "By merchant"}
                  </h3>
                  <div className="space-y-1">
                    {(() => {
                      // Special handling for debt categories
                      const isDebtCategory = selectedCategory === "Loan payments" || selectedCategory === "Credit card minimums";
                      
                      if (isDebtCategory) {
                        const debtType = selectedCategory === "Loan payments" ? "loan" : "credit";
                        const payments = summary.scheduledPayments.filter(p => p.debtType === debtType);
                        
                        if (payments.length === 0) {
                          return (
                            <div className="text-xs text-gray-500 py-3">
                              No breakdown available
                            </div>
                          );
                        }
                        
                        return payments.map(payment => (
                          <div key={payment.accountSlug} className="border-b border-gray-100 last:border-0 py-3">
                            <div className="flex items-center justify-between">
                              <span className="text-sm font-medium text-gray-900">
                                {payment.accountName || payment.accountSlug}
                              </span>
                              <span className="text-sm font-semibold text-gray-900">
                                {formatCurrency(payment.amount, summary.currency)}
                              </span>
                            </div>
                          </div>
                        ));
                      }
                      
                      // Regular categories: show merchants
                      if (catData.merchants.length === 0) {
                        return (
                          <div className="text-xs text-gray-500 py-3">
                            No breakdown available
                          </div>
                        );
                      }
                      
                      return catData.merchants.sort((a, b) => b.total - a.total).map(merchant => {
                        const monthTxns = merchant.transactions.filter(t => t.txMonth === lastMonth);
                        const expanded = expandedMerchants.has(merchant.merchantSlug);
                        
                        if (monthTxns.length === 0) return null;
                        const monthTotal = monthTxns.reduce((s, t) => s + t.amount, 0);
                        
                        return (
                          <div key={merchant.merchantSlug} className="border-b border-gray-100 last:border-0">
                            <button
                              onClick={() => {
                                const newExpanded = new Set(expandedMerchants);
                                if (expanded) {
                                  newExpanded.delete(merchant.merchantSlug);
                                } else {
                                  newExpanded.add(merchant.merchantSlug);
                                }
                                setExpandedMerchants(newExpanded);
                              }}
                              className="w-full flex items-center justify-between py-3 hover:bg-gray-50 transition-colors"
                            >
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium text-gray-900">{merchant.merchant}</span>
                                <span className="text-xs text-gray-500">({monthTxns.length})</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-semibold text-gray-900">{formatCurrency(monthTotal, summary.currency)}</span>
                                <svg className={`h-4 w-4 text-gray-400 transition-transform ${expanded ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                </svg>
                              </div>
                            </button>
                            
                            {expanded && (
                              <div className="pl-4 pb-3 space-y-1">
                                {monthTxns.map((txn, idx) => (
                                  <div key={idx} className="flex items-center justify-between text-xs text-gray-600">
                                    <span>{new Date(txn.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                                    <span className="font-medium">{formatCurrency(txn.amount, summary.currency)}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      });
                    })()}
                  </div>
                </div>
              </div>
            </div>
          </>
        );
      })()}
    </div>
  );
}
