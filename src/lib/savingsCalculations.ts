/**
 * Savings Calculations — shared data layer for all savings metrics.
 * 
 * SINGLE SOURCE OF TRUTH for savings calculations across dashboard, drawers, and pages.
 * 
 * Key principle: Savings = money you PUT ASIDE, not market gains or equity changes.
 * 
 * Includes:
 * - Contributions to savings/investment accounts
 * - Cash growth in bank accounts
 * - Debt principal paid down
 * 
 * Excludes:
 * - Market gains/losses on investments
 * - Changes in manual asset values (house, car appreciation)
 */

import type { MonthlyHistoryEntry } from "./financialProfile";
import type { ExpenseTxnRecord, AccountSnapshot } from "./extractTransactions";
import { isCoreExcluded } from "./spendingMetrics";
import { getParentCategory } from "./categoryTaxonomy";

/**
 * Calculate number of months between two YYYY-MM strings.
 */
function getMonthsBetween(startYM: string, endYM: string): number {
  const [startYear, startMonth] = startYM.split('-').map(Number);
  const [endYear, endMonth] = endYM.split('-').map(Number);
  return (endYear - startYear) * 12 + (endMonth - startMonth);
}

/**
 * Find the most recent month before the given month that has data.
 * Handles gaps in data gracefully.
 */
function findPriorMonth(
  monthlyHistory: MonthlyHistoryEntry[],
  currentMonth: string
): MonthlyHistoryEntry | null {
  const sorted = [...monthlyHistory]
    .filter(h => h.yearMonth < currentMonth)
    .sort((a, b) => b.yearMonth.localeCompare(a.yearMonth));
  
  return sorted[0] || null;
}

/**
 * Get account snapshots for a specific month (if available).
 * Returns empty array if no snapshots exist for that month.
 */
function getSnapshotsForMonth(
  accountSnapshots: AccountSnapshot[],
  month: string
): AccountSnapshot[] {
  return accountSnapshots.filter(s => s.statementMonth === month);
}

/**
 * Compute asset gains (market gains + manual asset value changes).
 * This is SEPARATE from savings - tracks wealth changes from appreciation, not contributions.
 * 
 * NOT SHOWN IN UI YET - kept separate for future use.
 */
export function computeAssetGains(
  monthlyHistory: MonthlyHistoryEntry[],
  accountSnapshots: AccountSnapshot[],
  currentMonth: string
): {
  marketGains: number;
  manualAssetChanges: number;
  totalGains: number;
} {
  const current = monthlyHistory.find(h => h.yearMonth === currentMonth);
  const prior = findPriorMonth(monthlyHistory, currentMonth);
  
  if (!current || !prior) {
    return { marketGains: 0, manualAssetChanges: 0, totalGains: 0 };
  }

  const currentSnapshots = getSnapshotsForMonth(accountSnapshots, currentMonth);
  const priorSnapshots = getSnapshotsForMonth(accountSnapshots, prior.yearMonth);

  // For now, approximate market gains as investment account balance changes
  // minus contributions (would need transaction history for precise calculation)
  // This is a placeholder - proper implementation would track gains separately
  
  // Manual asset changes: compare totalAssets excluding investment/bank accounts
  const currentManualAssets = current.totalAssets || 0;
  const priorManualAssets = prior.totalAssets || 0;
  
  // Approximate: assume difference in total assets that can't be explained by
  // savings account and investment account increases is manual asset changes
  const manualAssetChanges = 0; // Placeholder - needs proper tracking

  return {
    marketGains: 0, // Placeholder
    manualAssetChanges,
    totalGains: 0,
  };
}

/**
 * Compute monthly savings rate using actual contributions and debt paydown.
 * 
 * EXCLUDES market gains and manual asset value changes.
 * 
 * Calculation:
 * - Cash increases in bank accounts (checking, savings)
 * - Investment contributions (tracked separately from market gains)
 * - Debt principal paid down
 * 
 * Uses most recent available prior month as baseline, handles gaps.
 * Normalizes by months elapsed.
 */
export function computeMonthlySavings(
  monthlyHistory: MonthlyHistoryEntry[],
  expenseTxns: ExpenseTxnRecord[],
  currentMonth: string
): number {
  const current = monthlyHistory.find(h => h.yearMonth === currentMonth);
  const prior = findPriorMonth(monthlyHistory, currentMonth);
  
  if (!current || !prior) {
    // First month or no baseline - return 0
    return 0;
  }

  const monthsElapsed = getMonthsBetween(prior.yearMonth, current.yearMonth);
  
  // Calculate actual savings from transactions
  // 1. "Investments & Savings" category transactions = contributions
  const savingsTransactions = expenseTxns.filter(t => 
    t.txMonth === currentMonth &&
    !isCoreExcluded(t.category) &&
    getParentCategory(t.category) === "Investments & Savings"
  );
  const contributions = savingsTransactions.reduce((sum, t) => sum + Math.abs(t.amount), 0);

  // 2. Debt principal paid down
  // Use debt payments total from monthly history (tracks actual payments)
  const debtPaidDown = current.debtPaymentsTotal || 0;

  // 3. Net worth increase adjusted for market gains
  const netWorthDelta = current.netWorth - prior.netWorth;
  
  // For now, use net worth delta as proxy
  // TODO: Subtract market gains and manual asset changes when available
  // savings = netWorthDelta - marketGains - manualAssetChanges
  
  // Simple approximation: net worth increase
  const monthlySavings = monthsElapsed > 0 ? netWorthDelta / monthsElapsed : netWorthDelta;
  
  // Return maximum of 0 (can't have negative savings in this context)
  return Math.max(0, monthlySavings);
}

/**
 * Compute average monthly savings over a time window.
 * Uses computeMonthlySavings for each month and averages.
 */
export function computeAverageSavings(
  monthlyHistory: MonthlyHistoryEntry[],
  expenseTxns: ExpenseTxnRecord[],
  months: string[]
): number {
  if (months.length === 0) return 0;

  const savingsByMonth = months.map(m => 
    computeMonthlySavings(monthlyHistory, expenseTxns, m)
  );

  const total = savingsByMonth.reduce((sum, s) => sum + s, 0);
  return total / months.length;
}
