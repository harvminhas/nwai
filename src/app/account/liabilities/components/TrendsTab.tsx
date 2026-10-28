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

  const maxDebt = Math.max(...monthlyHistory.map(m => m.totalDebt));
  const selectedData = selectedMonth 
    ? monthlyHistory.find(m => m.month === selectedMonth)
    : null;

  return (
    <div className="space-y-6">
      {/* Monthly Chart */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">
          Total Debt by Month
        </h2>
        <div className="space-y-2">
          {monthlyHistory.map((month) => {
            const heightPct = maxDebt > 0 ? (month.totalDebt / maxDebt) * 100 : 0;
            const isSelected = selectedMonth === month.month;
            
            return (
              <button
                key={month.month}
                onClick={() => setSelectedMonth(
                  selectedMonth === month.month ? null : month.month
                )}
                className="w-full group"
              >
                <div className="flex items-center gap-3">
                  <span className="w-16 text-xs text-gray-600 text-right shrink-0">
                    {month.monthLabel}
                  </span>
                  <div className="flex-1 h-8 bg-gray-100 rounded relative overflow-hidden">
                    <div
                      className={`h-full transition-all ${
                        isSelected
                          ? "bg-red-600"
                          : "bg-red-500 group-hover:bg-red-600"
                      }`}
                      style={{ width: `${heightPct}%` }}
                    />
                  </div>
                  <span className="w-24 text-sm font-medium text-gray-900 text-right tabular-nums shrink-0">
                    {fmtCompact(month.totalDebt, currency)}
                  </span>
                </div>
              </button>
            );
          })}
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
