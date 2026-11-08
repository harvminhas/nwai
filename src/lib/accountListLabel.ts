/**
 * Display labels for Assets / Debts Accounts rows.
 * Avoids repeating institution + account when they are the same name,
 * while keeping the original combined name for title / aria.
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

export interface AccountDisplayLabel {
  /** Short line shown in the list. */
  primary: string;
  /** Institution, when it adds information beyond `primary`. */
  secondary?: string;
  /** Original combined name for title / aria. */
  full: string;
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

export function joinAccountMeta(parts: Array<string | null | undefined>): string {
  return parts
    .map((part) => (part ? normalizeName(part) : ""))
    .filter((part) => part.length > 0)
    .join("  ·  ");
}
