/**
 * Merchant name utilities for normalization and display.
 * 
 * Problem: Transaction data contains merchant names with inconsistent casing,
 * spacing, and punctuation (e.g. "AVIVA GENERAL INSURANCE" vs "Aviva General Insurance").
 * This causes duplicates in merchant lists.
 * 
 * Solution: Normalize for matching (via merchantSlug from applyRules.ts) and
 * provide a consistent display name (title case, trimmed).
 */

/**
 * Convert a merchant name to title case for consistent display.
 * Examples:
 *   "AVIVA GENERAL INSURANCE" → "Aviva General Insurance"
 *   "google cloud" → "Google Cloud"
 *   "HOME  DEPOT" → "Home Depot"
 */
export function normalizeMerchantName(name: string): string {
  if (!name || !name.trim()) return "Unknown";
  
  // Trim and normalize whitespace
  const cleaned = name.trim().replace(/\s+/g, " ");
  
  // Title case: capitalize first letter of each word
  return cleaned
    .split(" ")
    .map(word => {
      if (word.length === 0) return word;
      // Preserve all-caps acronyms (3 letters or less, all uppercase)
      if (word.length <= 3 && word === word.toUpperCase()) return word;
      // Title case the word
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");
}

/**
 * Detect if a merchant has recurring monthly charges based on transaction history.
 * Returns the detected monthly amount if recurring, null otherwise.
 * 
 * Logic:
 * - Merchant must appear in at least 2 different months
 * - Amounts must be consistent (within 10% variance)
 * - If consistent, return the median amount as the recurring charge
 */
export function detectRecurringMonthlyAmount(
  transactions: Array<{ txMonth: string; amount: number }>,
  minMonths = 2
): number | null {
  if (transactions.length < minMonths) return null;
  
  // Group by month
  const monthlyAmounts = new Map<string, number[]>();
  for (const txn of transactions) {
    const existing = monthlyAmounts.get(txn.txMonth) || [];
    existing.push(txn.amount);
    monthlyAmounts.set(txn.txMonth, existing);
  }
  
  // Must appear in at least minMonths different months
  if (monthlyAmounts.size < minMonths) return null;
  
  // Get one amount per month (sum if multiple in same month)
  const monthTotals = Array.from(monthlyAmounts.values()).map(amounts =>
    amounts.reduce((sum, a) => sum + a, 0)
  );
  
  // Check consistency: all amounts within 10% of median
  const sorted = [...monthTotals].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  
  const isConsistent = monthTotals.every(amt => {
    const variance = Math.abs(amt - median) / median;
    return variance <= 0.10; // Within 10%
  });
  
  return isConsistent ? median : null;
}

/**
 * Common merchant aliases that should be merged into canonical names.
 * Maps normalized slug to canonical display name.
 */
const MERCHANT_ALIASES: Record<string, string> = {
  // Amazon variants
  "amazon": "Amazon",
  "amazon-ca": "Amazon",
  "amazon-com": "Amazon",
  "amzn-mktp-ca": "Amazon",
  "amzn-mktp-us": "Amazon",
  "amznmktplace": "Amazon",
  "amazonca": "Amazon",
  
  // Home Depot variants
  "home-depot": "Home Depot",
  "homedepot-com": "Home Depot",
  "the-home-depot": "Home Depot",
  
  // Google variants
  "google-cloud": "Google Cloud",
  "google-cloud-ca": "Google Cloud",
  "google-cloud-us": "Google Cloud",
  "googlecloud": "Google Cloud",
};

/**
 * Resolve merchant slug to canonical slug for grouping.
 * E.g. "amazon-ca" → "amazon", "amzn-mktp-ca" → "amazon"
 * 
 * This ensures that merchant variants are grouped together under one key.
 */
export function resolveCanonicalMerchantSlug(slug: string): string {
  // Check if this slug should be mapped to a canonical merchant
  const canonical = MERCHANT_ALIASES[slug];
  if (canonical) {
    // Return the slug of the first entry with this canonical name
    // (or a normalized version of the canonical name)
    return canonical.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  }
  return slug; // No alias - return original slug
}

/**
 * Resolve merchant aliases to canonical names.
 * E.g. "Amazon.ca" and "Amzn Mktp CA" both resolve to "Amazon"
 * 
 * @param slug - The normalized merchant slug (from merchantSlug())
 * @param originalName - The original merchant name for fallback
 * @returns Canonical merchant name to display
 */
export function resolveMerchantAlias(slug: string, originalName: string): string {
  // Check if this slug has a known alias
  const canonical = MERCHANT_ALIASES[slug];
  if (canonical) return canonical;
  
  // No alias - return normalized original name
  return normalizeMerchantName(originalName);
}
