/**
 * Money Coach — compute budget breakdown from FinancialProfileCache.
 *
 * Returns monthly averages grouped into buckets:
 * Fixed, Essentials, Discretionary, Savings/Debt, Income
 * 
 * Debt model:
 * - Fixed costs include scheduled loan payments and credit card minimum payments
 * - Card Servicing transactions are excluded from all buckets (purchases already counted)
 * - Extra debt paydown (payments above scheduled/minimum) goes to Savings & debt
 * 
 * Income and spending use the same calculation window (last 3 months when available,
 * otherwise overall average) to ensure consistent percentages.
 */

import type { FinancialProfileCache, MonthlyHistoryEntry } from "./financialProfile";
import type { ExpenseTxnRecord } from "./extractTransactions";
import type { DebtPaymentReview } from "./types";
import { getCategoryBucket, getBucketAdvice, BUCKET_METADATA, type MoneyCoachBucket } from "./moneyCoachBuckets";
import { isCoreExcluded } from "./spendingMetrics";
import { computeScheduledDebtPayments, type ScheduledDebtPayment } from "./debtPayments";
import { getParentCategory } from "./categoryTaxonomy";
import { getMoneyCoachIncome } from "./incomeMetrics";
import { computeAverageSavings } from "./savingsCalculations";

export interface MoneyCoachBucketSummary {
  bucket: MoneyCoachBucket;
  label: string;
  emoji: string;
  /** Average monthly $ amount */
  monthlyAverage: number;
  /** % of take-home income */
  pctOfIncome: number;
  /** Target % from 50/30/20 rule */
  targetPct: number;
  /** Plain-language advice */
  advice: string;
  /** True if this bucket includes estimated values (e.g. debt payments) */
  hasEstimates?: boolean;
}

export interface MoneyCoachBreakdown {
  /** Income amount (current run-rate or average) */
  incomeAmount: number;
  /** Income basis label: "last 3 months" or "10-month avg" */
  incomeBasisLabel: string;
  /** Spending buckets */
  buckets: MoneyCoachBucketSummary[];
  /** Total spending (sum of all bucket averages) */
  totalSpending: number;
  /** Savings rate: (income - spending) / income */
  savingsRate: number;
  /** Coverage metadata */
  coverage: {
    monthsCovered: number;
    monthsSpan: number;
    coveragePct: number;
    missingMonths: string[];
  };
}

/**
 * Compute average of an array of numbers (returns 0 for empty array).
 */
function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * Compute money coach breakdown from financial profile.
 * Uses average (not median) across the same window as income calculation
 * to ensure consistent percentages.
 */
export function computeMoneyCoachBreakdown(
  profile: FinancialProfileCache,
  userReviews: DebtPaymentReview[] = [],
  incomeTxns: any[] = [],
  accountSnapshots: any[] = [],
  homeCurrency: string = "CAD",
  incomeDepositReviews: Map<string, string> = new Map()
): MoneyCoachBreakdown {
  const { monthlyHistory, expenseTxns, coverage, debtPaymentHistory, accountBalanceHistory, fxRates } = profile;

  // Compute income using shared function (matches Income page and drawer logic)
  // Uses buildIncomeSummary to ensure consistency - returns REGULAR + BONUS income (excludes only "not_income")
  const { amount: incomeAmount, basisLabel: incomeBasisLabel, bonusAmount } = getMoneyCoachIncome(
    monthlyHistory,
    incomeTxns,
    accountSnapshots,
    homeCurrency,
    incomeDepositReviews
  );

  // Determine which months to use for spending (same window as income)
  // Exclude current incomplete month (matches incomeMetrics.ts and bucketBreakdown.ts logic)
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  
  const completeMonthsWithIncome = monthlyHistory.filter(h => 
    h.incomeTotal > 0 && h.yearMonth < currentMonth
  );
  const spendingMonths = completeMonthsWithIncome.length >= 3 
    ? completeMonthsWithIncome.slice(-3).map(h => h.yearMonth)  // Use last 3 complete months
    : completeMonthsWithIncome.map(h => h.yearMonth);          // Use all available complete months

  // Compute scheduled debt payments (fixed costs)
  const scheduledPayments = computeScheduledDebtPayments(
    accountSnapshots, 
    profile.debtPaymentHistory, 
    userReviews,
    fxRates ?? {},
    homeCurrency ?? "CAD"
  );
  const scheduledByAccount = new Map(scheduledPayments.map(p => [p.accountSlug, p]));
  const hasEstimatedDebt = scheduledPayments.some(p => p.isEstimated);

  // Total scheduled debt payments per month
  const totalScheduledDebt = scheduledPayments.reduce((sum, p) => sum + p.amount, 0);

  // Group expenses by bucket for each month in the spending window
  const bucketsByMonth = new Map<string, Record<MoneyCoachBucket, number>>();

  for (const ym of spendingMonths) {
    const buckets: Record<MoneyCoachBucket, number> = {
      fixed: totalScheduledDebt, // Start with scheduled debt payments
      essentials: 0,
      flexible: 0,
      savings: 0,
      uncategorized: 0,
    };

    // Get transactions for this month
    const monthTxns = expenseTxns.filter(t => t.txMonth === ym);

    for (const txn of monthTxns) {
      // Skip transfers and other excluded categories
      if (isCoreExcluded(txn.category)) continue;

      // Skip Debt payments entirely - handled by NET balance approach in savings calculation
      const parentCategory = getParentCategory(txn.category);
      if (parentCategory === "Debt") {
        continue; // Don't add to any bucket
      }

      const bucket = getCategoryBucket(txn.category);
      const amount = Math.abs(txn.amount);
      buckets[bucket] += amount;
    }

    // Note: savings bucket is NOT calculated here - uses NET balance approach below
    bucketsByMonth.set(ym, buckets);
  }

  // Compute average for each bucket (same window as income)
  // Savings uses shared calculation function (actual contributions + debt paydown)
  const averageSavings = computeAverageSavings(monthlyHistory, accountBalanceHistory, expenseTxns, spendingMonths);

  const bucketAverages: Record<MoneyCoachBucket, number> = {
    fixed: average([...bucketsByMonth.values()].map(b => b.fixed)),
    essentials: average([...bucketsByMonth.values()].map(b => b.essentials)),
    flexible: average([...bucketsByMonth.values()].map(b => b.flexible)),
    savings: averageSavings, // From shared data layer
    uncategorized: average([...bucketsByMonth.values()].map(b => b.uncategorized)),
  };

  const totalSpending = Object.values(bucketAverages).reduce((sum, v) => sum + v, 0);
  const savingsRate = incomeAmount > 0 ? (incomeAmount - totalSpending) / incomeAmount : 0;

  // Build bucket summaries with advice
  const bucketSummaries: MoneyCoachBucketSummary[] = (
    Object.keys(bucketAverages) as MoneyCoachBucket[]
  )
    .filter(bucket => bucket !== "uncategorized") // Hide uncategorized unless it's significant
    .map(bucket => {
      const metadata = BUCKET_METADATA[bucket];
      const monthlyAverage = bucketAverages[bucket];
      const pctOfIncome = incomeAmount > 0 ? (monthlyAverage / incomeAmount) * 100 : 0;

      return {
        bucket,
        label: metadata.label,
        emoji: metadata.emoji,
        monthlyAverage,
        pctOfIncome,
        targetPct: metadata.targetPct,
        advice: getBucketAdvice(bucket, pctOfIncome, metadata.targetPct),
        hasEstimates: bucket === "fixed" && hasEstimatedDebt,
      };
    });

  // Add uncategorized if it's more than 5% of spending
  const uncatAverage = bucketAverages.uncategorized;
  if (uncatAverage > totalSpending * 0.05) {
    bucketSummaries.push({
      bucket: "uncategorized",
      label: "Uncategorized",
      emoji: "❓",
      monthlyAverage: uncatAverage,
      pctOfIncome: incomeAmount > 0 ? (uncatAverage / incomeAmount) * 100 : 0,
      targetPct: 0,
      advice: "Some transactions aren't categorized yet. Review your spending to assign them.",
    });
  }

  // Sanity check: percentages should not exceed 150% (warns of double-counting)
  const totalPct = bucketSummaries.reduce((sum, b) => sum + b.pctOfIncome, 0);
  if (totalPct > 150) {
    console.warn(
      `⚠️  Money Coach: Bucket percentages sum to ${Math.round(totalPct)}% (> 150%). Possible double-counting.`,
      {
        incomeAmount,
        incomeBasisLabel,
        spendingMonths,
        totalSpending,
        bucketAverages,
        buckets: bucketSummaries.map(b => ({ bucket: b.bucket, pct: Math.round(b.pctOfIncome), amount: Math.round(b.monthlyAverage) })),
      }
    );
  }

  return {
    incomeAmount,
    incomeBasisLabel,
    buckets: bucketSummaries,
    totalSpending,
    savingsRate,
    coverage,
  };
}
