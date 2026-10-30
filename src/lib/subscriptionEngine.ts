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
import type { BillingFrequency } from "./reviewTypes";

export type SubscriptionCadence = "monthly" | "yearly" | "ambiguous";
export type SubscriptionStatus = "active" | "inactive";
export type SubscriptionTier = "confirmed" | "candidate";

export interface DetectedSubscription {
  merchant: string;
  merchantSlug: string;
  category: string;
  amount: number;
  cadence: SubscriptionCadence;
  billingFrequency?: BillingFrequency; // User override for billing frequency
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
  /** Flag for user-confirmed subs that are past their normal grace period */
  noRecentCharge?: boolean;
}

export interface SubscriptionSummary {
  /** Active confirmed subscriptions only */
  subscriptions: DetectedSubscription[];
  /** Candidates needing review (NOT counted) */
  candidates: DetectedSubscription[];
  /** Inactive/cancelled subscriptions */
  inactive: DetectedSubscription[];
  /** Explicitly cancelled by user */
  cancelled: DetectedSubscription[];
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
 * User review decisions for subscriptions
 */
export interface SubscriptionReview {
  merchantSlug: string;
  decision: "is_subscription" | "not_subscription" | "still_active" | "cancelled";
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
 * Maps various merchant name patterns to canonical names
 */
const MERCHANT_VARIANT_MAP: Record<string, string> = {
  // Anthropic / Claude variants
  "anthropic": "anthropic",
  "claude": "anthropic",
  "claude-ai": "anthropic",
  "claudeai": "anthropic",
  
  // OpenAI / ChatGPT variants
  "chatgpt": "openai",
  "openai": "openai",
  "chat-gpt": "openai",
  
  // Sirius XM
  "siriusxm": "siriusxm",
  "sirius": "siriusxm",
  "sirius-xm": "siriusxm",
};

/**
 * Display names for canonical merchant slugs
 */
const CANONICAL_DISPLAY_NAMES: Record<string, string> = {
  "anthropic": "Anthropic (Claude)",
  "openai": "OpenAI (ChatGPT)",
  "siriusxm": "SiriusXM",
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
  // Check variant map - match if any key is contained in the slug
  for (const [variant, canonical] of Object.entries(MERCHANT_VARIANT_MAP)) {
    if (merchantSlugValue.includes(variant)) {
      return canonical;
    }
  }
  
  // Additional fuzzy matching for common patterns
  // Remove common suffixes that create duplicates
  const cleaned = merchantSlugValue
    .replace(/\*+/g, '') // Remove asterisks
    .replace(/-subscription$/, '')
    .replace(/-sub$/, '')
    .replace(/-ai$/, '')
    .toLowerCase()
    .trim();
  
  // Check variant map again with cleaned slug
  for (const [variant, canonical] of Object.entries(MERCHANT_VARIANT_MAP)) {
    if (cleaned.includes(variant)) {
      return canonical;
    }
  }
  
  return merchantSlugValue;
}

function determineStatus(
  lastDate: string,
  cadence: SubscriptionCadence,
  latestTxnDate: string,
  billingFrequency?: BillingFrequency
): SubscriptionStatus {
  // Use billing frequency override if provided
  const effectiveCadence = billingFrequency 
    ? (billingFrequency === "yearly" ? "yearly" : "monthly")
    : cadence;
  
  // Use latest transaction date, NOT today
  const daysSinceLast = daysBetween(lastDate, latestTxnDate);
  
  if (effectiveCadence === "monthly" || billingFrequency === "weekly" || billingFrequency === "quarterly") {
    // Monthly/weekly/quarterly: active if charged within 45 days
    return daysSinceLast <= 45 ? "active" : "inactive";
  } else if (effectiveCadence === "yearly") {
    // Yearly: active if charged within 13 months (395 days) of latest txn date
    return daysSinceLast <= 395 ? "active" : "inactive";
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
  latestTxnDate: string,
  billingFrequencyOverride?: BillingFrequency
): DetectedSubscription | null {
  const { merchant, merchantSlug, category, transactions } = pattern;
  
  // Hard exclusions
  if (isHardExcluded(merchant, category)) {
    return null;
  }
  
  // Sort by date
  const sorted = [...transactions].sort((a, b) => a.date.localeCompare(b.date));
  
  // Normalize merchant slug for variant matching (do this early)
  const normalizedSlug = normalizeSubscriptionMerchant(merchantSlug);
  
  // Determine tier FIRST: confirmed or candidate
  const isKnown = isKnownSubscription(normalizedSlug, category);
  const isUserConfirmed = userConfirmed.has(merchantSlug) || userConfirmed.has(normalizedSlug);
  const tier: SubscriptionTier = (isKnown || isUserConfirmed) ? "confirmed" : "candidate";
  
  // Known/confirmed subscriptions can have any number of transactions
  // Candidates need ≥3 transactions AND consistent intervals/amounts
  if (tier === "candidate") {
    if (transactions.length < 3) return null;
    
    // Calculate intervals and amounts for consistency check
    const intervals: number[] = [];
    const amounts: number[] = [];
    for (let i = 1; i < sorted.length; i++) {
      intervals.push(daysBetween(sorted[i - 1].date, sorted[i].date));
      amounts.push(sorted[i].amount);
    }
    amounts.unshift(sorted[0].amount); // Include first amount
    
    // Average interval
    const avgInterval = intervals.reduce((s, i) => s + i, 0) / intervals.length;
    
    // Check interval consistency: all intervals within ±5 days of average
    const intervalConsistent = intervals.every(i => Math.abs(i - avgInterval) <= 5);
    if (!intervalConsistent) return null;
    
    // Check amount consistency: all amounts within ±15% of median
    const sortedAmounts = [...amounts].sort((a, b) => a - b);
    const medianAmount = sortedAmounts[Math.floor(sortedAmounts.length / 2)];
    const amountConsistent = amounts.every(a => Math.abs(a - medianAmount) / medianAmount <= 0.15);
    if (!amountConsistent) return null;
  }
  
  // Calculate intervals for cadence determination
  const intervals: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    intervals.push(daysBetween(sorted[i - 1].date, sorted[i].date));
  }
  
  // Average interval (or use a reasonable default for single-charge user-confirmed subs)
  const avgInterval = intervals.length > 0 
    ? intervals.reduce((s, i) => s + i, 0) / intervals.length 
    : (isUserConfirmed && sorted.length === 1) ? 365 : 30; // User-confirmed single charge defaults to yearly
  
  // Determine cadence
  let cadence: SubscriptionCadence = "ambiguous";
  if (avgInterval >= 25 && avgInterval <= 35) {
    cadence = "monthly";
  } else if (avgInterval >= 320 && avgInterval <= 400) {
    cadence = "yearly";
  } else if (tier === "confirmed") {
    // User-confirmed single charge: default to yearly
    // Multi-charge with ambiguous interval: default to monthly
    cadence = (isUserConfirmed && sorted.length === 1) ? "yearly" : "monthly";
  } else {
    // Candidates with unclear cadence are rejected
    return null;
  }
  
  // Last charge
  const lastTxn = sorted[sorted.length - 1];
  const lastDate = lastTxn.date;
  const amount = lastTxn.amount;
  
  // Estimate next date (use override if provided)
  let nextDate: string | null = null;
  if (billingFrequencyOverride) {
    if (billingFrequencyOverride === "weekly") {
      nextDate = addMonths(lastDate, 0); // Add 7 days via different logic
      const d = new Date(lastDate);
      d.setDate(d.getDate() + 7);
      nextDate = d.toISOString().slice(0, 10);
    } else if (billingFrequencyOverride === "monthly") {
      nextDate = addMonths(lastDate, 1);
    } else if (billingFrequencyOverride === "quarterly") {
      nextDate = addMonths(lastDate, 3);
    } else if (billingFrequencyOverride === "yearly") {
      nextDate = addMonths(lastDate, 12);
    }
  } else {
    // Use detected cadence
    if (cadence === "monthly") {
      nextDate = addMonths(lastDate, 1);
    } else if (cadence === "yearly") {
      nextDate = addMonths(lastDate, 12);
    }
  }
  
  // Determine status: active or inactive (relative to latest txn date, honor override)
  const status = determineStatus(lastDate, cadence, latestTxnDate, billingFrequencyOverride);
  
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
  
  // Flag user-confirmed subs that are stale but should still be shown as active
  const noRecentCharge = isUserConfirmed && status === "inactive";
  
  return {
    merchant,
    merchantSlug: normalizedSlug,
    category,
    amount,
    cadence,
    billingFrequency: billingFrequencyOverride,
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
    noRecentCharge: noRecentCharge ? true : undefined,
  };
}

export function buildSubscriptionSummary(
  expenseTxns: ExpenseTxnRecord[],
  currency: string = "CAD",
  totalSpending?: number,
  userConfirmedSlugs: string[] = [],
  billingFrequencyOverrides: Map<string, BillingFrequency> = new Map()
): SubscriptionSummary {
  const userConfirmed = new Set(userConfirmedSlugs);
  
  // Find latest transaction date (use this for active status, not today)
  const latestTxnDate = expenseTxns.length > 0
    ? expenseTxns.reduce((latest, txn) => txn.date > latest ? txn.date : latest, expenseTxns[0].date)
    : new Date().toISOString().slice(0, 10);
  
  // Group by merchant (normalize slug early to merge variants)
  const merchantMap = new Map<string, MerchantPattern>();
  
  expenseTxns.forEach(txn => {
    const rawSlug = merchantSlug(txn.merchant);
    const normalizedSlug = normalizeSubscriptionMerchant(rawSlug);
    
    if (!merchantMap.has(normalizedSlug)) {
      // Use canonical display name if available, otherwise first merchant name seen
      const displayName = CANONICAL_DISPLAY_NAMES[normalizedSlug] || txn.merchant;
      
      merchantMap.set(normalizedSlug, {
        merchant: displayName,
        merchantSlug: normalizedSlug,
        category: txn.category,
        transactions: [],
      });
    }
    
    merchantMap.get(normalizedSlug)!.transactions.push({
      date: txn.date,
      amount: Math.abs(txn.amount),
    });
  });
  
  // Detect subscriptions
  const allDetected: DetectedSubscription[] = [];
  merchantMap.forEach(pattern => {
    const frequencyOverride = billingFrequencyOverrides.get(pattern.merchantSlug);
    const sub = detectSubscription(pattern, userConfirmed, latestTxnDate, frequencyOverride);
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
  
  // Calculate totals (confirmed active only, honor billing frequency overrides)
  let monthlyTotal = 0;
  let yearlyTotal = 0;
  
  confirmedActive.forEach(sub => {
    const frequency = sub.billingFrequency;
    
    if (frequency === "weekly") {
      // Weekly: 52 weeks/year, divide by 12 for monthly
      monthlyTotal += (sub.amount * 52) / 12;
      yearlyTotal += sub.amount * 52;
    } else if (frequency === "monthly" || (!frequency && sub.cadence === "monthly")) {
      monthlyTotal += sub.amount;
      yearlyTotal += sub.amount * 12;
    } else if (frequency === "quarterly") {
      // Quarterly: 4 times/year, divide by 12 for monthly
      monthlyTotal += (sub.amount * 4) / 12;
      yearlyTotal += sub.amount * 4;
    } else if (frequency === "yearly" || (!frequency && sub.cadence === "yearly")) {
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
    cancelled: [], // Handled at API layer based on reviews
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
