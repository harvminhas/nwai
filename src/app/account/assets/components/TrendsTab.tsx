import { useState, useEffect } from "react";
import type { AssetsSummary } from "@/lib/assetsSummary";
import { formatCurrency, fmtCompact } from "@/lib/currencyUtils";
import { calculateBalanceChartDomain } from "@/lib/chartDomain";
import { useIsDesktopLg } from "@/lib/useMediaMinWidth";
import {
  ACCOUNT_CARD,
  ACCOUNT_DETAIL_AMOUNT,
  ACCOUNT_DETAIL_LABEL,
  ACCOUNT_DETAIL_PCT,
  ACCOUNT_DETAIL_ROW,
  PHONE_CHART_HEIGHT,
  PHONE_CHART_MARGIN,
  PHONE_YAXIS_WIDTH,
} from "@/lib/accountSectionLayout";
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
import { monthFromChartInteraction } from "@/lib/chartMonthClick";

interface TrendsTabProps {
  summary: AssetsSummary;
}

export function TrendsTab({ summary }: TrendsTabProps) {
  const isLg = useIsDesktopLg();
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
  
  // Prepare chart data
  const chartData = sortedHistory.map(m => ({
    month: m.month,
    label: m.monthLabel.split(' ')[0], // Short label (e.g., "Jan")
    total: m.total,
    isSelected: m.month === selectedMonth,
  }));
  
  // Calculate domain using shared canonical logic
  const values = chartData.map(d => d.total);
  const domain = calculateBalanceChartDomain(values);
  
  const selectedData = selectedMonth 
    ? monthlyHistory.find(m => m.month === selectedMonth)
    : null;
  
  // Use authoritative account breakdown from profile's byAccount calculation
  // This includes carry-forward, FX conversion, manual assets, and historical values
  const selectedMonthAccounts = selectedData?.accountDetails
    ? selectedData.accountDetails
        .filter(acc => acc.value > 0) // Assets only
        .map(acc => ({
          label: acc.label,
          balance: acc.value, // Already in home currency, FX-converted
          slug: acc.slug,
        }))
    : [];
  
  function handleChartClick(
    state: Parameters<typeof monthFromChartInteraction>[0],
    event?: Parameters<typeof monthFromChartInteraction>[1]
  ) {
    const month = monthFromChartInteraction(state, event, chartData);
    if (month) setSelectedMonth(month);
  }

  return (
    <div className="space-y-6">
      {/* Canonical Line Chart */}
      <div className={ACCOUNT_CARD} data-testid="assets-trends-chart">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">
          Total Assets Over Time
        </h2>
        
        <div style={{ height: `${isLg ? CANONICAL_CHART_HEIGHT : PHONE_CHART_HEIGHT}px` }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={chartData}
              margin={isLg ? CANONICAL_CHART_MARGIN : PHONE_CHART_MARGIN}
              style={{ cursor: "pointer" }}
              onClick={handleChartClick}
            >
              <defs>
                <linearGradient id="assetsGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.15}/>
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0.02}/>
                </linearGradient>
              </defs>
              
              <CartesianGrid {...CANONICAL_GRID_CONFIG} />
              
              <XAxis
                dataKey="label"
                {...CANONICAL_XAXIS_CONFIG}
                tick={{
                  ...CANONICAL_XAXIS_CONFIG.tick,
                  fontSize: isLg ? CANONICAL_XAXIS_CONFIG.tick.fontSize : 10,
                }}
                minTickGap={isLg ? 5 : 18}
              />
              
              <YAxis
                domain={[domain.min, domain.max]}
                width={isLg ? 60 : PHONE_YAXIS_WIDTH}
                tickFormatter={(v: number) =>
                  isLg ? formatCurrency(v, currency) : fmtCompact(v, currency)
                }
                {...CANONICAL_YAXIS_CONFIG}
                tick={{
                  ...CANONICAL_YAXIS_CONFIG.tick,
                  fontSize: isLg ? CANONICAL_YAXIS_CONFIG.tick.fontSize : 10,
                }}
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
                        {formatCurrency(data.total, currency)}
                      </p>
                    </div>
                  );
                }}
              />
              
              {/* Gradient area */}
              <Area
                type="monotone"
                dataKey="total"
                fill="url(#assetsGradient)"
                stroke="none"
                isAnimationActive={false}
              />
              
              {/* Line; month selection is ComposedChart onClick, not per-dot onClick */}
              <Line
                {...CANONICAL_LINE_CONFIG}
                dataKey="total"
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
                      data-month={props.payload?.month}
                      style={{ cursor: "pointer", pointerEvents: "none" }}
                    />
                  );
                }}
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        
        <p className="mt-2 text-xs text-gray-400">
          {isLg ? "Click a point to see details" : "Tap a month to see the breakdown"}
        </p>
      </div>

      {/* Month Detail */}
      {selectedData && (
        <div className={ACCOUNT_CARD}>
          <div className="mb-4 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-gray-900">
                {selectedData.monthLabel}
              </h3>
              <p className="text-xs text-gray-500 mt-1">
                {selectedMonthAccounts.length} account{selectedMonthAccounts.length !== 1 ? 's' : ''}
              </p>
            </div>
            <div className="shrink-0 text-right">
              <p className="text-xs text-gray-500">Total</p>
              <p className="text-lg font-bold tabular-nums text-gray-900 lg:text-xl">
                {formatCurrency(selectedData.total, currency)}
              </p>
            </div>
          </div>

          {/* Account List */}
          {selectedMonthAccounts.length > 0 ? (
            <div>
              {selectedMonthAccounts
                .sort((a, b) => b.balance - a.balance)
                .map((account) => {
                  const pct = selectedData.total > 0 
                    ? (account.balance / selectedData.total) * 100 
                    : 0;
                  
                  return (
                    <div key={account.slug} className={ACCOUNT_DETAIL_ROW}>
                      <span className={ACCOUNT_DETAIL_LABEL}>{account.label}</span>
                      <div className={ACCOUNT_DETAIL_AMOUNT}>
                        <span className="text-sm font-semibold tabular-nums text-gray-900">
                          {formatCurrency(account.balance, currency)}
                        </span>
                        <span className={ACCOUNT_DETAIL_PCT}>
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
