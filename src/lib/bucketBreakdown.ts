/**
 * Bucket Breakdown — per-category and per-merchant aggregations for money coach drawers.
 * 
 * Provides detailed breakdowns of spending by category and merchant for each bucket,
 * supporting multiple time windows (last 3 months, 12-month avg, year-to-date).
 */

import type { ExpenseTxnRecord, IncomeTxnRecord, AccountSnapshot, DebtPaymentHistoryEntry } from "./extractTransactions";
import type { MonthlyHistoryEntry } from "./financialProfile";
import type { DebtPaymentReview } from "./types";
import { getCategoryBucket, type MoneyCoachBucket } from "./moneyCoachBuckets";
import { isNotSpending } from "./spendingMetrics";
import { getParentCategory } from "./categoryTaxonomy";
import { resolveDebtServicingKind } from "./debtServicing";
import { merchantSlug } from "./applyRules";
import {
  displayedMerchantName,
  resolveSpendingMerchant,
  type MerchantRenameContext,
} from "./merchantAliases";
import { monthsForCashFlowAverage } from "./cashFlowAverage";
import { computeAverageBuckets } from "./monthlyBucketComputation";

export interface MerchantTransaction {
  date: string;
  amount: number;
  description: string;
  /** Statement descriptor when `description` is a saved rename. */
  rawName?: string;
  accountSlug: string;
  accountLabel?: string;
}

export interface MerchantBreakdown {
  merchant: string;
  amount: number;
  accountSlug?: string;
  accountLabel?: string;
  /** Method used for debt payments: "fixed payment" | "est. interest-only" | etc. */
  method?: string;
  /** Transaction count for this merchant in the period */
  txCount?: number;
  /** Individual transactions (for expandable detail view) */
  transactions?: MerchantTransaction[];
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
 * Uses the shared anchor (last complete month = previous calendar month).
 */
export function getMonthsForWindow(
  monthlyHistory: MonthlyHistoryEntry[],
  window: TimeWindow,
  currentYear: number
): string[] {
  const available = monthlyHistory.map((h) => h.yearMonth);

  switch (window) {
    case "last3":
      return monthsForCashFlowAverage(available, { lastNComplete: 3 });
    case "12month":
      return monthsForCashFlowAverage(available, { lastNComplete: 12 });
    case "ytd": {
      const ytdStart = `${currentYear}-01`;
      const ytd = available.filter((ym) => ym >= ytdStart);
      return monthsForCashFlowAverage(available, { rangeMonths: ytd });
    }
    default:
      return monthsForCashFlowAverage(available, { lastNComplete: 3 });
  }
}

/**
 * Compute detailed breakdown for a specific bucket and time window.
 * 
 * For subscriptions: uses merchantCadence (user's chosen billing cycle) as primary source,
 * falling back to subscription frequency from users/{uid}/subscriptions.
 * Annual cadence = last charge / 12, labelled 'yearly'.
 * All amounts are converted to homeCurrency using fxRates.
 */
export function computeBucketBreakdown(
  bucket: MoneyCoachBucket,
  expenseTxns: ExpenseTxnRecord[],
  accountSnapshots: AccountSnapshot[],
  debtPaymentHistory: DebtPaymentHistoryEntry[],
  months: string[],
  homeCurrency: string,
  userReviews: DebtPaymentReview[] = [],
  fxRates: Record<string, number> = {},
  merchantCadence?: Record<string, string>,
  subscriptions?: Array<{ merchantSlug: string; amount: number | null; frequency: string | null; status: string }>,
  renameCtx?: MerchantRenameContext | null,
): BucketDetailedBreakdown {
  // Filter transactions to selected months
  const txnsInWindow = expenseTxns.filter(t => months.includes(t.txMonth));

  // Group by category
  const categoryMap = new Map<string, ExpenseTxnRecord[]>();
  
  for (const txn of txnsInWindow) {
    if (
      isNotSpending(txn.category, {
        debtType: txn.debtType,
        merchant: txn.merchant,
      })
    ) {
      continue;
    }

    const parentCategory = getParentCategory(txn.category);
    const txnBucket = getCategoryBucket(txn.category);
    if (txnBucket !== bucket) continue;

    const existing = categoryMap.get(parentCategory) || [];
    existing.push(txn);
    categoryMap.set(parentCategory, existing);
  }

  // Build category breakdowns
  const categories: CategoryBreakdown[] = [];
  
  // Build subscription lookup map (merchantSlug → monthly amount)
  // Priority: merchantCadence (user's chosen billing cycle) > subscription frequency
  const subscriptionMonthlyAmount = new Map<string, number>();
  if (subscriptions) {
    for (const sub of subscriptions) {
      if (sub.amount && (sub.status === "confirmed" || sub.status === "user_confirmed")) {
        // Get frequency: merchantCadence first, then subscription record
        const frequency = merchantCadence?.[sub.merchantSlug] ?? sub.frequency;
        if (!frequency) continue;
        
        // Convert to monthly amount
        let monthlyAmount = sub.amount;
        if (frequency === "annual" || frequency === "yearly") monthlyAmount = sub.amount / 12;
        if (frequency === "quarterly") monthlyAmount = sub.amount / 3;
        if (frequency === "biweekly") monthlyAmount = sub.amount * 26 / 12;
        if (frequency === "weekly") monthlyAmount = sub.amount * 52 / 12;
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

    // Group by merchant SLUG (normalized), not raw merchant name
    // This merges case-variant duplicates like "AVIVA GENERAL INSURANCE" and "Aviva General Insurance"
    // Also merges obvious aliases like "Amazon" / "Amazon.ca" / "Amzn Mktp CA"
    const merchantMap = new Map<string, { total: number; displayName: string; txns: typeof txns }>();
    
    for (const txn of txns) {
      const resolved = resolveSpendingMerchant(
        txn.merchant || "Unknown",
        renameCtx?.aliasResolver,
        renameCtx?.displayNames,
      );
      const slug = resolved.slug;
      const existing = merchantMap.get(slug);
      
      if (existing) {
        // Merge into existing merchant
        existing.total += Math.abs(txn.amount);
        existing.txns.push(txn);
      } else {
        merchantMap.set(slug, {
          total: Math.abs(txn.amount),
          displayName: resolved.name,
          txns: [txn],
        });
      }
    }

    // Convert to sorted merchant array (top merchants first)
    // ALWAYS use monthly average to match the category header
    const allMerchants = Array.from(merchantMap.entries())
      .map(([slug, data]) => {
        // Use monthly average for ALL merchants to match category total
        // This ensures merchant list sums to category amount
        const monthlyAvg = data.total / (months.length || 1);
        
        // Build transaction list for expandable detail view
        const transactions: MerchantTransaction[] = data.txns.map(t => {
          const rawName = t.merchant || "";
          return {
            date: t.date,
            amount: Math.abs(t.amount),
            description: displayedMerchantName(
              rawName,
              renameCtx?.aliasResolver,
              renameCtx?.displayNames,
            ),
            rawName,
            accountSlug: t.accountSlug,
            accountLabel: t.accountLabel,
          };
        });
        
        return {
          merchant: data.displayName,
          amount: monthlyAvg,
          accountSlug: data.txns[0].accountSlug,
          accountLabel: data.txns[0].accountLabel,
          txCount: data.txns.length,
          transactions,
        };
      })
      .sort((a, b) => b.amount - a.amount);
    
    // Top 10 merchants
    const topMerchants = allMerchants.slice(0, 10);
    
    // Add "Other" row if there are more than 10 merchants
    const merchants: MerchantBreakdown[] = [...topMerchants];
    if (allMerchants.length > 10) {
      const topMerchantsSum = topMerchants.reduce((sum, m) => sum + m.amount, 0);
      const otherAmount = avgMonthly - topMerchantsSum;
      const otherCount = allMerchants.length - 10;
      
      if (otherAmount > 0.01) { // Only add if meaningful amount
        // Collect all transactions from merchants 11+
        const otherMerchants = allMerchants.slice(10);
        const otherTransactions: MerchantTransaction[] = [];
        otherMerchants.forEach(m => {
          if (m.transactions) {
            otherTransactions.push(...m.transactions);
          }
        });
        
        merchants.push({
          merchant: `Other (${otherCount} ${otherCount === 1 ? 'merchant' : 'merchants'})`,
          amount: otherAmount,
          txCount: otherMerchants.reduce((sum, m) => sum + (m.txCount || 0), 0),
          transactions: otherTransactions,
        });
      }
    }

    categories.push({
      category,
      amount: avgMonthly,
      pctOfBucket: 0, // Will be calculated later
      merchants,
    });
  }

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
    const cardPayments = txnsInWindow.filter(
      (t) =>
        resolveDebtServicingKind(t.category, t.debtType, t.merchant, false) === "card",
    );
    const cardPaymentTotal =
      cardPayments.reduce((sum, t) => sum + Math.abs(t.amount), 0) / (months.length || 1);
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
      label: "Loan payments",
      reason: "Counted in Fixed costs from the actual payment",
    });
  }

  // Transfers always excluded
  notCountedHere.push({
    label: "Transfers between your accounts",
    reason: "Moving your own money isn't spending",
  });

  // USE SHARED COMPUTATION for monthly average to ensure card and drawer match
  // This is the SINGLE SOURCE OF TRUTH for bucket totals
  const { averages } = computeAverageBuckets(
    months,
    expenseTxns,
    accountSnapshots,
    debtPaymentHistory,
    userReviews,
    fxRates,
    homeCurrency
  );
  const correctMonthlyAverage = averages[bucket];

  // Recalculate percentages using the correct total from shared computation
  categories.forEach(c => {
    c.pctOfBucket = correctMonthlyAverage > 0 ? (c.amount / correctMonthlyAverage) * 100 : 0;
  });

  return {
    bucket,
    monthlyAverage: correctMonthlyAverage, // Use shared computation result
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
  debtPaymentHistory: DebtPaymentHistoryEntry[],
  monthlyHistory: MonthlyHistoryEntry[],
  homeCurrency: string,
  userReviews: DebtPaymentReview[] = [],
  fxRates: Record<string, number> = {},
  merchantCadence?: Record<string, string>,
  subscriptions?: Array<{ merchantSlug: string; amount: number | null; frequency: string | null; status: string }>
): { months: string[]; values: number[] } {
  const completeMonths = monthsForCashFlowAverage(
    monthlyHistory.map((h) => h.yearMonth),
    { lastNComplete: 3 },
  );

  const values: number[] = [];

  for (const month of completeMonths) {
    const breakdown = computeBucketBreakdown(
      bucket,
      expenseTxns,
      accountSnapshots,
      debtPaymentHistory,
      [month],
      homeCurrency,
      userReviews,
      fxRates,
      merchantCadence,
      subscriptions
    );
    values.push(breakdown.monthlyAverage);
  }

  return { months: completeMonths, values };
}
