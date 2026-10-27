"use client";

import { useState, useMemo } from "react";
import type { SpendingSummary, MerchantSummary } from "@/lib/spendingSummary";
import { formatCurrency } from "@/lib/currencyUtils";
import { formatDate, formatMonthYear } from "@/lib/dateFormatting";

type SortMode = "total" | "frequency" | "recent";

interface ByMerchantTabProps {
  summary: SpendingSummary;
}

export function ByMerchantTab({ summary }: ByMerchantTabProps) {
  const [search, setSearch] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("total");
  const [expandedMerchants, setExpandedMerchants] = useState<Set<string>>(new Set());

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
                  <button
                    onClick={() => toggleMerchant(merchant.merchantSlug)}
                    className="w-full px-6 py-4 flex items-center gap-4 hover:bg-gray-50 transition-colors"
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
                            {group.transactions.map((txn, idx) => (
                              <div
                                key={idx}
                                className="px-12 py-2 flex items-center justify-between text-xs"
                              >
                                <div className="text-gray-600">{formatDate(txn.date)}</div>
                                <div className="text-gray-900 font-medium">
                                  {formatCurrency(txn.amount, summary.currency)}
                                </div>
                              </div>
                            ))}
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
    </div>
  );
}
