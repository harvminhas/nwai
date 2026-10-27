"use client";

import { useState, useMemo } from "react";
import type { SpendingSummary, CategorySummary, MerchantSummary, SpendingTransaction } from "@/lib/spendingSummary";
import { formatCurrency } from "@/lib/currencyUtils";
import { formatDate } from "@/lib/dateFormatting";

type BucketFilter = "all" | "fixed" | "essentials" | "flexible";

interface WhereItGoesTabProps {
  summary: SpendingSummary;
}

export function WhereItGoesTab({ summary }: WhereItGoesTabProps) {
  const [search, setSearch] = useState("");
  const [bucketFilter, setBucketFilter] = useState<BucketFilter>("all");
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [expandedMerchants, setExpandedMerchants] = useState<Set<string>>(new Set());

  // Filter categories
  const filteredCategories = useMemo(() => {
    let cats = summary.categories;

    if (bucketFilter !== "all") {
      cats = cats.filter(c => c.bucket === bucketFilter);
    }

    if (search) {
      const query = search.toLowerCase();
      cats = cats.filter(c =>
        c.category.toLowerCase().includes(query) ||
        c.merchants.some(m => m.merchant.toLowerCase().includes(query))
      );
    }

    return cats.sort((a, b) => b.total - a.total);
  }, [summary.categories, bucketFilter, search]);

  const toggleCategory = (category: string) => {
    setExpandedCategories(prev => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  };

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

  const bucketLabels = {
    all: "All",
    fixed: "Fixed",
    essentials: "Essentials",
    flexible: "Flexible",
  };

  return (
    <div className="space-y-4">
      {/* Search and filter */}
      <div className="flex gap-3">
        <input
          type="text"
          placeholder="Search categories or merchants..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
        />
        <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden text-xs font-semibold">
          {(["all", "fixed", "essentials", "flexible"] as BucketFilter[]).map(bucket => (
            <button
              key={bucket}
              onClick={() => setBucketFilter(bucket)}
              className={`px-4 py-2 transition ${
                bucketFilter === bucket
                  ? "bg-purple-600 text-white"
                  : "text-gray-600 hover:bg-gray-50"
              } ${bucket !== "all" ? "border-l border-gray-200" : ""}`}
            >
              {bucketLabels[bucket]}
            </button>
          ))}
        </div>
      </div>

      {/* Category list */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="divide-y divide-gray-100">
          {filteredCategories.length === 0 ? (
            <div className="px-6 py-8 text-center text-sm text-gray-500">
              No categories found
            </div>
          ) : (
            filteredCategories.map(cat => {
              const isExpanded = expandedCategories.has(cat.category);
              return (
                <div key={cat.category}>
                  {/* Category row */}
                  <button
                    onClick={() => toggleCategory(cat.category)}
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
                      <div className="text-sm font-medium text-gray-900">{cat.category}</div>
                      <div className="text-xs text-gray-500">
                        {cat.merchants.length} {cat.merchants.length === 1 ? "merchant" : "merchants"} · {cat.count} transactions
                      </div>
                    </div>

                    <div className="text-right">
                      <div className="text-sm font-semibold text-gray-900">
                        {formatCurrency(cat.total, summary.currency)}
                      </div>
                      <div className="text-xs text-gray-500">
                        {(cat.share * 100).toFixed(0)}%
                      </div>
                    </div>
                  </button>

                  {/* Merchant list (when category expanded) */}
                  {isExpanded && (
                    <div className="bg-gray-50 border-t border-gray-100">
                      {cat.merchants.map(merchant => {
                        const isMerchantExpanded = expandedMerchants.has(merchant.merchantSlug);
                        return (
                          <div key={merchant.merchantSlug}>
                            {/* Merchant row */}
                            <button
                              onClick={() => toggleMerchant(merchant.merchantSlug)}
                              className="w-full px-12 py-3 flex items-center gap-4 hover:bg-gray-100 transition-colors"
                            >
                              <svg
                                className={`w-3 h-3 text-gray-400 transition-transform ${
                                  isMerchantExpanded ? "rotate-90" : ""
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
                                  {merchant.count} {merchant.count === 1 ? "transaction" : "transactions"}
                                  {merchant.isAnnual && (
                                    <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800">
                                      annual
                                    </span>
                                  )}
                                </div>
                              </div>

                              <div className="text-sm font-semibold text-gray-900">
                                {formatCurrency(merchant.total, summary.currency)}
                              </div>
                            </button>

                            {/* Transaction list (when merchant expanded) */}
                            {isMerchantExpanded && (
                              <div className="bg-white border-t border-gray-100">
                                {merchant.transactions
                                  .sort((a, b) => b.date.localeCompare(a.date))
                                  .map((txn, idx) => (
                                    <div
                                      key={idx}
                                      className="px-20 py-2 flex items-center justify-between text-xs"
                                    >
                                      <div className="text-gray-600">{formatDate(txn.date)}</div>
                                      <div className="text-gray-900 font-medium">
                                        {formatCurrency(txn.amount, summary.currency)}
                                      </div>
                                    </div>
                                  ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
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
