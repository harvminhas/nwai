/**
 * Shared Income Metrics — single source of truth for income calculations.
 * 
 * Used by both the Income page and Dashboard/Money Coach to ensure consistent numbers.
 * All income calculations respect the core-income toggle (excludes Transfer In, Other)
 * and use the same window/averaging logic.
 * 
 * Supports multiple time windows: last 3 months, 12-month average, year-to-date.
 * Detects one-off deposits (bonuses, unusual amounts) and excludes them from monthly averages.
 */

import type { MonthlyHistoryEntry } from "./financialProfile";
import type { IncomeTxnRecord } from "./extractTransactions";

export type IncomeTimeWindow = "last3" | "12month" | "ytd";

export interface IncomeSource {
  source: string;
  category?: string;
  amount: number;
  isOneOff?: boolean;
}

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

export interface DetailedIncomeMetrics extends IncomeMetrics {
  /** Income for specific time window */
  windowAmount: number;
  /** Window label: "last 3 months", "12-month avg", or "year-to-date" */
  windowLabel: string;
  /** Months used in this window */
  windowMonths: string[];
  /** Regular income sources (excluding one-offs) */
  regularSources: IncomeSource[];
  /** One-off income (bonuses, unusual amounts) */
  oneOffSources: IncomeSource[];
  /** Year-to-date total (regular + one-off) */
  ytdTotal: number;
  /** Year-to-date regular only */
  ytdRegular: number;
  /** Year-to-date one-off only */
  ytdOneOff: number;
  /** Projected full year (based on monthly average) */
  projectedFullYear: number;
}

/**
 * Detect if an income amount is a one-off (bonus, unusual deposit).
 * Heuristic: amount is >40% different from the median for this source.
 */
function isOneOffDeposit(
  amount: number,
  source: string,
  allTransactions: IncomeTxnRecord[]
): boolean {
  // Get all amounts from this source
  const sourceAmounts = allTransactions
    .filter(t => t.source === source)
    .map(t => t.amount)
    .filter(a => a > 0)
    .sort((a, b) => a - b);

  if (sourceAmounts.length <= 2) return false; // Need multiple data points

  // Compute median
  const mid = Math.floor(sourceAmounts.length / 2);
  const median = sourceAmounts.length % 2 !== 0
    ? sourceAmounts[mid]
    : (sourceAmounts[mid - 1] + sourceAmounts[mid]) / 2;

  if (median === 0) return false;

  // Check if this amount is >40% different from median
  const diffPct = Math.abs((amount - median) / median);
  return diffPct > 0.4;
}

/**
 * Get months for a specific time window.
 */
export function getMonthsForWindow(
  monthlyHistory: MonthlyHistoryEntry[],
  window: IncomeTimeWindow,
  currentYear: number
): string[] {
  const monthsWithIncome = monthlyHistory
    .filter(h => h.incomeTotal > 0)
    .map(h => h.yearMonth)
    .sort();

  if (monthsWithIncome.length === 0) return [];

  switch (window) {
    case "last3":
      return monthsWithIncome.slice(-3);
    
    case "12month":
      return monthsWithIncome.slice(-12);
    
    case "ytd": {
      const ytdStart = `${currentYear}-01`;
      return monthsWithIncome.filter(ym => ym >= ytdStart);
    }
    
    default:
      return monthsWithIncome.slice(-3);
  }
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
 * Compute detailed income metrics for a specific time window.
 * Includes one-off detection, sources breakdown, and year projections.
 */
export function computeDetailedIncomeMetrics(
  monthlyHistory: MonthlyHistoryEntry[],
  incomeTxns: IncomeTxnRecord[],
  window: IncomeTimeWindow,
  currentYear: number,
  useCoreOnly: boolean = true
): DetailedIncomeMetrics {
  // Get basic metrics
  const basic = computeIncomeMetrics(monthlyHistory, useCoreOnly);

  // Get months for this window
  const windowMonths = getMonthsForWindow(monthlyHistory, window, currentYear);
  
  if (windowMonths.length === 0) {
    return {
      ...basic,
      windowAmount: 0,
      windowLabel: "",
      windowMonths: [],
      regularSources: [],
      oneOffSources: [],
      ytdTotal: 0,
      ytdRegular: 0,
      ytdOneOff: 0,
      projectedFullYear: 0,
    };
  }

  // Filter transactions to window
  const windowTxns = incomeTxns.filter(t => windowMonths.includes(t.txMonth));

  // Group by source and detect one-offs
  const sourceMap = new Map<string, { amounts: number[]; category?: string; txns: IncomeTxnRecord[] }>();
  
  for (const txn of windowTxns) {
    const source = txn.source || "Unknown";
    const existing = sourceMap.get(source) || { amounts: [], category: txn.category, txns: [] };
    existing.amounts.push(txn.amount);
    existing.txns.push(txn);
    sourceMap.set(source, existing);
  }

  // Separate regular and one-off sources
  const regularSources: IncomeSource[] = [];
  const oneOffSources: IncomeSource[] = [];

  for (const [source, data] of sourceMap) {
    const total = data.amounts.reduce((sum, a) => sum + a, 0);
    const avgMonthly = total / windowMonths.length;

    // Check if any transaction from this source is a one-off
    const hasOneOff = data.txns.some(t => isOneOffDeposit(t.amount, source, incomeTxns));

    if (hasOneOff) {
      oneOffSources.push({
        source,
        category: data.category,
        amount: total,
        isOneOff: true,
      });
    } else {
      regularSources.push({
        source,
        category: data.category,
        amount: avgMonthly,
      });
    }
  }

  // Calculate window amount (regular income only, averaged per month)
  const windowAmount = Math.round(
    regularSources.reduce((sum, s) => sum + s.amount, 0)
  );

  // Window label
  let windowLabel: string;
  switch (window) {
    case "last3":
      windowLabel = "last 3 months";
      break;
    case "12month":
      windowLabel = "12-month avg";
      break;
    case "ytd":
      windowLabel = "year-to-date";
      break;
    default:
      windowLabel = `${windowMonths.length}-month avg`;
  }

  // Year-to-date calculations
  const ytdMonths = getMonthsForWindow(monthlyHistory, "ytd", currentYear);
  const ytdTxns = incomeTxns.filter(t => ytdMonths.includes(t.txMonth));
  
  const ytdRegularTxns = ytdTxns.filter(t => !isOneOffDeposit(t.amount, t.source, incomeTxns));
  const ytdOneOffTxns = ytdTxns.filter(t => isOneOffDeposit(t.amount, t.source, incomeTxns));
  
  const ytdRegular = ytdRegularTxns.reduce((sum, t) => sum + t.amount, 0);
  const ytdOneOff = ytdOneOffTxns.reduce((sum, t) => sum + t.amount, 0);
  const ytdTotal = ytdRegular + ytdOneOff;

  // Projected full year (regular income only)
  const monthsInYear = 12;
  const monthsElapsed = ytdMonths.length;
  const projectedFullYear = monthsElapsed > 0
    ? Math.round((ytdRegular / monthsElapsed) * monthsInYear + ytdOneOff)
    : windowAmount * monthsInYear;

  return {
    ...basic,
    windowAmount,
    windowLabel,
    windowMonths,
    regularSources: regularSources.sort((a, b) => b.amount - a.amount),
    oneOffSources: oneOffSources.sort((a, b) => b.amount - a.amount),
    ytdTotal,
    ytdRegular,
    ytdOneOff,
    projectedFullYear,
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
