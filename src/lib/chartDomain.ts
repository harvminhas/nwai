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

  // Padding strategy: make small changes visible without excessive padding
  // Key insight: padding should be proportional to range for visibility
  let baseline: number;
  let ceiling: number;
  
  if (range === 0) {
    // Flat series: create artificial range for visibility
    const artificial = Math.max(Math.abs(maxValue) * 0.05, 100);
    baseline = maxValue - artificial;
    ceiling = maxValue + artificial;
  } else if (range < Math.abs(minValue) * 0.05) {
    // Small range on large balance: use range-proportional padding
    // For $100 change on $100k, use ~10x range as total span
    // This gives ~9% height to the $100 change (visible!)
    const padFactor = 5; // Each side gets 5x range padding
    baseline = minValue - range * padFactor;
    ceiling = maxValue + range * padFactor;
  } else {
    // Large ranges: standard percentage padding
    baseline = minValue - Math.max(range * 0.1, 1000);
    ceiling = maxValue + Math.max(range * 0.05, 500);
  }

  // Range-informed rounding: step size based on range magnitude, not just baseline
  // This ensures $100k + $100 change is visible, not lost to thousand-rounding
  let min: number;
  let max: number;
  
  // Determine step size from range magnitude
  const rangeForSteps = Math.max(range, Math.abs(maxValue) * 0.01); // At least 1% of max
  let step: number;
  
  if (rangeForSteps >= 10000) {
    step = 1000; // Large ranges: round to thousands
  } else if (rangeForSteps >= 1000) {
    step = 100; // Medium ranges: round to hundreds  
  } else if (rangeForSteps >= 100) {
    step = 10; // Small ranges: round to tens
  } else {
    step = 1; // Tiny ranges: round to ones
  }
  
  min = Math.floor(baseline / step) * step;
  max = Math.ceil(ceiling / step) * step;

  // Safety: ensure non-zero range
  if (max <= min) {
    max = min + step;
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
