/**
 * Post-processing logic for subscriptions after engine detection.
 * Shared by API route and debug script to ensure consistent behavior.
 */

import type { DetectedSubscription } from "./subscriptionEngine";

export interface PostProcessingResult {
  confirmedActive: DetectedSubscription[];
  inactive: DetectedSubscription[];
  candidates: DetectedSubscription[];
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
  latestTxnDate: string
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
  
  const confirmedActive = allActive.sort((a, b) => b.amount - a.amount);
  
  // Inactive now contains only cancelled items
  const inactive = cancelled;
  
  return {
    confirmedActive,
    inactive,
    candidates: detected.candidates,
  };
}
