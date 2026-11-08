/**
 * Asset Trend Chart SVG Component
 * Extracted from asset page for testability.
 * Renders actual + projected trend with date-based chronological x-axis.
 */

import type { TrendDataPoint } from "@/lib/assetTrendChart";

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
  const minValue = Math.min(...allValues);
  const maxValue = Math.max(...allValues);
  const valueRange = maxValue - minValue;
  const yMin = valueRange > 0 ? minValue - valueRange * 0.1 : minValue * 0.9;
  const yMax = valueRange > 0 ? maxValue + valueRange * 0.1 : maxValue * 1.1;

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
      {/* Y-axis grid lines and labels */}
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
              strokeWidth="1"
            />
            <text
              x={padding.left - 10}
              y={y}
              textAnchor="end"
              alignmentBaseline="middle"
              className="text-xs fill-gray-500"
              style={{ fontSize: '10px' }}
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
      
      {/* X-axis labels (chronological) */}
      {allPoints.map((d, i) => (
        <text
          key={`x-${i}`}
          data-testid={`x-label-${i}`}
          data-date={d.date}
          x={xScale(d.date)}
          y={height - padding.bottom + 20}
          textAnchor="middle"
          className={`text-xs ${d.isProjected ? 'fill-gray-500' : 'fill-gray-700'}`}
          style={{ fontSize: '10px' }}
        >
          {d.label}
        </text>
      ))}
      
      {/* Actual line path */}
      {actualPoints.length > 0 && (
        <>
          <path
            data-testid="actual-path"
            d={actualPoints
              .map((d, i) => `${i === 0 ? 'M' : 'L'} ${xScale(d.date)} ${yScale(d.value)}`)
              .join(' ')}
            fill="none"
            stroke="#8b5cf6"
            strokeWidth="3"
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
                r="5"
                fill="#8b5cf6"
                stroke="white"
                strokeWidth="2"
              />
              <title>{`${d.label}: ${formatCurrencyWithCents(d.value, currency)}`}</title>
            </g>
          ))}
        </>
      )}

      {/* Projected line path (dashed) */}
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
              stroke="#9ca3af"
              strokeWidth="2"
              strokeDasharray="4 3"
            />
          )}
          <path
            data-testid="projected-path"
            d={projectedPoints
              .map((d, i) => `${i === 0 ? 'M' : 'L'} ${xScale(d.date)} ${yScale(d.value)}`)
              .join(' ')}
            fill="none"
            stroke="#9ca3af"
            strokeWidth="2"
            strokeDasharray="4 3"
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
                fill="#9ca3af"
                stroke="white"
                strokeWidth="2"
              />
              <title>{`${d.label}: ${formatCurrency(d.value, currency)} (estimated)`}</title>
            </g>
          ))}
        </>
      )}
    </svg>
  );
}
