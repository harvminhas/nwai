/**
 * Unified Spending Data Layer — single source of truth for all spending computations.
 * 
 * CRITICAL: Uses the SAME bucket classification as dashboard (getCategoryBucket from moneyCoachBuckets.ts)
 * to ensure spending page totals exactly match dashboard card averages.
 * 
 * Used by:
 * - Spending page (all 5 tabs)
 * - Dashboard Fixed/Essentials/Flexible cards/drawers
 * - Spending API routes
 */

import type { ExpenseTxnRecord } from "./extractTransactions";
import { getParentCategory } from "./categoryTaxonomy";
import { getCategoryBucket, type MoneyCoachBucket } from "./moneyCoachBuckets";
import { isCoreExcluded } from "./spendingMetrics";
import { merchantSlug } from "./applyRules";
import { getLastCompleteMonth } from "./monthAnchor";

export interface SpendingTransaction {
  date: string;
  merchant: string;
  merchantSlug: string;
  category: string;
  amount: number;
  accountLabel?: string;
  accountSlug?: string;
  txMonth: string;
}

export interface MerchantSummary {
  merchant: string;
  merchantSlug: string;
  category: string;
  bucket: MoneyCoachBucket;
  total: number;
  count: number;
  transactions: SpendingTransaction[];
  /** Average amount per transaction */
  avgAmount: number;
  /** Most recent transaction date */
  lastDate: string;
  /** True if this appears to be annual (for flagging) */
  isAnnual: boolean;
}

export interface CategorySummary {
  category: string;
  bucket: MoneyCoachBucket;
  total: number;
  count: number;
  merchants: MerchantSummary[];
  /** Share of total spending (0-1) */
  share: number;
}

export interface MonthlySpendingSummary {
  /** YYYY-MM */
  yearMonth: string;
  /** Total spending (excluding transfers) */
  total: number;
  /** Fixed bucket total */
  fixed: number;
  /** Essentials bucket total */
  essentials: number;
  /** Flexible bucket total */
  flexible: number;
  /** Per-category breakdown */
  categories: Array<{ category: string; amount: number; bucket: MoneyCoachBucket }>;
}

export interface BucketSummary {
  bucket: MoneyCoachBucket;
  total: number;
  share: number;
  categories: CategorySummary[];
}

export interface SpendingInsight {
  type: "trend" | "notable_category" | "new_merchant";
  message: string;
}

export interface SpendingSummary {
  /** Current month (YYYY-MM) */
  currentMonth: string;
  /** Last complete month (YYYY-MM) */
  lastCompleteMonth: string;
  /** Typical monthly spending (average of last 3 complete months) */
  typicalMonthly: number;
  /** Last 3 complete months totals */
  last3MonthTotals: number[];
  /** Last complete month total */
  lastMonthTotal: number;
  /** Change vs typical (absolute) */
  vsTypical: number;
  /** Change vs typical (percentage) */
  vsTypicalPct: number;
  /** Monthly history (last 12 complete months) */
  monthlyHistory: MonthlySpendingSummary[];
  /** Last 3 complete months */
  last3Months: string[];
  /** Bucket summaries for LAST 3 COMPLETE MONTHS (3-month average, matching dashboard) */
  buckets: BucketSummary[];
  /** All categories across all time */
  categories: CategorySummary[];
  /** All merchants across all time */
  merchants: MerchantSummary[];
  /** Top categories by total */
  topCategories: CategorySummary[];
  /** Insights (computed from data) */
  insights: SpendingInsight[];
  /** Currency */
  currency: string;
}

function detectAnnualCharge(txns: SpendingTransaction[]): boolean {
  // If only 1-2 transactions and they're ~12 months apart, it's annual
  if (txns.length <= 2) {
    const dates = txns.map(t => new Date(t.date).getTime());
    if (dates.length === 2) {
      const daysBetween = Math.abs(dates[1] - dates[0]) / (1000 * 60 * 60 * 24);
      return daysBetween >= 320 && daysBetween <= 400; // ~11-13 months
    }
  }
  return false;
}

function computeInsights(
  summary: Omit<SpendingSummary, 'insights'>,
  monthlyHistory: MonthlySpendingSummary[]
): SpendingInsight[] {
  const insights: SpendingInsight[] = [];
  
  // Trend: spending up or down vs typical
  if (Math.abs(summary.vsTypicalPct) >= 10) {
    const direction = summary.vsTypicalPct > 0 ? "up" : "down";
    const pct = Math.abs(summary.vsTypicalPct).toFixed(0);
    insights.push({
      type: "trend",
      message: `Spending ${direction} ${pct}% vs typical month`
    });
  }
  
  // Notable category: biggest change
  if (monthlyHistory.length >= 2) {
    const lastMonth = monthlyHistory[monthlyHistory.length - 1];
    const priorMonths = monthlyHistory.slice(-4, -1); // 3 months before last
    
    for (const cat of lastMonth.categories) {
      const priorAvg = priorMonths.reduce((sum, m) => {
        const c = m.categories.find(c => c.category === cat.category);
        return sum + (c?.amount || 0);
      }, 0) / priorMonths.length;
      
      if (priorAvg > 0) {
        const change = ((cat.amount - priorAvg) / priorAvg) * 100;
        if (Math.abs(change) >= 50 && cat.amount > 100) {
          const dir = change > 0 ? "up" : "down";
          insights.push({
            type: "notable_category",
            message: `${cat.category} ${dir} ${Math.abs(change).toFixed(0)}% vs recent months`
          });
          break; // Only show one
        }
      }
    }
  }
  
  return insights.slice(0, 2); // Max 2 insights
}

export function buildSpendingSummary(
  expenseTxns: ExpenseTxnRecord[],
  currency: string = "CAD"
): SpendingSummary {
  // Filter out excluded categories (transfers, etc.)
  const validTxns = expenseTxns.filter(t => !isCoreExcluded(t.category));
  
  // Get time windows
  const currentMonth = new Date().toISOString().slice(0, 7);
  const lastCompleteMonth = getLastCompleteMonth();
  
  // Build monthly history (last 12 complete months)
  const monthSet = new Set<string>();
  validTxns.forEach(t => {
    if (t.txMonth < currentMonth) monthSet.add(t.txMonth);
  });
  const allMonths = Array.from(monthSet).sort();
  const last12Months = allMonths.slice(-12);
  
  const monthlyHistory: MonthlySpendingSummary[] = last12Months.map(yearMonth => {
    const monthTxns = validTxns.filter(t => t.txMonth === yearMonth);
    
    const categoryTotals = new Map<string, number>();
    let fixed = 0, essentials = 0, flexible = 0;
    
    monthTxns.forEach(t => {
      const amt = Math.abs(t.amount);
      categoryTotals.set(t.category, (categoryTotals.get(t.category) || 0) + amt);
      
      // Use dashboard bucket classification
      const bucket = getCategoryBucket(t.category);
      if (bucket === "fixed") fixed += amt;
      else if (bucket === "essentials") essentials += amt;
      else if (bucket === "flexible") flexible += amt;
      // Note: "savings" bucket (Investments & Savings) is excluded by isCoreExcluded
    });
    
    const categories = Array.from(categoryTotals.entries()).map(([category, amount]) => ({
      category,
      amount,
      bucket: getCategoryBucket(category)
    }));
    
    return {
      yearMonth,
      total: fixed + essentials + flexible,
      fixed,
      essentials,
      flexible,
      categories
    };
  });
  
  // Last 3 complete months
  const last3Months = last12Months.slice(-3);
  const last3Data = monthlyHistory.slice(-3);
  
  // Typical monthly = AVERAGE of last 3 (matching dashboard definition)
  const last3Totals = last3Data.map(m => m.total);
  const typicalMonthly = last3Totals.length > 0
    ? last3Totals.reduce((a, b) => a + b, 0) / last3Totals.length
    : 0;
  
  // Last month stats
  const lastMonthData = monthlyHistory.find(m => m.yearMonth === lastCompleteMonth);
  const lastMonthTotal = lastMonthData?.total || 0;
  const vsTypical = lastMonthTotal - typicalMonthly;
  const vsTypicalPct = typicalMonthly > 0 ? (vsTypical / typicalMonthly) * 100 : 0;
  
  // Build merchant summaries (all time)
  const merchantMap = new Map<string, MerchantSummary>();
  validTxns.forEach(t => {
    const slug = merchantSlug(t.merchant);
    if (!merchantMap.has(slug)) {
      merchantMap.set(slug, {
        merchant: t.merchant,
        merchantSlug: slug,
        category: t.category,
        bucket: getCategoryBucket(t.category),
        total: 0,
        count: 0,
        transactions: [],
        avgAmount: 0,
        lastDate: t.date,
        isAnnual: false
      });
    }
    
    const m = merchantMap.get(slug)!;
    m.total += Math.abs(t.amount);
    m.count++;
    m.transactions.push({
      date: t.date,
      merchant: t.merchant,
      merchantSlug: slug,
      category: t.category,
      amount: Math.abs(t.amount),
      accountLabel: t.accountLabel,
      accountSlug: t.accountSlug,
      txMonth: t.txMonth
    });
    if (t.date > m.lastDate) m.lastDate = t.date;
  });
  
  // Calculate avg and detect annual
  merchantMap.forEach(m => {
    m.avgAmount = m.count > 0 ? m.total / m.count : 0;
    m.isAnnual = detectAnnualCharge(m.transactions);
    m.transactions.sort((a, b) => b.date.localeCompare(a.date));
  });
  
  const merchants = Array.from(merchantMap.values());
  
  // Build category summaries (all time)
  const categoryMap = new Map<string, CategorySummary>();
  merchants.forEach(m => {
    if (!categoryMap.has(m.category)) {
      categoryMap.set(m.category, {
        category: m.category,
        bucket: getCategoryBucket(m.category),
        total: 0,
        count: 0,
        merchants: [],
        share: 0
      });
    }
    
    const c = categoryMap.get(m.category)!;
    c.total += m.total;
    c.count += m.count;
    c.merchants.push(m);
  });
  
  const categories = Array.from(categoryMap.values());
  const grandTotal = categories.reduce((sum, c) => sum + c.total, 0);
  categories.forEach(c => {
    c.share = grandTotal > 0 ? c.total / grandTotal : 0;
    c.merchants.sort((a, b) => b.total - a.total);
  });
  
  // Top categories
  const topCategories = [...categories].sort((a, b) => b.total - a.total).slice(0, 5);
  
  // Bucket summaries for LAST 3 MONTHS (3-month average to match dashboard)
  const bucketMap = new Map<MoneyCoachBucket, BucketSummary>();
  
  ["fixed", "essentials", "flexible"].forEach(b => {
    bucketMap.set(b as MoneyCoachBucket, {
      bucket: b as MoneyCoachBucket,
      total: 0,
      share: 0,
      categories: []
    });
  });
  
  // Average buckets over last 3 months
  last3Data.forEach(month => {
    bucketMap.get("fixed")!.total += month.fixed;
    bucketMap.get("essentials")!.total += month.essentials;
    bucketMap.get("flexible")!.total += month.flexible;
  });
  
  const buckets = Array.from(bucketMap.values());
  buckets.forEach(b => {
    b.total = b.total / Math.max(1, last3Data.length); // Average over 3 months
    b.categories = categories.filter(c => c.bucket === b.bucket);
  });
  
  const bucketTotal = buckets.reduce((sum, b) => sum + b.total, 0);
  buckets.forEach(b => {
    b.share = bucketTotal > 0 ? b.total / bucketTotal : 0;
  });
  
  // Build summary object (without insights first)
  const summaryWithoutInsights: Omit<SpendingSummary, 'insights'> = {
    currentMonth,
    lastCompleteMonth,
    typicalMonthly,
    last3MonthTotals: last3Totals,
    lastMonthTotal,
    vsTypical,
    vsTypicalPct,
    monthlyHistory,
    last3Months,
    buckets,
    categories,
    merchants,
    topCategories,
    currency
  };
  
  // Compute insights
  const insights = computeInsights(summaryWithoutInsights, monthlyHistory);
  
  return {
    ...summaryWithoutInsights,
    insights
  };
}
