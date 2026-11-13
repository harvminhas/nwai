/**
 * Money Coach — compute budget breakdown from FinancialProfileCache.
 *
 * Income, spending buckets, leftover, and savings rate all come from
 * {@link getMonthlyCashFlow}. Multi-month values are averages of those
 * per-month results. Net savings = money in − money out (leftover).
 */

import type { FinancialProfileCache } from "./financialProfile";
import type { DebtPaymentReview } from "./types";
import { getBucketAdvice, BUCKET_METADATA, type MoneyCoachBucket } from "./moneyCoachBuckets";
import { computeScheduledDebtPayments } from "./debtPayments";
import {
  averageMonthlyCashFlow,
  getMonthlyCashFlowForMonths,
  type MonthlyCashFlowInput,
} from "./monthlyCashFlow";

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
  /** Savings rate: leftover / income */
  savingsRate: number;
  /** Coverage metadata */
  coverage: {
    monthsCovered: number;
    monthsSpan: number;
    coveragePct: number;
    missingMonths: string[];
  };
}

function cashFlowInputFrom(
  profile: FinancialProfileCache,
  userReviews: DebtPaymentReview[],
  incomeTxns: unknown[],
  accountSnapshots: unknown[],
  homeCurrency: string,
  incomeDepositReviews: Map<string, string>,
): MonthlyCashFlowInput {
  return {
    expenseTxns: profile.expenseTxns,
    incomeTxns: incomeTxns as MonthlyCashFlowInput["incomeTxns"],
    homeCurrency,
    fxRates: profile.fxRates,
    accountSnapshots: accountSnapshots as MonthlyCashFlowInput["accountSnapshots"],
    debtPaymentHistory: profile.debtPaymentHistory,
    userReviews,
    incomeDepositReviews,
  };
}

function defaultSpendingMonths(profile: FinancialProfileCache): string[] {
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const completeMonthsWithIncome = profile.monthlyHistory.filter(
    (h) => h.incomeTotal > 0 && h.yearMonth < currentMonth,
  );
  return completeMonthsWithIncome.length >= 3
    ? completeMonthsWithIncome.slice(-3).map((h) => h.yearMonth)
    : completeMonthsWithIncome.map((h) => h.yearMonth);
}

/**
 * Compute Money Coach breakdown with spending buckets and advice.
 *
 * @param rangeMonths - Optional: specific months to use for calculations (YYYY-MM format, oldest first)
 *                      If not provided, uses last 3 complete months with income
 */
export function computeMoneyCoachBreakdown(
  profile: FinancialProfileCache,
  userReviews: DebtPaymentReview[] = [],
  incomeTxns: unknown[] = [],
  accountSnapshots: unknown[] = [],
  homeCurrency: string = "CAD",
  incomeDepositReviews: Map<string, string> = new Map(),
  rangeMonths?: string[],
  _savingsConfirmedItems: Map<string, boolean> = new Map(),
): MoneyCoachBreakdown {
  const { coverage } = profile;

  const spendingMonths =
    rangeMonths && rangeMonths.length > 0 ? rangeMonths : defaultSpendingMonths(profile);

  const input = cashFlowInputFrom(
    profile,
    userReviews,
    incomeTxns,
    accountSnapshots,
    homeCurrency || "CAD",
    incomeDepositReviews,
  );

  const monthly = getMonthlyCashFlowForMonths(input, spendingMonths);
  const avg = averageMonthlyCashFlow(monthly);

  const incomeAmount = avg.moneyIn;
  const totalSpending = avg.moneyOut;

  const monthCount = spendingMonths.length;
  const incomeBasisLabel =
    monthCount === 3
      ? "last 3 months"
      : monthCount === 12
        ? "12-month"
        : `${monthCount}-month avg`;

  const bucketAverages: Record<MoneyCoachBucket, number> = {
    fixed: avg.buckets.fixed,
    essentials: avg.buckets.essentials,
    flexible: avg.buckets.flexible,
    savings: avg.leftover,
    uncategorized: 0,
  };

  const scheduledPayments = computeScheduledDebtPayments(
    (accountSnapshots.length > 0 ? accountSnapshots : profile.accountSnapshots) as never,
    profile.debtPaymentHistory,
    userReviews,
    profile.fxRates ?? {},
    homeCurrency || "CAD",
  );
  const hasEstimatedDebt = scheduledPayments.some((p) => p.isEstimated);

  const savingsRate = avg.savingsRate ?? 0;

  const bucketSummaries: MoneyCoachBucketSummary[] = (
    Object.keys(bucketAverages) as MoneyCoachBucket[]
  )
    .filter((bucket) => bucket !== "uncategorized")
    .map((bucket) => {
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
        buckets: bucketSummaries.map((b) => ({
          bucket: b.bucket,
          pct: Math.round(b.pctOfIncome),
          amount: Math.round(b.monthlyAverage),
        })),
      },
    );
  }

  let rangeLabel = "avg · Last 3 months";
  if (rangeMonths) {
    const count = rangeMonths.length;
    if (count === 12) {
      rangeLabel = "avg · 12-month";
    } else {
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
