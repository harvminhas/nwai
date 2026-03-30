/**
 * Canonical definitions for "typical monthly spending".
 *
 * CORE_EXCLUDE_RE is the single source of truth for which expense categories
 * are excluded when computing discretionary spending (used by the consolidated
 * API's coreExpensesTotal, the insights route, and any future consumer).
 *
 * Rule: if you change this regex you change what "Typical Month" means everywhere.
 */

import type { ExpenseTxnRecord } from "./extractTransactions";

export const CORE_EXCLUDE_RE =
  /^(transfers|transfers & payments)$/i;

export interface TypicalSpend {
  /** Median monthly core spend across all tracked months. */
  median: number;
  /** Mean monthly core spend across all tracked months. */
  avg: number;
  /** Number of historical months used (excludes currentMonth). */
  monthsTracked: number;
}

/**
 * Compute typical (median + avg) monthly discretionary spending from a flat
 * list of expense transactions. Uses CORE_EXCLUDE_RE to strip transfers, debt
 * payments, and investment transfers — matching the `coreExpensesTotal` the
 * consolidated API stores in its history array.
 *
 * @param expenseTxns   Output of extractAllTransactions() — already balance-marker filtered.
 * @param currentMonth  "YYYY-MM" for the current billing period (excluded from history).
 */
export function computeTypicalSpend(
  expenseTxns: ExpenseTxnRecord[],
  currentMonth: string
): TypicalSpend {
  const coreTxns = expenseTxns.filter(
    (t) => !CORE_EXCLUDE_RE.test((t.category ?? "").trim())
  );

  const allMonths = Array.from(new Set(coreTxns.map((t) => t.txMonth))).sort();
  const historicalMonths = allMonths.filter((m) => m < currentMonth);

  if (historicalMonths.length === 0) {
    // Fall back to current month if no history
    const currentTotal = coreTxns
      .filter((t) => t.txMonth === currentMonth)
      .reduce((s, t) => s + t.amount, 0);
    return { median: currentTotal, avg: currentTotal, monthsTracked: 0 };
  }

  const monthTotals = historicalMonths
    .map((m) => coreTxns.filter((t) => t.txMonth === m).reduce((s, t) => s + t.amount, 0))
    .filter((v) => v > 0);

  if (monthTotals.length === 0) {
    return { median: 0, avg: 0, monthsTracked: 0 };
  }

  const sorted = [...monthTotals].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 !== 0
      ? sorted[mid]
      : (sorted[mid - 1] + sorted[mid]) / 2;
  const avg = monthTotals.reduce((s, v) => s + v, 0) / monthTotals.length;

  return { median, avg, monthsTracked: monthTotals.length };
}
