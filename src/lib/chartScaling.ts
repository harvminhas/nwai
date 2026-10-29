/**
 * Chart point scaling utilities for balance line charts.
 * Handles edge cases: empty data, single point, constant values, non-finite values.
 */

export interface ChartPoint {
  x: number;
  y: number;
  month: string;
  monthLabel: string;
  balance: number;
}

export interface ChartDimensions {
  chartWidth: number;
  chartHeight: number;
  padding: { top: number; right: number; bottom: number; left: number };
}

/**
 * Scale balance history to chart coordinates.
 * 
 * Handles edge cases:
 * - Empty history: returns empty array
 * - Single point: centers it at (width/2, height/2)
 * - Constant values (max === min): creates artificial range
 * - Non-finite values: filters them out
 * - NaN prevention: returns center point as fallback
 */
export function scaleBalancePoints(
  history: Array<{ month: string; monthLabel: string; balance: number }>,
  dimensions: ChartDimensions,
  isDebt: boolean
): ChartPoint[] {
  // Filter non-finite and sort
  const validHistory = history
    .filter(h => Number.isFinite(h.balance))
    .sort((a, b) => a.month.localeCompare(b.month));
  
  if (validHistory.length === 0) {
    return [];
  }
  
  const { chartWidth, chartHeight, padding } = dimensions;
  const plotWidth = chartWidth - padding.left - padding.right;
  const plotHeight = chartHeight - padding.top - padding.bottom;
  
  // Calculate value range
  const values = validHistory.map(h => Math.abs(h.balance));
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const range = maxValue - minValue;
  
  // Guard against constant values (max === min)
  const hasVariation = range > 0.01;
  
  let paddedMin: number;
  let paddedMax: number;
  let effectiveRange: number;
  
  if (hasVariation) {
    paddedMin = Math.max(0, minValue - (range * 0.05));
    paddedMax = maxValue + (range * 0.05);
    effectiveRange = paddedMax - paddedMin;
  } else {
    // All values same - create artificial range
    const value = minValue;
    paddedMin = Math.max(0, value * 0.9);
    paddedMax = value * 1.1;
    effectiveRange = paddedMax - paddedMin;
  }
  
  // Scale points
  return validHistory.map((entry, idx) => {
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
}
