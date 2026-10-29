"use client";

import { useState } from "react";
import type { AssetsSummary, AssetAccount } from "@/lib/assetsSummary";
import type { ManualAsset } from "@/lib/types";
import { formatCurrency } from "@/lib/currencyUtils";
import { AccountDrawer, type AccountDrawerData } from "@/components/AccountDrawer";

interface AccountsTabProps {
  summary: AssetsSummary;
}

export function AccountsTab({ summary }: AccountsTabProps) {
  const { groups, currency, monthlyHistory } = summary;
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
  const [drawerData, setDrawerData] = useState<AccountDrawerData | null>(null);

  const handleAccountClick = (account: AssetAccount) => {
    // Find balance history for this account from accountBalanceHistory
    const accountHistory = summary.accountBalanceHistory?.find(h => h.slug === account.slug);
    
    // Build 12-month series from monthlyHistory template
    const last12Months = monthlyHistory.slice(-12);
    
    const balanceHistory = last12Months.map(m => {
      // Find balance entry for this month
      const entry = accountHistory?.entries.find(e => e.yearMonth === m.month);
      
      return {
        month: m.month,
        monthLabel: m.monthLabel,
        balance: entry?.balance ?? null, // null = gap (no data for this month)
        derived: entry?.derived,
        sourceStatement: entry?.sourceStatement,
      };
    });
    
    // Build transactions list for this account
    const accountExpenses = summary.expenseTxns
      .filter(t => t.accountSlug === account.slug)
      .map(t => ({
        date: t.date,
        description: t.merchant,
        amount: t.amount,
        txMonth: t.txMonth,
        isIncome: false,
      }));
    
    const accountIncome = summary.incomeTxns
      .filter(t => t.accountSlug === account.slug)
      .map(t => ({
        date: t.date,
        description: t.source,
        amount: t.amount,
        txMonth: t.txMonth,
        isIncome: true,
      }));
    
    const transactions = [...accountExpenses, ...accountIncome];

    setDrawerData({
      accountName: account.accountName || account.accountType,
      bankName: account.bankName,
      accountType: account.accountType,
      balance: account.balance,
      currency,
      statementMonth: account.statementMonth,
      isDebt: false,
      balanceHistory,
      transactions,
    });
  };

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
                  <AccountRow 
                    key={acc.slug} 
                    account={acc} 
                    currency={currency}
                    onClick={() => handleAccountClick(acc)}
                  />
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
      
      {/* Account Drawer */}
      <AccountDrawer
        isOpen={drawerData !== null}
        onClose={() => setDrawerData(null)}
        data={drawerData}
      />
    </div>
  );
}

function AccountRow({ 
  account, 
  currency,
  onClick
}: { 
  account: AssetAccount; 
  currency: string;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-start justify-between py-3 border-b border-gray-100 last:border-0 hover:bg-gray-50 transition-colors rounded px-2 -mx-2 text-left"
    >
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
    </button>
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
