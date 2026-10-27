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
import { isCoreExcluded } from "./spendingMetrics";
import { getParentCategory } from "./categoryTaxonomy";
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
  /** Per-category breakdown with transactions */
  items: MonthlyBucketItem[];
  /** Total spending (sum of fixed + essentials + flexible) */
  total: number;
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
    // Skip transfers and other excluded categories
    if (isCoreExcluded(txn.category)) continue;
    
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
  
  // Add category items to result
  items.push(...Array.from(categoryMap.values()));
  
  // Sort items by amount (descending)
  items.sort((a, b) => b.amount - a.amount);
  
  const total = buckets.fixed + buckets.essentials + buckets.flexible;
  
  return {
    yearMonth,
    buckets,
    items,
    total,
  };
}

/**
 * Compute bucket breakdown for multiple months and return averages.
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
  const monthlyResults = yearMonths.map(ym =>
    computeMonthlyBuckets(ym, expenseTxns, accountSnapshots, debtPaymentHistory, userReviews, fxRates, homeCurrency)
  );
  
  const averages: Record<MoneyCoachBucket, number> = {
    fixed: 0,
    essentials: 0,
    flexible: 0,
    savings: 0,
    uncategorized: 0,
  };
  
  if (monthlyResults.length > 0) {
    for (const result of monthlyResults) {
      averages.fixed += result.buckets.fixed;
      averages.essentials += result.buckets.essentials;
      averages.flexible += result.buckets.flexible;
      averages.savings += result.buckets.savings;
      averages.uncategorized += result.buckets.uncategorized;
    }
    
    for (const key in averages) {
      averages[key as MoneyCoachBucket] /= monthlyResults.length;
    }
  }
  
  return { averages, monthlyResults };
}
