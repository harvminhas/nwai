import { useState, useEffect } from "react";
import type { DebtsSummary } from "@/lib/debtsSummary";
import { formatCurrency } from "@/lib/currencyUtils";
import { calculateBalanceChartDomain } from "@/lib/chartDomain";
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import {
  CANONICAL_CHART_MARGIN,
  CANONICAL_GRID_CONFIG,
  CANONICAL_XAXIS_CONFIG,
  CANONICAL_YAXIS_CONFIG,
  CANONICAL_LINE_CONFIG,
  CANONICAL_CHART_HEIGHT,
} from "@/lib/canonicalChartConfig";

interface TrendsTabProps {
  summary: DebtsSummary;
}

export function TrendsTab({ summary }: TrendsTabProps) {
  const { monthlyHistory, currency, accountBalanceHistory } = summary;
  
  // Default selected month: LATEST AVAILABLE DATA (not wall clock empty future)
  const latestMonth = monthlyHistory.length > 0
    ? [...monthlyHistory].sort((a, b) => b.month.localeCompare(a.month))[0].month
    : null;
  
  const [selectedMonth, setSelectedMonth] = useState<string | null>(latestMonth);

  // Update selected month when data arrives (async) if not explicitly set by user
  useEffect(() => {
    if (!selectedMonth && latestMonth) {
      setSelectedMonth(latestMonth);
    }
  }, [latestMonth, selectedMonth]);

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

  // Sort chronologically (oldest to newest)
  const sortedHistory = [...monthlyHistory].sort((a, b) => a.month.localeCompare(b.month));
  
  // Prepare chart data (use absolute values for display)
  const chartData = sortedHistory.map(m => ({
    month: m.month,
    label: m.monthLabel.split(' ')[0], // Short label (e.g., "Jan")
    totalDebt: Math.abs(m.totalDebt), // Absolute value for display
    isSelected: m.month === selectedMonth,
  }));
  
  // Calculate domain using shared canonical logic
  const values = chartData.map(d => d.totalDebt);
  const domain = calculateBalanceChartDomain(values);
  
  const selectedData = selectedMonth 
    ? monthlyHistory.find(m => m.month === selectedMonth)
    : null;
  
  // Use authoritative account breakdown from profile's byAccount calculation
  // This includes carry-forward, FX conversion, manual liabilities, closed debt exclusion, and historical values
  const selectedMonthAccounts = selectedData?.accountDetails
    ? selectedData.accountDetails
        .filter(acc => acc.value < 0) // Debts only (value is negative)
        .map(acc => ({
          label: acc.label,
          balance: Math.abs(acc.value), // Convert to positive for display
          slug: acc.slug,
        }))
    : [];
  
  function handleMonthClick(month: string) {
    setSelectedMonth(prev => prev === month ? null : month);
  }

  return (
    <div className="space-y-6">
      {/* Canonical Line Chart */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">
          Total Debt Over Time
        </h2>
        
        <div style={{ height: `${CANONICAL_CHART_HEIGHT}px` }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={CANONICAL_CHART_MARGIN}>
              <defs>
                <linearGradient id="debtsGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.15}/>
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0.02}/>
                </linearGradient>
              </defs>
              
              <CartesianGrid {...CANONICAL_GRID_CONFIG} />
              
              <XAxis
                dataKey="label"
                {...CANONICAL_XAXIS_CONFIG}
              />
              
              <YAxis
                domain={[domain.min, domain.max]}
                tickFormatter={(v: number) => formatCurrency(v, currency)}
                {...CANONICAL_YAXIS_CONFIG}
              />
              
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.[0]) return null;
                  const data = payload[0].payload;
                  return (
                    <div className="bg-white border border-gray-200 rounded-lg shadow-lg px-3 py-2">
                      <p className="text-xs text-gray-600 mb-1">
                        {sortedHistory.find(h => h.month === data.month)?.monthLabel}
                      </p>
                      <p className="text-sm font-semibold text-gray-900">
                        {formatCurrency(data.totalDebt, currency)}
                      </p>
                    </div>
                  );
                }}
              />
              
              {/* Gradient area */}
              <Area
                type="monotone"
                dataKey="totalDebt"
                fill="url(#debtsGradient)"
                stroke="none"
                isAnimationActive={false}
              />
              
              {/* Line with clickable dots */}
              <Line
                {...CANONICAL_LINE_CONFIG}
                dataKey="totalDebt"
                stroke="#10b981"
                dot={(props: any) => {
                  const isSelected = props.payload?.isSelected;
                  return (
                    <circle
                      cx={props.cx}
                      cy={props.cy}
                      r={isSelected ? 6 : 4}
                      fill={isSelected ? "#059669" : "#10b981"}
                      stroke="#fff"
                      strokeWidth={isSelected ? 3 : 2}
                      onClick={() => handleMonthClick(props.payload.month)}
                      style={{ cursor: 'pointer' }}
                    />
                  );
                }}
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        
        <p className="mt-2 text-xs text-gray-400">Click a point to see details</p>
      </div>

      {/* Month Detail */}
      {selectedData && (
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-semibold text-gray-900">
                {selectedData.monthLabel}
              </h3>
              <p className="text-xs text-gray-500 mt-1">
                {selectedMonthAccounts.length} account{selectedMonthAccounts.length !== 1 ? 's' : ''}
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs text-gray-500">Total Debt</p>
              <p className="text-xl font-bold text-gray-900">
                {formatCurrency(Math.abs(selectedData.totalDebt), currency)}
              </p>
            </div>
          </div>

          {/* Account List */}
          {selectedMonthAccounts.length > 0 ? (
            <div className="space-y-2">
              {selectedMonthAccounts
                .sort((a, b) => b.balance - a.balance)
                .map((account) => {
                  const totalDebt = Math.abs(selectedData.totalDebt);
                  const pct = totalDebt > 0 
                    ? (account.balance / totalDebt) * 100 
                    : 0;
                  
                  return (
                    <div key={account.slug} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                      <span className="text-sm text-gray-700">{account.label}</span>
                      <div className="text-right">
                        <span className="text-sm font-semibold text-gray-900">
                          {formatCurrency(account.balance, currency)}
                        </span>
                        <span className="text-xs text-gray-500 ml-2">
                          {pct.toFixed(1)}%
                        </span>
                      </div>
                    </div>
                  );
                })}
            </div>
          ) : (
            <p className="text-sm text-gray-500">No account data for this month.</p>
          )}
        </div>
      )}
    </div>
  );
}
