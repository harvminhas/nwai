/**
 * Canonical definitions for "typical monthly spending".
 *
 * CORE_EXCLUDE_RE matches transfers + interest only (category/parent string test).
 * Debt servicing uses {@link isCoreExcluded}: **Card Servicing** (revolving settlement)
 * is excluded from core totals; **Installment Servicing** is included — avoids double-counting
 * card purchases while keeping mortgage/auto/student installment cash visible.
 *
 * Rule: if you change exclusion logic you change what "Typical Month" means everywhere.
 */

import type { ExpenseTxnRecord } from "./extractTransactions";
import { getParentCategory } from "./categoryTaxonomy";
import { resolveDebtServicingKind } from "./debtServicing";

/**
 * Transfers + interest — tested against category OR parent display name.
 * Does **not** include debt servicing (handled by {@link isCoreExcluded}).
 */
export const CORE_EXCLUDE_RE =
  /^(transfers|transfers & payments|transfer out|transfer in|interest)$/i;

export type CoreExcludeOpts = {
  debtType?: string;
  merchant?: string;
  /** Category rollup rows without txn metadata — legacy "Debt Payments" bucket stays conservative */
  forAggregateLabel?: boolean;
};

/**
 * Returns true when a transaction should be excluded from core spending totals.
 * Uses parent category for transfers; debt servicing uses installment vs card routing.
 */
export function isCoreExcluded(category: string, opts?: CoreExcludeOpts): boolean {
  const catTrim = category.trim();
  const parent = getParentCategory(catTrim);

  if (/^interest$/i.test(catTrim)) return true;

  if (CORE_EXCLUDE_RE.test(catTrim) || CORE_EXCLUDE_RE.test(parent.trim())) {
    return true;
  }

  const kind = resolveDebtServicingKind(
    catTrim,
    opts?.debtType,
    opts?.merchant,
    opts?.forAggregateLabel === true,
  );
  return kind === "card";
}

/**
 * Income transfer filter — single source of truth for detecting inter-account
 * deposits that should NOT count as income.
 *
 * Matches common bank abbreviations: TFR-TO, TFR-FR, TFR-FROM, E-TFR, XFER,
 * ETFR, as well as the AI-assigned category "Transfer In".
 *
 * Rule: if you change this you change what counts as income everywhere.
 */
export const INCOME_TRANSFER_RE =
  /\bTFR[-\s]?(TO|FR|FROM)\b|\bE[-\s]?TFR\b|\bETFR\b|\bXFER\b|\bTRANSFER\b/i;

export interface TypicalSpend {
  /** Median monthly core spend across all historical months. */
  median: number;
  /** Mean monthly core spend across all historical months. */
  avg: number;
  /** Number of historical months used (excludes currentMonth). */
  monthsTracked: number;
}

/**
 * Compute typical (median + avg) monthly discretionary spending from a flat
 * list of expense transactions — matches `coreExpensesTotal` in the profile cache.
 *
 * @param expenseTxns   Output of extractAllTransactions() — already balance-marker filtered.
 * @param currentMonth  "YYYY-MM" for the current billing period (excluded from history).
 */
export function computeTypicalSpend(
  expenseTxns: ExpenseTxnRecord[],
  currentMonth: string
): TypicalSpend {
  const coreTxns = expenseTxns.filter(
    (t) =>
      !isCoreExcluded(t.category ?? "", {
        debtType: t.debtType,
        merchant: t.merchant,
      })
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
