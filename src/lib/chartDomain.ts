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

  // Padding strategy: make all changes visible with magnitude/range-proportional padding
  let baseline: number;
  let ceiling: number;
  
  if (range === 0) {
    // Flat series: create artificial range for visibility
    const artificial = Math.max(Math.abs(maxValue) * 0.05, 100);
    baseline = maxValue - artificial;
    ceiling = maxValue + artificial;
  } else {
    // Magnitude/range-proportional padding for ALL branches
    // Key: use range itself for padding when it's small relative to total span needed
    const avgMagnitude = (Math.abs(minValue) + Math.abs(maxValue)) / 2;
    
    // Detect small range: either absolutely small OR small relative to magnitude
    const isAbsolutelySmall = range < 100; // [10,11], [20,21]
    const isRelativelySmall = range < avgMagnitude * 0.05; // [100k, 100.1k]
    
    if (isAbsolutelySmall || isRelativelySmall) {
      // Small range: use 5x padding each side (10x total span)
      // This makes the range occupy ~9% of chart height (1/11)
      const padFactor = 5;
      baseline = minValue - range * padFactor;
      ceiling = maxValue + range * padFactor;
    } else {
      // Large visible range: use percentage-based padding
      // Cap minimums to avoid excessive padding on large magnitudes
      const lowerPad = Math.max(range * 0.1, Math.min(avgMagnitude * 0.02, 1000));
      const upperPad = Math.max(range * 0.05, Math.min(avgMagnitude * 0.01, 500));
      baseline = minValue - lowerPad;
      ceiling = maxValue + upperPad;
    }
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

export type ChartAxisPrecision = "default" | "distinct";

/**
 * Million-tick decimals so ~4 ticks across `domain` stay unique.
 * Desktop canonical formatting stays 1 decimal; this is for tight phone scales.
 */
export function millionDecimalsForDomain(min: number, max: number): number {
  const range = Math.abs(max - min);
  const step = range / 1_000_000 / 4;
  if (step >= 0.1) return 1;
  if (step >= 0.01) return 2;
  return 3;
}

/**
 * Format Y-axis tick labels for currency values.
 * Matches canonical chart formatting: $1M, $500k, or full amount for small values.
 *
 * Pass `{ precision: "distinct", domain }` on narrow viewports so nearby ticks
 * (e.g. CA$1.22M vs CA$1.28M) do not round to the same 1-decimal label.
 */
export function formatChartAxisValue(
  value: number,
  currencySymbol: string = "$",
  options?: { precision?: ChartAxisPrecision; domain?: DomainResult }
): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  const distinct = options?.precision === "distinct";
  const domain = options?.domain;

  if (abs >= 1_000_000) {
    const decimals =
      distinct && domain
        ? millionDecimalsForDomain(domain.min, domain.max)
        : 1;
    return `${sign}${currencySymbol}${(abs / 1_000_000).toFixed(decimals)}M`;
  }
  if (abs >= 1_000) {
    if (distinct && domain && Math.abs(domain.max - domain.min) < 10_000) {
      return `${sign}${currencySymbol}${(abs / 1_000).toFixed(1)}k`;
    }
    return `${sign}${currencySymbol}${Math.round(abs / 1_000)}k`;
  }
  return `${sign}${currencySymbol}${abs}`;
}
