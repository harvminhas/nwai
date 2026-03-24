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
 * Stable slug for an account: `bank-last4digits`
 * e.g. "cibc-costco-world-mastercard-0773"
 */
export function buildAccountSlug(bankName: string | undefined | null, accountId: string | undefined | null): string {
  const bank = (bankName ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const acct = normalizeAccountId(accountId);
  return acct !== "unknown" ? `${bank}-${acct}` : bank;
}
