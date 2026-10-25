/**
 * Money Coach — compute budget breakdown from FinancialProfileCache.
 *
 * Returns monthly averages (median) grouped into buckets:
 * Fixed, Essentials, Discretionary, Savings/Debt, Income
 */

import type { FinancialProfileCache } from "./financialProfile";
import type { ExpenseTxnRecord } from "./extractTransactions";
import { getCategoryBucket, getBucketAdvice, BUCKET_METADATA, type MoneyCoachBucket } from "./moneyCoachBuckets";
import { isCoreExcluded } from "./spendingMetrics";

export interface MoneyCoachBucketSummary {
  bucket: MoneyCoachBucket;
  label: string;
  emoji: string;
  /** Median monthly $ amount */
  monthlyMedian: number;
  /** % of take-home income */
  pctOfIncome: number;
  /** Target % from 50/30/20 rule */
  targetPct: number;
  /** Plain-language advice */
  advice: string;
}

export interface MoneyCoachBreakdown {
  /** Income median */
  incomeMedian: number;
  /** Spending buckets */
  buckets: MoneyCoachBucketSummary[];
  /** Total spending (sum of all bucket medians) */
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
 * Compute median of an array of numbers (returns 0 for empty array).
 */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Compute money coach breakdown from financial profile.
 * Uses median across all available months.
 */
export function computeMoneyCoachBreakdown(profile: FinancialProfileCache): MoneyCoachBreakdown {
  const { monthlyHistory, expenseTxns, incomeTxns, coverage } = profile;

  // Compute income median from monthly history
  const incomeValues = monthlyHistory
    .map(h => h.incomeTotal)
    .filter(v => v > 0);
  const incomeMedian = median(incomeValues);

  // Group expenses by bucket for each month, then compute medians
  const bucketsByMonth = new Map<string, Record<MoneyCoachBucket, number>>();

  for (const h of monthlyHistory) {
    const ym = h.yearMonth;
    const buckets: Record<MoneyCoachBucket, number> = {
      fixed: 0,
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

      const bucket = getCategoryBucket(txn.category);
      const amount = Math.abs(txn.amount);
      buckets[bucket] += amount;
    }

    bucketsByMonth.set(ym, buckets);
  }

  // Compute median for each bucket
  const bucketMedians: Record<MoneyCoachBucket, number> = {
    fixed: median([...bucketsByMonth.values()].map(b => b.fixed)),
    essentials: median([...bucketsByMonth.values()].map(b => b.essentials)),
    flexible: median([...bucketsByMonth.values()].map(b => b.flexible)),
    savings: median([...bucketsByMonth.values()].map(b => b.savings)),
    uncategorized: median([...bucketsByMonth.values()].map(b => b.uncategorized)),
  };

  const totalSpending = Object.values(bucketMedians).reduce((sum, v) => sum + v, 0);
  const savingsRate = incomeMedian > 0 ? (incomeMedian - totalSpending) / incomeMedian : 0;

  // Build bucket summaries with advice
  const bucketSummaries: MoneyCoachBucketSummary[] = (
    Object.keys(bucketMedians) as MoneyCoachBucket[]
  )
    .filter(bucket => bucket !== "uncategorized") // Hide uncategorized unless it's significant
    .map(bucket => {
      const metadata = BUCKET_METADATA[bucket];
      const monthlyMedian = bucketMedians[bucket];
      const pctOfIncome = incomeMedian > 0 ? (monthlyMedian / incomeMedian) * 100 : 0;

      return {
        bucket,
        label: metadata.label,
        emoji: metadata.emoji,
        monthlyMedian,
        pctOfIncome,
        targetPct: metadata.targetPct,
        advice: getBucketAdvice(bucket, pctOfIncome, metadata.targetPct),
      };
    });

  // Add uncategorized if it's more than 5% of spending
  const uncatMedian = bucketMedians.uncategorized;
  if (uncatMedian > totalSpending * 0.05) {
    bucketSummaries.push({
      bucket: "uncategorized",
      label: "Uncategorized",
      emoji: "❓",
      monthlyMedian: uncatMedian,
      pctOfIncome: incomeMedian > 0 ? (uncatMedian / incomeMedian) * 100 : 0,
      targetPct: 0,
      advice: "Some transactions aren't categorized yet. Review your spending to assign them.",
    });
  }

  return {
    incomeMedian,
    buckets: bucketSummaries,
    totalSpending,
    savingsRate,
    coverage,
  };
}
