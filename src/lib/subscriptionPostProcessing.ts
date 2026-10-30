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

/**
 * Post-process subscriptions after engine detection:
 * - Product decision: ALL confirmed subscriptions stay active (engine or user-confirmed)
 * - Inactive = cancelled only
 * - Set noRecentCharge flag for items past their cadence window
 * - Preserve original cadence (yearly/monthly/ambiguous)
 */
export function postProcessSubscriptions(
  detected: {
    subscriptions: DetectedSubscription[];
    candidates: DetectedSubscription[];
    inactive: DetectedSubscription[];
  },
  cancelledSlugs: Set<string>,
  synthesizedSubs: DetectedSubscription[]
): PostProcessingResult {
  // Separate cancelled from non-cancelled inactive
  const cancelled = detected.inactive.filter(s => cancelledSlugs.has(s.merchantSlug));
  const nonCancelledInactive = detected.inactive.filter(s => !cancelledSlugs.has(s.merchantSlug));
  
  // Product decision: ALL confirmed items (tier === "confirmed") stay active
  // These were marked inactive by engine because past cadence window
  const confirmedInactive = nonCancelledInactive.filter(s => s.tier === "confirmed");
  
  // Set noRecentCharge flag for confirmed items that were inactive
  // (They're past their cadence window by definition)
  confirmedInactive.forEach(item => {
    item.status = "active";
    item.noRecentCharge = true;
  });
  
  // Build final active list
  const confirmedActive = [
    ...detected.subscriptions,
    ...confirmedInactive,
    ...synthesizedSubs,
  ].sort((a, b) => b.amount - a.amount);
  
  // Inactive now contains only cancelled items
  const inactive = cancelled;
  
  return {
    confirmedActive,
    inactive,
    candidates: detected.candidates,
  };
}
