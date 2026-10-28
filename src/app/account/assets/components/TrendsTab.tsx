import { useState } from "react";
import type { AssetsSummary } from "@/lib/assetsSummary";
import { formatCurrency, fmtCompact } from "@/lib/currencyUtils";

interface TrendsTabProps {
  summary: AssetsSummary;
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
  const values = sortedHistory.map(m => m.total);
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const range = maxValue - minValue;
  const paddedMin = minValue - (range * 0.05);
  const paddedMax = maxValue + (range * 0.05);
  const effectiveRange = paddedMax - paddedMin;
  
  // Calculate month-over-month changes
  const changes = sortedHistory.map((month, idx) => {
    if (idx === 0) return null;
    return month.total - sortedHistory[idx - 1].total;
  });
  
  const selectedData = selectedMonth 
    ? monthlyHistory.find(m => m.month === selectedMonth)
    : null;

  return (
    <div className="space-y-6">
      {/* Timeline Chart - Vertical Columns */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">
          Total Assets by Month
        </h2>
        
        {/* Compact timeline with vertical bars */}
        <div className="h-48 flex items-end gap-1 mb-2">
          {sortedHistory.map((month, idx) => {
            const heightPct = effectiveRange > 0 
              ? ((month.total - paddedMin) / effectiveRange) * 100 
              : 50;
            const change = changes[idx];
            const isSelected = selectedMonth === month.month;
            
            return (
              <button
                key={month.month}
                onClick={() => setSelectedMonth(
                  selectedMonth === month.month ? null : month.month
                )}
                className="flex-1 flex flex-col items-center group relative"
              >
                {/* Change label (+/-) */}
                {change !== null && (
                  <div className={`text-[10px] font-medium mb-1 ${
                    change > 0 ? 'text-green-600' : change < 0 ? 'text-red-600' : 'text-gray-400'
                  }`}>
                    {change > 0 ? '+' : ''}{fmtCompact(change, currency)}
                  </div>
                )}
                
                {/* Vertical bar */}
                <div className="w-full relative" style={{ height: `${Math.max(heightPct, 5)}%` }}>
                  <div className={`absolute bottom-0 left-0 right-0 rounded-t transition-all ${
                    isSelected
                      ? "bg-purple-600"
                      : "bg-purple-500 group-hover:bg-purple-600"
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
        <div className="bg-purple-50 border border-purple-200 rounded-lg p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-900">
              {selectedData.monthLabel}
            </h3>
            <button
              onClick={() => setSelectedMonth(null)}
              className="text-purple-600 hover:text-purple-700 text-sm font-medium"
            >
              Close
            </button>
          </div>

          <div className="mb-4">
            <p className="text-sm text-gray-600">Total Assets</p>
            <p className="text-2xl font-bold text-gray-900">
              {formatCurrency(selectedData.total, currency)}
            </p>
          </div>

          {/* Groups Breakdown */}
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-600 mb-2">
              By Type
            </p>
            {selectedData.groups.map((group) => {
              const pct = selectedData.total > 0 
                ? (group.total / selectedData.total) * 100 
                : 0;
              
              return (
                <div key={group.type} className="flex items-center justify-between py-2 border-b border-purple-100 last:border-0">
                  <span className="text-sm text-gray-700 capitalize">
                    {group.type.replace("_", " ")}
                  </span>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-gray-900">
                      {formatCurrency(group.total, currency)}
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
