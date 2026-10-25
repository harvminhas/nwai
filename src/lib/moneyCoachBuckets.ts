/**
 * Money Coach Buckets — category-to-bucket mapping for 50/30/20-style breakdown.
 *
 * Maps transaction categories to financial planning buckets:
 * - Fixed Costs: rent/mortgage, insurance, loan payments, utilities, subscriptions
 * - Essentials: groceries, transport, health, childcare
 * - Discretionary: dining, shopping, entertainment, travel
 * - Savings/Debt: savings contributions and debt paydown beyond minimums
 *
 * Canonical category list (from parseStatement.ts + csvParser.ts):
 * Dining, Groceries, Shopping, Transportation, Entertainment, Subscriptions,
 * Healthcare, Fees, Debt Payments, Investments & Savings, Transfers, Cash & ATM, Other
 */

export type MoneyCoachBucket = "fixed" | "essentials" | "flexible" | "savings" | "uncategorized";

export interface BucketMetadata {
  id: MoneyCoachBucket;
  label: string;
  description: string;
  emoji: string;
  /** Recommended % of take-home income (Fixed 35% + Essentials 15% = Needs 50%, Flexible 30%, Savings 20%) */
  targetPct: number;
}

/**
 * Category-to-bucket mapping.
 * Categories not listed here go to "uncategorized".
 */
export const CATEGORY_TO_BUCKET: Record<string, MoneyCoachBucket> = {
  // Fixed Costs (housing, insurance, debt minimums, utilities, subscriptions)
  "Subscriptions": "fixed",
  "Insurance": "fixed",
  "Utilities": "fixed",
  
  // Essentials (groceries, transport, health, childcare)
  "Groceries": "essentials",
  "Transportation": "essentials",
  "Healthcare": "essentials",
  "Childcare": "essentials",
  
  // Flexible (dining, shopping, entertainment, travel, cash)
  "Dining": "flexible",
  "Shopping": "flexible",
  "Entertainment": "flexible",
  "Travel": "flexible",
  "Cash & ATM": "flexible",
  "Personal Care": "flexible",
  "Gifts & Donations": "flexible",
  "Hobbies": "flexible",
  
  // Savings & Debt (investments, savings, debt paydown beyond minimums)
  "Investments & Savings": "savings",
  "Debt Payments": "savings", // user-directed debt paydown (beyond auto-deducted minimums)
  
  // Excluded from buckets (internal transfers, fees)
  // "Transfers" → not counted in spending
  // "Fees" → shown separately, not in buckets
  // "Other" → uncategorized
};

/**
 * Bucket metadata for display and benchmarking.
 */
export const BUCKET_METADATA: Record<MoneyCoachBucket, BucketMetadata> = {
  fixed: {
    id: "fixed",
    label: "Fixed costs",
    description: "Housing, insurance, utilities, subscriptions, minimum loan payments",
    emoji: "🏠",
    targetPct: 35, // Fixed 35% + Essentials 15% = Needs 50%
  },
  essentials: {
    id: "essentials",
    label: "Essentials",
    description: "Groceries, transportation, healthcare, childcare",
    emoji: "🛒",
    targetPct: 15, // Fixed 35% + Essentials 15% = Needs 50%
  },
  flexible: {
    id: "flexible",
    label: "Flexible",
    description: "Dining, shopping, entertainment, travel, personal spending",
    emoji: "🎭",
    targetPct: 30, // Flexible spending (wants)
  },
  savings: {
    id: "savings",
    label: "Savings & debt",
    description: "Savings contributions, debt paydown beyond minimums",
    emoji: "💰",
    targetPct: 20, // Savings and debt paydown
  },
  uncategorized: {
    id: "uncategorized",
    label: "Uncategorized",
    description: "Transactions not yet categorized",
    emoji: "❓",
    targetPct: 0,
  },
};

/**
 * Map a transaction category to its money coach bucket.
 */
export function getCategoryBucket(category: string): MoneyCoachBucket {
  return CATEGORY_TO_BUCKET[category] ?? "uncategorized";
}

/**
 * Generate plain-language advice based on actual vs. target percentage.
 * Returns short actionable note for each bucket.
 */
export function getBucketAdvice(
  bucket: MoneyCoachBucket,
  actualPct: number,
  targetPct: number
): string {
  const diff = actualPct - targetPct;
  const absDiff = Math.abs(diff);

  if (bucket === "fixed") {
    if (actualPct > 50) {
      return `At ${actualPct}%, your fixed costs are high. Look for ways to reduce subscriptions or negotiate insurance rates.`;
    }
    if (actualPct > 60) {
      return `At ${actualPct}%, fixed costs are too high. Consider moving to lower rent or refinancing debt.`;
    }
    return `Fixed costs look healthy at ${actualPct}%. Keep monitoring subscriptions.`;
  }

  if (bucket === "essentials") {
    if (actualPct > 25) {
      return `At ${actualPct}%, essentials are running high. Meal planning and carpooling can help.`;
    }
    return `Essentials at ${actualPct}% are manageable. Keep an eye on grocery and transport costs.`;
  }

  if (bucket === "flexible") {
    if (actualPct > 40) {
      return `At ${actualPct}%, flexible spending is high. Cut back on dining out or entertainment to free up savings.`;
    }
    if (actualPct > targetPct + 5) {
      return `At ${actualPct}%, you're over the 30% guideline. Small cuts to dining or shopping can make a big difference.`;
    }
    if (actualPct < targetPct - 5) {
      return `At ${actualPct}%, you're living frugally. You could afford to enjoy yourself a bit more if you want.`;
    }
    return `Flexible spending at ${actualPct}% is within a healthy range.`;
  }

  if (bucket === "savings") {
    if (actualPct < 10) {
      return `At ${actualPct}%, you're not saving enough. Aim for at least 15-20% to build financial security.`;
    }
    if (actualPct < targetPct) {
      return `At ${actualPct}%, you're saving but below the 20% target. Look for small cuts in discretionary spending.`;
    }
    return `Great job! Saving ${actualPct}% puts you ahead of the 20% guideline.`;
  }

  return ""; // uncategorized
}
