/**
 * Money Coach Buckets — category-to-bucket mapping for 50/30/20-style breakdown.
 *
 * Maps transaction categories to financial planning buckets:
 * - Fixed Costs: rent/mortgage, insurance, loan payments, utilities, subscriptions, taxes
 * - Essentials: groceries, transport, health, childcare
 * - Discretionary: dining, shopping, entertainment, travel
 * - Savings/Debt: savings contributions and debt paydown beyond minimums
 *
 * Uses parent categories from categoryTaxonomy.ts. The parser produces both parent
 * categories (Housing, Groceries, etc.) and subtypes (Rent, Mortgage, Utilities, etc.).
 * This mapping handles both by resolving subtypes to their parent via getParentCategory().
 */

import { getParentCategory, type ParentCategory } from "./categoryTaxonomy";

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
 * Parent category to bucket mapping.
 * Uses parent categories from categoryTaxonomy.ts as canonical keys.
 */
const PARENT_TO_BUCKET: Record<string, MoneyCoachBucket> = {
  // Fixed Costs (housing, insurance, debt servicing, utilities, subscriptions, taxes)
  "Housing": "fixed",              // Rent, Mortgage, Utilities, Internet & Phone, Home Insurance, Condo Fees, Maintenance & Repairs
  "Subscriptions": "fixed",        // Software, Memberships, News & Media
  "Insurance": "fixed",            // Life, Disability, Critical Illness, Tenant, Pet (excl. Auto, Home, Health)
  "Taxes": "fixed",                // Property Tax, Income Tax, HST/GST, Sales Tax, Business Tax, Capital Gains Tax
  "Debt": "fixed",                 // Installment Servicing, Card Servicing
  
  // Essentials (groceries, transport, health, childcare)
  "Groceries": "essentials",
  "Transportation": "essentials",  // Gas, Parking, Car Insurance, Transit, Rideshare, Auto Service
  "Healthcare": "essentials",      // Pharmacy, Dental, Vision, Fitness, Health Insurance, Vet
  "Education": "essentials",       // Tuition, Courses, Books, School Fees, Childcare
  
  // Flexible (dining, shopping, entertainment, travel, cash, personal care)
  "Dining": "flexible",            // Restaurants, Coffee & Drinks, Fast Food, Food Delivery
  "Shopping": "flexible",          // Clothing, Electronics, Home & Garden, Online Shopping
  "Entertainment": "flexible",     // Streaming, Movies & Events, Sports, Hobbies
  "Travel": "flexible",            // Accommodation, Flights, Car Rental, Train & Bus, Cruise, Travel Insurance
  "Cash & ATM": "flexible",
  "Personal Care": "flexible",     // Spa, Salon & Haircare, Massage, Skincare & Beauty, Barber, Nail Care
  
  // Savings & Debt (investments, savings, debt paydown beyond minimums)
  "Investments & Savings": "savings",  // RRSP, TFSA, RESP, 401k, IRA, Stocks, Mutual Funds, GICs, Crypto, Emergency Fund
  
  // Excluded from buckets (internal transfers, fees, interest, other)
  // "Transfers", "Transfer Out", "Transfers & Payments" → not counted in spending (filtered by isCoreExcluded)
  // "Fees" → bank fees, shown separately or in uncategorized
  // "Interest" → not counted in spending
  // "Other" → uncategorized
};

/**
 * Bucket metadata for display and benchmarking.
 */
export const BUCKET_METADATA: Record<MoneyCoachBucket, BucketMetadata> = {
  fixed: {
    id: "fixed",
    label: "Fixed costs",
    description: "Housing, insurance, utilities, subscriptions, scheduled debt payments",
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
    label: "Net savings",
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
 * Handles both parent categories (Housing, Groceries) and subtypes (Rent, Mortgage)
 * by resolving to parent first via categoryTaxonomy.
 */
export function getCategoryBucket(category: string): MoneyCoachBucket {
  const parent = getParentCategory(category);
  return PARENT_TO_BUCKET[parent] ?? "uncategorized";
}

/**
 * Generate plain-language advice based on actual vs. target percentage.
 * Returns short actionable note for each bucket.
 * All percentages are rounded to whole numbers for readability.
 */
export function getBucketAdvice(
  bucket: MoneyCoachBucket,
  actualPct: number,
  targetPct: number
): string {
  const diff = actualPct - targetPct;
  const absDiff = Math.abs(diff);
  const roundedActual = Math.round(actualPct);

  if (bucket === "fixed") {
    if (actualPct > 50) {
      return `At ${roundedActual}%, your fixed costs are high. Look for ways to reduce subscriptions or negotiate insurance rates.`;
    }
    if (actualPct > 60) {
      return `At ${roundedActual}%, fixed costs are too high. Consider moving to lower rent or refinancing debt.`;
    }
    return `Fixed costs look healthy at ${roundedActual}%. Keep monitoring subscriptions.`;
  }

  if (bucket === "essentials") {
    if (actualPct > 25) {
      return `At ${roundedActual}%, essentials are running high. Meal planning and carpooling can help.`;
    }
    return `Essentials at ${roundedActual}% are manageable. Keep an eye on grocery and transport costs.`;
  }

  if (bucket === "flexible") {
    if (actualPct > 40) {
      return `At ${roundedActual}%, flexible spending is high. Cut back on dining out or entertainment to free up savings.`;
    }
    if (actualPct > targetPct + 5) {
      return `At ${roundedActual}%, you're over the 30% guideline. Small cuts to dining or shopping can make a big difference.`;
    }
    if (actualPct < targetPct - 5) {
      return `At ${roundedActual}%, you're living frugally. You could afford to enjoy yourself a bit more if you want.`;
    }
    return `Flexible spending at ${roundedActual}% is within a healthy range.`;
  }

  if (bucket === "savings") {
    if (actualPct < 10) {
      return `At ${roundedActual}%, you're not saving enough. Aim for at least 15-20% to build financial security.`;
    }
    if (actualPct < targetPct) {
      return `At ${roundedActual}%, you're saving but below the 20% target. Look for small cuts in discretionary spending.`;
    }
    return `Great job! Saving ${roundedActual}% puts you ahead of the 20% guideline.`;
  }

  return ""; // uncategorized
}
