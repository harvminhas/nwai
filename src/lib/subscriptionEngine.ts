/**
 * Subscription Detection Engine
 * 
 * CONSERVATIVE detection: Only true subscription-type merchants (streaming, software, memberships, cloud storage).
 * 
 * EXCLUDED from subscriptions:
 * - Loans, utilities, insurance, rent/mortgage
 * - Transfers, groceries, fuel, dining
 * - Irregular merchants
 * 
 * Ambiguous candidates → 'subscription' review type (not counted until confirmed)
 * 
 * SANITY CHECKS:
 * - Fail if monthly subscriptions > 10% of spending
 * - Fail if count > 30 active subscriptions
 */

import type { ExpenseTxnRecord } from "./extractTransactions";
import { getParentCategory } from "./categoryTaxonomy";
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
  /** True if this is ambiguous and needs review */
  needsReview: boolean;
}

export interface SubscriptionSummary {
  /** Confirmed subscriptions only (excluding ambiguous/review items) */
  subscriptions: DetectedSubscription[];
  /** Ambiguous candidates for review */
  ambiguous: DetectedSubscription[];
  /** Total per month (yearly prorated, confirmed only) */
  monthlyTotal: number;
  /** Total per year (confirmed only) */
  yearlyTotal: number;
  /** Change in monthly total vs prior month */
  monthlyChange: number;
  /** Number of active confirmed subscriptions */
  activeCount: number;
  /** Number of new subscriptions (last 60 days) */
  newCount: number;
  /** Number with price increases (last 90 days) */
  priceIncreaseCount: number;
  /** Currency */
  currency: string;
  /** Sanity check failures (if any) */
  sanityCheckFailures: string[];
}

interface MerchantPattern {
  merchant: string;
  merchantSlug: string;
  category: string;
  transactions: Array<{ date: string; amount: number }>;
}

/**
 * Parent categories that can contain subscriptions (whitelist)
 */
const SUBSCRIPTION_PARENT_CATEGORIES = new Set([
  "Subscriptions",       // Streaming, software, memberships, news & media
  "Entertainment",       // Streaming services specifically
  "Personal Care",       // Gym/fitness memberships
]);

/**
 * Parent categories to EXCLUDE from subscription detection
 */
const EXCLUDED_PARENT_CATEGORIES = new Set([
  "Housing",            // Rent, mortgage, utilities, internet, home insurance
  "Insurance",          // Life, disability, auto, home, health insurance
  "Debt",               // Loans, credit card payments
  "Taxes",              // Any tax payments
  "Groceries",          // Grocery stores
  "Transportation",     // Gas, parking, transit
  "Healthcare",         // Pharmacy, medical
  "Dining",             // Restaurants
  "Shopping",           // Retail
  "Travel",             // Hotels, flights
  "Cash & ATM",         // Cash withdrawals
  "Transfers",          // Transfers
  "Fees",               // Bank fees
  "Education",          // Tuition
  "Investments & Savings", // RRSP, TFSA, etc.
]);

/**
 * Merchant name patterns that are NEVER subscriptions (even if recurring)
 */
const EXCLUDED_MERCHANT_PATTERNS = [
  /^(esso|shell|petro|gas|fuel)/i,
  /^(loblaws|sobeys|metro|walmart|costco|safeway|freshco|nofrills|food basics)/i,
  /^(mcdonald|tim horton|starbucks|subway|burger king)/i,
  /^(td |rbc |bmo |cibc |scotiabank|tangerine|pc financial)/i,
  /^(enbridge|hydro|water|electric|power|utility|internet|rogers|bell|telus|shaw)/i,
  /^(rent|mortgage|property tax|condo fee|hoa)/i,
  /^(insurance|allstate|state farm|td insurance)/i,
  /loan|payment|transfer|withdraw/i,
];

/**
 * Merchant name patterns that ARE likely subscriptions
 */
const SUBSCRIPTION_MERCHANT_PATTERNS = [
  /netflix|spotify|disney|hbo|amazon prime|apple (tv|music|one)|youtube premium/i,
  /adobe|microsoft 365|office|google (one|workspace)|dropbox|icloud/i,
  /gym|fitness|peloton|yoga|planet fitness|goodlife|anytime fitness/i,
  /patreon|substack|medium membership/i,
  /audible|kindle unlimited/i,
];

function daysBetween(date1: string, date2: string): number {
  const d1 = new Date(date1).getTime();
  const d2 = new Date(date2).getTime();
  return Math.abs(d2 - d1) / (1000 * 60 * 60 * 24);
}

function addMonths(date: string, months: number): string {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

function isSubscriptionMerchant(merchant: string): boolean {
  // Check explicit exclusions first
  if (EXCLUDED_MERCHANT_PATTERNS.some(p => p.test(merchant))) {
    return false;
  }
  
  // Check if it matches known subscription patterns
  return SUBSCRIPTION_MERCHANT_PATTERNS.some(p => p.test(merchant));
}

function isAmbiguousSubscription(merchant: string, category: string): boolean {
  const parent = getParentCategory(category);
  
  // If merchant is explicitly a subscription, not ambiguous
  if (isSubscriptionMerchant(merchant)) {
    return false;
  }
  
  // If in subscription parent category but not explicitly matched, ambiguous
  if (SUBSCRIPTION_PARENT_CATEGORIES.has(parent)) {
    return true;
  }
  
  // Otherwise not a subscription at all
  return false;
}

function detectSubscription(pattern: MerchantPattern): DetectedSubscription | null {
  const { merchant, merchantSlug, category, transactions } = pattern;
  const parent = getParentCategory(category);
  
  // Hard exclusions (never subscriptions)
  if (EXCLUDED_PARENT_CATEGORIES.has(parent)) {
    return null;
  }
  
  if (EXCLUDED_MERCHANT_PATTERNS.some(p => p.test(merchant))) {
    return null;
  }
  
  // Need at least 2 transactions for recurring pattern
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
  } else {
    // Not a clear recurring pattern
    return null;
  }
  
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
  
  // Check for price increase
  const priorCharges = sorted.slice(0, -1);
  const priorAvg = priorCharges.reduce((s, t) => s + t.amount, 0) / priorCharges.length;
  const priceIncrease = amount > priorAvg * 1.05; // 5% threshold
  const priceIncreaseAmount = priceIncrease ? amount - priorAvg : undefined;
  const previousAmount = priceIncrease ? priorAvg : undefined;
  
  // Determine if needs review
  const needsReview = isAmbiguousSubscription(merchant, category);
  
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
    needsReview,
  };
}

export function buildSubscriptionSummary(
  expenseTxns: ExpenseTxnRecord[],
  currency: string = "CAD",
  totalSpending?: number // For sanity check
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
  const allDetected: DetectedSubscription[] = [];
  merchantMap.forEach(pattern => {
    const sub = detectSubscription(pattern);
    if (sub) {
      allDetected.push(sub);
    }
  });
  
  // Split confirmed vs ambiguous
  const subscriptions = allDetected.filter(s => !s.needsReview);
  const ambiguous = allDetected.filter(s => s.needsReview);
  
  // Sort by amount (highest first)
  subscriptions.sort((a, b) => b.amount - a.amount);
  ambiguous.sort((a, b) => b.amount - a.amount);
  
  // Calculate totals (confirmed only)
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
  
  // Sanity checks
  const sanityCheckFailures: string[] = [];
  
  if (subscriptions.length > 30) {
    sanityCheckFailures.push(`Too many subscriptions: ${subscriptions.length} (max 30)`);
  }
  
  if (totalSpending && totalSpending > 0) {
    const subscriptionPct = (monthlyTotal / totalSpending) * 100;
    if (subscriptionPct > 10) {
      sanityCheckFailures.push(`Subscriptions are ${subscriptionPct.toFixed(1)}% of spending (max 10%)`);
    }
  }
  
  return {
    subscriptions,
    ambiguous,
    monthlyTotal,
    yearlyTotal,
    monthlyChange: 0, // TODO: implement month-over-month comparison
    activeCount: subscriptions.length,
    newCount,
    priceIncreaseCount,
    currency,
    sanityCheckFailures,
  };
}
