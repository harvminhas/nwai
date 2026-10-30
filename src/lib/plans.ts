/**
 * Plan definitions.
 *
 * Plan resolution priority (see /api/user/plan GET and resolvePlan function):
 *   1. users/{uid}.manualPro === true  → "pro"  (admin override, bypasses Stripe)
 *   2. users/{uid}.subscription.status === "active" | "trialing" → "pro"
 *   3. users/{uid}.promoExpiresAt > now → "pro"  (promo code grant)
 *   4. Otherwise → "free"
 */

/**
 * Free-tier upload allowances — SINGLE SOURCE OF TRUTH.
 * ONE_TIME: lifetime allotment granted on signup, carries over indefinitely.
 * MONTHLY:  refreshes on the 1st of each month, unused quota does NOT carry over.
 * Import these constants wherever upload limits are checked.
 */
export const FREE_ONETIME_UPLOADS  = 50;
export const FREE_MONTHLY_UPLOADS  = 8;

/**
 * Free-tier AI answer limit (per month).
 */
export const FREE_AI_ANSWERS_PER_MONTH = 50;

export type PlanId = "free" | "pro";

export interface PlanFeatures {
  forecast: boolean;
  goals: boolean;
  payoffPlanner: boolean;
  multiUpload: boolean;
  export: boolean;
  aiInsights: boolean;
  multiUser: boolean;
  whatIf: boolean;
  aiChat: boolean;
}

export interface PlanDefinition {
  id: PlanId;
  name: string;
  price: string; // display only
  uploadsPerMonth: number; // -1 = unlimited
  historyMonths: number;   // -1 = unlimited
  features: PlanFeatures;
}

export const PLANS: Record<PlanId, PlanDefinition> = {
  free: {
    id: "free",
    name: "Free",
    price: "$0",
    uploadsPerMonth: FREE_MONTHLY_UPLOADS,
    historyMonths: -1, // FULL history (was 6 months)
    features: {
      forecast:      false,
      goals:         true,
      payoffPlanner: false,
      multiUpload:   true,
      export:        false,
      aiInsights:    false,
      multiUser:     false,
      whatIf:        false,
      aiChat:        true,  // true, but gated at 50 answers/month
    },
  },
  pro: {
    id: "pro",
    name: "Pro",
    price: "$9.99 / mo",
    uploadsPerMonth: -1,
    historyMonths: -1,
    features: {
      forecast:      true,
      goals:         true,
      payoffPlanner: true,
      multiUpload:   true,
      export:        true,
      aiInsights:    true,
      multiUser:     false,
      whatIf:        true,
      aiChat:        true,
    },
  },
};

export const PLAN_ORDER: PlanId[] = ["free", "pro"];

/** Returns true if the given plan includes the feature. */
export function planHas(plan: PlanId, feature: keyof PlanFeatures): boolean {
  return PLANS[plan].features[feature];
}

/** Returns the minimum plan required for a feature (for upgrade prompts). */
export function minPlanFor(feature: keyof PlanFeatures): PlanDefinition {
  for (const id of PLAN_ORDER) {
    if (PLANS[id].features[feature]) return PLANS[id];
  }
  return PLANS.pro;
}
