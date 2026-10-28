"use client";

import { useEffect } from "react";
import { formatCurrency } from "@/lib/currencyUtils";

export interface AccountDrawerData {
  accountName: string;
  bankName: string;
  accountType: string;
  balance: number;
  currency: string;
  statementMonth: string;
  isDebt: boolean;
  interestRate?: number | null;
  monthlyPayment?: number | null;
  balanceHistory: Array<{
    month: string;
    monthLabel: string;
    balance: number;
  }>;
  paymentHistory?: Array<{
    month: string;
    monthLabel: string;
    amount: number;
  }>;
  payoffInfo?: {
    monthsToPayoff: number;
    payoffDate: string;
    totalInterest: number;
  };
}

interface AccountDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  data: AccountDrawerData | null;
}

export function AccountDrawer({ isOpen, onClose, data }: AccountDrawerProps) {
  // Close on Escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [isOpen, onClose]);

  // Prevent body scroll when open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  if (!isOpen || !data) return null;

  const monthDisplay = (() => {
    const match = data.statementMonth.match(/^(\d{4})-(\d{2})$/);
    if (match) {
      const [, year, month] = match;
      const date = new Date(parseInt(year), parseInt(month) - 1);
      return date.toLocaleDateString("en-US", { month: "short", year: "numeric" });
    }
    return data.statementMonth;
  })();

  const payoffDisplay = data.payoffInfo
    ? (() => {
        const match = data.payoffInfo.payoffDate.match(/^(\d{4})-(\d{2})$/);
        if (match) {
          const [, year, month] = match;
          const date = new Date(parseInt(year), parseInt(month) - 1);
          return date.toLocaleDateString("en-US", { month: "short", year: "numeric" });
        }
        return data.payoffInfo.payoffDate;
      })()
    : null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/30 backdrop-blur-sm z-40 transition-opacity"
        onClick={onClose}
      />

      {/* Drawer */}
      <div className="fixed inset-y-0 right-0 w-full sm:w-[480px] bg-white shadow-2xl z-50 overflow-y-auto">
        {/* Sticky Header */}
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 z-10">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <h2 className="text-lg font-semibold text-gray-900 truncate">
                {data.bankName} {data.accountName}
              </h2>
              <p className="text-sm text-gray-600 mt-0.5">{data.accountType}</p>
            </div>
            <button
              onClick={onClose}
              className="flex-shrink-0 p-2 hover:bg-gray-100 rounded-lg transition"
              aria-label="Close"
            >
              <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          
          <div className="mt-3 flex items-baseline gap-3">
            <p className="text-2xl font-bold text-gray-900">
              {formatCurrency(Math.abs(data.balance), data.currency)}
            </p>
            <p className="text-sm text-gray-500">
              as of {monthDisplay}
            </p>
          </div>
        </div>

        {/* Content */}
        <div className="px-6 py-6 space-y-6">
          {/* Balance History */}
          <div>
            <h3 className="text-sm font-semibold text-gray-900 mb-3">
              Balance History (Last 12 Months)
            </h3>
            <div className="space-y-2">
              {data.balanceHistory.map((entry, idx) => {
                const maxBalance = Math.max(...data.balanceHistory.map(e => Math.abs(e.balance)));
                const pct = maxBalance > 0 ? (Math.abs(entry.balance) / maxBalance) * 100 : 0;
                
                // For debts, show change from previous month
                let changeColor = "bg-gray-300";
                if (data.isDebt && idx > 0) {
                  const prevBalance = Math.abs(data.balanceHistory[idx - 1].balance);
                  const currBalance = Math.abs(entry.balance);
                  if (currBalance < prevBalance) {
                    changeColor = "bg-green-500"; // Debt decreased (good)
                  } else if (currBalance > prevBalance) {
                    changeColor = "bg-red-500"; // Debt increased (bad)
                  }
                }
                
                return (
                  <div key={entry.month} className="flex items-center gap-2">
                    <span className="text-xs text-gray-600 w-16">{entry.monthLabel}</span>
                    <div className="flex-1 h-6 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full ${data.isDebt ? changeColor : 'bg-purple-500'} rounded-full transition-all`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="text-xs font-medium text-gray-900 w-20 text-right tabular-nums">
                      {formatCurrency(Math.abs(entry.balance), data.currency)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Debt Details */}
          {data.isDebt && (
            <>
              {/* Interest Rate */}
              {data.interestRate !== undefined && data.interestRate !== null && (
                <div className="bg-gray-50 rounded-lg p-4">
                  <p className="text-xs text-gray-600 mb-1">Interest Rate</p>
                  <p className="text-xl font-bold text-gray-900">{data.interestRate.toFixed(2)}%</p>
                </div>
              )}

              {/* Monthly Payment */}
              {data.monthlyPayment !== undefined && data.monthlyPayment !== null && (
                <div className="bg-gray-50 rounded-lg p-4">
                  <p className="text-xs text-gray-600 mb-1">Monthly Payment</p>
                  <p className="text-xl font-bold text-gray-900">
                    {formatCurrency(data.monthlyPayment, data.currency)}
                  </p>
                </div>
              )}

              {/* Payoff Info */}
              {data.payoffInfo && (
                <div className="bg-violet-50 border border-violet-200 rounded-lg p-4">
                  <p className="text-xs text-violet-700 font-semibold mb-2">Payoff Projection</p>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-violet-900">Payoff Date</span>
                      <span className="text-sm font-semibold text-violet-900">{payoffDisplay}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-violet-900">Months to Payoff</span>
                      <span className="text-sm font-semibold text-violet-900">
                        {data.payoffInfo.monthsToPayoff} months
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-violet-900">Total Interest</span>
                      <span className="text-sm font-semibold text-violet-900">
                        {formatCurrency(data.payoffInfo.totalInterest, data.currency)}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* Payment History */}
              {data.paymentHistory && data.paymentHistory.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-gray-900 mb-3">
                    Recent Payments
                  </h3>
                  <div className="space-y-2">
                    {data.paymentHistory.map((payment) => (
                      <div key={payment.month} className="flex items-center justify-between py-2">
                        <span className="text-sm text-gray-600">{payment.monthLabel}</span>
                        <span className="text-sm font-semibold text-gray-900 tabular-nums">
                          {formatCurrency(payment.amount, data.currency)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
