/**
 * Subscription Detection Engine - Two-Tier System
 * 
 * TIER 1 - CONFIRMED (counted in totals):
 * - Known subscription merchants (streaming, software, memberships, cloud)
 * - Category 'Subscriptions', 'Software', 'Streaming' with recurring pattern
 * - User-confirmed via review framework
 * - Regular cadence + consistent amount
 * 
 * TIER 2 - CANDIDATES (NOT counted):
 * - Recurring-looking but not on known list and not in subscription categories
 * - Sent to 'subscription' review for user confirmation
 * 
 * HARD EXCLUSIONS (never subscriptions):
 * - Groceries, Shopping, Dining, School Fees, Charity, Housing categories
 * - Interest, fees, bank charges, debt, transfers, e-transfers, person names
 * - Loans, insurance, utilities, rent, taxes, income
 * 
 * ACTIVE STATUS (relative to latest transaction date, NOT today):
 * - Monthly: charged within cadence+grace (45 days) of latest txn date
 * - Yearly: charged within 400 days of latest txn date
 * - Otherwise: Inactive/cancelled (not counted in totals)
 * 
 * PRICE INCREASE:
 * - Only for confirmed subs with same cadence
 * - ≥5% change comparing consecutive charges
 */

import type { ExpenseTxnRecord } from "./extractTransactions";
import { getParentCategory } from "./categoryTaxonomy";
import { merchantSlug } from "./applyRules";

export type SubscriptionCadence = "monthly" | "yearly" | "ambiguous";
export type SubscriptionStatus = "active" | "inactive";
export type SubscriptionTier = "confirmed" | "candidate";

export interface DetectedSubscription {
  merchant: string;
  merchantSlug: string;
  category: string;
  amount: number;
  cadence: SubscriptionCadence;
  lastDate: string;
  nextDate: string | null;
  chargeCount: number;
  isNew: boolean;
  priceIncrease: boolean;
  priceIncreaseAmount?: number;
  previousAmount?: number;
  transactions: Array<{ date: string; amount: number }>;
  /** Tier: confirmed (counted) or candidate (needs review) */
  tier: SubscriptionTier;
  /** Status: active or inactive */
  status: SubscriptionStatus;
}

export interface SubscriptionSummary {
  /** Active confirmed subscriptions only */
  subscriptions: DetectedSubscription[];
  /** Candidates needing review (NOT counted) */
  candidates: DetectedSubscription[];
  /** Inactive/cancelled subscriptions */
  inactive: DetectedSubscription[];
  /** Total per month (confirmed active only, yearly prorated) */
  monthlyTotal: number;
  /** Total per year (confirmed active only) */
  yearlyTotal: number;
  monthlyChange: number;
  /** Number of active confirmed subscriptions */
  activeCount: number;
  /** Number of new subscriptions (confirmed, last 60 days) */
  newCount: number;
  /** Number with price increases (confirmed, last 90 days) */
  priceIncreaseCount: number;
  /** Number of candidates needing review */
  candidateCount: number;
  currency: string;
  sanityCheckFailures: string[];
}

/**
 * Known subscription merchants (streaming, software, memberships, cloud)
 * These are automatically confirmed as subscriptions.
 */
const KNOWN_SUBSCRIPTION_MERCHANTS = [
  // Streaming video
  "netflix", "disney", "disney-plus", "hbo", "hbo-max", "amazon-prime", 
  "prime-video", "apple-tv", "youtube-premium", "paramount", "crave",
  
  // Streaming music
  "spotify", "apple-music", "tidal", "deezer", "youtube-music", "siriusxm", "sirius",
  
  // Cloud storage
  "icloud", "google-one", "dropbox", "microsoft-onedrive", "onedrive",
  
  // Software & productivity
  "adobe", "microsoft-365", "office-365", "google-workspace",
  "obsidian", "notion", "evernote", "todoist", "slack",
  
  // AI & Development tools
  "openai", "chatgpt", "anthropic", "claude", "github", "gitlab", 
  "vercel", "netlify", "ngrok", "digitalocean", "heroku",
  
  // Cloud services (only when in Subscriptions/Software category)
  "aws", "amazon-web-services", "google-cloud",
  
  // Fitness & wellness
  "peloton", "goodlife", "planet-fitness", "anytime-fitness",
  "classpass", "strava", "headspace", "calm",
  
  // News & media
  "new-york-times", "wall-street-journal", "economist", 
  "washington-post", "patreon", "substack", "medium",
  
  // Other subscriptions
  "audible", "kindle-unlimited", "scribd", "masterclass",
];

/**
 * Merchant variants that should be merged
 */
const MERCHANT_VARIANT_MAP: Record<string, string> = {
  "anthropic": "anthropic",
  "claude": "anthropic",
  "claude-ai": "anthropic",
  "chatgpt": "openai",
  "openai": "openai",
  "siriusxm": "siriusxm",
  "sirius": "siriusxm",
};

/**
 * Categories that automatically confirm recurring charges as subscriptions
 */
const SUBSCRIPTION_CATEGORIES = new Set([
  "Subscriptions",
  "Software",
  "Streaming",
]);

/**
 * Hard-exclude categories (never subscriptions)
 */
const EXCLUDED_CATEGORIES = new Set([
  "Interest",
  "Fees",
  "Debt Payments",
  "Transfers",
  "Transfers & Payments",
  "Loans",
  "Insurance",
  "Taxes",
  "Income",
  "Cash & ATM",
  "Investments & Savings",
  "Groceries",
  "Shopping",
  "Dining",
  "School Fees",
  "Charity",
  "Education",
]);

/**
 * Parent categories that are never subscriptions
 */
const EXCLUDED_PARENT_CATEGORIES = new Set([
  "Debt",
  "Taxes",
  "Investments & Savings",
  "Groceries",
  "Shopping",
  "Dining",
  "Education",
  "Housing", // Includes utilities, home comfort, alarm
]);

/**
 * Merchant patterns that are never subscriptions
 */
const EXCLUDED_MERCHANT_PATTERNS = [
  // Bank fees & interest
  /interest|int-chg|o\.d\.p\.|overdraft|nsf|service charge|account fee|monthly fee/i,
  
  // Transfers & e-transfers
  /transfer|e-transfer|etransfer|interac|paypal transfer|venmo/i,
  
  // Person names (e-transfers to people)
  /^(mr|mrs|ms|miss|dr)\.?\s+[a-z]/i,
  /^[a-z]+\s+[a-z]+\s+[a-z]+$/i, // "firstname middlename lastname" pattern
  
  // Utilities & home services
  /hydro|water|electric|power|enbridge|utility/i,
  /internet|rogers|bell|telus|shaw|videotron/i,
  /alarm|home comfort|adt security|protection plan/i,
  
  // Insurance
  /insurance|allstate|state farm|td insurance|manulife/i,
  
  // Loans & debt
  /loan|mortgage|line of credit|credit payment/i,
  
  // Rent & property
  /rent|landlord|property management|condo fee|strata/i,
  
  // Transportation
  /gas station|esso|shell|petro|fuel|parking/i,
  
  // Groceries (specific stores)
  /loblaws|sobeys|metro|walmart|costco|safeway|freshco|nofrills|food basics/i,
  /t&t|singh.*farm|warraich|punjabi.*bazaar|indian.*bazaar|grocery|supermarket/i,
  
  // Shopping
  /dollarama|dollar store|home depot|canadian tire|best buy/i,
  
  // Dining
  /restaurant|mcdonald|tim horton|starbucks|subway|burger king/i,
  
  // School & charity
  /school|tuition|daycare|donation|charity|temple|church|gurdwara|mosque/i,
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

function isHardExcluded(merchant: string, category: string): boolean {
  const parent = getParentCategory(category);
  
  // Check excluded categories
  if (EXCLUDED_CATEGORIES.has(category)) return true;
  if (EXCLUDED_PARENT_CATEGORIES.has(parent)) return true;
  
  // Check excluded merchant patterns
  if (EXCLUDED_MERCHANT_PATTERNS.some(p => p.test(merchant))) return true;
  
  return false;
}

function isKnownSubscription(merchantSlugValue: string, category: string): boolean {
  // Check if category is a subscription category
  if (SUBSCRIPTION_CATEGORIES.has(category)) {
    return true;
  }
  
  // Check known merchants
  return KNOWN_SUBSCRIPTION_MERCHANTS.some(known => 
    merchantSlugValue === known || merchantSlugValue.includes(known)
  );
}

function normalizeSubscriptionMerchant(merchantSlugValue: string): string {
  // Check variant map
  for (const [variant, canonical] of Object.entries(MERCHANT_VARIANT_MAP)) {
    if (merchantSlugValue.includes(variant)) {
      return canonical;
    }
  }
  return merchantSlugValue;
}

function determineStatus(
  lastDate: string,
  cadence: SubscriptionCadence,
  latestTxnDate: string
): SubscriptionStatus {
  // Use latest transaction date, NOT today
  const daysSinceLast = daysBetween(lastDate, latestTxnDate);
  
  if (cadence === "monthly") {
    // Monthly: active if charged within 45 days of latest txn date
    return daysSinceLast <= 45 ? "active" : "inactive";
  } else if (cadence === "yearly") {
    // Yearly: active if charged within 400 days of latest txn date
    return daysSinceLast <= 400 ? "active" : "inactive";
  }
  
  // Ambiguous cadence: consider active if within 45 days
  return daysSinceLast <= 45 ? "active" : "inactive";
}

interface MerchantPattern {
  merchant: string;
  merchantSlug: string;
  category: string;
  transactions: Array<{ date: string; amount: number }>;
}

function detectSubscription(
  pattern: MerchantPattern,
  userConfirmed: Set<string>,
  latestTxnDate: string
): DetectedSubscription | null {
  const { merchant, merchantSlug, category, transactions } = pattern;
  
  // Hard exclusions
  if (isHardExcluded(merchant, category)) {
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
  
  // Normalize merchant slug for variant matching
  const normalizedSlug = normalizeSubscriptionMerchant(merchantSlug);
  
  // Determine tier: confirmed or candidate
  const isKnown = isKnownSubscription(normalizedSlug, category);
  const isUserConfirmed = userConfirmed.has(merchantSlug) || userConfirmed.has(normalizedSlug);
  const tier: SubscriptionTier = (isKnown || isUserConfirmed) ? "confirmed" : "candidate";
  
  // Determine status: active or inactive (relative to latest txn date)
  const status = determineStatus(lastDate, cadence, latestTxnDate);
  
  // Check if new (first charge in last 60 days relative to latest txn date)
  const firstDate = sorted[0].date;
  const daysSinceFirst = daysBetween(firstDate, latestTxnDate);
  const isNew = daysSinceFirst <= 60 && sorted.length <= 2;
  
  // Check for price increase (only for confirmed subs with same cadence)
  let priceIncrease = false;
  let priceIncreaseAmount: number | undefined;
  let previousAmount: number | undefined;
  
  if (tier === "confirmed" && sorted.length >= 2) {
    const prevTxn = sorted[sorted.length - 2];
    const pctChange = ((amount - prevTxn.amount) / prevTxn.amount) * 100;
    
    if (pctChange >= 5) {
      priceIncrease = true;
      priceIncreaseAmount = amount - prevTxn.amount;
      previousAmount = prevTxn.amount;
    }
  }
  
  return {
    merchant,
    merchantSlug: normalizedSlug,
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
    tier,
    status,
  };
}

export function buildSubscriptionSummary(
  expenseTxns: ExpenseTxnRecord[],
  currency: string = "CAD",
  totalSpending?: number,
  userConfirmedSlugs: string[] = []
): SubscriptionSummary {
  const userConfirmed = new Set(userConfirmedSlugs);
  
  // Find latest transaction date (use this for active status, not today)
  const latestTxnDate = expenseTxns.length > 0
    ? expenseTxns.reduce((latest, txn) => txn.date > latest ? txn.date : latest, expenseTxns[0].date)
    : new Date().toISOString().slice(0, 10);
  
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
    const sub = detectSubscription(pattern, userConfirmed, latestTxnDate);
    if (sub) {
      allDetected.push(sub);
    }
  });
  
  // Split by tier and status
  const confirmedActive = allDetected.filter(s => s.tier === "confirmed" && s.status === "active");
  const candidates = allDetected.filter(s => s.tier === "candidate" && s.status === "active");
  const inactive = allDetected.filter(s => s.status === "inactive");
  
  // Sort by amount (highest first)
  confirmedActive.sort((a, b) => b.amount - a.amount);
  candidates.sort((a, b) => b.amount - a.amount);
  inactive.sort((a, b) => b.amount - a.amount);
  
  // Calculate totals (confirmed active only)
  let monthlyTotal = 0;
  let yearlyTotal = 0;
  
  confirmedActive.forEach(sub => {
    if (sub.cadence === "monthly") {
      monthlyTotal += sub.amount;
      yearlyTotal += sub.amount * 12;
    } else if (sub.cadence === "yearly") {
      monthlyTotal += sub.amount / 12;
      yearlyTotal += sub.amount;
    }
  });
  
  // Count stats (confirmed active only)
  const activeCount = confirmedActive.length;
  const newCount = confirmedActive.filter(s => s.isNew).length;
  const priceIncreaseCount = confirmedActive.filter(s => s.priceIncrease).length;
  const candidateCount = candidates.length;
  
  // Sanity checks
  const sanityCheckFailures: string[] = [];
  
  if (activeCount > 30) {
    sanityCheckFailures.push(`Too many active subscriptions: ${activeCount} (max 30)`);
  }
  
  if (totalSpending && totalSpending > 0) {
    const subPct = (monthlyTotal / totalSpending) * 100;
    if (subPct > 10) {
      sanityCheckFailures.push(`Subscriptions ${subPct.toFixed(1)}% of spending (max 10%)`);
    }
  }
  
  // Check for hard-excluded items in results (should never happen)
  [...confirmedActive, ...candidates, ...inactive].forEach(sub => {
    if (isHardExcluded(sub.merchant, sub.category)) {
      sanityCheckFailures.push(`Hard-excluded item detected: ${sub.merchant} (${sub.category})`);
    }
  });
  
  return {
    subscriptions: confirmedActive,
    candidates,
    inactive,
    monthlyTotal,
    yearlyTotal,
    monthlyChange: 0, // TODO: implement if needed
    activeCount,
    newCount,
    priceIncreaseCount,
    candidateCount,
    currency,
    sanityCheckFailures,
  };
}
