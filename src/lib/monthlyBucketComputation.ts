/**
 * Shared Monthly Bucket Computation
 * 
 * Used by BOTH dashboard cards/drawers AND spending page to ensure identical totals.
 * 
 * Computes per-month bucket totals including:
 * - Scheduled loan payments (added as synthetic "Loan payments" category)
 * - Regular expense transactions (excluding Debt parent category)
 * - Housing, Subscriptions, etc.
 */

import type { ExpenseTxnRecord, AccountSnapshot } from "./extractTransactions";
import type { DebtPaymentHistoryEntry } from "./extractTransactions";
import type { DebtPaymentReview } from "./types";
import { getCategoryBucket, type MoneyCoachBucket } from "./moneyCoachBuckets";
import { isNotSpending, isNonSpendingGroup } from "./spendingMetrics";
import { getParentCategory } from "./categoryTaxonomy";
import { mean, monthsForCashFlowAverage } from "./cashFlowAverage";
import { computeScheduledDebtPayments, type ScheduledDebtPayment } from "./debtPayments";

export interface MonthlyBucketItem {
  /** Category name (or "Loan payments" for scheduled debt) */
  category: string;
  /** Bucket classification */
  bucket: MoneyCoachBucket;
  /** Total amount for this category in the month */
  amount: number;
  /** Underlying transactions (empty for synthetic "Loan payments") */
  transactions: ExpenseTxnRecord[];
  /** True if this is a synthetic line item (e.g. scheduled debt payments) */
  isSynthetic: boolean;
  /** For synthetic loan payments, the scheduled payment details */
  scheduledPayments?: ScheduledDebtPayment[];
}

export interface MonthlyBucketResult {
  /** Year-month (YYYY-MM) */
  yearMonth: string;
  /** Bucket totals */
  buckets: Record<MoneyCoachBucket, number>;
  /** Per-category breakdown with transactions (ONLY spending buckets: fixed, essentials, flexible) */
  items: MonthlyBucketItem[];
  /** Total spending (sum of fixed + essentials + flexible) */
  total: number;
  /** Non-spending items (savings, assets, uncategorized) — excluded from total */
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

/**
 * Compute bucket breakdown for a single month.
 * This is the SINGLE SOURCE OF TRUTH for bucket calculations.
 * 
 * Used by:
 * - Dashboard Money Coach cards/drawers
 * - Spending page summary
 * - Regression tests
 */
export function computeMonthlyBuckets(
  yearMonth: string,
  expenseTxns: ExpenseTxnRecord[],
  accountSnapshots: AccountSnapshot[],
  debtPaymentHistory: DebtPaymentHistoryEntry[],
  userReviews: DebtPaymentReview[],
  fxRates: Record<string, number>,
  homeCurrency: string
): MonthlyBucketResult {
  // Compute scheduled debt payments (added to Fixed bucket)
  const scheduledPayments = computeScheduledDebtPayments(
    accountSnapshots,
    debtPaymentHistory,
    userReviews,
    fxRates,
    homeCurrency
  );
  
  const totalScheduledDebt = scheduledPayments.reduce((sum, p) => sum + p.amount, 0);
  
  // Initialize buckets
  const buckets: Record<MoneyCoachBucket, number> = {
    fixed: totalScheduledDebt, // Start with scheduled debt payments
    essentials: 0,
    flexible: 0,
    savings: 0,
    assets: 0,
    uncategorized: 0,
  };
  
  const items: MonthlyBucketItem[] = [];
  
  // Add synthetic "Loan payments" item if there are scheduled payments
  if (scheduledPayments.length > 0) {
    items.push({
      category: "Loan payments",
      bucket: "fixed",
      amount: totalScheduledDebt,
      transactions: [],
      isSynthetic: true,
      scheduledPayments,
    });
  }
  
  // Get transactions for this month
  const monthTxns = expenseTxns.filter(t => t.txMonth === yearMonth);
  
  // Group by category
  const categoryMap = new Map<string, MonthlyBucketItem>();
  
  for (const txn of monthTxns) {
    const excludeOpts = { debtType: txn.debtType, merchant: txn.merchant };
    // Skip transfers / interest / card servicing. Asset moves still flow into
    // excludedItems so Spending and cash flow can show "Into assets".
    if (isNotSpending(txn.category, excludeOpts) && !isNonSpendingGroup(txn.category)) continue;
    
    // Skip Debt parent category - handled by scheduled payments above
    const parentCategory = getParentCategory(txn.category);
    if (parentCategory === "Debt") continue;
    
    const bucket = getCategoryBucket(txn.category);
    const amount = Math.abs(txn.amount);
    
    // Add to bucket total
    buckets[bucket] += amount;
    
    // Add to category item
    if (!categoryMap.has(txn.category)) {
      categoryMap.set(txn.category, {
        category: txn.category,
        bucket,
        amount: 0,
        transactions: [],
        isSynthetic: false,
      });
    }
    
    const item = categoryMap.get(txn.category)!;
    item.amount += amount;
    item.transactions.push(txn);
  }
  
  // Add category items to result, split by spending vs non-spending
  const allItems = Array.from(categoryMap.values());
  const spendingBuckets: MoneyCoachBucket[] = ["fixed", "essentials", "flexible"];
  
  const spendingItems = allItems.filter(item => spendingBuckets.includes(item.bucket));
  const excludedItems = allItems.filter(item => !spendingBuckets.includes(item.bucket));
  
  // Add synthetic loan payments to spending items
  items.push(...spendingItems);
  
  // Sort both by amount (descending)
  items.sort((a, b) => b.amount - a.amount);
  excludedItems.sort((a, b) => b.amount - a.amount);
  
  const total = buckets.fixed + buckets.essentials + buckets.flexible;
  const intoAssets = buckets.assets + buckets.savings;
  const intoAssetsLines = intoAssetsLinesFromItems(excludedItems);
  
  return {
    yearMonth,
    buckets,
    items,
    total,
    excludedItems,
    intoAssets,
    intoAssetsLines,
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
  homeCurrency: string
): {
  averages: Record<MoneyCoachBucket, number>;
  monthlyResults: MonthlyBucketResult[];
} {
  const months = monthsForCashFlowAverage(yearMonths, { rangeMonths: yearMonths });
  const monthlyResults = months.map((ym) =>
    computeMonthlyBuckets(ym, expenseTxns, accountSnapshots, debtPaymentHistory, userReviews, fxRates, homeCurrency)
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
