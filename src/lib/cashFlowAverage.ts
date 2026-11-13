/**
 * One averaging rule for monthly cash flow.
 *
 * Which months count:
 * - Explicit `rangeMonths` (dashboard 3mo / 12mo / ytd / month:X) when provided
 * - Otherwise the last N complete months from `availableMonths` (default 3)
 * - The unfinished current month is excluded unless `includeCurrentMonth`
 * - $0-income months are included so leftover stays money in − money out
 *   over the same month set
 *
 * Rounding: none. Callers format for display.
 */

import { getCurrentMonth } from "./monthAnchor";

export type CashFlowAverageOptions = {
  /** Dashboard / page range months (YYYY-MM). Takes precedence over last-N. */
  rangeMonths?: string[];
  /** Last N complete months when rangeMonths is omitted. Default 3. */
  lastNComplete?: number;
  /** Include the unfinished current month. Default false. */
  includeCurrentMonth?: boolean;
  /** Override "now" (tests). Default getCurrentMonth(). */
  currentMonth?: string;
};

/** Arithmetic mean. Empty list is 0. No rounding. */
export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * Months that count toward a cash-flow average.
 * Current unfinished month is dropped unless includeCurrentMonth.
 * $0 months in the set are kept.
 */
export function monthsForCashFlowAverage(
  availableMonths: string[],
  options: CashFlowAverageOptions = {},
): string[] {
  const current = options.currentMonth ?? getCurrentMonth();
  const includeCurrent = options.includeCurrentMonth === true;
  const eligible = (m: string) => Boolean(m) && (includeCurrent || m < current);

  if (options.rangeMonths && options.rangeMonths.length > 0) {
    return [...new Set(options.rangeMonths.filter(eligible))].sort();
  }

  const complete = [...new Set(availableMonths.filter(eligible))].sort();
  const n = options.lastNComplete ?? 3;
  return complete.slice(-n);
}
