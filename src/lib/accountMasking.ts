/**
 * Account Number Masking Utility
 * 
 * Masks account numbers to last 4 digits only for privacy.
 * Full account numbers are never stored in Firestore.
 */

/**
 * Masks an account number to only the last 4 digits.
 * 
 * Examples:
 *   "1234567890" → "7890"
 *   "5678" → "5678" (already 4 digits)
 *   "123" → "123" (less than 4, return as-is)
 *   "" → ""
 *   undefined → undefined
 */
export function maskAccountNumber(accountNumber: string | undefined | null): string | undefined {
  if (!accountNumber || typeof accountNumber !== "string") {
    return undefined;
  }

  const trimmed = accountNumber.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  // If 4 digits or less, return as-is
  if (trimmed.length <= 4) {
    return trimmed;
  }

  // Return last 4 characters
  return trimmed.slice(-4);
}

/**
 * Recursively masks account numbers in parsed statement data.
 * Only masks the accountId field, preserving all other data.
 * Slugs are built AFTER masking, so they remain stable.
 */
export function maskAccountNumbersInParsedData<T extends Record<string, any>>(data: T): T {
  if (!data || typeof data !== "object") {
    return data;
  }

  // Create shallow copy
  const masked = { ...data };

  // Mask accountId if present
  if ("accountId" in masked && typeof masked.accountId === "string") {
    masked.accountId = maskAccountNumber(masked.accountId) || masked.accountId;
  }

  return masked;
}
