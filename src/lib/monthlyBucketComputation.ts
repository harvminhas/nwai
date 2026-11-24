/**
 * Shared Monthly Bucket Computation
 *
 * Spending totals and line items come from {@link computeMonthSpending}.
 * This module only classifies those lines into money-coach buckets and
 * collects Into-assets (Investments & Savings + Asset purchase).
 *
 * Used by dashboard cards/drawers, the Spending page, and cash flow money out.
 */

import type { ExpenseTxnRecord, AccountSnapshot, DebtPaymentHistoryEntry } from "./extractTransactions";
import type { DebtPaymentReview } from "./types";
import { getCategoryBucket, type MoneyCoachBucket } from "./moneyCoachBuckets";
import { computeMonthSpending, isNonSpendingGroup } from "./spendingMetrics";
import { getParentCategory } from "./categoryTaxonomy";
import { mean, monthsForCashFlowAverage } from "./cashFlowAverage";
import { toHome } from "./currencyUtils";
import type { ScheduledDebtPayment } from "./debtPayments";

export interface MonthlyBucketItem {
  /** Category name */
  category: string;
  /** Bucket classification */
  bucket: MoneyCoachBucket;
  /** Total amount for this category in the month */
  amount: number;
  /** Underlying transactions */
  transactions: ExpenseTxnRecord[];
  /** True if this is a synthetic line item (loan payments are no longer synthetic) */
  isSynthetic: boolean;
  /** @deprecated Scheduled loan rows are no longer injected into spending. */
  scheduledPayments?: ScheduledDebtPayment[];
}

export interface MonthlyBucketResult {
  /** Year-month (YYYY-MM) */
  yearMonth: string;
  /** Bucket totals */
  buckets: Record<MoneyCoachBucket, number>;
  /** Per-category breakdown with transactions (spending only) */
  items: MonthlyBucketItem[];
  /** Total spending — same figure as {@link computeMonthSpending} */
  total: number;
  /** Non-spending items (savings, assets) — excluded from total */
  excludedItems: MonthlyBucketItem[];
  /**
   * Money moved into assets this month (Asset purchases + Investments & Savings).
   * Not spending; not leftover. Same figure cash flow uses for "Into assets".
   */
  intoAssets: number;
  /** Rolled-up Asset purchases / Investments & Savings lines for display. */
  intoAssetsLines: Array<{ category: string; amount: number }>;
}

const ASSET_MOVE_DISPLAY: Record<string, string> = {
  "Asset purchase": "Asset purchases",
  "Investments & Savings": "Investments & Savings",
};

/** Roll excluded asset-move items up to parent display lines. */
export function intoAssetsLinesFromItems(
  items: Array<{ category: string; amount: number }>,
): Array<{ category: string; amount: number }> {
  const byLabel = new Map<string, number>();
  for (const item of items) {
    const parent = getParentCategory(item.category);
    const label = ASSET_MOVE_DISPLAY[parent];
    if (!label) continue;
    byLabel.set(label, (byLabel.get(label) ?? 0) + item.amount);
  }
  return Array.from(byLabel.entries())
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => b.amount - a.amount);
}

function emptyBuckets(): Record<MoneyCoachBucket, number> {
  return {
    fixed: 0,
    essentials: 0,
    flexible: 0,
    savings: 0,
    assets: 0,
    uncategorized: 0,
  };
}

function homeAmount(
  amount: number,
  currency: string | null | undefined,
  fxRates: Record<string, number>,
  homeCurrency: string,
): number {
  return Math.abs(toHome(amount, currency, { homeCurrency, fxRates }));
}

/**
 * Bucket breakdown for a single month.
 *
 * Spending total and category lines come from {@link computeMonthSpending}.
 * Scheduled loan / card-minimum estimates are not added — actual installment
 * transactions are already in those lines.
 *
 * accountSnapshots / debtPaymentHistory / userReviews are accepted so existing
 * callers keep compiling; they no longer change the spending total.
 */
export function computeMonthlyBuckets(
  yearMonth: string,
  expenseTxns: ExpenseTxnRecord[],
  _accountSnapshots: AccountSnapshot[],
  _debtPaymentHistory: DebtPaymentHistoryEntry[],
  _userReviews: DebtPaymentReview[],
  fxRates: Record<string, number>,
  homeCurrency: string,
): MonthlyBucketResult {
  const spending = computeMonthSpending(yearMonth, expenseTxns, {
    homeCurrency,
    fxRates,
  });

  const buckets = emptyBuckets();
  const items: MonthlyBucketItem[] = spending.lines.map((line) => {
    // Spending lines always land in a spending bucket so Fixed+Essentials+Flexible
    // matches computeMonthSpending.total. Unknown labels fold into Flexible.
    const mapped = getCategoryBucket(line.category);
    const bucket: MoneyCoachBucket =
      mapped === "fixed" || mapped === "essentials" || mapped === "flexible"
        ? mapped
        : "flexible";
    buckets[bucket] += line.amount;
    return {
      category: line.category,
      bucket,
      amount: line.amount,
      transactions: line.transactions as ExpenseTxnRecord[],
      isSynthetic: false,
    };
  });

  const excludedMap = new Map<string, MonthlyBucketItem>();
  for (const txn of expenseTxns) {
    if (txn.txMonth !== yearMonth) continue;
    if (!isNonSpendingGroup(txn.category)) continue;
    const amount = homeAmount(txn.amount, txn.currency, fxRates, homeCurrency);
    if (amount <= 0) continue;
    const bucket = getCategoryBucket(txn.category);
    buckets[bucket] += amount;
    const existing = excludedMap.get(txn.category);
    if (existing) {
      existing.amount += amount;
      existing.transactions.push(txn);
    } else {
      excludedMap.set(txn.category, {
        category: txn.category,
        bucket,
        amount,
        transactions: [txn],
        isSynthetic: false,
      });
    }
  }

  items.sort((a, b) => b.amount - a.amount);
  const excludedItems = Array.from(excludedMap.values()).sort((a, b) => b.amount - a.amount);

  return {
    yearMonth,
    buckets,
    items,
    total: spending.total,
    excludedItems,
    intoAssets: buckets.assets + buckets.savings,
    intoAssetsLines: intoAssetsLinesFromItems(excludedItems),
  };
}

/**
 * Average Fixed / Essentials / Flexible over the shared cash-flow month set.
 * Net savings (leftover) is {@link averageCashFlow}, not the Investments
 * category that used to live in `averages.savings`.
 */
export function computeAverageBuckets(
  yearMonths: string[],
  expenseTxns: ExpenseTxnRecord[],
  accountSnapshots: AccountSnapshot[],
  debtPaymentHistory: DebtPaymentHistoryEntry[],
  userReviews: DebtPaymentReview[],
  fxRates: Record<string, number>,
  homeCurrency: string,
): {
  averages: Record<MoneyCoachBucket, number>;
  monthlyResults: MonthlyBucketResult[];
} {
  const months = monthsForCashFlowAverage(yearMonths, { rangeMonths: yearMonths });
  const monthlyResults = months.map((ym) =>
    computeMonthlyBuckets(
      ym,
      expenseTxns,
      accountSnapshots,
      debtPaymentHistory,
      userReviews,
      fxRates,
      homeCurrency,
    ),
  );

  return {
    averages: {
      fixed: mean(monthlyResults.map((r) => r.buckets.fixed)),
      essentials: mean(monthlyResults.map((r) => r.buckets.essentials)),
      flexible: mean(monthlyResults.map((r) => r.buckets.flexible)),
      savings: 0,
      assets: mean(monthlyResults.map((r) => r.buckets.assets)),
      uncategorized: mean(monthlyResults.map((r) => r.buckets.uncategorized)),
    },
    monthlyResults,
  };
}
