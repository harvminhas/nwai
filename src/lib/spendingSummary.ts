/**
 * Unified Spending Data Layer — uses shared bucket computation with dashboard.
 * 
 * CRITICAL: Calls computeMonthlyBuckets() from monthlyBucketComputation.ts
 * (same function used by dashboard) to ensure identical bucket totals.
 */

import type { ExpenseTxnRecord, AccountSnapshot, DebtPaymentHistoryEntry } from "./extractTransactions";
import type { DebtPaymentReview } from "./types";
import { getCategoryBucket, type MoneyCoachBucket } from "./moneyCoachBuckets";
import { merchantSlug } from "./applyRules";
import { getLastCompleteMonth } from "./monthAnchor";
import { computeMonthlyBuckets } from "./monthlyBucketComputation";

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
  avgAmount: number;
  lastDate: string;
  isAnnual: boolean;
}

export interface CategorySummary {
  category: string;
  bucket: MoneyCoachBucket;
  total: number;
  count: number;
  merchants: MerchantSummary[];
  share: number;
}

export interface MonthlySpendingSummary {
  yearMonth: string;
  total: number;
  fixed: number;
  essentials: number;
  flexible: number;
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
  currentMonth: string;
  lastCompleteMonth: string;
  typicalMonthly: number;
  last3MonthTotals: number[];
  lastMonthTotal: number;
  vsTypical: number;
  vsTypicalPct: number;
  monthlyHistory: MonthlySpendingSummary[];
  last3Months: string[];
  buckets: BucketSummary[];
  categories: CategorySummary[];
  merchants: MerchantSummary[];
  topCategories: CategorySummary[];
  insights: SpendingInsight[];
  currency: string;
}

function detectAnnualCharge(txns: SpendingTransaction[]): boolean {
  if (txns.length <= 2) {
    const dates = txns.map(t => new Date(t.date).getTime());
    if (dates.length === 2) {
      const daysBetween = Math.abs(dates[1] - dates[0]) / (1000 * 60 * 60 * 24);
      return daysBetween >= 320 && daysBetween <= 400;
    }
  }
  return false;
}

function computeInsights(
  summary: Omit<SpendingSummary, 'insights'>,
  monthlyHistory: MonthlySpendingSummary[]
): SpendingInsight[] {
  const insights: SpendingInsight[] = [];
  
  if (Math.abs(summary.vsTypicalPct) >= 10) {
    const direction = summary.vsTypicalPct > 0 ? "up" : "down";
    const pct = Math.abs(summary.vsTypicalPct).toFixed(0);
    insights.push({
      type: "trend",
      message: `Spending ${direction} ${pct}% vs typical month`
    });
  }
  
  if (monthlyHistory.length >= 2) {
    const lastMonth = monthlyHistory[monthlyHistory.length - 1];
    const priorMonths = monthlyHistory.slice(-4, -1);
    
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
          break;
        }
      }
    }
  }
  
  return insights.slice(0, 2);
}

export function buildSpendingSummary(
  expenseTxns: ExpenseTxnRecord[],
  accountSnapshots: AccountSnapshot[],
  debtPaymentHistory: DebtPaymentHistoryEntry[],
  userReviews: DebtPaymentReview[],
  fxRates: Record<string, number>,
  currency: string = "CAD"
): SpendingSummary {
  const currentMonth = new Date().toISOString().slice(0, 7);
  const lastCompleteMonth = getLastCompleteMonth();
  
  // Get all complete months
  const monthSet = new Set<string>();
  expenseTxns.forEach(t => {
    if (t.txMonth < currentMonth) monthSet.add(t.txMonth);
  });
  const allMonths = Array.from(monthSet).sort();
  const last12Months = allMonths.slice(-12);
  
  // Use shared bucket computation for each month
  const monthlyHistory: MonthlySpendingSummary[] = last12Months.map(yearMonth => {
    const result = computeMonthlyBuckets(
      yearMonth,
      expenseTxns,
      accountSnapshots,
      debtPaymentHistory,
      userReviews,
      fxRates,
      currency
    );
    
    return {
      yearMonth: result.yearMonth,
      total: result.total,
      fixed: result.buckets.fixed,
      essentials: result.buckets.essentials,
      flexible: result.buckets.flexible,
      categories: result.items.map(item => ({
        category: item.category,
        amount: item.amount,
        bucket: item.bucket
      }))
      // Note: result.excludedItems (savings, uncategorized) are NOT included in categories
    };
  });
  
  const last3Months = last12Months.slice(-3);
  const last3Data = monthlyHistory.slice(-3);
  
  const last3Totals = last3Data.map(m => m.total);
  const typicalMonthly = last3Totals.length > 0
    ? last3Totals.reduce((a, b) => a + b, 0) / last3Totals.length
    : 0;
  
  const lastMonthData = monthlyHistory.find(m => m.yearMonth === lastCompleteMonth);
  const lastMonthTotal = lastMonthData?.total || 0;
  const vsTypical = lastMonthTotal - typicalMonthly;
  const vsTypicalPct = typicalMonthly > 0 ? (vsTypical / typicalMonthly) * 100 : 0;
  
  // Build merchant summaries from actual transactions (not synthetic loan payments)
  const merchantMap = new Map<string, MerchantSummary>();
  
  monthlyHistory.forEach(month => {
    month.categories.forEach(cat => {
      // Skip synthetic "Loan payments" category
      if (cat.category === "Loan payments") return;
      
      // Find transactions for this category in this month
      const categoryTxns = expenseTxns.filter(t =>
        t.txMonth === month.yearMonth &&
        t.category === cat.category
      );
      
      categoryTxns.forEach(t => {
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
    });
  });
  
  merchantMap.forEach(m => {
    m.avgAmount = m.count > 0 ? m.total / m.count : 0;
    m.isAnnual = detectAnnualCharge(m.transactions);
    m.transactions.sort((a, b) => b.date.localeCompare(a.date));
  });
  
  const merchants = Array.from(merchantMap.values());
  
  // Build category summaries
  const categoryMap = new Map<string, CategorySummary>();
  
  // Aggregate categories across all months (including synthetic "Loan payments")
  monthlyHistory.forEach(month => {
    month.categories.forEach(cat => {
      if (!categoryMap.has(cat.category)) {
        categoryMap.set(cat.category, {
          category: cat.category,
          bucket: cat.bucket,
          total: 0,
          count: 0,
          merchants: [],
          share: 0
        });
      }
      categoryMap.get(cat.category)!.total += cat.amount;
    });
  });
  
  // Add merchants to categories (skip "Loan payments" which has no merchants)
  merchants.forEach(m => {
    const cat = categoryMap.get(m.category);
    if (cat) {
      cat.merchants.push(m);
      cat.count += m.count;
    }
  });
  
  const categories = Array.from(categoryMap.values());
  const grandTotal = categories.reduce((sum, c) => sum + c.total, 0);
  categories.forEach(c => {
    c.share = grandTotal > 0 ? c.total / grandTotal : 0;
    c.merchants.sort((a, b) => b.total - a.total);
  });
  
  const topCategories = [...categories].sort((a, b) => b.total - a.total).slice(0, 5);
  
  // Bucket summaries (3-month average)
  const bucketMap = new Map<MoneyCoachBucket, BucketSummary>();
  
  ["fixed", "essentials", "flexible"].forEach(b => {
    bucketMap.set(b as MoneyCoachBucket, {
      bucket: b as MoneyCoachBucket,
      total: 0,
      share: 0,
      categories: []
    });
  });
  
  last3Data.forEach(month => {
    bucketMap.get("fixed")!.total += month.fixed;
    bucketMap.get("essentials")!.total += month.essentials;
    bucketMap.get("flexible")!.total += month.flexible;
  });
  
  const buckets = Array.from(bucketMap.values());
  buckets.forEach(b => {
    b.total = b.total / Math.max(1, last3Data.length);
    b.categories = categories.filter(c => c.bucket === b.bucket);
  });
  
  const bucketTotal = buckets.reduce((sum, b) => sum + b.total, 0);
  buckets.forEach(b => {
    b.share = bucketTotal > 0 ? b.total / bucketTotal : 0;
  });
  
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
  
  const insights = computeInsights(summaryWithoutInsights, monthlyHistory);
  
  return {
    ...summaryWithoutInsights,
    insights
  };
}

