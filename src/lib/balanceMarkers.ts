/**
 * Detects balance-marker rows that the AI should have skipped but occasionally
 * includes — e.g. "OPENING BALANCE", "CLOSING BALANCE", "BALANCE FORWARD".
 * Used as a post-processing safety net both server-side (consolidated API) and
 * client-side (transaction lists).
 */
export const BALANCE_MARKER_RE =
  /^\s*(opening|closing|beginning|ending|starting|prior|previous)\s*bal(ance|\.?)?\s*$|^\s*balance\s*(forward|brought\s*forward|b\/f|c\/f|carried\s*forward)\s*$|^\s*(bal\.?\s*fwd|balance\s*fwd|balance\s*b\/f)\s*$/i;

export function isBalanceMarker(merchant: string): boolean {
  return BALANCE_MARKER_RE.test((merchant ?? "").trim());
}

/** Client-side stable key for a transaction (used for ignore list). */
export function txIgnoreKey(date: string | undefined, amount: number, merchant: string): string {
  return `${date ?? ""}|${Math.round(Math.abs(amount) * 100)}|${merchant.trim().toLowerCase()}`;
}
