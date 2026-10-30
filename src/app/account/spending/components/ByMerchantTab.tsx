"use client";

import { useState, useMemo, useEffect } from "react";
import type { SpendingSummary, MerchantSummary } from "@/lib/spendingSummary";
import { formatCurrency } from "@/lib/currencyUtils";
import { formatDate, formatMonthYear } from "@/lib/dateFormatting";
import type { Plan } from "@/app/api/user/plans/route";
import { useConfirm } from "@/components/useConfirm";
import { useToast } from "@/components/useToast";
import { getFirebaseClient } from "@/lib/firebase";

type SortMode = "total" | "frequency" | "recent";

interface ByMerchantTabProps {
  summary: SpendingSummary;
}

export function ByMerchantTab({ summary }: ByMerchantTabProps) {
  const [search, setSearch] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("total");
  const [expandedMerchants, setExpandedMerchants] = useState<Set<string>>(new Set());
  const [planMap, setPlanMap] = useState<Map<string, string>>(new Map());
  const [submitting, setSubmitting] = useState(false);
  const { confirm, ConfirmDialog } = useConfirm();
  const { success, error: showError, Toast } = useToast();

  // Load plans to show tags on linked transactions
  useEffect(() => {
    async function loadPlans() {
      try {
        const res = await fetch("/api/user/plans");
        if (res.ok) {
          const data = await res.json();
          const plans = data.plans || [];
          const map = new Map<string, string>();
          plans.forEach((plan: Plan) => {
            plan.linkedTransactions.forEach((tx) => {
              map.set(tx.txFingerprint, plan.name);
            });
          });
          setPlanMap(map);
        }
      } catch (error) {
        console.error("Failed to load plans:", error);
      }
    }
    loadPlans();
  }, []);

  // Filter and sort merchants
  const filteredMerchants = useMemo(() => {
    let merchants = summary.merchants;

    if (search) {
      const query = search.toLowerCase();
      merchants = merchants.filter(m =>
        m.merchant.toLowerCase().includes(query) ||
        m.category.toLowerCase().includes(query)
      );
    }

    // Sort
    if (sortMode === "total") {
      merchants = [...merchants].sort((a, b) => b.total - a.total);
    } else if (sortMode === "frequency") {
      merchants = [...merchants].sort((a, b) => b.count - a.count);
    } else if (sortMode === "recent") {
      merchants = [...merchants].sort((a, b) => b.lastDate.localeCompare(a.lastDate));
    }

    return merchants;
  }, [summary.merchants, search, sortMode]);

  const toggleMerchant = (merchantSlug: string) => {
    setExpandedMerchants(prev => {
      const next = new Set(prev);
      if (next.has(merchantSlug)) {
        next.delete(merchantSlug);
      } else {
        next.add(merchantSlug);
      }
      return next;
    });
  };

  const handleMarkAsSubscription = async (merchant: MerchantSummary, e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent merchant row expansion
    
    if (submitting) return;

    const confirmed = await confirm({
      title: "Mark as subscription",
      message: `Mark "${merchant.merchant}" as a subscription? The app will track it with detected subscriptions.`,
    });

    if (!confirmed) return;

    setSubmitting(true);

    try {
      const { auth } = getFirebaseClient();
      const user = auth.currentUser;
      if (!user) {
        showError("You must be logged in");
        return;
      }

      const token = await user.getIdToken();

      const res = await fetch("/api/user/reviews", {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          id: merchant.merchantSlug,
          type: "subscription",
          classification: "is_subscription",
          merchantSlug: merchant.merchantSlug,
          date: merchant.lastDate,
          amount: merchant.avgAmount, // Use average amount for inferred frequency
        }),
      });

      if (res.ok) {
        success(`${merchant.merchant} marked as subscription`);
      } else {
        const data = await res.json().catch(() => ({ error: "Failed to save" }));
        showError(data.error || "Failed to save");
      }
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to mark as subscription");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Search and sort */}
      <div className="flex gap-3">
        <input
          type="text"
          placeholder="Search merchants..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
        />
        <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden text-xs font-semibold">
          <button
            onClick={() => setSortMode("total")}
            className={`px-4 py-2 transition ${
              sortMode === "total" ? "bg-purple-600 text-white" : "text-gray-600 hover:bg-gray-50"
            }`}
          >
            Total
          </button>
          <button
            onClick={() => setSortMode("frequency")}
            className={`px-4 py-2 border-l border-gray-200 transition ${
              sortMode === "frequency" ? "bg-purple-600 text-white" : "text-gray-600 hover:bg-gray-50"
            }`}
          >
            Frequency
          </button>
          <button
            onClick={() => setSortMode("recent")}
            className={`px-4 py-2 border-l border-gray-200 transition ${
              sortMode === "recent" ? "bg-purple-600 text-white" : "text-gray-600 hover:bg-gray-50"
            }`}
          >
            Recent
          </button>
        </div>
      </div>

      {/* Merchant list */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="divide-y divide-gray-100">
          {filteredMerchants.length === 0 ? (
            <div className="px-6 py-8 text-center text-sm text-gray-500">
              No merchants found
            </div>
          ) : (
            filteredMerchants.map(merchant => {
              const isExpanded = expandedMerchants.has(merchant.merchantSlug);
              
              // Group transactions by month
              const txnsByMonth = new Map<string, typeof merchant.transactions>();
              merchant.transactions.forEach(txn => {
                if (!txnsByMonth.has(txn.txMonth)) {
                  txnsByMonth.set(txn.txMonth, []);
                }
                txnsByMonth.get(txn.txMonth)!.push(txn);
              });
              
              const monthGroups = Array.from(txnsByMonth.entries())
                .sort((a, b) => b[0].localeCompare(a[0]))
                .map(([month, txns]) => ({
                  month,
                  transactions: txns.sort((a, b) => b.date.localeCompare(a.date)),
                  subtotal: txns.reduce((s, t) => s + t.amount, 0),
                }));

              return (
                <div key={merchant.merchantSlug}>
                  {/* Merchant row */}
                  <div className="flex items-center hover:bg-gray-50 transition-colors">
                    <button
                      onClick={() => toggleMerchant(merchant.merchantSlug)}
                      className="flex-1 px-6 py-4 flex items-center gap-4"
                    >
                      <svg
                        className={`w-4 h-4 text-gray-400 transition-transform ${
                          isExpanded ? "rotate-90" : ""
                        }`}
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>

                      <div className="flex-1 text-left">
                        <div className="text-sm font-medium text-gray-900">{merchant.merchant}</div>
                        <div className="text-xs text-gray-500">
                          {merchant.category} · {merchant.count} {merchant.count === 1 ? "transaction" : "transactions"}
                        </div>
                      </div>

                      <div className="text-sm font-semibold text-gray-900">
                        {formatCurrency(merchant.total, summary.currency)}
                      </div>
                    </button>
                    
                    {/* Mark as subscription button */}
                    <button
                      onClick={(e) => handleMarkAsSubscription(merchant, e)}
                      disabled={submitting}
                      className="px-4 py-2 mr-4 text-xs text-purple-600 hover:text-purple-700 hover:bg-purple-50 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      title="Mark as subscription"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                      </svg>
                    </button>
                  </div>

                  {/* Transaction list grouped by month (when expanded) */}
                  {isExpanded && (
                    <div className="bg-gray-50 border-t border-gray-100">
                      {monthGroups.map(group => (
                        <div key={group.month} className="border-b border-gray-100 last:border-b-0">
                          {/* Month header */}
                          <div className="px-12 py-2 flex items-center justify-between bg-gray-100">
                            <div className="text-xs font-semibold text-gray-700">
                              {formatMonthYear(group.month)}
                            </div>
                            <div className="text-xs font-semibold text-gray-700">
                              {formatCurrency(group.subtotal, summary.currency)}
                            </div>
                          </div>

                          {/* Transactions for this month */}
                          <div className="divide-y divide-gray-100">
                            {group.transactions.map((txn, idx) => {
                              // Compute transaction fingerprint to check for plan tag
                              const { txFingerprint } = require("@/lib/txFingerprint");
                              const fingerprint = txFingerprint(
                                txn.accountSlug || "",
                                txn.date,
                                txn.amount,
                                txn.merchant
                              );
                              const planName = planMap.get(fingerprint);

                              return (
                                <div
                                  key={idx}
                                  className="px-12 py-2 flex items-center justify-between text-xs"
                                >
                                  <div className="flex items-center gap-2">
                                    <span className="text-gray-600">{formatDate(txn.date)}</span>
                                    {planName && (
                                      <span className="rounded bg-purple-100 px-1.5 py-0.5 text-[10px] font-medium text-purple-700">
                                        {planName}
                                      </span>
                                    )}
                                  </div>
                                  <div className="text-gray-900 font-medium">
                                    {formatCurrency(txn.amount, summary.currency)}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ))}

                      {/* Merchant controls placeholder */}
                      <div className="px-12 py-3 border-t border-gray-200 bg-white flex gap-3">
                        <button className="text-xs text-purple-600 hover:text-purple-700 font-medium">
                          Rename merchant
                        </button>
                        <button className="text-xs text-gray-500 hover:text-gray-700 font-medium">
                          Hide from reports
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
      
      <ConfirmDialog />
      <Toast />
    </div>
  );
}
