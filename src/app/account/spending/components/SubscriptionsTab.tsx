"use client";

import { useState, useEffect } from "react";
import type { SubscriptionSummary, DetectedSubscription } from "@/lib/subscriptionEngine";
import { formatCurrency } from "@/lib/currencyUtils";
import { formatDate } from "@/lib/dateFormatting";
import { getSignColor } from "@/lib/colorHelpers";
import { ReviewList } from "@/components/ReviewList";

interface SubscriptionsTabProps {
  token: string | null;
}

export function SubscriptionsTab({ token }: SubscriptionsTabProps) {
  const [summary, setSummary] = useState<SubscriptionSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<{ message: string; undoId?: string } | null>(null);

  const loadSubscriptions = async () => {
    try {
      const res = await fetch("/api/user/subscriptions", {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        throw new Error("Failed to load subscriptions");
      }

      const data = await res.json();
      setSummary(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load subscriptions");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!token) return;
    loadSubscriptions();
  }, [token]);

  const handleClassify = async (
    item: DetectedSubscription,
    classification: "is_subscription" | "not_subscription" | "still_active" | "cancelled"
  ) => {
    if (!token || submitting) return;

    setSubmitting(true);

    try {
      const res = await fetch("/api/user/reviews", {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          id: item.merchantSlug,
          type: "subscription",
          classification,
          merchantSlug: item.merchantSlug,
          date: item.lastDate,
          amount: item.amount,
        }),
      });

      if (res.ok) {
        // Silent refresh
        await loadSubscriptions();
        
        // Show toast with undo
        const actionText = 
          classification === "is_subscription" ? "marked as subscription" :
          classification === "not_subscription" ? "marked as not a subscription" :
          classification === "still_active" ? "marked as still active" :
          "marked as cancelled";
        
        setToast({ 
          message: `${item.merchant} ${actionText}`,
          undoId: item.merchantSlug,
        });
        
        // Auto-hide toast after 5 seconds
        setTimeout(() => setToast(null), 5000);
      } else {
        console.error("Failed to save classification", await res.text());
      }
    } catch (err) {
      console.error("Error saving classification:", err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleUndo = async (id: string) => {
    if (!token) return;

    try {
      const res = await fetch(`/api/user/reviews?id=${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.ok) {
        setToast(null);
        await loadSubscriptions();
      }
    } catch (err) {
      console.error("Failed to undo:", err);
    }
  };
  
  const handleBillingFrequencyChange = async (
    item: DetectedSubscription,
    frequency: string
  ) => {
    if (!token || submitting) return;

    setSubmitting(true);

    try {
      const res = await fetch("/api/user/reviews", {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          id: item.merchantSlug,
          type: "subscription",
          classification: "is_subscription", // Ensure it's confirmed
          merchantSlug: item.merchantSlug,
          date: item.lastDate,
          amount: item.amount,
          billingFrequency: frequency,
        }),
      });

      if (res.ok) {
        // Silent refresh
        await loadSubscriptions();
        
        const frequencyLabels: Record<string, string> = {
          weekly: "Weekly",
          monthly: "Monthly",
          quarterly: "Every 3 months",
          yearly: "Yearly",
        };
        
        setToast({ 
          message: `${item.merchant} billing changed to ${frequencyLabels[frequency]}`,
          undoId: item.merchantSlug,
        });
        
        setTimeout(() => setToast(null), 5000);
      } else {
        console.error("Failed to save billing frequency", await res.text());
      }
    } catch (err) {
      console.error("Error saving billing frequency:", err);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-purple-600 border-t-transparent" />
      </div>
    );
  }

  if (error || !summary) {
    return (
      <div className="text-sm text-red-600 bg-red-50 rounded-lg p-4">
        {error || "Failed to load subscriptions"}
      </div>
    );
  }

  const { 
    subscriptions, 
    candidates, 
    inactive, 
    cancelled,
    monthlyTotal, 
    yearlyTotal, 
    monthlyChange, 
    newCount, 
    priceIncreaseCount,
    candidateCount,
  } = summary;

  return (
    <div className="space-y-6">
      {/* ReviewList for one-at-a-time review */}
      <ReviewList 
        token={token} 
        reviewType="subscription" 
        onReviewComplete={() => loadSubscriptions()}
      />

      {/* Toast notification */}
      {toast && (
        <div className="fixed bottom-4 right-4 bg-gray-900 text-white px-4 py-3 rounded-lg shadow-lg flex items-center gap-3 z-50">
          <span>{toast.message}</span>
          {toast.undoId && (
            <button
              onClick={() => handleUndo(toast.undoId!)}
              className="text-violet-400 hover:text-violet-300 font-medium"
            >
              Undo
            </button>
          )}
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-xs text-gray-500 mb-1">PER MONTH</p>
          <div className="flex items-baseline gap-2">
            <p className="text-3xl font-bold text-gray-900 tabular-nums">
              {formatCurrency(monthlyTotal, summary.currency, undefined, true)}
            </p>
            {monthlyChange !== 0 && (
              <span className={`text-sm font-medium ${getSignColor(monthlyChange)}`}>
                {monthlyChange > 0 ? "+" : ""}
                {formatCurrency(monthlyChange, summary.currency)}
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500 mt-1">Confirmed active only</p>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-xs text-gray-500 mb-1">PER YEAR</p>
          <p className="text-3xl font-bold text-gray-900 tabular-nums">
            {formatCurrency(yearlyTotal, summary.currency, undefined, true)}
          </p>
          <p className="text-xs text-gray-500 mt-1">Confirmed active only</p>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-xs text-gray-500 mb-1">ACTIVE SUBSCRIPTIONS</p>
          <div className="flex items-baseline gap-2">
            <p className="text-3xl font-bold text-gray-900 tabular-nums">
              {subscriptions.length}
            </p>
            {(newCount > 0 || priceIncreaseCount > 0) && (
              <div className="text-xs text-red-600 font-medium">
                {newCount > 0 && `${newCount} new`}
                {newCount > 0 && priceIncreaseCount > 0 && " · "}
                {priceIncreaseCount > 0 && `${priceIncreaseCount} price increase`}
              </div>
            )}
          </div>
          {candidateCount > 0 && (
            <p className="text-xs text-orange-600 font-medium mt-1">
              {candidateCount} to review
            </p>
          )}
        </div>
      </div>

      {/* Sanity check warnings */}
      {summary.sanityCheckFailures.length > 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <p className="text-sm font-semibold text-yellow-900 mb-1">Sanity check warnings:</p>
          <ul className="text-sm text-yellow-800 list-disc list-inside space-y-1">
            {summary.sanityCheckFailures.map((msg, i) => (
              <li key={i}>{msg}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Active confirmed subscriptions */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
          <h3 className="text-sm font-semibold text-gray-900">
            Active Subscriptions ({subscriptions.length})
          </h3>
          <p className="text-xs text-gray-500 mt-0.5">Known subscription merchants counted in totals</p>
        </div>
        <SubscriptionTable 
          subscriptions={subscriptions} 
          currency={summary.currency}
          onClassify={handleClassify}
          submitting={submitting}
          showActions="active"
          onBillingFrequencyChange={handleBillingFrequencyChange}
        />
      </div>

      {/* Candidates to review */}
      {candidates.length > 0 && (
        <div className="bg-white rounded-xl border border-orange-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-orange-200 bg-orange-50">
            <h3 className="text-sm font-semibold text-orange-900">
              To Review ({candidates.length})
            </h3>
            <p className="text-xs text-orange-700 mt-0.5">
              Is this a subscription? Not counted until you confirm.
            </p>
          </div>
          <SubscriptionTable 
            subscriptions={candidates} 
            currency={summary.currency}
            onClassify={handleClassify}
            submitting={submitting}
            showActions="candidate"
            onBillingFrequencyChange={handleBillingFrequencyChange}
          />
        </div>
      )}

      {/* Inactive/cancelled */}
      {inactive.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <button
            onClick={() => setShowInactive(!showInactive)}
            className="w-full px-6 py-4 border-b border-gray-200 bg-gray-50 flex items-center justify-between hover:bg-gray-100 transition-colors"
          >
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                {showInactive ? (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                )}
              </svg>
              <h3 className="text-sm font-semibold text-gray-700">
                Inactive / Cancelled? ({inactive.length})
              </h3>
            </div>
            <p className="text-xs text-gray-500">Not charged within grace period</p>
          </button>
          {showInactive && (
            <SubscriptionTable 
              subscriptions={inactive} 
              currency={summary.currency}
              onClassify={handleClassify}
              submitting={submitting}
              showActions="inactive"
              onBillingFrequencyChange={handleBillingFrequencyChange}
            />
          )}
        </div>
      )}
    </div>
  );
}

function SubscriptionTable({
  subscriptions,
  currency,
  onClassify,
  submitting,
  showActions,
  onBillingFrequencyChange,
}: {
  subscriptions: DetectedSubscription[];
  currency: string;
  onClassify: (item: DetectedSubscription, classification: any) => void;
  submitting: boolean;
  showActions?: "active" | "candidate" | "inactive";
  onBillingFrequencyChange?: (item: DetectedSubscription, frequency: string) => void;
}) {
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [openFrequencyMenu, setOpenFrequencyMenu] = useState<string | null>(null);
  
  const getBillingLabel = (sub: DetectedSubscription): string => {
    const freq = sub.billingFrequency;
    if (freq === "weekly") return "Weekly";
    if (freq === "monthly") return "Monthly";
    if (freq === "quarterly") return "Every 3 months";
    if (freq === "yearly") return "Yearly";
    
    // Fallback to cadence
    if (sub.cadence === "monthly") return "Monthly";
    if (sub.cadence === "yearly") return "Yearly";
    return "Recurring";
  };
  
  const getBillingColor = (sub: DetectedSubscription): string => {
    const freq = sub.billingFrequency || sub.cadence;
    if (freq === "weekly") return "bg-green-100 text-green-800";
    if (freq === "monthly") return "bg-purple-100 text-purple-800";
    if (freq === "quarterly") return "bg-orange-100 text-orange-800";
    if (freq === "yearly") return "bg-blue-100 text-blue-800";
    return "bg-gray-100 text-gray-800";
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead className="bg-gray-50 border-b border-gray-200">
          <tr>
            <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700">Name</th>
            <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700">Billed</th>
            <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700">Last charge</th>
            <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700">
              {showActions === "inactive" ? "Last expected" : "Next expected"}
            </th>
            <th className="px-6 py-3 text-right text-xs font-semibold text-gray-700">Amount</th>
            <th className="px-6 py-3 text-right text-xs font-semibold text-gray-700">
              {showActions ? "Actions" : "Status"}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {subscriptions.length === 0 ? (
            <tr>
              <td colSpan={6} className="px-6 py-8 text-center text-sm text-gray-500">
                No subscriptions detected
              </td>
            </tr>
          ) : (
            subscriptions.map((sub, idx) => (
              <tr 
                key={idx} 
                className={`hover:bg-gray-50 transition-colors ${showActions === "inactive" ? 'opacity-60' : ''}`}
              >
                <td className="px-6 py-4">
                  <div className="text-sm font-medium text-gray-900">{sub.merchant}</div>
                  <div className="text-xs text-gray-500">
                    {sub.category}
                    {sub.noRecentCharge && (
                      <span className="ml-2 text-amber-600">• No recent charge</span>
                    )}
                  </div>
                </td>
                <td className="px-6 py-4">
                  <div className="relative">
                    <button
                      onClick={() => setOpenFrequencyMenu(openFrequencyMenu === sub.merchantSlug ? null : sub.merchantSlug)}
                      disabled={!onBillingFrequencyChange}
                      className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium ${getBillingColor(sub)} ${onBillingFrequencyChange ? 'cursor-pointer hover:opacity-80' : ''} transition`}
                    >
                      {getBillingLabel(sub)}
                      {onBillingFrequencyChange && (
                        <svg className="w-3 h-3 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      )}
                    </button>
                    {onBillingFrequencyChange && openFrequencyMenu === sub.merchantSlug && (
                      <div className="absolute left-0 top-8 bg-white border border-gray-200 rounded-lg shadow-lg py-1 z-20 w-40">
                        <button
                          onClick={() => {
                            setOpenFrequencyMenu(null);
                            onBillingFrequencyChange(sub, "weekly");
                          }}
                          className="w-full text-left px-3 py-2 text-xs text-gray-700 hover:bg-gray-50"
                        >
                          Weekly
                        </button>
                        <button
                          onClick={() => {
                            setOpenFrequencyMenu(null);
                            onBillingFrequencyChange(sub, "monthly");
                          }}
                          className="w-full text-left px-3 py-2 text-xs text-gray-700 hover:bg-gray-50"
                        >
                          Monthly
                        </button>
                        <button
                          onClick={() => {
                            setOpenFrequencyMenu(null);
                            onBillingFrequencyChange(sub, "quarterly");
                          }}
                          className="w-full text-left px-3 py-2 text-xs text-gray-700 hover:bg-gray-50"
                        >
                          Every 3 months
                        </button>
                        <button
                          onClick={() => {
                            setOpenFrequencyMenu(null);
                            onBillingFrequencyChange(sub, "yearly");
                          }}
                          className="w-full text-left px-3 py-2 text-xs text-gray-700 hover:bg-gray-50"
                        >
                          Yearly
                        </button>
                      </div>
                    )}
                  </div>
                </td>
                <td className="px-6 py-4 text-sm text-gray-600">
                  {formatDate(sub.lastDate)}
                </td>
                <td className="px-6 py-4 text-sm text-gray-600">
                  {sub.nextDate ? formatDate(sub.nextDate) : "—"}
                </td>
                <td className="px-6 py-4 text-right">
                  <div className="text-sm font-semibold text-gray-900">
                    {formatCurrency(sub.amount, currency)}
                  </div>
                  {(sub.billingFrequency === "yearly" || (!sub.billingFrequency && sub.cadence === "yearly")) && (
                    <div className="text-xs text-gray-500">
                      {formatCurrency(sub.amount / 12, currency)}/mo
                    </div>
                  )}
                </td>
                <td className="px-6 py-4 text-right">
                  {showActions === "candidate" && (
                    <div className="flex flex-col gap-1.5 items-end">
                      <button
                        onClick={() => onClassify(sub, "is_subscription")}
                        disabled={submitting}
                        className="text-xs font-medium px-3 py-1.5 rounded-md bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
                      >
                        Yes, subscription
                      </button>
                      <button
                        onClick={() => onClassify(sub, "not_subscription")}
                        disabled={submitting}
                        className="text-xs font-medium px-3 py-1.5 rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition"
                      >
                        Not a subscription
                      </button>
                    </div>
                  )}
                  
                  {showActions === "active" && (
                    <div className="relative">
                      <button
                        onClick={() => setOpenMenu(openMenu === sub.merchantSlug ? null : sub.merchantSlug)}
                        className="p-2 hover:bg-gray-100 rounded transition"
                      >
                        <svg className="w-5 h-5 text-gray-600" fill="currentColor" viewBox="0 0 24 24">
                          <circle cx="12" cy="5" r="2" />
                          <circle cx="12" cy="12" r="2" />
                          <circle cx="12" cy="19" r="2" />
                        </svg>
                      </button>
                      {openMenu === sub.merchantSlug && (
                        <div className="absolute right-0 top-10 bg-white border border-gray-200 rounded-lg shadow-lg py-1 z-10 w-48">
                          <button
                            onClick={() => {
                              setOpenMenu(null);
                              onClassify(sub, "not_subscription");
                            }}
                            disabled={submitting}
                            className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                          >
                            Not a subscription
                          </button>
                          <button
                            onClick={() => {
                              setOpenMenu(null);
                              onClassify(sub, "cancelled");
                            }}
                            disabled={submitting}
                            className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                          >
                            Mark as cancelled
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                  
                  {showActions === "inactive" && (
                    <div className="flex flex-col gap-1.5 items-end">
                      <button
                        onClick={() => onClassify(sub, "still_active")}
                        disabled={submitting}
                        className="text-xs font-medium px-3 py-1.5 rounded-md border border-violet-600 text-violet-700 hover:bg-violet-50 disabled:opacity-50 disabled:cursor-not-allowed transition"
                      >
                        Still active
                      </button>
                      <button
                        onClick={() => onClassify(sub, "cancelled")}
                        disabled={submitting}
                        className="text-xs font-medium px-3 py-1.5 rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition"
                      >
                        Cancelled
                      </button>
                    </div>
                  )}
                  
                  {!showActions && (
                    <div className="flex flex-col items-end gap-1">
                      {sub.isNew && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-green-100 text-green-800 text-xs font-semibold">
                          New
                        </span>
                      )}
                      {sub.priceIncrease && sub.priceIncreaseAmount && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-red-100 text-red-800 text-xs font-semibold">
                          +{formatCurrency(sub.priceIncreaseAmount, currency)}
                        </span>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
