/**
 * Shared currency formatting utilities.
 *
 * All monetary amounts in the app are displayed using these helpers so the
 * symbol is always unambiguous (CA$ vs US$ vs €, etc.).
 *
 * The home currency is user-specific ("CAD" for Canadian users, "USD" for US
 * users). Pages that display aggregate / already-converted amounts should call
 * fmt(value, homeCurrency) — where homeCurrency comes from the API response
 * (profile.homeCurrency) or the ProfileRefreshContext.
 *
 * fmt(value) with no second arg falls back to "USD" (the app default when
 * country is unknown or not yet confirmed).
 */

/** Default when no home currency is known yet. */
export const HOME_CURRENCY = "USD";

const CA_BANK_RE = /\b(td|rbc|bmo|cibc|scotiabank|desjardins|national bank|tangerine|simplii|hsbc canada|laurentian|coast capital|meridian|atb|wealthsimple|questrade|eq bank|manulife|sun life|great.west|industrial alliance|ia financial|ci financial|empire life|canada life|ivari|rbc direct|td direct|bmo investorline|qtrade|virtual brokers|credential|aviso|servus|alterna|motusbank|oaken|nbc|bnc|canadian western|cwb|envision|first west|khalsa credit|libro credit|nexbank|prospera|valley first|interior savings|island savings|gulf and fraser)\b/i;
const US_BANK_RE = /\b(bank of america|chase|wells fargo|citibank|citi|capital one|us bank|pnc|suntrust|bb&t|truist|regions|fifth third|ally|discover|american express|amex|usaa|navy federal|td bank|fidelity|schwab|vanguard|merrill|etrade|e.trade|robinhood|sofi|marcus|synchrony|barclays us|citizens bank|key bank|huntington|m&t bank)\b/i;

/**
 * Infer the ISO 4217 currency for a statement given the bank name and any
 * explicit currency the AI already extracted.
 *
 * Priority:
 *   1. `explicitCurrency` — AI-extracted (always trusted when present)
 *   2. Bank-name heuristic — CA banks → CAD, US banks → USD
 *   3. `fallback` — caller's home currency (last resort)
 */
export function inferCurrencyFromBankName(
  bankName: string | null | undefined,
  explicitCurrency: string | null | undefined,
  fallback = HOME_CURRENCY,
): string {
  if (explicitCurrency) return explicitCurrency.toUpperCase();
  const name = bankName ?? "";
  if (CA_BANK_RE.test(name)) return "CAD";
  if (US_BANK_RE.test(name)) return "USD";
  return fallback.toUpperCase();
}

/** Minimal shape for resolving a transaction's display currency from profile snapshots. */
export interface AccountSnapshotCurrency {
  slug: string;
  currency?: string | null;
}

/**
 * ISO currency for a bank transaction: match `accountSlug` to a snapshot (with
 * case-insensitive slug match), then txn field, then home. `cash` uses home/no snapshot.
 */
export function resolveTxnCurrencyFromSnapshots(
  accountSlug: string | undefined,
  snapshots: AccountSnapshotCurrency[] | undefined,
  txnCurrency?: string | null,
  homeCurrency = HOME_CURRENCY,
): string {
  if (accountSlug && accountSlug !== "cash" && snapshots && snapshots.length > 0) {
    const s = String(accountSlug).trim();
    for (const snap of snapshots) {
      if (!snap.currency) continue;
      const ss = String(snap.slug).trim();
      if (ss === s || ss.toLowerCase() === s.toLowerCase()) {
        return String(snap.currency).toUpperCase();
      }
    }
  }
  if (txnCurrency) return String(txnCurrency).toUpperCase();
  return homeCurrency.toUpperCase();
}

export const CURRENCY_SYMBOL: Record<string, string> = {
  CAD: "CA$",
  USD: "US$",
  EUR: "€",
  GBP: "£",
  AUD: "AU$",
  NZD: "NZ$",
  CHF: "CHF\u00a0",
  JPY: "¥",
  MXN: "MX$",
  INR: "₹",
};

/**
 * Returns the display symbol for a currency code.
 * Pass the user's homeCurrency as the fallback to get the right symbol.
 */
export function getCurrencySymbol(currency?: string | null, homeCurrency?: string): string {
  const code = (currency ?? homeCurrency ?? HOME_CURRENCY).toUpperCase();
  return CURRENCY_SYMBOL[code] ?? `${code}\u00a0`;
}

/**
 * Format a monetary amount with the correct currency symbol.
 * Pass currency (or homeCurrency) to get the right symbol — defaults to USD.
 * Examples:
 *   fmt(1234, "USD")  → "US$1,234"
 *   fmt(1234, "CAD")  → "CA$1,234"
 *   fmt(-500, "GBP")  → "-£500"
 */
export function fmt(value: number, currency?: string | null): string {
  const sym = getCurrencySymbol(currency);
  const num = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Math.abs(value));
  return `${value < 0 ? "-" : ""}${sym}${num}`;
}

/**
 * The single formatting entry-point for ALL monetary display in the app.
 *
 * Rules:
 *   isConsolidated = false  → individual account/transaction amount.
 *                             Show in originalCurrency (the account's native currency).
 *                             e.g. a TD transaction always shows CA$, a Chase tx shows US$
 *
 *   isConsolidated = true   → aggregate / already-converted total.
 *                             Show in homeCurrency (the data layer already converted it).
 *                             e.g. net worth, monthly spending total, category total
 *
 * Examples:
 *   formatCurrency(1464, "USD", "CAD", false)  → "CA$1,464"  (individual CAD tx, user is USD-home)
 *   formatCurrency(14731, "USD", undefined, true) → "US$14,731" (aggregate in home USD)
 *   formatCurrency(500, "CAD", "CAD", false)   → "CA$500"    (CAD tx, user is CAD-home)
 */
export function formatCurrency(
  amount: number,
  homeCurrency: string,
  originalCurrency?: string | null,
  isConsolidated = false,
): string {
  const displayCurrency = isConsolidated
    ? homeCurrency
    : (originalCurrency ?? homeCurrency);
  return fmt(amount, displayCurrency);
}

/**
 * Compact formatter: uses k/M suffix for large numbers.
 * Examples:
 *   fmtCompact(1234567, "USD") → "US$1.2M"
 *   fmtCompact(9500, "CAD")    → "CA$9.5k"
 */
export function fmtCompact(value: number, currency?: string | null): string {
  const sym = getCurrencySymbol(currency);
  const abs = Math.abs(value);
  let num: string;
  if (abs >= 1_000_000) {
    num = `${(abs / 1_000_000).toFixed(1)}M`;
  } else if (abs >= 1_000) {
    num = `${(abs / 1_000).toFixed(1)}k`;
  } else {
    num = abs.toFixed(0);
  }
  return `${value < 0 ? "-" : ""}${sym}${num}`;
}
