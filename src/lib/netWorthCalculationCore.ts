/**
 * Core net worth calculation logic - single authoritative implementation.
 * 
 * Extracted from financialProfile.ts to be shared by all consumers.
 * Preserves all existing FX, account activation, and valuation rules.
 */

import type { ManualAsset, ManualLiability } from "./types";
import type { AccountStatusRecord } from "./accountStatus";
import { isAccountActive } from "./accountStatus";

/** Stored manual-liability fields the NW calc reads. Extra Firestore keys (startDate, linkedAccountSlug) may be present. */
export type ManualLiabilityInput = Pick<ManualLiability, "id" | "label" | "category" | "balance"> & {
  updatedAt?: string;
  startDate?: string;
  linkedAccountSlug?: string;
};

/**
 * Earliest month this manual liability is known to exist.
 * Manual liabilities have no valuation history — only a current snapshot.
 * Use startDate when stored; otherwise updatedAt (the only date on the type).
 * Do not invent a balance for months before that date.
 * Undated legacy records are included in every month (same as legacy manual assets).
 */
function liabilityKnownFromMonth(liability: ManualLiabilityInput): string | null {
  const dated = liability.startDate || liability.updatedAt;
  if (dated && dated.length >= 7) return dated.slice(0, 7);
  return null;
}

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
 * Get the actual last day of a month (handles February, leap years correctly).
 * @param yearMonth - YYYY-MM format
 * @returns Last day of the month (28-31)
 */
function getLastDayOfMonth(yearMonth: string): number {
  const [year, month] = yearMonth.split('-').map(Number);
  // Date(year, month, 0) gives last day of previous month
  // Date(year, month+1, 0) gives last day of target month
  return new Date(year, month, 0).getDate();
}

/**
 * Get the effective valuation for a manual asset as of a specific month-end.
 * 
 * @param asset - The manual asset with optional valuations array
 * @param yearMonth - The target month (YYYY-MM format)
 * @returns The asset's value (in dollars) as of the end of that month
 */
export function getAssetValueForMonth(asset: ManualAsset, yearMonth: string): number {
  // Legacy path: no valuations array means single current value for all months
  if (!asset.valuations || asset.valuations.length === 0) {
    return asset.value;
  }

  // Find the most recent valuation as of the end of this month
  // Use actual last day of month (handles February 28/29, not assuming day 31)
  const lastDay = getLastDayOfMonth(yearMonth);
  const monthEnd = `${yearMonth}-${String(lastDay).padStart(2, '0')}`;
  
  let effectiveValue: number | null = null;
  for (const val of asset.valuations) {
    if (val.effectiveDate <= monthEnd) {
      effectiveValue = val.valueCents / 100; // Convert cents to dollars
    } else {
      break; // valuations are sorted ascending, so we can stop
    }
  }

  // If no valuation exists for this month (all are after monthEnd)
  if (effectiveValue !== null) {
    return effectiveValue;
  }
  
  // For legacy assets without startDate, use first valuation as unknown baseline
  // (preserves historical baseline without inventing dates)
  if (!asset.startDate && asset.valuations.length > 0) {
    return asset.valuations[0].valueCents / 100;
  }
  
  // Otherwise use current value (shouldn't happen for well-formed data)
  return asset.value;
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
 * @param manualLiabilities - Manually added liabilities (current snapshot; no invented past balances)
 * @param toHome - Currency conversion function (balance, currency) => homeAmount
 * @param accountStatusMap - Active/closed status per account (AccountStatusRecord map)
 */
export function calculateNetWorthForMonths(
  monthlyHistory: MonthNetWorthHistory[],
  accountBalanceHistory: AccountBalanceHistory[],
  manualAssets: ManualAsset[],
  manualLiabilities: ManualLiabilityInput[],
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

  const importedDebtBySlug = new Map(debtEntries.map(({ acct }) => [acct.slug, acct]));

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
    const importedContributingSlugs = new Set<string>();
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
      const homeBal = toHome(bal, acct.currency);
      if (homeBal > 0) {
        // Overpaid / credit balance — the bank owes the user, not the other way around.
        ta += homeBal;
        accountContributions.push({
          slug: acct.slug,
          label: acct.label,
          type: acct.accountType,
          value: homeBal,
        });
      } else {
        const absValue = Math.abs(homeBal);
        td += absValue;
        accountContributions.push({
          slug: acct.slug,
          label: acct.label,
          type: acct.accountType,
          value: -absValue,
        });
      }
      importedContributingSlugs.add(acct.slug);
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
    
    // Add manual liabilities from their known-from month onward.
    // Current snapshot only — do not invent a historical payoff series.
    // Explicit link/id only. Skip when the linked imported loan:
    //   • contributes this month (active + has a balance), or
    //   • is closed/paid off as of this month (do not resurrect the manual).
    // Active but not yet imported (no statement as of this month) → keep manual.
    // Same-label imported vs manual loans are distinct unless linked.
    for (const liability of manualLiabilities) {
      const linkedSlugs = [liability.linkedAccountSlug, liability.id].filter(
        (slug): slug is string => !!slug && importedDebtBySlug.has(slug)
      );
      if (linkedSlugs.some((slug) =>
        !isAccountActive(slug, h.yearMonth, accountStatusMap) ||
        importedContributingSlugs.has(slug)
      )) continue;

      const knownFrom = liabilityKnownFromMonth(liability);
      if (knownFrom && h.yearMonth < knownFrom) continue;

      td += liability.balance;
      accountContributions.push({
        slug: `manual-${liability.id}`,
        label: liability.label,
        type: `manual-${liability.category}`,
        value: -liability.balance, // Debts are negative
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
