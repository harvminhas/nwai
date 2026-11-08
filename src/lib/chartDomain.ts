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
 * 
 * Ensures changes are visible without misrepresenting amounts:
 * - Small ranges (< 5% of baseline): zoom in with conservative baseline
 * - Large ranges: standard 10% padding below, 5% above
 * - Rounds to thousands for clean labels
 * - Handles zeros, negatives, and sign-crossing
 * 
 * @param values - Array of numeric values to display
 * @returns Domain [min, max] for Y-axis
 */
export function calculateBalanceChartDomain(values: number[]): DomainResult {
  if (values.length === 0) {
    return { min: 0, max: 1000 };
  }

  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const range = maxValue - minValue;

  // Detect small changes on large balances
  const rangeIsSmall = range < Math.abs(minValue) * 0.05;

  // For small ranges: use conservative baseline (5% below min)
  // For large ranges: standard 10% padding, at least $1k
  const baseline = rangeIsSmall && minValue > 0
    ? minValue * 0.95
    : minValue - Math.max(range * 0.1, 1000);

  // Ceiling: 5% above for small ranges, standard for large
  const ceiling = maxValue + Math.max(range * 0.05, 500);

  // Round to thousands for clean axis labels
  const min = Math.floor(baseline / 1000) * 1000;
  const max = Math.ceil(ceiling / 1000) * 1000;

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
