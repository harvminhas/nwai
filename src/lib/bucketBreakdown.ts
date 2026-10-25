/**
 * Bucket Breakdown — per-category and per-merchant aggregations for money coach drawers.
 * 
 * Provides detailed breakdowns of spending by category and merchant for each bucket,
 * supporting multiple time windows (last 3 months, 12-month avg, year-to-date).
 */

import type { ExpenseTxnRecord, IncomeTxnRecord, AccountSnapshot } from "./extractTransactions";
import type { MonthlyHistoryEntry } from "./financialProfile";
import { getCategoryBucket, type MoneyCoachBucket } from "./moneyCoachBuckets";
import { isCoreExcluded } from "./spendingMetrics";
import { getParentCategory } from "./categoryTaxonomy";
import { computeScheduledDebtPayments } from "./debtPayments";
import { merchantSlug } from "./applyRules";

export interface MerchantBreakdown {
  merchant: string;
  amount: number;
  accountSlug?: string;
  accountLabel?: string;
  /** Method used for debt payments: "fixed payment" | "est. interest-only" | etc. */
  method?: string;
}

export interface CategoryBreakdown {
  category: string;
  amount: number;
  pctOfBucket: number;
  merchants: MerchantBreakdown[];
  isEstimated?: boolean;
  isScheduled?: boolean;
}

export interface BucketDetailedBreakdown {
  bucket: MoneyCoachBucket;
  monthlyAverage: number;
  categories: CategoryBreakdown[];
  notCountedHere: {
    label: string;
    reason: string;
    amount?: number;
  }[];
}

export type TimeWindow = "last3" | "12month" | "ytd";

/**
 * Get months for a specific time window.
 * Excludes the current incomplete month (same logic as incomeMetrics.ts).
 */
export function getMonthsForWindow(
  monthlyHistory: MonthlyHistoryEntry[],
  window: TimeWindow,
  currentYear: number
): string[] {
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  // Filter to complete months only (exclude current incomplete month)
  const completeMonths = monthlyHistory
    .filter(h => {
      const hasData = h.incomeTotal > 0 || h.expensesTotal > 0;
      const isComplete = h.yearMonth < currentMonth;
      return hasData && isComplete;
    })
    .map(h => h.yearMonth)
    .sort();

  if (completeMonths.length === 0) return [];

  switch (window) {
    case "last3":
      return completeMonths.slice(-3);
    
    case "12month":
      return completeMonths.slice(-12);
    
    case "ytd": {
      const ytdStart = `${currentYear}-01`;
      return completeMonths.filter(ym => ym >= ytdStart);
    }
    
    default:
      return completeMonths.slice(-3);
  }
}

/**
 * Compute detailed breakdown for a specific bucket and time window.
 * 
 * For subscriptions: uses the subscription's monthly rate from users/{uid}/subscriptions
 * instead of averaging total÷months. This ensures recurring charges show their actual
 * monthly cost, not a diluted average.
 */
export function computeBucketBreakdown(
  bucket: MoneyCoachBucket,
  expenseTxns: ExpenseTxnRecord[],
  accountSnapshots: AccountSnapshot[],
  months: string[],
  homeCurrency: string,
  subscriptions?: Array<{ merchantSlug: string; amount: number | null; frequency: string | null; status: string }>
): BucketDetailedBreakdown {
  // Filter transactions to selected months
  const txnsInWindow = expenseTxns.filter(t => months.includes(t.txMonth));

  // Group by category
  const categoryMap = new Map<string, ExpenseTxnRecord[]>();
  
  for (const txn of txnsInWindow) {
    // Skip transfers and excluded categories
    if (isCoreExcluded(txn.category)) continue;

    // Skip Card Servicing - it's excluded from buckets
    const parentCategory = getParentCategory(txn.category);
    if (parentCategory === "Debt") continue;

    const txnBucket = getCategoryBucket(txn.category);
    if (txnBucket !== bucket) continue;

    const existing = categoryMap.get(parentCategory) || [];
    existing.push(txn);
    categoryMap.set(parentCategory, existing);
  }

  // For Fixed bucket, add scheduled debt payments
  let scheduledDebtAmount = 0;
  const scheduledDebtCategories: CategoryBreakdown[] = [];
  
  if (bucket === "fixed") {
    const scheduledPayments = computeScheduledDebtPayments(accountSnapshots, expenseTxns);
    const monthCount = months.length || 1;
    
    // Group by debt type
    const mortgagePayments = scheduledPayments.filter(p => p.debtType === "loan" && p.accountSlug.includes("mortgage"));
    const loanPayments = scheduledPayments.filter(p => p.debtType === "loan" && !p.accountSlug.includes("mortgage"));
    const creditPayments = scheduledPayments.filter(p => p.debtType === "credit");
    
    if (mortgagePayments.length > 0) {
      const mortgageTotal = mortgagePayments.reduce((sum, p) => sum + p.amount, 0);
      scheduledDebtAmount += mortgageTotal;
      scheduledDebtCategories.push({
        category: "Mortgage payment",
        amount: mortgageTotal,
        pctOfBucket: 0, // Will be calculated later
        merchants: mortgagePayments.map(p => ({
          merchant: p.accountName || p.accountSlug,
          amount: p.amount,
          accountSlug: p.accountSlug,
          method: p.method,
        })),
        isScheduled: true,
        isEstimated: mortgagePayments.some(p => p.isEstimated),
      });
    }

    if (loanPayments.length > 0) {
      const loanTotal = loanPayments.reduce((sum, p) => sum + p.amount, 0);
      scheduledDebtAmount += loanTotal;
      scheduledDebtCategories.push({
        category: "Loan payments",
        amount: loanTotal,
        pctOfBucket: 0,
        merchants: loanPayments.map(p => ({
          merchant: p.accountName || p.accountSlug,
          amount: p.amount,
          accountSlug: p.accountSlug,
          method: p.method,
        })),
        isScheduled: true,
        isEstimated: loanPayments.some(p => p.isEstimated),
      });
    }

    if (creditPayments.length > 0) {
      const creditTotal = creditPayments.reduce((sum, p) => sum + p.amount, 0);
      scheduledDebtAmount += creditTotal;
      scheduledDebtCategories.push({
        category: "Credit card minimums",
        amount: creditTotal,
        pctOfBucket: 0,
        merchants: creditPayments.map(p => ({
          merchant: p.accountName || p.accountSlug,
          amount: p.amount,
          accountSlug: p.accountSlug,
          method: p.method,
        })),
        isScheduled: true,
        isEstimated: creditPayments.some(p => p.isEstimated),
      });
    }
  }

  // Build category breakdowns
  const categories: CategoryBreakdown[] = [];
  
  // Build subscription lookup map (merchantSlug → monthly amount)
  const subscriptionMonthlyAmount = new Map<string, number>();
  if (subscriptions) {
    for (const sub of subscriptions) {
      if (sub.amount && sub.frequency && (sub.status === "confirmed" || sub.status === "user_confirmed")) {
        // Convert to monthly amount
        let monthlyAmount = sub.amount;
        if (sub.frequency === "annual") monthlyAmount = sub.amount / 12;
        if (sub.frequency === "quarterly") monthlyAmount = sub.amount / 3;
        if (sub.frequency === "biweekly") monthlyAmount = sub.amount * 26 / 12;
        if (sub.frequency === "weekly") monthlyAmount = sub.amount * 52 / 12;
        subscriptionMonthlyAmount.set(sub.merchantSlug, monthlyAmount);
      }
    }
  }
  
  for (const [category, txns] of categoryMap) {
    const total = txns.reduce((sum, t) => sum + Math.abs(t.amount), 0);
    
    // Check if this category consists primarily of subscriptions
    const isSubscriptionCategory = category.toLowerCase().includes("subscriptions");
    let avgMonthly: number;
    
    if (isSubscriptionCategory && subscriptions) {
      // For subscription category, use the sum of subscription monthly rates
      // instead of averaging transaction totals
      const merchantSlugs = new Set(txns.map(t => merchantSlug(t.merchant)));
      
      let subscriptionTotal = 0;
      let hasSubscriptionData = false;
      for (const slug of merchantSlugs) {
        const monthlyAmt = subscriptionMonthlyAmount.get(slug);
        if (monthlyAmt) {
          subscriptionTotal += monthlyAmt;
          hasSubscriptionData = true;
        }
      }
      
      // Use subscription data if available, otherwise fall back to averaging
      avgMonthly = hasSubscriptionData ? subscriptionTotal : total / (months.length || 1);
    } else {
      // Non-subscription: use averaging as before
      avgMonthly = total / (months.length || 1);
    }

    // Group by merchant
    const merchantMap = new Map<string, number>();
    const merchantAccounts = new Map<string, { accountSlug?: string; accountLabel?: string }>();
    
    for (const txn of txns) {
      const merchant = txn.merchant || "Unknown";
      merchantMap.set(merchant, (merchantMap.get(merchant) || 0) + Math.abs(txn.amount));
      if (!merchantAccounts.has(merchant)) {
        merchantAccounts.set(merchant, {
          accountSlug: txn.accountSlug,
          accountLabel: txn.accountLabel,
        });
      }
    }

    // Convert to sorted merchant array (top merchants first)
    const merchants = Array.from(merchantMap.entries())
      .map(([merchant, amount]) => {
        const slug = merchantSlug(merchant);
        const subMonthlyAmt = subscriptionMonthlyAmount.get(slug);
        
        // Use subscription monthly rate if available, otherwise average
        const displayAmount = subMonthlyAmt || (amount / (months.length || 1));
        
        return {
          merchant,
          amount: displayAmount,
          ...merchantAccounts.get(merchant),
        };
      })
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 5); // Top 5 merchants per category

    categories.push({
      category,
      amount: avgMonthly,
      pctOfBucket: 0, // Will be calculated later
      merchants,
    });
  }

  // Add scheduled debt categories
  categories.push(...scheduledDebtCategories);

  // Sort by amount (largest first)
  categories.sort((a, b) => b.amount - a.amount);

  // Calculate total and percentages
  const totalAmount = categories.reduce((sum, c) => sum + c.amount, 0);
  categories.forEach(c => {
    c.pctOfBucket = totalAmount > 0 ? (c.amount / totalAmount) * 100 : 0;
  });

  // Build "Not counted here" notes
  const notCountedHere: BucketDetailedBreakdown["notCountedHere"] = [];
  
  if (bucket === "fixed") {
    // Card payments are excluded
    const cardPayments = txnsInWindow.filter(t => getParentCategory(t.category) === "Debt");
    const cardPaymentTotal = cardPayments.reduce((sum, t) => sum + Math.abs(t.amount), 0) / (months.length || 1);
    if (cardPaymentTotal > 0) {
      notCountedHere.push({
        label: "Credit card payments",
        reason: "Purchases already counted in their categories",
        amount: cardPaymentTotal,
      });
    }
  }

  if (bucket === "savings") {
    notCountedHere.push({
      label: "Scheduled mortgage & loan payments",
      reason: "Counted in Fixed costs",
    });
  }

  // Transfers always excluded
  notCountedHere.push({
    label: "Transfers between your accounts",
    reason: "Moving your own money isn't spending",
  });

  return {
    bucket,
    monthlyAverage: totalAmount,
    categories,
    notCountedHere,
  };
}

/**
 * Compute 3-month trend values for sparkline (most recent 3 complete months).
 * Excludes the current incomplete month.
 */
export function compute3MonthTrend(
  bucket: MoneyCoachBucket,
  expenseTxns: ExpenseTxnRecord[],
  accountSnapshots: AccountSnapshot[],
  monthlyHistory: MonthlyHistoryEntry[],
  subscriptions?: Array<{ merchantSlug: string; amount: number | null; frequency: string | null; status: string }>
): { months: string[]; values: number[] } {
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  // Filter to complete months only (exclude current incomplete month)
  const completeMonths = monthlyHistory
    .filter(h => {
      const hasData = h.incomeTotal > 0 || h.expensesTotal > 0;
      const isComplete = h.yearMonth < currentMonth;
      return hasData && isComplete;
    })
    .map(h => h.yearMonth)
    .sort()
    .slice(-3);

  const values: number[] = [];

  for (const month of completeMonths) {
    const breakdown = computeBucketBreakdown(
      bucket,
      expenseTxns,
      accountSnapshots,
      [month],
      "CAD",
      subscriptions // Pass subscriptions for consistent calculation
    );
    values.push(breakdown.monthlyAverage);
  }

  return { months: completeMonths, values };
}
