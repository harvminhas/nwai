import { resolveAccountDisplayName } from "./accountListLabel";

/**
 * Account row → detail URL, matching Assets / Debts list behavior:
 *   imported statement accounts → /account/accounts/[slug]
 *   manual assets               → /account/assets/[id]
 *   manual liabilities          → no page (non-clickable)
 *   missing / aggregate rows    → null (non-clickable)
 */

const MANUAL_PREFIX = "manual-";

const MANUAL_ASSET_CATEGORIES = new Set([
  "property",
  "vehicle",
  "retirement",
  "investment",
  "business",
]);

const MANUAL_LIABILITY_CATEGORIES = new Set([
  "mortgage",
  "auto_loan",
  "student_loan",
  "personal_loan",
  "credit_card",
  "line_of_credit",
]);

export type AccountDetailSide = "asset" | "debt";

export interface AccountDetailHrefInput {
  slug?: string | null;
  /** byAccount.type, e.g. "checking" or "manual-vehicle". */
  type?: string | null;
  /**
   * Which net-worth tab / breakdown category this row came from.
   * Used when a manual row's category is "other" (shared by assets and debts).
   */
  side?: AccountDetailSide | null;
}

function manualCategory(type?: string | null): string {
  if (!type) return "";
  return type.startsWith(MANUAL_PREFIX) ? type.slice(MANUAL_PREFIX.length) : type;
}

function isManualLiabilityType(type?: string | null, side?: AccountDetailSide | null): boolean {
  const category = manualCategory(type);
  if (MANUAL_LIABILITY_CATEGORIES.has(category)) return true;
  if (MANUAL_ASSET_CATEGORIES.has(category)) return false;
  return side === "debt";
}

export function accountDetailHref(input: AccountDetailHrefInput | string | null | undefined): string | null {
  const opts: AccountDetailHrefInput = typeof input === "string" || input == null
    ? { slug: input }
    : input;
  const slug = (opts.slug ?? "").trim();
  if (!slug) return null;

  if (slug.startsWith(MANUAL_PREFIX)) {
    const id = slug.slice(MANUAL_PREFIX.length);
    if (!id) return null;
    if (isManualLiabilityType(opts.type, opts.side)) return null;
    return `/account/assets/${id}`;
  }

  return `/account/accounts/${slug}`;
}

export interface NetWorthAccountRowInput {
  slug: string;
  label: string;
  type?: string | null;
  side: AccountDetailSide;
  isBaseline?: boolean;
  isNewAsset?: boolean;
}

/** Label + href for a Net Worth What Changed / Assets / Debts account row. */
export function netWorthAccountRow(item: NetWorthAccountRowInput): {
  label: string;
  href: string | null;
} {
  const name = resolveAccountDisplayName({
    historyLabel: item.label,
    fallback: item.slug,
  }).primary;
  const label = item.isNewAsset
    ? `New asset: ${name}`
    : item.isBaseline
      ? `${name} (first statement)`
      : name;
  return {
    label,
    href: accountDetailHref({ slug: item.slug, type: item.type, side: item.side }),
  };
}
