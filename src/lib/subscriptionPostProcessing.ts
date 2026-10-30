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
  // 1. Pool every subscription the user should see: engine-active, confirmed
  //    items the engine called inactive (we never auto-inactivate), and
  //    user-marked synthesized ones. Unconfirmed inactive items are dropped.
  const pool: DetectedSubscription[] = [
    ...detected.subscriptions,
    ...detected.inactive.filter(s => s.tier === "confirmed" || cancelledSlugs.has(s.merchantSlug)),
    ...synthesizedSubs,
  ];

  // 2. Which merged groups did the user cancel? A cancel on ANY member slug
  //    cancels the whole merged row (the visible row may carry another slug).
  const groupKey = (s: DetectedSubscription) =>
    normaliseName(resolveCanonical(s.merchant, sourceMappings));
  const cancelledGroups = new Set(
    pool.filter(s => cancelledSlugs.has(s.merchantSlug)).map(groupKey)
  );

  // 3. Collapse merged names into one row each.
  const collapsed = collapseAliases(pool, sourceMappings);

  // 4. Split into active vs cancelled (cancelled is the ONLY way to be inactive).
  const active: DetectedSubscription[] = [];
  const inactive: DetectedSubscription[] = [];
  for (const row of collapsed) {
    if (cancelledGroups.has(groupKey(row))) {
      row.status = "inactive";
      row.noRecentCharge = false;
      inactive.push(row);
    } else {
      row.status = "active";
      active.push(row);
    }
  }

  // 5. Flag (never deactivate) rows whose last charge is past their
  //    billing interval plus grace, measured from the latest data date.
  const intervalDays: Record<string, number> = { weekly: 7, monthly: 30, quarterly: 91, yearly: 365 };
  for (const row of active) {
    const freq = (row.billingFrequency || row.cadence) as string;
    const interval = intervalDays[freq] ?? 30;
    const grace = Math.max(15, Math.round(interval * 0.1));
    row.noRecentCharge = daysBetween(row.lastDate, latestTxnDate) > interval + grace;
  }

  const confirmedActive = active.sort((a, b) => b.amount - a.amount);
  
  return {
    confirmedActive,
    inactive,
    candidates: detected.candidates,
  };
}
