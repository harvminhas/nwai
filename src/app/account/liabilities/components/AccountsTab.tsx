"use client";

import { useState } from "react";
import type { DebtsSummary, DebtAccount } from "@/lib/debtsSummary";
import type { ManualLiability } from "@/lib/types";
import { formatCurrency } from "@/lib/currencyUtils";
import { AccountDrawer, type AccountDrawerData } from "@/components/AccountDrawer";
import { formatAccountLast4 } from "@/lib/rangeUtils";
import { getFirebaseClient } from "@/lib/firebase";

interface AccountsTabProps {
  summary: DebtsSummary;
  onRefresh?: () => void;
}

export function AccountsTab({ summary, onRefresh }: AccountsTabProps) {
  const { groups, currency, payoffEstimates, monthlyHistory } = summary;
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
  const [drawerData, setDrawerData] = useState<AccountDrawerData | null>(null);
  const [statusUpdating, setStatusUpdating] = useState<string | null>(null);

  const handleStatusChange = async (accountSlug: string, status: "open" | "paid_off" | "closed") => {
    setStatusUpdating(accountSlug);
    try {
      const { auth } = getFirebaseClient();
      const user = auth.currentUser;
      if (!user) return;

      const token = await user.getIdToken();
      const statusDate = new Date().toISOString().split("T")[0]; // YYYY-MM-DD

      const res = await fetch("/api/user/account-status", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ accountSlug, status, statusDate }),
      });

      if (!res.ok) {
        throw new Error("Failed to update account status");
      }

      // Refresh the data
      if (onRefresh) {
        onRefresh();
      }
    } catch (err) {
      console.error("Failed to update account status:", err);
      alert("Failed to update account status. Please try again.");
    } finally {
      setStatusUpdating(null);
    }
  };

  const handleAccountClick = (account: DebtAccount) => {
    const payoff = payoffEstimates.find(e => e.accountSlug === account.slug);
    
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
        balance: entry?.balance ?? null, // Use actual balance (already negative for debts)
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
      isDebt: true,
      interestRate: account.interestRate,
      monthlyPayment: account.monthlyPayment,
      balanceHistory: balanceHistory.filter(h => h.balance !== null) as any, // Filter out gaps for now
      transactions,
      payoffInfo: payoff?.payoffDate ? {
        monthsToPayoff: payoff.monthsToPayoff || 0,
        payoffDate: payoff.payoffDate,
        totalInterest: 0, // Would need to calculate from payoff estimates
      } : undefined,
    });
  };

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
                      onClick={() => handleAccountClick(acc)}
                      onStatusChange={handleStatusChange}
                      isUpdating={statusUpdating === acc.slug}
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
      
      {/* Account Drawer */}
      <AccountDrawer
        isOpen={drawerData !== null}
        onClose={() => setDrawerData(null)}
        data={drawerData}
      />
    </div>
  );
}

function DebtAccountRow({ 
  account, 
  currency, 
  payoff,
  onClick,
  onStatusChange,
  isUpdating
}: { 
  account: DebtAccount; 
  currency: string;
  payoff?: { accountSlug: string; monthsToPayoff: number | null; payoffDate: string | null };
  onClick?: () => void;
  onStatusChange?: (slug: string, status: "open" | "paid_off" | "closed") => void;
  isUpdating?: boolean;
}) {
  const [showMenu, setShowMenu] = useState(false);

  const handleMenuClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowMenu(!showMenu);
  };

  const handleStatusClick = (e: React.MouseEvent, status: "open" | "paid_off" | "closed") => {
    e.stopPropagation();
    setShowMenu(false);
    if (onStatusChange) {
      onStatusChange(account.slug, status);
    }
  };

  return (
    <div className="relative">
      <button
        onClick={onClick}
        className="w-full flex items-start justify-between py-3 border-b border-gray-100 last:border-0 hover:bg-gray-50 transition-colors rounded px-2 -mx-2 text-left"
        disabled={isUpdating}
      >
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-medium text-gray-900">{account.bankName}</span>
            <span className="text-xs text-gray-400 font-normal">{formatAccountLast4(account.slug)}</span>
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
        <div className="flex items-start gap-2">
          <div className="text-right">
            <p className="text-base font-semibold text-gray-900 tabular-nums">
              {formatCurrency(account.balance, currency)}
            </p>
            <p className="text-xs text-gray-500 capitalize mt-1">
              {account.accountType.replace("_", " ")}
            </p>
          </div>
          {onStatusChange && (
            <button
              onClick={handleMenuClick}
              disabled={isUpdating}
              className="p-1 hover:bg-gray-200 rounded transition-colors"
            >
              {isUpdating ? (
                <div className="w-5 h-5 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" />
              ) : (
                <svg className="w-5 h-5 text-gray-600" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
                </svg>
              )}
            </button>
          )}
        </div>
      </button>

      {/* Dropdown Menu */}
      {showMenu && (
        <>
          <div 
            className="fixed inset-0 z-10" 
            onClick={(e) => {
              e.stopPropagation();
              setShowMenu(false);
            }}
          />
          <div className="absolute right-2 top-12 z-20 w-48 bg-white border border-gray-200 rounded-lg shadow-lg py-1">
            <button
              onClick={(e) => handleStatusClick(e, "paid_off")}
              className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 transition-colors"
            >
              Mark as Paid Off
            </button>
            <button
              onClick={(e) => handleStatusClick(e, "closed")}
              className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 transition-colors"
            >
              Mark as Closed
            </button>
            <button
              onClick={(e) => handleStatusClick(e, "open")}
              className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 transition-colors"
            >
              Reopen
            </button>
          </div>
        </>
      )}
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
