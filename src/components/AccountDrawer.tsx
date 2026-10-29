"use client";

import { useEffect, useState } from "react";
import { formatCurrency } from "@/lib/currencyUtils";

interface BalanceLineChartProps {
  history: Array<{
    month: string;
    monthLabel: string;
    balance: number | null;
    derived?: boolean;
    sourceStatement?: string;
  }>;
  currency: string;
  isDebt: boolean;
  onMonthClick?: (month: string) => void;
}

function BalanceLineChart({ history, currency, isDebt, onMonthClick }: BalanceLineChartProps) {
  const [hoveredPoint, setHoveredPoint] = useState<number | null>(null);
  
  // Filter out null values (gaps) and narrow type
  const validHistory = history.filter((h): h is typeof h & { balance: number } => h.balance !== null && Number.isFinite(h.balance));
  
  if (validHistory.length === 0) {
    return (
      <div className="bg-gray-50 rounded-lg p-6 text-center">
        <p className="text-sm text-gray-600">Not enough history yet</p>
      </div>
    );
  }

  // Sort chronologically (oldest first)
  const sortedHistory = [...validHistory].sort((a, b) => a.month.localeCompare(b.month));
  
  if (validHistory.length === 0) {
    return (
      <div className="bg-gray-50 rounded-lg p-6 text-center">
        <p className="text-sm text-gray-600">Not enough history yet</p>
      </div>
    );
  }
  
  // Calculate min/max with 5% padding
  const values = validHistory.map(h => Math.abs(h.balance));
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const range = maxValue - minValue;
  
  // Guard against constant values (max === min)
  const hasVariation = range > 0.01; // Allow for tiny floating point differences
  
  let paddedMin: number;
  let paddedMax: number;
  let effectiveRange: number;
  
  if (hasVariation) {
    paddedMin = Math.max(0, minValue - (range * 0.05));
    paddedMax = maxValue + (range * 0.05);
    effectiveRange = paddedMax - paddedMin;
  } else {
    // All values are the same - create artificial range for display
    const value = minValue;
    paddedMin = Math.max(0, value * 0.9);
    paddedMax = value * 1.1;
    effectiveRange = paddedMax - paddedMin;
  }
  
  // Determine if trend is improving
  const firstBalance = Math.abs(validHistory[0].balance);
  const lastBalance = Math.abs(validHistory[validHistory.length - 1].balance);
  const isImproving = isDebt 
    ? lastBalance < firstBalance  // Debt decreasing is good
    : lastBalance > firstBalance; // Assets increasing is good
  
  const lineColor = isImproving ? "#10b981" : "#ef4444"; // green-500 : red-500
  const fillColor = isImproving ? "rgba(16, 185, 129, 0.1)" : "rgba(239, 68, 68, 0.1)";
  
  // Chart dimensions
  const chartWidth = 400;
  const chartHeight = 200;
  const padding = { top: 20, right: 20, bottom: 30, left: 50 };
  const plotWidth = chartWidth - padding.left - padding.right;
  const plotHeight = chartHeight - padding.top - padding.bottom;
  
  // Map data to coordinates with safeguards
  const points = validHistory.map((entry, idx) => {
    let x: number;
    let y: number;
    
    if (validHistory.length === 1) {
      // Single point - center it
      x = padding.left + plotWidth / 2;
      y = padding.top + plotHeight / 2;
    } else {
      x = padding.left + (idx / (validHistory.length - 1)) * plotWidth;
      y = padding.top + (1 - ((Math.abs(entry.balance) - paddedMin) / effectiveRange)) * plotHeight;
    }
    
    // Final safeguard - ensure no NaN
    x = Number.isFinite(x) ? x : padding.left + plotWidth / 2;
    y = Number.isFinite(y) ? y : padding.top + plotHeight / 2;
    
    return { x, y, ...entry };
  });
  
  // Create path for line
  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x},${p.y}`).join(' ');
  
  // Create path for area fill
  const areaPath = [
    `M ${points[0].x},${padding.top + plotHeight}`,
    ...points.map(p => `L ${p.x},${p.y}`),
    `L ${points[points.length - 1].x},${padding.top + plotHeight}`,
    'Z'
  ].join(' ');

  return (
    <div>
      <h3 className="text-sm font-semibold text-gray-900 mb-3">
        Balance History (Last {sortedHistory.length} Months)
      </h3>
      
      <div className="relative bg-gray-50 rounded-lg p-4">
        <svg 
          width="100%" 
          height={chartHeight}
          viewBox={`0 0 ${chartWidth} ${chartHeight}`}
          className="overflow-visible"
        >
          {/* Y-axis labels */}
          {[paddedMax, (paddedMax + paddedMin) / 2, paddedMin].map((value, idx) => {
            const y = padding.top + (idx / 2) * plotHeight;
            return (
              <text
                key={idx}
                x={padding.left - 8}
                y={y}
                textAnchor="end"
                alignmentBaseline="middle"
                className="text-[10px] fill-gray-500"
              >
                {value >= 10000 ? `${(value / 1000).toFixed(0)}k` : value.toFixed(0)}
              </text>
            );
          })}
          
          {/* Area fill */}
          <path
            d={areaPath}
            fill={fillColor}
          />
          
          {/* Line */}
          <path
            d={linePath}
            fill="none"
            stroke={lineColor}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          
          {/* Points */}
          {points.map((point, idx) => (
            <g key={idx}>
              <circle
                cx={point.x}
                cy={point.y}
                r={hoveredPoint === idx ? 5 : 3}
                fill="white"
                stroke={lineColor}
                strokeWidth="2"
                className="cursor-pointer transition-all"
                onMouseEnter={() => setHoveredPoint(idx)}
                onMouseLeave={() => setHoveredPoint(null)}
                onClick={() => onMonthClick?.(sortedHistory[idx].month)}
              />
            </g>
          ))}
          
          {/* X-axis labels (every other month if too many) */}
          {points.map((point, idx) => {
            const showLabel = sortedHistory.length <= 6 || idx % 2 === 0;
            if (!showLabel) return null;
            
            return (
              <text
                key={idx}
                x={point.x}
                y={padding.top + plotHeight + 15}
                textAnchor="middle"
                className="text-[10px] fill-gray-600"
              >
                {point.monthLabel.split(' ')[0]}
              </text>
            );
          })}
        </svg>
        
        {/* Tooltip */}
        {hoveredPoint !== null && (
          <div 
            className="absolute bg-gray-900 text-white text-xs rounded px-2 py-1.5 pointer-events-none shadow-lg"
            style={{
              left: `${(points[hoveredPoint].x / chartWidth) * 100}%`,
              top: `${Math.max(10, (points[hoveredPoint].y / chartHeight) * 100 - 20)}%`,
              transform: 'translate(-50%, -100%)',
            }}
          >
            <div className="font-semibold">{sortedHistory[hoveredPoint].monthLabel}</div>
            <div className="tabular-nums">
              {formatCurrency(Math.abs(sortedHistory[hoveredPoint].balance), currency)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

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
    balance: number | null;
    derived?: boolean;
    sourceStatement?: string;
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
  /** Transactions for this account (for month-detail view) */
  transactions?: Array<{
    date: string;
    description: string;
    amount: number;
    txMonth: string;
    isIncome: boolean;
  }>;
}

interface AccountDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  data: AccountDrawerData | null;
}

export function AccountDrawer({ isOpen, onClose, data }: AccountDrawerProps) {
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  
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
      <div className="fixed inset-y-0 right-0 w-full sm:w-[75vw] sm:max-w-[1100px] bg-white shadow-2xl z-50 overflow-y-auto">
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
          {/* Balance History - Line Chart */}
          <BalanceLineChart 
            history={data.balanceHistory} 
            currency={data.currency}
            isDebt={data.isDebt}
            onMonthClick={setSelectedMonth}
          />

          {/* Month Detail View */}
          {selectedMonth && data.transactions && (() => {
            const monthEntry = data.balanceHistory.find(h => h.month === selectedMonth);
            const monthTxns = data.transactions.filter(t => t.txMonth === selectedMonth);
            const inflows = monthTxns.filter(t => t.isIncome);
            const outflows = monthTxns.filter(t => !t.isIncome);
            const totalIn = inflows.reduce((sum, t) => sum + t.amount, 0);
            const totalOut = outflows.reduce((sum, t) => sum + Math.abs(t.amount), 0);
            
            const monthLabel = monthEntry?.monthLabel || selectedMonth;
            
            return (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h4 className="font-semibold text-gray-900">{monthLabel} Details</h4>
                    {monthEntry && (
                      <p className="text-sm text-gray-600 mt-1">
                        Month-end: {formatCurrency(Math.abs(monthEntry.balance || 0), data.currency)}
                        <span className="ml-2 text-xs">
                          ({monthEntry.derived ? 'Calculated' : 'From statement'})
                        </span>
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => setSelectedMonth(null)}
                    className="text-gray-400 hover:text-gray-600"
                  >
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                
                <div className="space-y-3">
                  {/* Summary */}
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div className="bg-white rounded p-2">
                      <p className="text-xs text-gray-600">Inflows</p>
                      <p className="font-semibold text-green-600">
                        +{formatCurrency(totalIn, data.currency)}
                      </p>
                    </div>
                    <div className="bg-white rounded p-2">
                      <p className="text-xs text-gray-600">Outflows</p>
                      <p className="font-semibold text-red-600">
                        -{formatCurrency(totalOut, data.currency)}
                      </p>
                    </div>
                  </div>
                  
                  {/* Transactions List */}
                  {monthTxns.length > 0 && (
                    <div className="bg-white rounded-lg p-3 max-h-64 overflow-y-auto">
                      <p className="text-xs font-semibold text-gray-700 mb-2">
                        Transactions ({monthTxns.length})
                      </p>
                      <div className="space-y-1.5">
                        {monthTxns.sort((a, b) => b.date.localeCompare(a.date)).map((txn, idx) => (
                          <div key={idx} className="flex items-start justify-between text-xs gap-2">
                            <div className="flex-1 min-w-0">
                              <p className="font-medium text-gray-900 truncate">{txn.description}</p>
                              <p className="text-gray-500">{txn.date}</p>
                            </div>
                            <p className={`font-semibold tabular-nums ${txn.isIncome ? 'text-green-600' : 'text-gray-900'}`}>
                              {txn.isIncome ? '+' : ''}{formatCurrency(txn.amount, data.currency)}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

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
