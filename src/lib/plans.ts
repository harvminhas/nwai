/**
 * Plan definitions.
 * When Stripe is integrated, replace the localStorage-based PlanContext
 * with a Firestore fetch of the user's active subscription, then map
 * the Stripe price ID to one of these plan IDs.
 */

export type PlanId = "free" | "pro" | "family";

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
    uploadsPerMonth: 5,
    historyMonths: 6,
    features: {
      forecast:      false,
      goals:         false,
      payoffPlanner: false,
      multiUpload:   false,
      export:        false,
      aiInsights:    false,
      multiUser:     false,
      whatIf:        false,
      aiChat:        false,
    },
  },
  pro: {
    id: "pro",
    name: "Pro",
    price: "$9 / mo",
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
  family: {
    id: "family",
    name: "Family",
    price: "$18 / mo",
    uploadsPerMonth: -1,
    historyMonths: -1,
    features: {
      forecast:      true,
      goals:         true,
      payoffPlanner: true,
      multiUpload:   true,
      export:        true,
      aiInsights:    true,
      multiUser:     true,
      whatIf:        true,
      aiChat:        true,
    },
  },
};

export const PLAN_ORDER: PlanId[] = ["free", "pro", "family"];

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
