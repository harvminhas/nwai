/**
 * Display labels for Assets / Debts Accounts rows, the account switcher,
 * transaction rows, and the account detail header.
 * Avoids repeating institution + account when they are the same name,
 * while keeping the original combined name for title / aria.
 *
 * Resolution (display only — does not write stored data):
 *   1. User-set nickname / label
 *   2. Account product name that is distinct from the institution
 *   3. History / What Changed label (same source as net-worth byAccount.label)
 *   4. Account name, then institution, then fallback
 *
 * The same generic rule applies to every account from that account's own
 * fields. Placeholder institutions (e.g. "Unknown Bank") are not prefixed
 * onto a product name.
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

/**
 * Generic / missing institution strings that should not prefix a product name.
 * Matches the account's own bankName field, not any particular real bank.
 */
function isPlaceholderInstitution(name: string): boolean {
  return /^(unknown(\s+(bank|account))?|bank)$/i.test(normalizeName(name));
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
  /** Statement product name. */
  accountName?: string | null;
  /** Institution. */
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

  const bankForCombine = product && isPlaceholderInstitution(bankName) ? "" : bankName;
  const resolved = accountDisplayLabel(bankForCombine, product || null);
  if (resolved.primary) return resolved;
  if (fallback) return { primary: fallback, full: fallback };
  return resolved;
}

/**
 * Masked last-4 from a slug or id-like token. Digits only — never returns a
 * raw account number, and never invents a mask from letters.
 */
export function maskedAccountLast4(slugOrId?: string | null): string {
  if (!slugOrId) return "";
  const trimmed = slugOrId.trim();
  if (!trimmed || /^unknown(-account)?$/i.test(trimmed)) return "";
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length >= 4) return `•••${digits.slice(-4)}`;
  return "";
}

function alreadyHasMaskedLast4(value: string): boolean {
  return /••+\s*\d{2,4}/.test(value);
}

function isInstitutionOnlyPrimary(display: AccountDisplayLabel, bankName: string): boolean {
  if (!display.primary || !bankName || display.secondary) return false;
  return namesAreEquivalent(display.primary, bankName);
}

/**
 * Single-line label for transaction rows, merchants, and CSV Account columns.
 * Same generic resolution as resolveAccountDisplayName, then:
 *   - if the name is the institution (no nickname/product), append masked last4
 *     so two same-bank accounts stay distinguishable
 *   - never emit a raw slug or account number (masked last4 or "Account")
 *
 * Do not use this where last4 is already shown as secondary meta (switcher, lists).
 */
export function compactAccountDisplayName(
  input: AccountDisplayNameInput,
  last4Source?: string | null,
): string {
  const bankName = normalizeName(input.bankName ?? "");
  const display = resolveAccountDisplayName({
    ...input,
    fallback: undefined,
  });
  const masked = maskedAccountLast4(last4Source ?? input.fallback);
  if (display.primary) {
    if (
      isInstitutionOnlyPrimary(display, bankName) &&
      masked &&
      !alreadyHasMaskedLast4(display.primary)
    ) {
      return `${display.primary} ${masked}`;
    }
    return display.primary;
  }
  return masked || "Account";
}

/** Primary display string for a parsed statement / snapshot (compact / txn label). */
export function statementAccountDisplayName(
  parsed: {
    nickname?: string | null;
    accountName?: string | null;
    bankName?: string | null;
  },
  slug?: string | null,
  historyLabel?: string | null,
): string {
  return compactAccountDisplayName(
    {
      nickname: parsed.nickname,
      accountName: parsed.accountName,
      bankName: parsed.bankName,
      historyLabel,
    },
    slug,
  );
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

/** Lowercased haystack for account search: display name + institution + extra meta. */
export function accountSearchText(
  display: AccountDisplayLabel,
  ...extra: Array<string | null | undefined>
): string {
  return [display.primary, display.secondary, display.full, ...extra]
    .map((part) => (part ? normalizeName(part) : ""))
    .filter((part) => part.length > 0)
    .join(" ")
    .toLowerCase();
}

export function accountMatchesQuery(
  query: string,
  ...fields: Array<string | null | undefined>
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return fields.some((field) => (field ?? "").toLowerCase().includes(q));
}

/** Resolve a display name from a profile snapshot + history + existing txn label. */
export function displayNameFromProfileAccount(
  slug: string,
  profile: {
    accountSnapshots?: Array<{ slug: string; accountName?: string | null; bankName?: string | null }>;
    accountBalanceHistory?: Array<{ slug?: string | null; label?: string | null }>;
  },
  existingLabel?: string | null,
): string {
  const snap = (profile.accountSnapshots ?? []).find((entry) => entry.slug === slug);
  return compactAccountDisplayName(
    {
      accountName: snap?.accountName,
      bankName: snap?.bankName,
      // What Changed / history outranks a stale txn cache like "Bank · •••1234".
      historyLabel: findAccountHistoryLabel(profile.accountBalanceHistory, slug) || existingLabel,
    },
    slug,
  );
}

export interface SwitcherAccountFields {
  slug: string;
  bankName?: string | null;
  accountName?: string | null;
  nickname?: string | null;
}

export interface SwitcherAccountPresentation {
  label: string;
  sub: string;
  searchText: string;
  full: string;
}

/**
 * Account switcher row: product/nickname as the title, institution + group +
 * last4 as the subdued line. Search matches every one of those fields.
 */
export function switcherAccountPresentation(
  acc: SwitcherAccountFields,
  opts: {
    groupLabel: string;
    last4: string;
    historyLabel?: string | null;
  },
): SwitcherAccountPresentation {
  const display = resolveAccountDisplayName({
    nickname: acc.nickname,
    accountName: acc.accountName,
    bankName: acc.bankName,
    historyLabel: opts.historyLabel,
    fallback: acc.slug,
  });
  const sub = joinAccountMeta([display.secondary, opts.groupLabel, opts.last4]);
  return {
    label: display.primary,
    sub,
    searchText: accountSearchText(
      display,
      opts.groupLabel,
      opts.last4,
      acc.slug,
      acc.bankName,
      acc.accountName,
      acc.nickname,
      opts.historyLabel,
    ),
    full: display.full,
  };
}
