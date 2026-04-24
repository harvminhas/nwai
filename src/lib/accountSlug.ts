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
 * Priority:
 * 1. Last 4 digits of accountId — most specific, immune to bank name variations.
 * 2. bankName + accountType — stable across re-uploads since the AI consistently
 *    returns the same bank name and type even when the plan/product name wording
 *    changes. e.g. "fidelity-investment", "td-checking".
 *    accountName is intentionally excluded: it varies too much per upload to be
 *    a reliable key (e.g. "HPE Hewlett Packard Enterprise 401(k) Plan" vs "HPE 401(k)").
 * 3. bankName alone — last resort when type is also absent.
 */
export function buildAccountSlug(
  bankName: string | undefined | null,
  accountId: string | undefined | null,
  _accountName?: string | undefined | null,  // reserved for future use; not used in slug
  accountType?: string | undefined | null,
): string {
  const acct = normalizeAccountId(accountId);
  if (acct !== "unknown") return acct;

  const normalize = (s: string | undefined | null) =>
    (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

  const bank = normalize(bankName);
  const type = normalize(accountType);

  if (bank && type) return `${bank}-${type}`;
  return bank || "unknown";
}
