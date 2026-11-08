/**
 * Asset Trend Chart Component
 * Extracted from asset page for testability.
 * Renders actual + projected trend with date-based chronological x-axis.
 * Uses Recharts for canonical monotone curves and tooltips.
 */

import type { TrendDataPoint } from "@/lib/assetTrendChart";
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
  ReferenceLine,
} from "recharts";
import {
  CANONICAL_CHART_MARGIN,
  CANONICAL_GRID_CONFIG,
  CANONICAL_XAXIS_CONFIG,
  CANONICAL_YAXIS_CONFIG,
  CANONICAL_LINE_CONFIG,
} from "@/lib/canonicalChartConfig";

interface AssetTrendChartSVGProps {
  actualPoints: TrendDataPoint[];
  projectedPoints: TrendDataPoint[];
  todayDate: string;
  currency: string;
  formatCurrency: (value: number, currency: string) => string;
  formatCurrencyWithCents: (value: number, currency: string) => string;
}

export function AssetTrendChartSVG({
  actualPoints,
  projectedPoints,
  todayDate,
  currency,
  formatCurrency,
  formatCurrencyWithCents,
}: AssetTrendChartSVGProps) {
  // Merge actual and projected into single dataset for Recharts
  const chartData = [
    ...actualPoints.map(p => ({
      date: p.date,
      label: p.label,
      actual: p.value,
      projected: null,
      isProjected: false,
    })),
    ...projectedPoints.map(p => ({
      date: p.date,
      label: p.label,
      actual: null,
      projected: p.value,
      isProjected: true,
    })),
  ];
  
  const allValues = [...actualPoints, ...projectedPoints].map(p => p.value);
  const domain = calculateBalanceChartDomain(allValues);

  return (
    <div data-testid="trend-chart-svg" style={{ height: '300px' }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={chartData} margin={CANONICAL_CHART_MARGIN}>
          <defs>
            <linearGradient id="assetTrendGradient" x1="0" y1="0" x2="0" y2="1">
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
              if (!active || !payload?.length) return null;
              const data = payload.find(p => p.value != null);
              if (!data || !data.payload) return null;
              const isProjected = data.payload.isProjected;
              return (
                <div className="bg-white border border-gray-200 rounded-lg shadow-lg px-3 py-2">
                  <p className="text-xs text-gray-600 mb-1">{data.payload.label}</p>
                  <p className="text-sm font-semibold text-gray-900">
                    {formatCurrencyWithCents(data.value as number, currency)}
                    {isProjected && <span className="text-xs text-gray-500 ml-1">(estimated)</span>}
                  </p>
                </div>
              );
            }}
          />
          
          {/* Today marker - vertical reference line */}
          {projectedPoints.length > 0 && (
            <ReferenceLine
              x={actualPoints[actualPoints.length - 1]?.label}
              stroke="#fbbf24"
              strokeWidth={2}
              strokeDasharray="4 3"
              opacity={0.6}
              label={{
                value: "Today",
                position: "top",
                fill: "#f59e0b",
                fontSize: 10,
              }}
            />
          )}
          
          {/* Gradient area for actual values */}
          <Area
            type="monotone"
            dataKey="actual"
            fill="url(#assetTrendGradient)"
            stroke="none"
            connectNulls={false}
            isAnimationActive={false}
          />
          
          {/* Actual line (solid) */}
          <Line
            {...CANONICAL_LINE_CONFIG}
            dataKey="actual"
            stroke="#10b981"
            dot={{ r: 4, fill: "#10b981", stroke: "#fff", strokeWidth: 2 }}
            connectNulls={false}
            isAnimationActive={false}
          />
          
          {/* Projected line (dashed) */}
          <Line
            type="monotone"
            dataKey="projected"
            stroke="#10b981"
            strokeWidth={2}
            strokeDasharray="5 4"
            strokeOpacity={0.45}
            dot={{ r: 4, fill: "#10b981", stroke: "#fff", strokeWidth: 2, opacity: 0.45 }}
            connectNulls={false}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
