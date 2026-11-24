/**
 * Canonical definitions for monthly spending.
 *
 * {@link computeMonthSpending} is the only function that totals a month and
 * its line items. Dashboard headline, typical month, Spending page, cash flow
 * money out, chat/insights, and drawers all call it (directly or through
 * spendingForMonth / computeMonthlyBuckets).
 *
 * What counts as spending:
 * - Everyday purchases, rent/housing, insurance, subscriptions, utilities
 * - Other/uncategorized outflows, and bank Fees
 * - Installment Servicing (the actual loan payment that left the account)
 *
 * What does not:
 * - Transfers, Card Servicing (credit-card payments), Interest
 * - Investments & Savings, Asset purchase, balance-marker rows
 *
 * Interest stays excluded: it is a finance charge on balances whose purchases
 * are already counted, and no surface currently shows it as spending.
 *
 * Loans use actual installment transactions, never scheduled/estimated
 * payments. Card purchases are already in their categories; counting the card
 * payment or a scheduled minimum would double-count. Asset purchases are
 * excluded, so counting the installment cash-out does not also count the
 * thing the loan financed.
 *
 * Rule: if you change exclusion logic you change what spending means everywhere.
 */

import { isBalanceMarker } from "./balanceMarkers";
import { completeMonthsWithData } from "./cashFlowAverage";
import { toHome } from "./currencyUtils";
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
 * True for Investments & Savings and Asset purchase (parent or subtype).
 * Stocks/crypto stay under Investments & Savings — they are not Asset purchase.
 */
export function isNonSpendingGroup(category: string): boolean {
  const parent = getParentCategory(category);
  return parent === "Investments & Savings" || parent === "Asset purchase";
}

/**
 * Transfers, interest, and Card Servicing — the original core-exclude set,
 * without non-spending groups. Used when those groups still need to be
 * collected for "Into assets" display.
 */
export function isTransferInterestOrCardServicing(
  category: string,
  opts?: CoreExcludeOpts,
): boolean {
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
 * Single exclusion for "is this spending?". Covers everything
 * {@link isTransferInterestOrCardServicing} covers PLUS non-spending groups
 * (Asset purchase and Investments & Savings).
 *
 * {@link computeMonthSpending} is the only place that sums a month — this
 * predicate is what it uses to decide whether a row is spending.
 */
export function isNotSpending(category: string, opts?: CoreExcludeOpts): boolean {
  return isTransferInterestOrCardServicing(category, opts) || isNonSpendingGroup(category);
}

/**
 * Returns true when a transaction should be excluded from core spending totals.
 * Delegates to {@link isNotSpending} — one exclusion function everywhere.
 */
export function isCoreExcluded(category: string, opts?: CoreExcludeOpts): boolean {
  return isNotSpending(category, opts);
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
 * Minimal transaction shape {@link computeMonthSpending} needs.
 * {@link ExpenseTxnRecord} and statement {@link ExpenseTransaction} both fit.
 */
export type SpendingTxnLike = {
  amount: number;
  category?: string;
  merchant?: string;
  debtType?: string;
  currency?: string | null;
  txMonth?: string;
  date?: string;
  accountSlug?: string;
};

export type MonthSpendingOptions = {
  homeCurrency?: string;
  fxRates?: Record<string, number>;
};

export type MonthSpendingLine = {
  category: string;
  amount: number;
  transactions: SpendingTxnLike[];
};

export type MonthSpending = {
  yearMonth: string;
  /** Sum of every spending line. Same figure every surface uses for this month. */
  total: number;
  lines: MonthSpendingLine[];
};

function txnMonth(txn: SpendingTxnLike, fallback: string): string {
  return txn.txMonth || txn.date?.slice(0, 7) || fallback;
}

function spendingAmount(txn: SpendingTxnLike, options?: MonthSpendingOptions): number {
  const native = Math.abs(txn.amount);
  if (!options?.homeCurrency && !options?.fxRates) return native;
  return Math.abs(
    toHome(txn.amount, txn.currency, {
      homeCurrency: options.homeCurrency,
      fxRates: options.fxRates,
    }),
  );
}

/**
 * One month of spending and its line items.
 *
 * Dashboard headline, typical month, Spending buckets, cash flow money out,
 * chat/insights, and drawers must all call this (or a wrapper that does).
 */
export function computeMonthSpending(
  yearMonth: string,
  expenseTxns: readonly SpendingTxnLike[],
  options?: MonthSpendingOptions,
): MonthSpending {
  const linesByCategory = new Map<string, MonthSpendingLine>();
  let total = 0;

  for (const txn of expenseTxns) {
    if (txnMonth(txn, yearMonth) !== yearMonth) continue;
    if (isBalanceMarker(txn.merchant ?? "")) continue;
    if (
      isNotSpending(txn.category ?? "", {
        debtType: txn.debtType,
        merchant: txn.merchant,
      })
    ) {
      continue;
    }
    const amount = spendingAmount(txn, options);
    if (amount <= 0) continue;
    total += amount;
    const category = (txn.category ?? "Other").trim() || "Other";
    const existing = linesByCategory.get(category);
    if (existing) {
      existing.amount += amount;
      existing.transactions.push(txn);
    } else {
      linesByCategory.set(category, {
        category,
        amount,
        transactions: [txn],
      });
    }
  }

  return {
    yearMonth,
    total,
    lines: Array.from(linesByCategory.values()).sort((a, b) => b.amount - a.amount),
  };
}

/**
 * Typical (median + avg) monthly spending from {@link computeMonthSpending}.
 * Matches `coreExpensesTotal` in the profile cache.
 *
 * @param expenseTxns   Expense rows (profile cache or extractAllTransactions).
 * @param currentMonth  "YYYY-MM" for the current billing period (excluded from history).
 */
export function computeTypicalSpend(
  expenseTxns: readonly SpendingTxnLike[],
  currentMonth: string,
  options?: MonthSpendingOptions,
): TypicalSpend {
  const allMonths = Array.from(
    new Set(expenseTxns.map((t) => txnMonth(t, "")).filter(Boolean)),
  ).sort();
  const historicalMonths = completeMonthsWithData(allMonths, { currentMonth });

  if (historicalMonths.length === 0) {
    const currentTotal = computeMonthSpending(currentMonth, expenseTxns, options).total;
    return { median: currentTotal, avg: currentTotal, monthsTracked: 0 };
  }

  const monthTotals = historicalMonths
    .map((m) => computeMonthSpending(m, expenseTxns, options).total)
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
