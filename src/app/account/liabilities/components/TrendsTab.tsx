import { useState } from "react";
import type { DebtsSummary } from "@/lib/debtsSummary";
import { formatCurrency, fmtCompact } from "@/lib/currencyUtils";

interface TrendsTabProps {
  summary: DebtsSummary;
}

export function TrendsTab({ summary }: TrendsTabProps) {
  const { monthlyHistory, currency } = summary;
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);

  if (monthlyHistory.length === 0) {
    return (
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-8 text-center">
        <p className="text-gray-600">No historical data available yet.</p>
        <p className="text-sm text-gray-500 mt-2">
          Upload more statements to see trends over time.
        </p>
      </div>
    );
  }

  // Show oldest on left to newest on right
  const sortedHistory = [...monthlyHistory].sort((a, b) => a.month.localeCompare(b.month));
  
  // Calculate min and max for scaling (with 5% padding)
  const values = sortedHistory.map(m => m.totalDebt);
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const range = maxValue - minValue;
  const paddedMin = minValue - (range * 0.05);
  const paddedMax = maxValue + (range * 0.05);
  const effectiveRange = paddedMax - paddedMin;
  
  // Calculate month-over-month changes
  const changes = sortedHistory.map((month, idx) => {
    if (idx === 0) return null;
    return month.totalDebt - sortedHistory[idx - 1].totalDebt;
  });
  
  const selectedData = selectedMonth 
    ? monthlyHistory.find(m => m.month === selectedMonth)
    : null;

  return (
    <div className="space-y-6">
      {/* Timeline Chart - Vertical Columns */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">
          Total Debt by Month
        </h2>
        
        {/* Compact timeline with vertical bars */}
        <div className="h-48 flex items-end gap-1 mb-2">
          {sortedHistory.map((month, idx) => {
            const heightPct = effectiveRange > 0 
              ? ((month.totalDebt - paddedMin) / effectiveRange) * 100 
              : 50;
            const change = changes[idx];
            const isSelected = selectedMonth === month.month;
            
            // For debt: decrease (negative change) is green, increase is red
            const changeColor = change === null ? 'text-gray-400' :
                               change < 0 ? 'text-green-600' : 
                               change > 0 ? 'text-red-600' : 'text-gray-400';
            
            const barColor = change === null ? 'bg-red-500' :
                            change < 0 ? 'bg-green-500' : 
                            'bg-red-500';
            
            const barColorHover = change === null ? 'bg-red-600' :
                                 change < 0 ? 'bg-green-600' : 
                                 'bg-red-600';
            
            const barColorSelected = change === null ? 'bg-red-600' :
                                    change < 0 ? 'bg-green-600' : 
                                    'bg-red-600';
            
            return (
              <button
                key={month.month}
                onClick={() => setSelectedMonth(
                  selectedMonth === month.month ? null : month.month
                )}
                className="flex-1 h-full flex flex-col items-center justify-end group relative"
              >
                {/* Change label (+/-) */}
                {change !== null && (
                  <div className={`text-[10px] font-medium mb-1 ${changeColor}`}>
                    {change > 0 ? '+' : ''}{fmtCompact(change, currency)}
                  </div>
                )}
                
                {/* Vertical bar */}
                <div className="w-full relative" style={{ height: `${Math.max(heightPct, 5)}%` }}>
                  <div className={`absolute bottom-0 left-0 right-0 rounded-t transition-all ${
                    isSelected
                      ? barColorSelected
                      : `${barColor} group-hover:${barColorHover}`
                  }`} style={{ height: '100%' }} />
                </div>
                
                {/* Month label */}
                <span className="text-[10px] text-gray-600 mt-1 whitespace-nowrap">
                  {month.monthLabel.split(' ')[0]}
                </span>
              </button>
            );
          })}
        </div>
        
        {/* Value range labels */}
        <div className="flex justify-between text-xs text-gray-500 border-t pt-2">
          <span>{fmtCompact(minValue, currency)}</span>
          <span>{fmtCompact(maxValue, currency)}</span>
        </div>
      </div>

      {/* Month Detail Drawer */}
      {selectedData && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-900">
              {selectedData.monthLabel}
            </h3>
            <button
              onClick={() => setSelectedMonth(null)}
              className="text-red-600 hover:text-red-700 text-sm font-medium"
            >
              Close
            </button>
          </div>

          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <p className="text-sm text-gray-600">Total Debt</p>
              <p className="text-2xl font-bold text-gray-900">
                {formatCurrency(selectedData.totalDebt, currency)}
              </p>
            </div>
            <div>
              <p className="text-sm text-gray-600">Payments Made</p>
              <p className="text-2xl font-bold text-green-600">
                {formatCurrency(selectedData.totalPayments, currency)}
              </p>
            </div>
          </div>

          {/* Groups Breakdown */}
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-600 mb-2">
              Debt by Type
            </p>
            {selectedData.groups.map((group) => {
              const pct = selectedData.totalDebt > 0 
                ? (group.balance / selectedData.totalDebt) * 100 
                : 0;
              
              return (
                <div key={group.type} className="flex items-center justify-between py-2 border-b border-red-100 last:border-0">
                  <span className="text-sm text-gray-700 capitalize">
                    {group.type.replace("_", " ")}
                  </span>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-gray-900">
                      {formatCurrency(group.balance, currency)}
                    </p>
                    <p className="text-xs text-gray-500">{pct.toFixed(1)}%</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
