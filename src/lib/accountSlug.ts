/**
 * Normalize a raw account ID (masked card number) to a stable 4-digit token.
 *
 * Banks format the same account number many different ways across PDFs:
 *   ****0773  /  XXXX0773  /  5223 XXXX XXXX 0773  /  •••• 0773
 *
 * We strip every non-digit character and keep the last 4 digits — the only
 * portion that is both consistently present and actually unique to the account.
 * If fewer than 4 digits exist (unlikely), we fall back to the raw alphanumeric.
 */
export function normalizeAccountId(raw: string | undefined | null): string {
  if (!raw) return "unknown";
  const digits = raw.replace(/\D/g, "");
  if (digits.length >= 4) return digits.slice(-4);
  const alnum = raw.toLowerCase().replace(/[^a-z0-9]/g, "");
  return alnum || "unknown";
}

/**
 * Stable slug for an account.
 *
 * When the account ID is known, use only the last 4 digits — this is unique
 * enough in practice (one person very rarely has two accounts ending in the
 * same 4 digits at different banks) and is immune to bank name variations like
 * "TD" vs "TD Bank" vs "TD Canada Trust".
 *
 * When the account ID is not extractable, fall back to a normalized bank name
 * so that at least same-bank accounts without IDs group together rather than
 * all collapsing into a single "unknown" bucket.
 */
export function buildAccountSlug(bankName: string | undefined | null, accountId: string | undefined | null): string {
  const acct = normalizeAccountId(accountId);
  if (acct !== "unknown") return acct;
  // Fallback: use normalized bank name when no account ID is available
  return (bankName ?? "unknown").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "unknown";
}
