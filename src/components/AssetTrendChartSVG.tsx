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
  // Timestamp-keyed coalesced sorted rows for proper time-based x-axis
  const rowsByDate = new Map<string, { timestamp: number; label: string; actual: number | null; projected: number | null }>();
  
  // Add actual points
  actualPoints.forEach(p => {
    const timestamp = new Date(p.date).getTime();
    rowsByDate.set(p.date, {
      timestamp,
      label: p.label,
      actual: p.value,
      projected: null,
    });
  });
  
  // Seed projected with actual anchor row (last actual) for connection
  if (actualPoints.length > 0 && projectedPoints.length > 0) {
    const lastActual = actualPoints[actualPoints.length - 1];
    const firstProj = projectedPoints[0];
    
    // If projected doesn't start at last actual date, add anchor
    if (lastActual.date !== firstProj.date) {
      const anchorTimestamp = new Date(lastActual.date).getTime();
      rowsByDate.set(lastActual.date, {
        timestamp: anchorTimestamp,
        label: lastActual.label,
        actual: lastActual.value,
        projected: lastActual.value, // Anchor: same value for connection
      });
    }
  }
  
  // Add projected points
  projectedPoints.forEach(p => {
    const timestamp = new Date(p.date).getTime();
    const existing = rowsByDate.get(p.date);
    if (existing) {
      // Same-date coalescing
      existing.projected = p.value;
    } else {
      rowsByDate.set(p.date, {
        timestamp,
        label: p.label,
        actual: null,
        projected: p.value,
      });
    }
  });
  
  // Sort by timestamp chronologically
  const chartData = Array.from(rowsByDate.values()).sort((a, b) => a.timestamp - b.timestamp);
  
  const allValues = [...actualPoints, ...projectedPoints].map(p => p.value);
  const domain = calculateBalanceChartDomain(allValues);
  
  // Today marker at actual UTC timestamp
  const todayTimestamp = new Date(todayDate).getTime();

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
          
          {/* Numeric UTC time-based XAxis for proper date proportions */}
          <XAxis
            dataKey="timestamp"
            type="number"
            domain={['dataMin', 'dataMax']}
            tickFormatter={(timestamp: number) => {
              const row = chartData.find(d => d.timestamp === timestamp);
              return row?.label ?? '';
            }}
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
              const hasProjected = data.payload.projected != null;
              const value = (data.payload.actual ?? data.payload.projected) as number;
              return (
                <div className="bg-white border border-gray-200 rounded-lg shadow-lg px-3 py-2">
                  <p className="text-xs text-gray-600 mb-1">{data.payload.label}</p>
                  <p className="text-sm font-semibold text-gray-900">
                    {formatCurrencyWithCents(value, currency)}
                    {!data.payload.actual && hasProjected && (
                      <span className="text-xs text-gray-500 ml-1">(estimated)</span>
                    )}
                  </p>
                </div>
              );
            }}
          />
          
          {/* Today marker at actual UTC timestamp */}
          {projectedPoints.length > 0 && (
            <ReferenceLine
              x={todayTimestamp}
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
          
          {/* Actual line (solid) - anchor row has both actual and projected */}
          <Line
            {...CANONICAL_LINE_CONFIG}
            dataKey="actual"
            stroke="#10b981"
            dot={{ r: 4, fill: "#10b981", stroke: "#fff", strokeWidth: 2 }}
            connectNulls={false}
            isAnimationActive={false}
          />
          
          {/* Projected line (dashed) - anchor row connects via shared x/y */}
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
