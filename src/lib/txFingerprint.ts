import { createHash } from "crypto";

/** Normalize a merchant / description string before hashing. */
function normDesc(s: string): string {
  return (s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Extract last 4 digits of an account ID (works with masked IDs like "••••1234"). */
function last4(accountId: string): string {
  const digits = (accountId ?? "").replace(/\D/g, "");
  return digits.slice(-4).padStart(4, "0");
}

/**
 * Create a deterministic SHA-256 fingerprint for a transaction.
 *
 * Same real-world transaction appearing in both a PDF statement and a CSV
 * export will produce the same fingerprint, enabling safe cross-source
 * deduplication in extractAllTransactions.
 *
 * Key: last4(accountId) | YYYY-MM-DD | amount (2dp) | normalized descriptor
 */
export function txFingerprint(
  accountId: string,
  date: string,        // YYYY-MM-DD
  amount: number,
  descriptor: string,  // merchant name or income description
): string {
  const key = [
    last4(accountId),
    date.slice(0, 10),
    Math.abs(amount).toFixed(2),
    normDesc(descriptor),
  ].join("|");
  return createHash("sha256").update(key).digest("hex");
}
