import { useState } from "react";
import type { DebtsSummary, DebtAccount } from "@/lib/debtsSummary";
import type { ManualLiability } from "@/lib/types";
import { formatCurrency } from "@/lib/currencyUtils";

interface AccountsTabProps {
  summary: DebtsSummary;
}

export function AccountsTab({ summary }: AccountsTabProps) {
  const { groups, currency, payoffEstimates } = summary;
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);

  if (groups.length === 0) {
    return (
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-8 text-center">
        <p className="text-gray-600">No debt accounts found.</p>
        <p className="text-sm text-gray-500 mt-2">
          You're debt-free! 🎉
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {groups.map((group) => {
        const isExpanded = expandedGroup === group.type;
        const accountCount = group.accounts.length + group.manualLiabilities.length;

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
                  {formatCurrency(group.totalBalance, currency)}
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
                {group.accounts.map((acc) => {
                  const payoff = payoffEstimates.find(e => e.accountSlug === acc.slug);
                  return (
                    <DebtAccountRow 
                      key={acc.slug} 
                      account={acc} 
                      currency={currency}
                      payoff={payoff}
                    />
                  );
                })}

                {/* Manual Liabilities */}
                {group.manualLiabilities.map((liability) => (
                  <ManualLiabilityRow 
                    key={liability.id} 
                    liability={liability} 
                    currency={currency} 
                  />
                ))}

                {group.accounts.length === 0 && group.manualLiabilities.length === 0 && (
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

function DebtAccountRow({ 
  account, 
  currency, 
  payoff 
}: { 
  account: DebtAccount; 
  currency: string;
  payoff?: { accountSlug: string; monthsToPayoff: number | null; payoffDate: string | null };
}) {
  return (
    <div className="flex items-start justify-between py-3 border-b border-gray-100 last:border-0">
      <div className="flex-1">
        <div className="flex items-center gap-2 mb-1">
          <span className="font-medium text-gray-900">{account.bankName}</span>
        </div>
        {account.accountName && (
          <p className="text-sm text-gray-600">{account.accountName}</p>
        )}
        <div className="flex gap-4 mt-2 text-xs text-gray-500">
          {account.interestRate !== null && (
            <span>{account.interestRate.toFixed(2)}% APR</span>
          )}
          {account.monthlyPayment !== null && (
            <span>Payment: {formatCurrency(account.monthlyPayment, currency)}/mo</span>
          )}
        </div>
        {payoff?.payoffDate && (
          <p className="text-xs text-green-600 mt-1">
            Payoff: {formatPayoffDate(payoff.payoffDate)} ({payoff.monthsToPayoff} months)
          </p>
        )}
      </div>
      <div className="text-right">
        <p className="text-base font-semibold text-gray-900 tabular-nums">
          {formatCurrency(account.balance, currency)}
        </p>
        <p className="text-xs text-gray-500 capitalize mt-1">
          {account.accountType.replace("_", " ")}
        </p>
      </div>
    </div>
  );
}

function ManualLiabilityRow({ 
  liability, 
  currency 
}: { 
  liability: ManualLiability; 
  currency: string;
}) {
  const lastUpdated = new Date(liability.updatedAt);
  const daysOld = Math.floor((Date.now() - lastUpdated.getTime()) / 86400000);

  return (
    <div className="flex items-start justify-between py-3 border-b border-gray-100 last:border-0">
      <div className="flex-1">
        <div className="flex items-center gap-2 mb-1">
          <span className="font-medium text-gray-900">{liability.label}</span>
          <span className="px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-800 rounded">
            Manual
          </span>
        </div>
        <div className="flex gap-4 mt-2 text-xs text-gray-500">
          {liability.interestRate !== undefined && (
            <span>{liability.interestRate.toFixed(2)}% APR</span>
          )}
          <span>Updated {daysOld === 0 ? "today" : `${daysOld} days ago`}</span>
        </div>
      </div>
      <div className="text-right">
        <p className="text-base font-semibold text-gray-900 tabular-nums">
          {formatCurrency(liability.balance, currency)}
        </p>
        <p className="text-xs text-gray-500 capitalize mt-1">
          {liability.category.replace("_", " ")}
        </p>
      </div>
    </div>
  );
}

function formatPayoffDate(dateStr: string): string {
  const [year, month] = dateStr.split("-");
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${monthNames[parseInt(month) - 1]} ${year}`;
}
