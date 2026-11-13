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
import { averageCashFlow, cashFlowInputFromProfile } from "./monthlyCashFlow";

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
  /** Months included in the averages (complete months; current excluded) */
  months: string[];
}

/**
 * Compute Money Coach breakdown with spending buckets and advice.
 *
 * Income, spend, leftover, and bucket averages all come from
 * {@link averageCashFlow}. Default months are last 3 complete months with
 * income or spending — not `profile.monthlyHistory.incomeTotal > 0`.
 *
 * `savingsConfirmedItems` is not used: Net savings is leftover
 * (money in − money out). Those reviews only affected the retired
 * balance-change path (life-insurance-style contributions).
 */
export function computeMoneyCoachBreakdown(
  profile: FinancialProfileCache,
  userReviews: DebtPaymentReview[] = [],
  incomeTxns: unknown[] = [],
  accountSnapshots: unknown[] = [],
  homeCurrency: string = "CAD",
  incomeDepositReviews: Map<string, string> = new Map(),
  rangeMonths?: string[],
): MoneyCoachBreakdown {
  const { coverage } = profile;

  const input = cashFlowInputFromProfile(
    {
      expenseTxns: profile.expenseTxns,
      incomeTxns: (incomeTxns.length > 0
        ? incomeTxns
        : profile.incomeTxns ?? []) as FinancialProfileCache["incomeTxns"],
      homeCurrency: homeCurrency || profile.homeCurrency || "CAD",
      fxRates: profile.fxRates,
      accountSnapshots: (accountSnapshots.length > 0
        ? accountSnapshots
        : profile.accountSnapshots) as FinancialProfileCache["accountSnapshots"],
      debtPaymentHistory: profile.debtPaymentHistory,
    },
    { debtPaymentReviews: userReviews, incomeDepositReviews },
  );

  const avg = averageCashFlow(input, { rangeMonths, lastNComplete: 3 });
  const spendingMonths = avg.months;

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
    months: spendingMonths,
  };
}
