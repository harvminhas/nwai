/**
 * Asset Trend Chart SVG Component
 * Extracted from asset page for testability.
 * Renders actual + projected trend with date-based chronological x-axis.
 */

import type { TrendDataPoint } from "@/lib/assetTrendChart";
import { calculateBalanceChartDomain } from "@/lib/chartDomain";

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
  const allPoints = [...actualPoints, ...projectedPoints];
  const allValues = allPoints.map(p => p.value);
  
  // Use shared domain calculation for consistency with canonical balance charts
  // Handles all-zero, small ranges, and large ranges appropriately
  const domain = calculateBalanceChartDomain(allValues);
  const yMin = domain.min;
  const yMax = domain.max;

  const width = 800;
  const height = 300;
  const padding = { top: 20, right: 20, bottom: 40, left: 80 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  // Date-based x-axis scale (chronological)
  const allDates = allPoints.map(p => new Date(p.date).getTime());
  const minDate = Math.min(...allDates);
  const maxDate = Math.max(...allDates);
  const dateRange = maxDate - minDate;
  
  const xScale = (dateStr: string) => {
    const dateMs = new Date(dateStr).getTime();
    if (dateRange === 0) return padding.left + chartWidth / 2;
    return padding.left + ((dateMs - minDate) / dateRange) * chartWidth;
  };
  
  const yScale = (value: number) => 
    padding.top + chartHeight - ((value - yMin) / (yMax - yMin)) * chartHeight;

  const yTicks = 5;
  const yTickValues = Array.from({ length: yTicks }, (_, i) => 
    yMin + (i / (yTicks - 1)) * (yMax - yMin)
  );

  return (
    <svg 
      viewBox={`0 0 ${width} ${height}`} 
      className="w-full h-auto"
      style={{ minWidth: '600px', maxHeight: '300px' }}
      data-testid="trend-chart-svg"
    >
      {/* Gradient definition - canonical emerald green */}
      <defs>
        <linearGradient id="assetTrendGradient" x1="0" y1="0" x2="0" y2="1">
          <stop offset="5%" stopColor="#10b981" stopOpacity={0.15}/>
          <stop offset="95%" stopColor="#10b981" stopOpacity={0.02}/>
        </linearGradient>
      </defs>
      {/* Y-axis grid lines and labels - canonical style */}
      {yTickValues.map((tickValue, i) => {
        const y = yScale(tickValue);
        return (
          <g key={i}>
            <line
              x1={padding.left}
              y1={y}
              x2={width - padding.right}
              y2={y}
              stroke="#e5e7eb"
              strokeDasharray="3 3"
              strokeWidth="1"
            />
            <text
              x={padding.left - 10}
              y={y}
              textAnchor="end"
              alignmentBaseline="middle"
              className="text-xs fill-gray-600"
              fontSize="12"
            >
              {formatCurrency(tickValue, currency)}
            </text>
          </g>
        );
      })}
      
      {/* Today marker line (vertical dashed) */}
      {projectedPoints.length > 0 && (
        <line
          data-testid="today-marker"
          x1={xScale(todayDate)}
          y1={padding.top}
          x2={xScale(todayDate)}
          y2={height - padding.bottom}
          stroke="#fbbf24"
          strokeWidth="2"
          strokeDasharray="4 3"
          opacity="0.6"
        />
      )}
      
      {/* X-axis labels - canonical 12px */}
      {allPoints.map((d, i) => (
        <text
          key={`x-${i}`}
          data-testid={`x-label-${i}`}
          data-date={d.date}
          x={xScale(d.date)}
          y={height - padding.bottom + 20}
          textAnchor="middle"
          className="text-xs fill-gray-600"
          fontSize="12"
        >
          {d.label}
        </text>
      ))}
      
      {/* Actual line path with gradient fill - canonical emerald green */}
      {actualPoints.length > 0 && (
        <>
          {/* Gradient area fill */}
          <path
            data-testid="actual-area"
            d={`
              M ${xScale(actualPoints[0].date)} ${height - padding.bottom}
              ${actualPoints.map(d => `L ${xScale(d.date)} ${yScale(d.value)}`).join(' ')}
              L ${xScale(actualPoints[actualPoints.length - 1].date)} ${height - padding.bottom}
              Z
            `}
            fill="url(#assetTrendGradient)"
            stroke="none"
          />
          <path
            data-testid="actual-path"
            d={actualPoints
              .map((d, i) => `${i === 0 ? 'M' : 'L'} ${xScale(d.date)} ${yScale(d.value)}`)
              .join(' ')}
            fill="none"
            stroke="#10b981"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {actualPoints.map((d, i) => (
            <g key={`actual-${i}`}>
              <circle
                data-testid={`actual-point-${i}`}
                data-date={d.date}
                data-value={d.value}
                cx={xScale(d.date)}
                cy={yScale(d.value)}
                r="4"
                fill="#10b981"
                stroke="#fff"
                strokeWidth="2"
              />
              <title>{`${d.label}: ${formatCurrencyWithCents(d.value, currency)}`}</title>
            </g>
          ))}
        </>
      )}

      {/* Projected line path (dashed) - canonical emerald green dashed */}
      {projectedPoints.length > 0 && (
        <>
          {/* Connect last actual to first projected */}
          {actualPoints.length > 0 && (
            <line
              data-testid="connector-line"
              x1={xScale(actualPoints[actualPoints.length - 1].date)}
              y1={yScale(actualPoints[actualPoints.length - 1].value)}
              x2={xScale(projectedPoints[0].date)}
              y2={yScale(projectedPoints[0].value)}
              stroke="#10b981"
              strokeWidth="2"
              strokeDasharray="5 4"
              strokeOpacity="0.45"
            />
          )}
          <path
            data-testid="projected-path"
            d={projectedPoints
              .map((d, i) => `${i === 0 ? 'M' : 'L'} ${xScale(d.date)} ${yScale(d.value)}`)
              .join(' ')}
            fill="none"
            stroke="#10b981"
            strokeWidth="2"
            strokeDasharray="5 4"
            strokeOpacity="0.45"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {projectedPoints.map((d, i) => (
            <g key={`proj-${i}`}>
              <circle
                data-testid={`projected-point-${i}`}
                data-date={d.date}
                data-value={d.value}
                cx={xScale(d.date)}
                cy={yScale(d.value)}
                r="4"
                fill="#10b981"
                stroke="#fff"
                strokeWidth="2"
                opacity="0.45"
              />
              <title>{`${d.label}: ${formatCurrency(d.value, currency)} (estimated)`}</title>
            </g>
          ))}
        </>
      )}
    </svg>
  );
}
