import { useState } from "react";
import type { AssetsSummary, AssetAccount } from "@/lib/assetsSummary";
import type { ManualAsset } from "@/lib/types";
import { formatCurrency } from "@/lib/currencyUtils";

interface AccountsTabProps {
  summary: AssetsSummary;
}

export function AccountsTab({ summary }: AccountsTabProps) {
  const { groups, currency } = summary;
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);

  if (groups.length === 0) {
    return (
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-8 text-center">
        <p className="text-gray-600">No asset accounts found.</p>
        <p className="text-sm text-gray-500 mt-2">
          Upload statements or add manual assets to get started.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {groups.map((group) => {
        const isExpanded = expandedGroup === group.type;
        const accountCount = group.accounts.length + group.manualAssets.length;

        return (
          <div key={group.type} className="bg-white rounded-lg border border-gray-200">
            {/* Group Header */}
            <button
              onClick={() => setExpandedGroup(isExpanded ? null : group.type)}
              className="w-full px-6 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors"
            >
              <div className="flex items-center gap-3">
                <span className="text-base font-semibold text-gray-900">
                  {group.label}
                </span>
                <span className="text-sm text-gray-500">
                  ({accountCount})
                </span>
              </div>
              <div className="flex items-center gap-4">
                <span className="text-lg font-bold text-gray-900 tabular-nums">
                  {formatCurrency(group.total, currency)}
                </span>
                <svg
                  className={`w-5 h-5 text-gray-400 transition-transform ${
                    isExpanded ? "rotate-180" : ""
                  }`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 9l-7 7-7-7"
                  />
                </svg>
              </div>
            </button>

            {/* Expanded Accounts List */}
            {isExpanded && (
              <div className="border-t border-gray-200 p-6 space-y-4">
                {/* Statement Accounts */}
                {group.accounts.map((acc) => (
                  <AccountRow key={acc.slug} account={acc} currency={currency} />
                ))}

                {/* Manual Assets */}
                {group.manualAssets.map((asset) => (
                  <ManualAssetRow key={asset.id} asset={asset} currency={currency} />
                ))}

                {group.accounts.length === 0 && group.manualAssets.length === 0 && (
                  <p className="text-sm text-gray-500 text-center py-4">
                    No accounts in this group yet.
                  </p>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function AccountRow({ account, currency }: { account: AssetAccount; currency: string }) {
  return (
    <div className="flex items-start justify-between py-3 border-b border-gray-100 last:border-0">
      <div className="flex-1">
        <div className="flex items-center gap-2 mb-1">
          <span className="font-medium text-gray-900">{account.bankName}</span>
          {account.isStale && (
            <span className="px-2 py-0.5 text-xs font-medium bg-amber-100 text-amber-800 rounded">
              Stale
            </span>
          )}
        </div>
        {account.accountName && (
          <p className="text-sm text-gray-600">{account.accountName}</p>
        )}
        <p className="text-xs text-gray-500 mt-1">
          Last statement: {account.statementMonth}
        </p>
      </div>
      <div className="text-right">
        <p className="text-base font-semibold text-gray-900 tabular-nums">
          {formatCurrency(account.balance, currency)}
        </p>
        <p className="text-xs text-gray-500 capitalize">
          {account.accountType.replace("_", " ")}
        </p>
      </div>
    </div>
  );
}

function ManualAssetRow({ asset, currency }: { asset: ManualAsset; currency: string }) {
  const lastUpdated = new Date(asset.updatedAt);
  const daysOld = Math.floor((Date.now() - lastUpdated.getTime()) / 86400000);

  return (
    <div className="flex items-start justify-between py-3 border-b border-gray-100 last:border-0">
      <div className="flex-1">
        <div className="flex items-center gap-2 mb-1">
          <span className="font-medium text-gray-900">{asset.label}</span>
          <span className="px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-800 rounded">
            Manual
          </span>
        </div>
        <p className="text-xs text-gray-500 mt-1">
          Updated {daysOld === 0 ? "today" : `${daysOld} days ago`}
        </p>
      </div>
      <div className="text-right">
        <p className="text-base font-semibold text-gray-900 tabular-nums">
          {formatCurrency(asset.value, currency)}
        </p>
        <p className="text-xs text-gray-500 capitalize">
          {asset.category}
        </p>
      </div>
    </div>
  );
}
