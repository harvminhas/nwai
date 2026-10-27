"use client";

import { useState, useEffect } from "react";
import type { SubscriptionSummary, DetectedSubscription } from "@/lib/subscriptionEngine";
import { formatCurrency } from "@/lib/currencyUtils";
import { formatDate } from "@/lib/dateFormatting";
import { getSignColor } from "@/lib/colorHelpers";
import { ChevronDown, ChevronRight } from "lucide-react";

interface SubscriptionsTabProps {
  token: string | null;
}

export function SubscriptionsTab({ token }: SubscriptionsTabProps) {
  const [summary, setSummary] = useState<SubscriptionSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showInactive, setShowInactive] = useState(false);

  useEffect(() => {
    if (!token) return;

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

    loadSubscriptions();
  }, [token]);

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
    monthlyTotal, 
    yearlyTotal, 
    monthlyChange, 
    newCount, 
    priceIncreaseCount,
    candidateCount,
  } = summary;

  return (
    <div className="space-y-6">
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
        <SubscriptionTable subscriptions={subscriptions} currency={summary.currency} />
      </div>

      {/* Candidates to review */}
      {candidates.length > 0 && (
        <div className="bg-white rounded-xl border border-orange-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-orange-200 bg-orange-50">
            <h3 className="text-sm font-semibold text-orange-900">
              To Review ({candidates.length})
            </h3>
            <p className="text-xs text-orange-700 mt-0.5">
              Recurring charges not on known list — NOT counted in totals
            </p>
          </div>
          <SubscriptionTable subscriptions={candidates} currency={summary.currency} isCandidate />
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
              {showInactive ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
              <h3 className="text-sm font-semibold text-gray-700">
                Inactive / Cancelled? ({inactive.length})
              </h3>
            </div>
            <p className="text-xs text-gray-500">Not charged within grace period</p>
          </button>
          {showInactive && (
            <SubscriptionTable subscriptions={inactive} currency={summary.currency} isInactive />
          )}
        </div>
      )}
    </div>
  );
}

function SubscriptionTable({
  subscriptions,
  currency,
  isCandidate = false,
  isInactive = false,
}: {
  subscriptions: DetectedSubscription[];
  currency: string;
  isCandidate?: boolean;
  isInactive?: boolean;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead className="bg-gray-50 border-b border-gray-200">
          <tr>
            <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700">Name</th>
            <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700">Cadence</th>
            <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700">Last charge</th>
            <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700">
              {isInactive ? "Last expected" : "Next expected"}
            </th>
            <th className="px-6 py-3 text-right text-xs font-semibold text-gray-700">Amount</th>
            <th className="px-6 py-3 text-right text-xs font-semibold text-gray-700">Status</th>
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
                className={`hover:bg-gray-50 transition-colors ${isInactive ? 'opacity-60' : ''}`}
              >
                <td className="px-6 py-4">
                  <div className="text-sm font-medium text-gray-900">{sub.merchant}</div>
                  <div className="text-xs text-gray-500">{sub.category}</div>
                </td>
                <td className="px-6 py-4">
                  <span className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium ${
                    sub.cadence === "monthly"
                      ? "bg-purple-100 text-purple-800"
                      : sub.cadence === "yearly"
                        ? "bg-blue-100 text-blue-800"
                        : "bg-gray-100 text-gray-800"
                  }`}>
                    {sub.cadence === "monthly" && "Monthly"}
                    {sub.cadence === "yearly" && "Yearly"}
                    {sub.cadence === "ambiguous" && "Recurring"}
                  </span>
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
                  {sub.cadence === "yearly" && (
                    <div className="text-xs text-gray-500">
                      {formatCurrency(sub.amount / 12, currency)}/mo
                    </div>
                  )}
                </td>
                <td className="px-6 py-4 text-right">
                  <div className="flex flex-col items-end gap-1">
                    {isCandidate && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-orange-100 text-orange-800 text-xs font-semibold">
                        Review
                      </span>
                    )}
                    {isInactive && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 text-xs font-semibold">
                        Inactive
                      </span>
                    )}
                    {!isCandidate && !isInactive && sub.isNew && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-green-100 text-green-800 text-xs font-semibold">
                        New
                      </span>
                    )}
                    {!isCandidate && !isInactive && sub.priceIncrease && sub.priceIncreaseAmount && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-red-100 text-red-800 text-xs font-semibold">
                        +{formatCurrency(sub.priceIncreaseAmount, currency)}
                      </span>
                    )}
                  </div>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
