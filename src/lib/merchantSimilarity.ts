/**
 * Shared merchant name normalization and grouping for merge suggestions.
 * Used by subscriptions API, debug script, and regression tests.
 */

export interface MerchantItem {
  merchant: string;
  merchantSlug: string;
}

/**
 * Normalize merchant name for similarity matching.
 * Strips special chars, trailing random codes, and normalizes whitespace.
 * 
 * Examples:
 *   "GOOGLE CLOUD XR3XS7" → "google cloud"
 *   "GOOGLE *CLOUD 74DBCz" → "google cloud"
 *   "NETFLIX.COM" → "netflix com"
 *   "RESEND" → "resend"
 *   "GOOGLE *CLOUD MPRCGL" → "google cloud mprcgl" (no digit, kept)
 */
export function normalizeMerchantForSimilarity(name: string): string {
  // Convert to lowercase and replace all non-alphanumeric (except spaces) with spaces
  let cleaned = name.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  
  // Strip trailing tokens that contain BOTH a letter and a digit
  // Pattern: space followed by 5-8 chars that have at least one digit AND one letter
  // Using lookaheads to verify the token contains both before matching
  cleaned = cleaned.replace(/\s+(?=[a-z0-9]{5,8}$)(?=\S*\d)(?=\S*[a-z])[a-z0-9]{5,8}$/i, "").trim();
  
  // Also strip all-digit codes at the end
  cleaned = cleaned.replace(/\s+\d{5,8}$/, "").trim();
  
  return cleaned;
}

/**
 * Find groups of similar merchants that should be suggested for merging.
 * Runs over all provided items (active, candidates, inactive) to catch split variants.
 * 
 * Rules:
 *   1. Exact match after normalization (e.g. "GOOGLE CLOUD XR3XS7" → "google cloud")
 *   2. Prefix match: shorter is prefix of longer, ≥5 chars, ≥30% coverage
 */
export function findMergeSuggestions<T extends MerchantItem>(items: T[]): Array<T[]> {
  const groups: Array<T[]> = [];
  const processed = new Set<string>();
  
  for (const item of items) {
    if (processed.has(item.merchantSlug)) continue;
    
    const normalized = normalizeMerchantForSimilarity(item.merchant);
    
    // Find similar merchants
    const similar = items.filter(other => {
      if (other.merchantSlug === item.merchantSlug || processed.has(other.merchantSlug)) return false;
      
      const otherNorm = normalizeMerchantForSimilarity(other.merchant);
      
      // Rule 1: normalized names match exactly (e.g. after stripping codes)
      if (normalized === otherNorm && normalized.length >= 5) return true;
      
      // Rule 2: one is prefix of the other, ≥5 chars, ≥30% coverage
      const shorter = normalized.length <= otherNorm.length ? normalized : otherNorm;
      const longer = normalized.length <= otherNorm.length ? otherNorm : normalized;
      if (shorter.length >= 5 && longer.startsWith(shorter) && shorter.length / longer.length >= 0.3) return true;
      
      return false;
    });
    
    if (similar.length > 0) {
      const group = [item, ...similar];
      groups.push(group);
      processed.add(item.merchantSlug);
      similar.forEach(s => processed.add(s.merchantSlug));
    }
  }
  
  return groups;
}
