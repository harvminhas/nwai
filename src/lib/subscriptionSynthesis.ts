/**
 * Subscription Synthesis for Manually Marked Merchants
 * 
 * When a user marks a merchant as a subscription via the UI, but that merchant
 * wasn't detected by the subscription engine, we synthesize a subscription from
 * the merchant's transaction history.
 */

import type { ExpenseTxnRecord } from "./extractTransactions";
import type { DetectedSubscription } from "./subscriptionEngine";
import type { BillingFrequency } from "./reviewTypes";
import { merchantSlug as merchantSlugFn } from "./applyRules";

export interface SynthesisInput {
  slug: string;
  expenseTxns: ExpenseTxnRecord[];
  billingFrequencyOverride?: BillingFrequency;
}

export interface SynthesisResult {
  subscription: DetectedSubscription | null;
  reason?: string; // Why synthesis failed
}

/**
 * Synthesize a subscription for a manually marked merchant
 */
export function synthesizeSubscription(input: SynthesisInput): SynthesisResult {
  const { slug, expenseTxns, billingFrequencyOverride } = input;
  
  // Find transactions for this merchant
  const merchantTxns = expenseTxns.filter(txn => {
    const txnSlug = merchantSlugFn(txn.merchant);
    return txnSlug === slug;
  });
  
  if (merchantTxns.length === 0) {
    return { 
      subscription: null, 
      reason: "No transactions found for this merchant slug" 
    };
  }
  
  // Sort by date
  const sortedTxns = merchantTxns.sort((a, b) => a.date.localeCompare(b.date));
  const lastTxn = sortedTxns[sortedTxns.length - 1];
  
  // Infer amount: use latest charge
  const amount = Math.abs(lastTxn.amount);
  
  // Infer frequency from gaps between charges
  let cadence: "monthly" | "yearly" | "ambiguous" = "monthly"; // Default to monthly
  if (sortedTxns.length >= 2) {
    const gaps: number[] = [];
    for (let i = 1; i < sortedTxns.length; i++) {
      const prevDate = new Date(sortedTxns[i - 1].date);
      const currDate = new Date(sortedTxns[i].date);
      const daysBetween = (currDate.getTime() - prevDate.getTime()) / (1000 * 60 * 60 * 24);
      gaps.push(daysBetween);
    }
    
    // Calculate median gap
    const sortedGaps = gaps.sort((a, b) => a - b);
    const medianGap = sortedGaps[Math.floor(sortedGaps.length / 2)];
    
    // Classify cadence based on median gap
    if (medianGap >= 320 && medianGap <= 400) {
      cadence = "yearly";
    } else if (medianGap >= 25 && medianGap <= 35) {
      cadence = "monthly";
    } else {
      cadence = "ambiguous";
    }
  }
  
  // Calculate next expected date
  let nextDate: string | null = null;
  if (cadence === "monthly") {
    const lastDate = new Date(lastTxn.date);
    lastDate.setMonth(lastDate.getMonth() + 1);
    nextDate = lastDate.toISOString().slice(0, 10);
  } else if (cadence === "yearly") {
    const lastDate = new Date(lastTxn.date);
    lastDate.setFullYear(lastDate.getFullYear() + 1);
    nextDate = lastDate.toISOString().slice(0, 10);
  }
  
  // Synthesize subscription
  const subscription: DetectedSubscription = {
    merchant: lastTxn.merchant,
    merchantSlug: slug,
    category: lastTxn.category,
    amount,
    cadence,
    billingFrequency: billingFrequencyOverride,
    lastDate: lastTxn.date,
    nextDate,
    chargeCount: sortedTxns.length,
    isNew: false,
    priceIncrease: false,
    transactions: sortedTxns.map(t => ({ date: t.date, amount: Math.abs(t.amount) })),
    tier: "confirmed",
    status: "active",
  };
  
  return { subscription };
}

/**
 * Synthesize subscriptions for multiple merchants
 */
export function synthesizeSubscriptions(
  userConfirmedSlugs: string[],
  alreadyDetectedSlugs: Set<string>,
  expenseTxns: ExpenseTxnRecord[],
  billingFrequencyOverrides: Map<string, BillingFrequency>
): DetectedSubscription[] {
  const synthesized: DetectedSubscription[] = [];
  
  userConfirmedSlugs.forEach(slug => {
    if (alreadyDetectedSlugs.has(slug)) return; // Already detected
    
    const result = synthesizeSubscription({
      slug,
      expenseTxns,
      billingFrequencyOverride: billingFrequencyOverrides.get(slug),
    });
    
    if (result.subscription) {
      synthesized.push(result.subscription);
    }
  });
  
  return synthesized;
}
