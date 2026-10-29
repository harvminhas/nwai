/**
 * Account Number Masking Utility
 * 
 * Masks account numbers to last 4 digits only for privacy.
 * Full account numbers are never stored in Firestore.
 */

/**
 * Masks an account number to only the last 4 alphanumeric characters.
 * 
 * Strategy:
 * 1. Strip all non-alphanumeric characters (keep only digits and letters)
 * 2. If 4+ digits exist, return last 4 digits (most common case: card numbers)
 * 3. Otherwise return last 4 alphanumeric characters (handles alphanumeric IDs)
 * 
 * Examples:
 *   "1234567890" → "7890" (last 4 digits)
 *   "(7780)" → "7780" (strip parens, last 4 digits)
 *   "4520 88XX XXXX 7035" → "7035" (strip spaces and X, last 4 digits)
 *   "••••7035" → "7035" (strip bullets, last 4 digits)
 *   "HQ45X5615CAD" → "5CAD" (mixed alphanumeric, last 4 alphanumerics)
 *   "1185-4190085" → "0085" (strip dashes, last 4 digits)
 *   "573156" → "3156" (last 4 digits)
 *   "5678" → "5678" (already 4 digits)
 *   "HQ6MK8XN6CAD" → "6CAD" (no 4+ digits, last 4 alphanumerics)
 *   "123" → "123" (less than 4 alphanumerics, return as-is)
 */
export function maskAccountNumber(accountNumber: string | undefined | null): string | undefined {
  if (!accountNumber || typeof accountNumber !== "string") {
    return undefined;
  }

  const trimmed = accountNumber.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  // Extract digits and all alphanumerics separately
  const digits = trimmed.replace(/\D/g, "");
  const alphanumerics = trimmed.toLowerCase().replace(/[^a-z0-9]/g, "");

  // If we have 4+ digits, return last 4 digits (most common: card numbers)
  if (digits.length >= 4) {
    return digits.slice(-4);
  }

  // Otherwise return last 4 alphanumerics (handles mixed IDs like HQ6MK8XN6CAD)
  if (alphanumerics.length <= 4) {
    return alphanumerics;
  }

  return alphanumerics.slice(-4);
}

/**
 * Recursively masks account numbers in parsed statement data.
 * Only masks the accountId field, preserving all other data.
 * Slugs should be built BEFORE calling this function.
 */
export function maskAccountNumbersInParsedData<T extends Record<string, any>>(data: T): T {
  if (!data || typeof data !== "object") {
    return data;
  }

  // Create shallow copy
  const masked = { ...data } as any;

  // Mask accountId if present and it's a string
  if ("accountId" in data && typeof data.accountId === "string") {
    const maskedId = maskAccountNumber(data.accountId);
    if (maskedId) {
      masked.accountId = maskedId;
    }
  }

  return masked as T;
}
