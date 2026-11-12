/**
 * Display labels for Assets / Debts Accounts rows and the account detail header.
 * Avoids repeating institution + account when they are the same name,
 * while keeping the original combined name for title / aria.
 *
 * Resolution (display only — does not write stored data):
 *   1. User-set nickname / label
 *   2. Account product name that is distinct from the institution
 *   3. History / What Changed label (same source as net-worth byAccount.label)
 *   4. Account name, then institution, then fallback
 */

function normalizeName(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function namesAreEquivalent(a: string, b: string): boolean {
  return normalizeName(a).toLowerCase() === normalizeName(b).toLowerCase();
}

function oneContainsTheOther(a: string, b: string): boolean {
  const left = normalizeName(a).toLowerCase();
  const right = normalizeName(b).toLowerCase();
  return left.includes(right) || right.includes(left);
}

/** Non-empty name that is not just a repeat of the institution. */
function distinctFromInstitution(name: string, bank: string): string {
  if (!name) return "";
  if (!bank) return name;
  if (namesAreEquivalent(name, bank)) return "";
  return name;
}

export interface AccountDisplayLabel {
  /** Short line shown in the list / breadcrumb. Account name first. */
  primary: string;
  /** Institution, when it adds information beyond `primary`. */
  secondary?: string;
  /** Original combined name for title / aria. */
  full: string;
}

export interface AccountDisplayNameInput {
  /** User-set nickname / label — always wins when present. */
  nickname?: string | null;
  /** Statement product name (e.g. ALLINCLUSIVE). */
  accountName?: string | null;
  /** Institution (e.g. TD Canada Trust). */
  bankName?: string | null;
  /**
   * Already-resolved label from net-worth / balance history
   * (same source as What Changed rows).
   */
  historyLabel?: string | null;
  /** Last-resort key, typically the account slug. */
  fallback?: string | null;
}

export function accountDisplayLabel(
  bankName: string,
  accountName?: string | null
): AccountDisplayLabel {
  const bank = normalizeName(bankName);
  const account = accountName ? normalizeName(accountName) : "";

  if (!bank && !account) {
    return { primary: "", full: "" };
  }
  if (!account) {
    return { primary: bank, full: bank };
  }
  if (!bank) {
    return { primary: account, full: account };
  }

  if (namesAreEquivalent(bank, account)) {
    return { primary: account, full: account };
  }

  const full = `${bank} · ${account}`;

  if (oneContainsTheOther(bank, account)) {
    const primary = account.length >= bank.length ? account : bank;
    return { primary, full };
  }

  return { primary: account, secondary: bank, full };
}

/**
 * Shared display-name resolution for What Changed rows and the account detail
 * header: account name / nickname first, institution as secondary.
 */
export function resolveAccountDisplayName(
  input: AccountDisplayNameInput
): AccountDisplayLabel {
  const nickname = normalizeName(input.nickname ?? "");
  const accountName = normalizeName(input.accountName ?? "");
  const bankName = normalizeName(input.bankName ?? "");
  const historyLabel = normalizeName(input.historyLabel ?? "");
  const fallback = normalizeName(input.fallback ?? "");

  const product =
    nickname ||
    distinctFromInstitution(accountName, bankName) ||
    distinctFromInstitution(historyLabel, bankName) ||
    accountName ||
    historyLabel ||
    "";

  const resolved = accountDisplayLabel(bankName, product || null);
  if (resolved.primary) return resolved;
  if (fallback) return { primary: fallback, full: fallback };
  return resolved;
}

export function joinAccountMeta(parts: Array<string | null | undefined>): string {
  return parts
    .map((part) => (part ? normalizeName(part) : ""))
    .filter((part) => part.length > 0)
    .join("  ·  ");
}

/** Look up the What Changed / balance-history label for an account slug. */
export function findAccountHistoryLabel(
  entries: Array<{ slug?: string | null; label?: string | null }> | undefined,
  slug: string,
): string | null {
  const needle = slug.trim().toLowerCase();
  if (!needle) return null;
  const match = (entries ?? []).find((entry) => (entry.slug ?? "").trim().toLowerCase() === needle);
  const label = match?.label ? normalizeName(match.label) : "";
  return label || null;
}
