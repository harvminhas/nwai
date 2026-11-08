/**
 * Shared chart domain calculation utilities
 * Based on canonical /account/net-worth chart implementation
 */

export interface DomainResult {
  min: number;
  max: number;
}

/**
 * Calculate adaptive Y-axis domain for balance/value charts.
 * Based on canonical /account/net-worth implementation (page.tsx:372-383)
 * 
 * Strategy:
 * - Small ranges (< 5% of baseline): zoom in with 95% baseline
 * - Large ranges: 10% padding below (min $1k), 5% padding above (min $500)
 * - Rounds to thousands for values >= $1k
 * - For small values < $1k: uses magnitude-aware steps
 * - Filters NaN and infinite values
 * 
 * @param values - Array of numeric values to display
 * @param options - Optional configuration
 * @returns Domain [min, max] for Y-axis
 */
export function calculateBalanceChartDomain(
  values: number[],
  options?: { forceZeroBaseline?: boolean }
): DomainResult {
  // Filter out NaN and infinite values
  const validValues = values.filter(v => Number.isFinite(v));
  
  if (validValues.length === 0) {
    return { min: 0, max: 1000 };
  }

  const minValue = Math.min(...validValues);
  const maxValue = Math.max(...validValues);
  const range = maxValue - minValue;

  // For stacked bar charts (income trends), always baseline at zero
  if (options?.forceZeroBaseline && minValue >= 0) {
    // Use 5% padding above max, minimum $500
    const ceiling = maxValue + Math.max(range * 0.05, 500);
    const max = Math.ceil(ceiling / 1000) * 1000;
    return { min: 0, max };
  }

  // Detect small changes on large balances (< 5% of absolute baseline)
  const rangeIsSmall = range < Math.abs(minValue) * 0.05;

  // Canonical padding strategy from net-worth page
  // Small ranges: 95% baseline (zoom in to show small changes)
  // Large ranges: 10% below with $1k minimum padding
  const baseline = rangeIsSmall && minValue > 0
    ? minValue * 0.95
    : minValue - Math.max(range * 0.1, 1000);

  // Ceiling: 5% above with $500 minimum padding
  const ceiling = maxValue + Math.max(range * 0.05, 500);

  // Rounding strategy: thousands for large values, intelligent steps for small
  let min: number;
  let max: number;

  const absMax = Math.abs(maxValue);
  
  if (absMax >= 1000) {
    // Large values: round to thousands (canonical behavior)
    min = Math.floor(baseline / 1000) * 1000;
    max = Math.ceil(ceiling / 1000) * 1000;
  } else if (absMax >= 100) {
    // Medium values ($100-$999): round to $100
    min = Math.floor(baseline / 100) * 100;
    max = Math.ceil(ceiling / 100) * 100;
  } else if (absMax >= 10) {
    // Small values ($10-$99): round to $10
    min = Math.floor(baseline / 10) * 10;
    max = Math.ceil(ceiling / 10) * 10;
  } else {
    // Very small values (< $10): round to $1
    min = Math.floor(baseline);
    max = Math.ceil(ceiling);
  }

  // Safety: ensure non-zero range
  if (max <= min) {
    max = min + (absMax >= 1000 ? 1000 : absMax >= 100 ? 100 : 10);
  }

  return { min, max };
}

/**
 * Format Y-axis tick labels for currency values.
 * Matches canonical chart formatting: $1M, $500k, or full amount for small values.
 * 
 * @param value - Numeric value to format
 * @param currencySymbol - Currency symbol (e.g., "$", "CA$")
 * @returns Formatted string
 */
export function formatChartAxisValue(value: number, currencySymbol: string = "$"): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  
  if (abs >= 1_000_000) {
    return `${sign}${currencySymbol}${(abs / 1_000_000).toFixed(1)}M`;
  }
  if (abs >= 1_000) {
    return `${sign}${currencySymbol}${Math.round(abs / 1_000)}k`;
  }
  return `${sign}${currencySymbol}${abs}`;
}
