/**
 * Subscription Detection Engine
 * 
 * Detects recurring subscriptions from transaction history.
 * Identifies cadence (monthly/yearly), price changes, and new subscriptions.
 * Feeds ambiguous candidates to the shared review framework.
 */

import type { ExpenseTxnRecord } from "./extractTransactions";
import { merchantSlug } from "./applyRules";

export type SubscriptionCadence = "monthly" | "yearly" | "ambiguous";

export interface DetectedSubscription {
  merchant: string;
  merchantSlug: string;
  category: string;
  /** Current amount per charge */
  amount: number;
  /** Monthly or yearly */
  cadence: SubscriptionCadence;
  /** Last charge date */
  lastDate: string;
  /** Expected next charge date (estimated) */
  nextDate: string | null;
  /** Number of charges in history */
  chargeCount: number;
  /** True if this is a new subscription (first charge in last 60 days) */
  isNew: boolean;
  /** True if price increased recently */
  priceIncrease: boolean;
  /** Amount of price increase if applicable */
  priceIncreaseAmount?: number;
  /** Previous amount before increase */
  previousAmount?: number;
  /** All transaction dates for this subscription */
  transactions: Array<{ date: string; amount: number }>;
}

export interface SubscriptionSummary {
  subscriptions: DetectedSubscription[];
  /** Total per month (yearly prorated) */
  monthlyTotal: number;
  /** Total per year */
  yearlyTotal: number;
  /** Change in monthly total vs prior month */
  monthlyChange: number;
  /** Number of active subscriptions */
  activeCount: number;
  /** Number of new subscriptions (last 60 days) */
  newCount: number;
  /** Number with price increases (last 90 days) */
  priceIncreaseCount: number;
  /** Currency */
  currency: string;
}

interface MerchantPattern {
  merchant: string;
  merchantSlug: string;
  category: string;
  transactions: Array<{ date: string; amount: number }>;
}

/**
 * Calculate day difference between two dates
 */
function daysBetween(date1: string, date2: string): number {
  const d1 = new Date(date1).getTime();
  const d2 = new Date(date2).getTime();
  return Math.abs(d2 - d1) / (1000 * 60 * 60 * 24);
}

/**
 * Add months to a date
 */
function addMonths(date: string, months: number): string {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

/**
 * Detect if a merchant pattern is a subscription
 */
function detectSubscription(pattern: MerchantPattern): DetectedSubscription | null {
  const { merchant, merchantSlug, category, transactions } = pattern;
  
  // Need at least 2 transactions
  if (transactions.length < 2) return null;
  
  // Sort by date
  const sorted = [...transactions].sort((a, b) => a.date.localeCompare(b.date));
  
  // Calculate intervals between charges
  const intervals: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    intervals.push(daysBetween(sorted[i - 1].date, sorted[i].date));
  }
  
  // Average interval
  const avgInterval = intervals.reduce((s, i) => s + i, 0) / intervals.length;
  
  // Determine cadence
  let cadence: SubscriptionCadence = "ambiguous";
  if (avgInterval >= 25 && avgInterval <= 35) {
    cadence = "monthly";
  } else if (avgInterval >= 320 && avgInterval <= 400) {
    cadence = "yearly";
  } else if (intervals.length >= 3 && intervals.every(i => Math.abs(i - avgInterval) / avgInterval < 0.15)) {
    // Consistent interval but not monthly/yearly - still ambiguous
    cadence = "ambiguous";
  } else {
    // Too irregular - not a subscription
    return null;
  }
  
  // If ambiguous with fewer than 3 charges, skip
  if (cadence === "ambiguous" && transactions.length < 3) return null;
  
  // Last charge
  const lastTxn = sorted[sorted.length - 1];
  const lastDate = lastTxn.date;
  const amount = lastTxn.amount;
  
  // Estimate next date
  let nextDate: string | null = null;
  if (cadence === "monthly") {
    nextDate = addMonths(lastDate, 1);
  } else if (cadence === "yearly") {
    nextDate = addMonths(lastDate, 12);
  }
  
  // Check if new (first charge in last 60 days)
  const firstDate = sorted[0].date;
  const daysSinceFirst = daysBetween(firstDate, new Date().toISOString().slice(0, 10));
  const isNew = daysSinceFirst <= 60 && sorted.length <= 2;
  
  // Check for price increase (last charge > previous charges avg)
  const priorCharges = sorted.slice(0, -1);
  const priorAvg = priorCharges.reduce((s, t) => s + t.amount, 0) / priorCharges.length;
  const priceIncrease = amount > priorAvg * 1.05; // 5% threshold
  const priceIncreaseAmount = priceIncrease ? amount - priorAvg : undefined;
  const previousAmount = priceIncrease ? priorAvg : undefined;
  
  return {
    merchant,
    merchantSlug,
    category,
    amount,
    cadence,
    lastDate,
    nextDate,
    chargeCount: transactions.length,
    isNew,
    priceIncrease,
    priceIncreaseAmount,
    previousAmount,
    transactions: sorted,
  };
}

/**
 * Build subscription summary from expense transactions
 */
export function buildSubscriptionSummary(
  expenseTxns: ExpenseTxnRecord[],
  currency: string = "CAD"
): SubscriptionSummary {
  // Group by merchant
  const merchantMap = new Map<string, MerchantPattern>();
  
  expenseTxns.forEach(txn => {
    const slug = merchantSlug(txn.merchant);
    if (!merchantMap.has(slug)) {
      merchantMap.set(slug, {
        merchant: txn.merchant,
        merchantSlug: slug,
        category: txn.category,
        transactions: [],
      });
    }
    
    merchantMap.get(slug)!.transactions.push({
      date: txn.date,
      amount: Math.abs(txn.amount),
    });
  });
  
  // Detect subscriptions
  const subscriptions: DetectedSubscription[] = [];
  merchantMap.forEach(pattern => {
    const sub = detectSubscription(pattern);
    if (sub) {
      subscriptions.push(sub);
    }
  });
  
  // Sort by amount (highest first)
  subscriptions.sort((a, b) => b.amount - a.amount);
  
  // Calculate totals
  let monthlyTotal = 0;
  subscriptions.forEach(sub => {
    if (sub.cadence === "monthly") {
      monthlyTotal += sub.amount;
    } else if (sub.cadence === "yearly") {
      monthlyTotal += sub.amount / 12;
    }
  });
  
  const yearlyTotal = monthlyTotal * 12;
  
  // Count flags
  const newCount = subscriptions.filter(s => s.isNew).length;
  const priceIncreaseCount = subscriptions.filter(s => s.priceIncrease).length;
  
  return {
    subscriptions,
    monthlyTotal,
    yearlyTotal,
    monthlyChange: 0, // TODO: implement month-over-month comparison
    activeCount: subscriptions.length,
    newCount,
    priceIncreaseCount,
    currency,
  };
}
