/**
 * Post-processing logic for subscriptions after engine detection.
 * Shared by API route and debug script to ensure consistent behavior.
 */

import type { DetectedSubscription } from "./subscriptionEngine";
import type { SourceMapping } from "./sourceMappings";
import { resolveCanonical, normaliseName } from "./sourceMappings";

export interface PostProcessingResult {
  confirmedActive: DetectedSubscription[];
  inactive: DetectedSubscription[];
  candidates: DetectedSubscription[];
}

/**
 * Collapse subscriptions with the same canonical merchant name (after resolving aliases).
 * Combines charges, uses latest lastDate, recomputes cadence from combined charge dates.
 */
function collapseAliases(
  subscriptions: DetectedSubscription[],
  mappings: SourceMapping[]
): DetectedSubscription[] {
  const canonicalMap = new Map<string, DetectedSubscription[]>();
  
  // Group subscriptions by canonical merchant name
  for (const sub of subscriptions) {
    const canonical = normaliseName(resolveCanonical(sub.merchant, mappings));
    if (!canonicalMap.has(canonical)) {
      canonicalMap.set(canonical, []);
    }
    canonicalMap.get(canonical)!.push(sub);
  }
  
  // Collapse each group into one subscription
  const collapsed: DetectedSubscription[] = [];
  for (const [, subs] of canonicalMap.entries()) {
    const canonical = resolveCanonical(subs[0].merchant, mappings);
    if (subs.length === 1) {
      collapsed.push(subs[0]);
      continue;
    }
    
    // Merge multiple subscriptions
    const allTransactions = subs.flatMap(s => s.transactions);
    const sortedTransactions = allTransactions.sort((a, b) => a.date.localeCompare(b.date));
    const lastTxn = sortedTransactions[sortedTransactions.length - 1];
    
    // Sum amounts (use the most recent amount as the primary amount)
    const totalAmount = subs.reduce((sum, s) => sum + s.amount, 0);
    
    // Use the first subscription as the base, but update key fields
    const merged: DetectedSubscription = {
      ...subs[0],
      merchant: canonical,
      billingFrequency: subs.find(s => s.billingFrequency)?.billingFrequency ?? subs[0].billingFrequency,
      cadence: subs.find(s => s.billingFrequency)?.cadence ?? subs[0].cadence,
      amount: lastTxn.amount, // Use latest charge amount
      chargeCount: allTransactions.length,
      lastDate: lastTxn.date,
      transactions: sortedTransactions,
    };
    
    collapsed.push(merged);
  }
  
  return collapsed;
}

function daysBetween(date1: string, date2: string): number {
  const d1 = new Date(date1);
  const d2 = new Date(date2);
  return Math.floor((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * Post-process subscriptions after engine detection:
 * - Product decision: ALL confirmed subscriptions stay active (engine or user-confirmed)
 * - Inactive = cancelled only
 * - Set noRecentCharge flag for items past their cadence window (date-based check)
 * - Preserve original cadence (yearly/monthly/ambiguous)
 */
export function postProcessSubscriptions(
  detected: {
    subscriptions: DetectedSubscription[];
    candidates: DetectedSubscription[];
    inactive: DetectedSubscription[];
  },
  cancelledSlugs: Set<string>,
  synthesizedSubs: DetectedSubscription[],
  latestTxnDate: string,
  sourceMappings: SourceMapping[] = []
): PostProcessingResult {
  // Separate cancelled from non-cancelled inactive
  const cancelled = detected.inactive.filter(s => cancelledSlugs.has(s.merchantSlug));
  const nonCancelledInactive = detected.inactive.filter(s => !cancelledSlugs.has(s.merchantSlug));
  
  // Product decision: ALL confirmed items (tier === "confirmed") stay active
  const confirmedInactive = nonCancelledInactive.filter(s => s.tier === "confirmed");
  confirmedInactive.forEach(item => {
    item.status = "active";
  });
  
  // Build final active list
  const allActive = [
    ...detected.subscriptions,
    ...confirmedInactive,
    ...synthesizedSubs,
  ];
  
  // Date-based noRecentCharge flag: check if last charge is past cadence window + grace
  // Measured against latest data date, NOT today
  allActive.forEach(item => {
    const daysSinceLast = daysBetween(item.lastDate, latestTxnDate);
    const effectiveCadence = item.billingFrequency 
      ? (item.billingFrequency === "yearly" ? "yearly" : "monthly")
      : item.cadence;
    
    let isPastWindow = false;
    if (effectiveCadence === "monthly" || item.billingFrequency === "weekly" || item.billingFrequency === "quarterly") {
      // Monthly/weekly/quarterly: flag if > 45 days
      isPastWindow = daysSinceLast > 45;
    } else if (effectiveCadence === "yearly") {
      // Yearly: flag if > 400 days
      isPastWindow = daysSinceLast > 400;
    }
    
    if (isPastWindow) {
      item.noRecentCharge = true;
    }
  });
  
  // Collapse aliases based on confirmed source mappings
  const collapsedActive = collapseAliases(allActive, sourceMappings);
  
  const confirmedActive = collapsedActive.sort((a, b) => b.amount - a.amount);
  
  // Inactive now contains only cancelled items
  const inactive = cancelled;
  
  return {
    confirmedActive,
    inactive,
    candidates: detected.candidates,
  };
}
