/**
 * Shared Income Metrics — single source of truth for income calculations.
 * 
 * Used by both the Income page and Dashboard/Money Coach to ensure consistent numbers.
 * All income calculations respect the core-income toggle (excludes Transfer In, Other)
 * and use the same window/averaging logic.
 */

import type { MonthlyHistoryEntry } from "./financialProfile";

export interface IncomeMetrics {
  /** Average monthly income across all available months */
  averageMonthly: number;
  /** Current run-rate: average of last 3 complete months, or falls back to overall average */
  currentMonthly: number;
  /** Number of months used for average calculation */
  monthsTracked: number;
  /** Number of months used for current run-rate */
  currentMonthsTracked: number;
  /** Label describing the current basis: "last 3 months" or "10-month avg" */
  currentBasisLabel: string;
  /** True when current differs materially from average (>10% difference) */
  currentDiffersFromAverage: boolean;
}

/**
 * Compute income metrics from monthly history.
 * Uses average (not median) to match Income page logic.
 * 
 * @param monthlyHistory - All monthly history entries from FinancialProfileCache
 * @param useCoreOnly - True to use incomeTotal (core only), false for all credits
 * @returns Income metrics with average and current run-rate
 */
export function computeIncomeMetrics(
  monthlyHistory: MonthlyHistoryEntry[],
  useCoreOnly: boolean = true
): IncomeMetrics {
  // Filter to months with positive income
  const monthsWithIncome = monthlyHistory.filter(h => {
    const income = useCoreOnly ? h.incomeTotal : (h.incomeTotalAllCredits ?? h.incomeTotal);
    return income > 0;
  });

  if (monthsWithIncome.length === 0) {
    return {
      averageMonthly: 0,
      currentMonthly: 0,
      monthsTracked: 0,
      currentMonthsTracked: 0,
      currentBasisLabel: "",
      currentDiffersFromAverage: false,
    };
  }

  // Compute overall average
  const allIncomeValues = monthsWithIncome.map(h =>
    useCoreOnly ? h.incomeTotal : (h.incomeTotalAllCredits ?? h.incomeTotal)
  );
  const averageMonthly = Math.round(
    allIncomeValues.reduce((sum, v) => sum + v, 0) / allIncomeValues.length
  );

  // Compute current run-rate (last 3 complete months)
  const recentMonths = monthsWithIncome.slice(-3);
  const recentValues = recentMonths.map(h =>
    useCoreOnly ? h.incomeTotal : (h.incomeTotalAllCredits ?? h.incomeTotal)
  );
  
  let currentMonthly: number;
  let currentMonthsTracked: number;
  let currentBasisLabel: string;

  if (recentMonths.length >= 2 && recentValues.length >= 2) {
    // Have at least 2 recent months - use recent average
    currentMonthly = Math.round(
      recentValues.reduce((sum, v) => sum + v, 0) / recentValues.length
    );
    currentMonthsTracked = recentValues.length;
    currentBasisLabel = recentValues.length === 3 ? "last 3 months" : "last 2 months";
  } else {
    // Not enough recent data - fall back to overall average
    currentMonthly = averageMonthly;
    currentMonthsTracked = allIncomeValues.length;
    currentBasisLabel = `${allIncomeValues.length}-month avg`;
  }

  // Check if current differs materially from average (>10% difference)
  const diffPct = averageMonthly > 0 
    ? Math.abs((currentMonthly - averageMonthly) / averageMonthly) 
    : 0;
  const currentDiffersFromAverage = diffPct > 0.1 && currentMonthly !== averageMonthly;

  return {
    averageMonthly,
    currentMonthly,
    monthsTracked: allIncomeValues.length,
    currentMonthsTracked,
    currentBasisLabel,
    currentDiffersFromAverage,
  };
}

/**
 * Get income value to use for money coach calculations.
 * Returns current run-rate (recent 3 months) when available,
 * otherwise falls back to overall average.
 */
export function getMoneyCoachIncome(monthlyHistory: MonthlyHistoryEntry[]): {
  amount: number;
  basisLabel: string;
} {
  const metrics = computeIncomeMetrics(monthlyHistory, true);
  return {
    amount: metrics.currentMonthly,
    basisLabel: metrics.currentBasisLabel,
  };
}
