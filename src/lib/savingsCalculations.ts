/**
 * Savings Calculations — shared data layer for all savings metrics.
 * 
 * SINGLE SOURCE OF TRUTH for savings calculations across dashboard, drawers, and pages.
 * 
 * Key principle: Savings = money you PUT ASIDE, not market gains or equity changes.
 * 
 * Components:
 * 1. Contributions to savings/investment accounts (from transactions)
 * 2. Cash growth in bank accounts (checking, savings only - NOT investment accounts)
 * 3. Debt principal paid down
 * 
 * Excluded (tracked separately in computeAssetGains):
 * - Market gains/losses on investments
 * - Changes in manual asset values (house, car appreciation)
 * - Investment account balance changes (use transactions for contributions only)
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
 * Get account snapshots for a specific month.
 */
function getSnapshotsForMonth(
  accountSnapshots: AccountSnapshot[],
  month: string
): AccountSnapshot[] {
  return accountSnapshots.filter(s => s.statementMonth === month);
}

/**
 * Check if an account type is a cash account (checking, savings).
 * NOT investment accounts, NOT manual assets.
 */
function isCashAccount(accountType: string): boolean {
  const type = accountType.toLowerCase();
  return type === "checking" || type === "savings" || type === "chequing";
}

/**
 * Check if an account type is a debt account.
 */
function isDebtAccount(accountType: string): boolean {
  const type = accountType.toLowerCase();
  return type === "credit" || type === "loan" || type === "mortgage" || type === "loc";
}

/**
 * Compute asset gains (market gains + manual asset value changes).
 * This is SEPARATE from savings - tracks wealth changes from appreciation, not contributions.
 * 
 * Calculation:
 * - Investment account balance changes MINUS contributions (transactions)
 * - Manual asset value changes (not tracked in accountSnapshots)
 */
export function computeAssetGains(
  monthlyHistory: MonthlyHistoryEntry[],
  accountSnapshots: AccountSnapshot[],
  expenseTxns: ExpenseTxnRecord[],
  currentMonth: string
): {
  marketGains: number;
  manualAssetChanges: number;
  totalGains: number;
} {
  const prior = findPriorMonth(monthlyHistory, currentMonth);
  if (!prior) {
    return { marketGains: 0, manualAssetChanges: 0, totalGains: 0 };
  }

  const currentSnapshots = getSnapshotsForMonth(accountSnapshots, currentMonth);
  const priorSnapshots = getSnapshotsForMonth(accountSnapshots, prior.yearMonth);

  // Calculate investment account balance changes
  let investmentBalanceChange = 0;
  
  for (const currentSnap of currentSnapshots) {
    if (currentSnap.accountType.toLowerCase() === "investment") {
      const priorSnap = priorSnapshots.find(p => p.slug === currentSnap.slug);
      if (priorSnap) {
        investmentBalanceChange += (currentSnap.balance - priorSnap.balance);
      }
    }
  }

  // Get investment contributions from transactions
  const contributions = expenseTxns
    .filter(t => 
      t.txMonth === currentMonth &&
      !isCoreExcluded(t.category) &&
      getParentCategory(t.category) === "Investments & Savings"
    )
    .reduce((sum, t) => sum + Math.abs(t.amount), 0);

  // Market gains = balance increase minus contributions
  const marketGains = Math.max(0, investmentBalanceChange - contributions);

  // Manual asset changes would come from totalAssets field difference
  // minus all account balance changes
  const current = monthlyHistory.find(h => h.yearMonth === currentMonth);
  const manualAssetChanges = current && prior
    ? Math.max(0, (current.totalAssets || 0) - (prior.totalAssets || 0) - investmentBalanceChange)
    : 0;

  return {
    marketGains,
    manualAssetChanges,
    totalGains: marketGains + manualAssetChanges,
  };
}

/**
 * Compute monthly savings from actual components (NOT net worth delta).
 * 
 * Components:
 * 1. Contributions to savings/investment accounts (from "Investments & Savings" transactions)
 * 2. Cash growth in checking/savings accounts (balance increases in bank accounts only)
 * 3. Debt principal paid down (debt balance decreases)
 * 
 * EXCLUDES:
 * - Investment account balance changes (only count transactions/contributions)
 * - Manual asset value changes
 * - Market gains
 */
export function computeMonthlySavings(
  monthlyHistory: MonthlyHistoryEntry[],
  accountSnapshots: AccountSnapshot[],
  expenseTxns: ExpenseTxnRecord[],
  currentMonth: string
): number {
  const prior = findPriorMonth(monthlyHistory, currentMonth);
  
  if (!prior) {
    // First month or no baseline - return 0
    return 0;
  }

  const currentSnapshots = getSnapshotsForMonth(accountSnapshots, currentMonth);
  const priorSnapshots = getSnapshotsForMonth(accountSnapshots, prior.yearMonth);
  const monthsElapsed = getMonthsBetween(prior.yearMonth, currentMonth);

  // Component 1: Investment/savings contributions from transactions
  // These are expense transactions in the "Investments & Savings" parent category
  const contributions = expenseTxns
    .filter(t => {
      if (t.txMonth !== currentMonth) return false;
      if (isCoreExcluded(t.category)) return false;
      const parent = getParentCategory(t.category);
      return parent === "Investments & Savings";
    })
    .reduce((sum, t) => sum + Math.abs(t.amount), 0);

  // Component 2: Cash growth in checking/savings accounts ONLY
  // NOT investment accounts, NOT manual assets
  let cashGrowth = 0;
  
  for (const currentSnap of currentSnapshots) {
    if (isCashAccount(currentSnap.accountType)) {
      const priorSnap = priorSnapshots.find(p => p.slug === currentSnap.slug);
      if (priorSnap) {
        const growth = currentSnap.balance - priorSnap.balance;
        cashGrowth += Math.max(0, growth); // Only count increases, not decreases
      }
    }
  }

  // Component 3: Debt principal paid down (debt balance decreases)
  // Debt balances are stored as negative numbers
  let debtReduction = 0;
  
  for (const currentSnap of currentSnapshots) {
    if (isDebtAccount(currentSnap.accountType)) {
      const priorSnap = priorSnapshots.find(p => p.slug === currentSnap.slug);
      if (priorSnap) {
        // Both balances are negative, so reduction = abs(prior) - abs(current)
        // e.g., -$5000 to -$4000 means $1000 paid down
        const reduction = Math.abs(priorSnap.balance) - Math.abs(currentSnap.balance);
        debtReduction += Math.max(0, reduction); // Only count reductions, not new borrowing
      }
    }
  }

  // Total savings = contributions + cash growth + debt reduction
  const totalSavings = contributions + cashGrowth + debtReduction;

  // Normalize by months elapsed (handles gaps)
  return monthsElapsed > 0 ? totalSavings / monthsElapsed : totalSavings;
}

/**
 * Compute average monthly savings over a time window.
 * Uses computeMonthlySavings for each month and averages.
 */
export function computeAverageSavings(
  monthlyHistory: MonthlyHistoryEntry[],
  accountSnapshots: AccountSnapshot[],
  expenseTxns: ExpenseTxnRecord[],
  months: string[]
): number {
  if (months.length === 0) return 0;

  const savingsByMonth = months.map(m => 
    computeMonthlySavings(monthlyHistory, accountSnapshots, expenseTxns, m)
  );

  const total = savingsByMonth.reduce((sum, s) => sum + s, 0);
  return total / months.length;
}
