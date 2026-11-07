/**
 * Core net worth calculation logic - single authoritative implementation.
 * 
 * Extracted from financialProfile.ts to be shared by all consumers.
 * Preserves all existing FX, account activation, and valuation rules.
 */

import type { ManualAsset } from "./types";
import type { AccountStatusRecord } from "./accountStatus";

// Use a minimal interface that works with financialProfile.ts MonthlyHistoryEntry
// We only modify netWorth/totalAssets/totalDebts/byAccount fields
export interface MonthNetWorthHistory {
  yearMonth: string;
  netWorth: number;
  totalAssets: number;
  totalDebts: number;
  byAccount: Array<{ slug: string; label: string; type: string; value: number }>;
  [key: string]: unknown; // Allow additional fields from MonthlyHistoryEntry
}

export interface AccountBalanceHistory {
  slug: string;
  label: string;
  accountType: string;
  currency: string;
  entries: Array<{ yearMonth: string; balance: number }>;
}

/**
 * Calculate net worth for all months in history.
 * 
 * This is the PRODUCTION calculation used by financialProfile.ts.
 * All net worth consumers must use this path for consistency.
 * 
 * @param monthlyHistory - Array of month entries to populate (modified in place)
 * @param accountBalanceHistory - Account balance history per account
 * @param manualAssets - Manually added assets (car, property, etc.)
 * @param toHome - Currency conversion function (balance, currency) => homeAmount
 * @param accountStatusMap - Active/closed status per account (AccountStatusRecord map)
 */
export function calculateNetWorthForMonths(
  monthlyHistory: MonthNetWorthHistory[],
  accountBalanceHistory: AccountBalanceHistory[],
  manualAssets: ManualAsset[],
  toHome: (balance: number, currency: string) => number,
  accountStatusMap: Map<string, AccountStatusRecord>
): void {
  // Manual assets total (added to each month)
  const manualAssetsTotal = manualAssets.reduce((s, a) => s + a.value, 0);

  // Account type classification (same as assets/liabilities pages)
  const ASSET_TYPES = new Set(["checking", "savings", "investment", "property", "other"]);
  const DEBT_TYPES = new Set(["credit", "mortgage", "loan", "line_of_credit"]);

  // Pre-sort entries ascending; split into asset and debt buckets
  const assetEntries: Array<{ acct: AccountBalanceHistory; sorted: Array<{ yearMonth: string; balance: number }> }> = [];
  const debtEntries: Array<{ acct: AccountBalanceHistory; sorted: Array<{ yearMonth: string; balance: number }> }> = [];

  for (const acct of accountBalanceHistory) {
    const sorted = [...acct.entries].sort((a, b) => a.yearMonth.localeCompare(b.yearMonth));
    if (ASSET_TYPES.has(acct.accountType)) {
      assetEntries.push({ acct, sorted });
    }
    if (DEBT_TYPES.has(acct.accountType) || acct.entries.some((e) => e.balance < 0)) {
      debtEntries.push({ acct, sorted });
    }
  }

  // Calculate net worth for each month
  for (const h of monthlyHistory) {
    let ta = 0;
    let td = 0;
    const accountContributions: Array<{ slug: string; label: string; type: string; value: number }> = [];

    // Sum asset account balances as of this month
    for (const { acct, sorted } of assetEntries) {
      let bal: number | null = null;
      for (const e of sorted) {
        if (e.yearMonth <= h.yearMonth) bal = e.balance;
        else break;
      }
      if (bal === null) continue;
      const value = Math.max(0, toHome(bal, acct.currency)); // positive balances only
      ta += value;
      accountContributions.push({
        slug: acct.slug,
        label: acct.label,
        type: acct.accountType,
        value, // Assets are positive
      });
    }

    // Sum debt account balances as of this month
    for (const { acct, sorted } of debtEntries) {
      // Exclude paid-off/closed debts from net worth calculation
      const isActive = isAccountActive(acct.slug, h.yearMonth, accountStatusMap);
      if (!isActive) continue;

      let bal: number | null = null;
      for (const e of sorted) {
        if (e.yearMonth <= h.yearMonth) bal = e.balance;
        else break;
      }
      if (bal === null) continue;
      const absValue = Math.abs(toHome(bal, acct.currency)); // abs — same as liabilities page
      td += absValue;
      accountContributions.push({
        slug: acct.slug,
        label: acct.label,
        type: acct.accountType,
        value: -absValue, // Debts are negative
      });
    }

    // Add manual assets (car, property, etc.)
    ta += manualAssetsTotal;
    
    // Populate month entry
    h.totalAssets = ta;
    h.totalDebts = td;
    h.netWorth = ta - td;
    h.byAccount = accountContributions;
  }
}

/**
 * Helper to check if account is active for a given month.
 * Re-uses logic from accountStatus.ts isAccountActive.
 */
function isAccountActive(
  slug: string,
  yearMonth: string,
  accountStatusMap: Map<string, AccountStatusRecord>
): boolean {
  const statusRec = accountStatusMap.get(slug);
  if (!statusRec) return true; // No status info = assume active (open)
  
  // Check if status changed before or during this month
  const statusYearMonth = statusRec.statusDate.substring(0, 7); // YYYY-MM-DD -> YYYY-MM
  
  if (statusYearMonth > yearMonth) {
    // Status change happened after this month - account was still active
    return true;
  }
  
  // Status changed at or before this month - check if it's still active
  return statusRec.status === "open";
}
