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
