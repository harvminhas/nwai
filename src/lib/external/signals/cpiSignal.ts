/**
 * Pure personalization function for CPI / inflation signals.
 *
 * Input:  FinancialProfileCache + ExternalDataPoint
 * Output: personalized context used to build the insight card body
 *
 * No DB calls. No side effects.
 */

import type { FinancialProfileCache } from "@/lib/financialProfile";
import type { ExternalDataPoint } from "../types";

export interface CpiSignalContext {
  /** Official CPI year-over-year % change */
  yoyChange: number;
  /** User's core spending % change over the same window — null if insufficient history */
  userSpendChange: number | null;
  /** Signed difference: user spend change − CPI. Positive = user outpacing inflation */
  spendVsInflation: number | null;
  /** Average monthly core spend over last 3 months */
  recentMonthlySpend: number | null;
  /** Whether we have enough history to make a meaningful comparison (≥ 12 months) */
  hasYoyHistory: boolean;
}

export function personalizeCpiSignal(
  profile: FinancialProfileCache,
  point: ExternalDataPoint,
): CpiSignalContext {
  const yoyChange = point.value; // ExternalDataPoint.value holds the YoY % for CPI

  const sorted = [...profile.monthlyHistory].sort((a, b) =>
    a.yearMonth.localeCompare(b.yearMonth),
  );

  // Need at least 12 months of history for a year-over-year comparison
  if (sorted.length < 12) {
    return {
      yoyChange,
      userSpendChange: null,
      spendVsInflation: null,
      recentMonthlySpend: null,
      hasYoyHistory: false,
    };
  }

  // Last 3 months vs same 3 months 12 months prior
  const recentSlice = sorted.slice(-3);
  const yearAgoSlice = sorted.slice(-15, -12);

  const recentAvg =
    recentSlice.reduce((s, m) => s + m.coreExpensesTotal, 0) / recentSlice.length;
  const yearAgoAvg =
    yearAgoSlice.length > 0
      ? yearAgoSlice.reduce((s, m) => s + m.coreExpensesTotal, 0) / yearAgoSlice.length
      : 0;

  const userSpendChange =
    yearAgoAvg > 0
      ? +((((recentAvg - yearAgoAvg) / yearAgoAvg) * 100).toFixed(1))
      : null;

  const spendVsInflation =
    userSpendChange !== null
      ? +(userSpendChange - yoyChange).toFixed(1)
      : null;

  return {
    yoyChange,
    userSpendChange,
    spendVsInflation,
    recentMonthlySpend: Math.round(recentAvg),
    hasYoyHistory: true,
  };
}
