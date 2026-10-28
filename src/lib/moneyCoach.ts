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
import { buildSpendingSummary } from "./spendingSummary";

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
  /** Range label for cards: "avg · Last 3 months", "avg · 12-month", "avg · This year" */
  rangeLabel: string;
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
/**
 * Compute Money Coach breakdown with spending buckets and advice.
 * 
 * @param rangeMonths - Optional: specific months to use for calculations (YYYY-MM format, oldest first)
 *                      If not provided, uses last 3 complete months with income
 */
export function computeMoneyCoachBreakdown(
  profile: FinancialProfileCache,
  userReviews: DebtPaymentReview[] = [],
  incomeTxns: any[] = [],
  accountSnapshots: any[] = [],
  homeCurrency: string = "CAD",
  incomeDepositReviews: Map<string, string> = new Map(),
  rangeMonths?: string[]
): MoneyCoachBreakdown {
  const { monthlyHistory, expenseTxns, coverage, debtPaymentHistory, accountBalanceHistory, fxRates } = profile;

  // Compute income using shared function (matches Income page and drawer logic)
  // Uses buildIncomeSummary to ensure consistency - returns REGULAR + BONUS income (excludes only "not_income")
  const { amount: incomeAmount, basisLabel: incomeBasisLabel, bonusAmount } = getMoneyCoachIncome(
    monthlyHistory,
    incomeTxns,
    accountSnapshots,
    homeCurrency,
    incomeDepositReviews,
    rangeMonths
  );

  // Determine which months to use for spending
  // If rangeMonths provided, use those; otherwise default to last 3 complete months with income
  let spendingMonths: string[];
  
  if (rangeMonths && rangeMonths.length > 0) {
    spendingMonths = rangeMonths;
  } else {
    // Exclude current incomplete month (matches incomeMetrics.ts and bucketBreakdown.ts logic)
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    
    const completeMonthsWithIncome = monthlyHistory.filter(h => 
      h.incomeTotal > 0 && h.yearMonth < currentMonth
    );
    spendingMonths = completeMonthsWithIncome.length >= 3 
      ? completeMonthsWithIncome.slice(-3).map(h => h.yearMonth)  // Use last 3 complete months
      : completeMonthsWithIncome.map(h => h.yearMonth);
  }

  // SINGLE SOURCE OF TRUTH: Use buildSpendingSummary for spending calculation
  // This ensures card and page use identical logic
  const spendingSummary = buildSpendingSummary(
    expenseTxns,
    accountSnapshots,
    profile.debtPaymentHistory,
    userReviews,
    fxRates ?? {},
    homeCurrency ?? "CAD",
    spendingMonths
  );
  
  // Total spending from the shared function - this is the single source of truth
  const totalSpending = spendingSummary.typicalMonthly;
  
  // Get per-bucket averages for display from the computed monthlyHistory
  const bucketAverages: Record<MoneyCoachBucket, number> = {
    fixed: 0,
    essentials: 0,
    flexible: 0,
    savings: 0,
    uncategorized: 0,
  };
  
  // Check if there's estimated debt for the hasEstimates flag
  const scheduledPayments = computeScheduledDebtPayments(
    accountSnapshots, 
    profile.debtPaymentHistory, 
    userReviews,
    fxRates ?? {},
    homeCurrency ?? "CAD"
  );
  const hasEstimatedDebt = scheduledPayments.some(p => p.isEstimated);
  
  // Average bucket values across the spending months
  const relevantMonths = spendingSummary.monthlyHistory.filter(m => spendingMonths.includes(m.yearMonth));
  if (relevantMonths.length > 0) {
    bucketAverages.fixed = relevantMonths.reduce((sum, m) => sum + m.fixed, 0) / relevantMonths.length;
    bucketAverages.essentials = relevantMonths.reduce((sum, m) => sum + m.essentials, 0) / relevantMonths.length;
    bucketAverages.flexible = relevantMonths.reduce((sum, m) => sum + m.flexible, 0) / relevantMonths.length;
  }
  
  // Savings uses the app's definition: cash change + debt change + contributions (same as drawer)
  const averageSavings = computeAverageSavings(monthlyHistory, accountBalanceHistory, expenseTxns, spendingMonths);
  bucketAverages.savings = averageSavings;
  
  const savingsRate = incomeAmount > 0 ? averageSavings / incomeAmount : 0;

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

  // Compute range label for cards
  let rangeLabel = "avg · Last 3 months"; // Default
  if (rangeMonths) {
    const count = rangeMonths.length;
    if (count === 12) {
      rangeLabel = "avg · 12-month";
    } else {
      // Check if it's YTD (starts with Jan of current year)
      const now = new Date();
      const currentYear = now.getFullYear();
      const firstMonth = rangeMonths[0];
      if (firstMonth === `${currentYear}-01`) {
        rangeLabel = "avg · This year";
      } else {
        rangeLabel = `avg · Last ${count} months`;
      }
    }
  }
  
  return {
    incomeAmount,
    incomeBasisLabel,
    rangeLabel,
    buckets: bucketSummaries,
    totalSpending,
    savingsRate,
    coverage,
  };
}
