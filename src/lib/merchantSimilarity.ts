/**
 * Shared merchant name normalization for merge suggestions.
 * Used by subscriptions API, debug script, and regression tests.
 */

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
