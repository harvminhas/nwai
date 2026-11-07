/**
 * Core net worth calculation logic - single authoritative implementation.
 * 
 * Extracted from financialProfile.ts to be shared by all consumers.
 * Preserves all existing FX, account activation, and valuation rules.
 */

import type { ManualAsset } from "./types";
import type { AccountStatusRecord } from "./accountStatus";
import { isAccountActive } from "./accountStatus";

// Minimal interface for net worth calculation fields
// financialProfile.ts MonthlyHistoryEntry has all these fields plus more
export interface MonthNetWorthHistory {
  yearMonth: string;
  netWorth: number;
  totalAssets: number;
  totalDebts: number;
  byAccount?: Array<{ slug: string; label: string; type: string; value: number }>;
}

export interface AccountBalanceHistory {
  slug: string;
  label: string;
  accountType: string;
  currency: string;
  entries: Array<{ yearMonth: string; balance: number }>;
}

/**
 * Get the effective valuation for a manual asset as of a specific month-end.
 * 
 * @param asset - The manual asset with optional valuations array
 * @param yearMonth - The target month (YYYY-MM format)
 * @returns The asset's value (in dollars) as of the end of that month
 */
function getAssetValueForMonth(asset: ManualAsset, yearMonth: string): number {
  // Legacy path: no valuations array means single current value for all months
  if (!asset.valuations || asset.valuations.length === 0) {
    return asset.value;
  }

  // Find the most recent valuation as of the end of this month
  // Month-end is YYYY-MM-31 (simplified — actual last day doesn't matter for comparison)
  const monthEnd = `${yearMonth}-31`;
  
  let effectiveValue: number | null = null;
  for (const val of asset.valuations) {
    if (val.effectiveDate <= monthEnd) {
      effectiveValue = val.valueCents / 100; // Convert cents to dollars
    } else {
      break; // valuations are sorted ascending, so we can stop
    }
  }

  // If no valuation exists for this month (all are after monthEnd), use legacy value or 0
  return effectiveValue !== null ? effectiveValue : asset.value;
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
  // Note: manualAssetsTotal removed — no longer a single value per asset

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
        const active = isAccountActive(acct.slug, h.yearMonth, accountStatusMap);
        if (!active) continue;

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

    // Add manual assets from their start date onward
    // Legacy assets without startDate are included in all months (preserve prior behavior)
    for (const asset of manualAssets) {
      if (asset.startDate) {
        const startMonth = asset.startDate.slice(0, 7); // YYYY-MM
        if (h.yearMonth < startMonth) continue; // Exclude before start month
      }
      
      // Get the effective value for this specific month
      const valueForMonth = getAssetValueForMonth(asset, h.yearMonth);
      
      ta += valueForMonth;
      accountContributions.push({
        slug: `manual-${asset.id}`,
        label: asset.label,
        type: `manual-${asset.category}`,
        value: valueForMonth,
      });
    }
    
    // Populate month entry
    h.totalAssets = ta;
    h.totalDebts = td;
    h.netWorth = ta - td;
    h.byAccount = accountContributions;
  }
}

// isAccountActive imported from accountStatus.ts - DO NOT reimplement
// Original logic: dateStr.slice(0,10) < statusDate.slice(0,10)
// Closure mid-month (2026-11-15) is ACTIVE for month 2026-11
