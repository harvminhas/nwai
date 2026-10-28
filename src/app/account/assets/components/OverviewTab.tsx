"use client";

import { useState, useEffect } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseClient } from "@/lib/firebase";
import type { AssetsSummary } from "@/lib/assetsSummary";
import { formatCurrency } from "@/lib/currencyUtils";
import { formatChange, getChangeColor } from "@/lib/colorHelpers";
import { ReviewList } from "@/components/ReviewList";

interface OverviewTabProps {
  summary: AssetsSummary;
}

export function OverviewTab({ summary }: OverviewTabProps) {
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    const { auth } = getFirebaseClient();
    return onAuthStateChanged(auth, async (user) => {
      if (user) {
        const tok = await user.getIdToken();
        setToken(tok);
      } else {
        setToken(null);
      }
    });
  }, []);

  const {
    totalAssets,
    currency,
    changeVsLastMonth,
    changeVs12Months,
    groups,
  } = summary;

  return (
    <div className="space-y-6">
      {/* Total Assets Card */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <p className="text-sm text-gray-600 mb-1">Total Assets</p>
        <p className="text-3xl font-bold text-gray-900 mb-3">
          {formatCurrency(totalAssets, currency)}
        </p>
        <div className="flex gap-4 text-sm">
          <div>
            <span className="text-gray-600">vs last month: </span>
            <span className={getChangeColor(changeVsLastMonth, "positive")}>
              {formatChange(changeVsLastMonth, currency)}
            </span>
          </div>
          <div>
            <span className="text-gray-600">vs 12 months: </span>
            <span className={getChangeColor(changeVs12Months, "positive")}>
              {formatChange(changeVs12Months, currency)}
            </span>
          </div>
        </div>
      </div>

      {/* Assets by Type */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">By Type</h2>
        <div className="space-y-3">
          {groups.map((group) => {
            const pct = totalAssets > 0 ? (group.total / totalAssets) * 100 : 0;
            const accountCount = group.accounts.length + group.manualAssets.length;
            
            return (
              <div key={group.type}>
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-900">{group.label}</span>
                    <span className="text-xs text-gray-500">
                      ({accountCount} {accountCount === 1 ? "account" : "accounts"})
                    </span>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-gray-900">
                      {formatCurrency(group.total, currency)}
                    </p>
                    <p className="text-xs text-gray-500">{pct.toFixed(1)}%</p>
                  </div>
                </div>
                <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-purple-500 rounded-full transition-all"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Stale Accounts Review */}
      {summary.staleAccounts.length > 0 && (
        <ReviewList 
          token={token}
          reviewType="stale_account"
        />
      )}
    </div>
  );
}
