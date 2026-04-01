/**
 * Shared currency formatting utilities.
 *
 * All monetary amounts in the app are displayed using these helpers so the
 * symbol is always unambiguous (CA$ vs US$ vs €, etc.).
 *
 * Home currency is CAD — pages that display aggregate / already-converted
 * values (net worth, spending, income) call fmt(value) with no second arg
 * and get "CA$" automatically.
 *
 * Per-account pages that hold foreign-currency balances pass the account's
 * currency code as the second argument.
 */

export const HOME_CURRENCY = "CAD";

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
 * Defaults to the home currency symbol (CA$) when currency is null/undefined.
 */
export function getCurrencySymbol(currency?: string | null): string {
  const code = (currency ?? HOME_CURRENCY).toUpperCase();
  return CURRENCY_SYMBOL[code] ?? `${code}\u00a0`;
}

/**
 * Format a monetary amount with the correct currency symbol.
 * Examples:
 *   fmt(1234)         → "CA$1,234"
 *   fmt(1234, "USD")  → "US$1,234"
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
 * Compact formatter: uses k/M suffix for large numbers.
 * Examples:
 *   fmtCompact(1234567) → "CA$1.2M"
 *   fmtCompact(9500)    → "CA$9.5k"
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
