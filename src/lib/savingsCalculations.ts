/**
 * Savings Calculations — shared data layer for all savings metrics.
 * 
 * SINGLE SOURCE OF TRUTH for savings calculations across dashboard, drawers, and pages.
 * 
 * Key principle: Savings = money you PUT ASIDE, not market gains or equity changes.
 * 
 * Components:
 * 1. Contributions to savings/investment accounts (from transactions + user confirmations)
 * 2. Cash growth in bank accounts (from accountBalanceHistory - checking, savings only)
 * 3. Debt principal paid down (from accountBalanceHistory - debt account balance decreases)
 * 
 * Excluded (tracked separately in computeAssetGains):
 * - Market gains/losses on investments
 * - Changes in manual asset values (house, car appreciation)
 * - Investment account balance changes (use transactions for contributions only)
 * - New debt draws (e.g., FlexLine draws)
 */

import type { MonthlyHistoryEntry, AccountBalanceHistory } from "./financialProfile";
import type { ExpenseTxnRecord } from "./extractTransactions";
import { isCoreExcluded } from "./spendingMetrics";
import { getParentCategory } from "./categoryTaxonomy";

/**
 * User confirmation for whether a transaction counts as savings.
 * Stored in users/{uid}/savingsConfirmations collection.
 */
export interface SavingsConfirmation {
  /** Unique ID for this confirmation (merchant + category fingerprint) */
  id: string;
  /** Merchant name from the transaction */
  merchant: string;
  /** Transaction category */
  category: string;
  /** Sample amount (for display) */
  amount: number;
  /** Sample date (for display) */
  date: string;
  /** User's decision: true = counts as savings, false = exclude, undefined = needs review */
  countAsSavings?: boolean;
  /** When the user made this decision */
  confirmedAt?: string;
}

/**
 * Get confirmation key for a transaction (merchant + category).
 */
function getConfirmationKey(merchant: string, category: string): string {
  return `${merchant.toLowerCase().trim()}:${category.toLowerCase().trim()}`;
}

/**
 * Check if a transaction category needs user confirmation.
 * Returns true for ambiguous items like life insurance premiums.
 */
function needsConfirmation(category: string, merchant: string): boolean {
  const cat = category.toLowerCase();
  const merch = merchant.toLowerCase();
  
  // Life insurance premiums are ambiguous (protection vs. investment component)
  if (cat.includes("life") && cat.includes("ins")) return true;
  if (merch.includes("life") && merch.includes("ins")) return true;
  
  // Whole life / universal life with investment component
  if (merch.includes("whole life") || merch.includes("universal life")) return true;
  
  // Add more patterns as needed
  return false;
}

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
 * Get account balance for a specific month from balance history.
 */
function getBalanceForMonth(
  account: AccountBalanceHistory,
  month: string
): number | null {
  const entry = account.entries.find(e => e.yearMonth === month);
  return entry ? entry.balance : null;
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
 * Result of monthly savings calculation with detailed breakdown.
 */
export interface MonthlySavingsResult {
  total: number;
  contributions: number;
  cashGrowth: number;
  debtPrincipal: number;
  /** Transactions that need user confirmation */
  needsConfirmation: SavingsConfirmation[];
  /** Detailed breakdown by component */
  details: {
    contributions: Array<{ merchant: string; amount: number; category: string; needsConfirmation: boolean }>;
    cashGrowth: Array<{ accountLabel: string; slug: string; growth: number; priorBalance: number; currentBalance: number }>;
    debtPrincipal: Array<{ accountLabel: string; slug: string; reduction: number; priorBalance: number; currentBalance: number }>;
  };
}

/**
 * Compute asset gains (market gains + manual asset value changes).
 * This is SEPARATE from savings - tracks wealth changes from appreciation, not contributions.
 */
export function computeAssetGains(
  monthlyHistory: MonthlyHistoryEntry[],
  accountBalanceHistory: AccountBalanceHistory[],
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

  // Calculate investment account balance changes
  let investmentBalanceChange = 0;
  
  for (const account of accountBalanceHistory) {
    if (account.accountType.toLowerCase() === "investment") {
      const currentBalance = getBalanceForMonth(account, currentMonth);
      const priorBalance = getBalanceForMonth(account, prior.yearMonth);
      
      if (currentBalance !== null && priorBalance !== null) {
        investmentBalanceChange += (currentBalance - priorBalance);
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
 * Uses accountBalanceHistory (the existing data source for account pages/dashboard).
 * Returns detailed breakdown including items that need user confirmation.
 */
export function computeMonthlySavings(
  monthlyHistory: MonthlyHistoryEntry[],
  accountBalanceHistory: AccountBalanceHistory[],
  expenseTxns: ExpenseTxnRecord[],
  currentMonth: string,
  confirmedItems: Map<string, boolean> = new Map()
): MonthlySavingsResult {
  const prior = findPriorMonth(monthlyHistory, currentMonth);
  
  if (!prior) {
    // First month or no baseline - return empty result
    return {
      total: 0,
      contributions: 0,
      cashGrowth: 0,
      debtPrincipal: 0,
      needsConfirmation: [],
      details: { contributions: [], cashGrowth: [], debtPrincipal: [] },
    };
  }

  const monthsElapsed = getMonthsBetween(prior.yearMonth, currentMonth);
  const needsConfirmationList: SavingsConfirmation[] = [];

  // Component 1: Investment/savings contributions from transactions
  let contributions = 0;
  const contributionDetails: Array<{ merchant: string; amount: number; category: string; needsConfirmation: boolean }> = [];
  
  for (const t of expenseTxns) {
    if (t.txMonth !== currentMonth) continue;
    if (isCoreExcluded(t.category)) continue;
    
    const parent = getParentCategory(t.category);
    if (parent !== "Investments & Savings") continue;
    
    const amount = Math.abs(t.amount);
    const key = getConfirmationKey(t.merchant, t.category);
    
    // Check if this needs user confirmation
    if (needsConfirmation(t.category, t.merchant)) {
      const confirmed = confirmedItems.get(key);
      
      if (confirmed === undefined) {
        // Needs confirmation - add to list but don't count yet
        needsConfirmationList.push({
          id: key,
          merchant: t.merchant,
          category: t.category,
          amount,
          date: t.date,
        });
        contributionDetails.push({ merchant: t.merchant, amount, category: t.category, needsConfirmation: true });
        continue;
      } else if (!confirmed) {
        // User said no - skip it
        continue;
      }
      // User said yes - fall through and count it
    }
    
    contributions += amount;
    contributionDetails.push({ merchant: t.merchant, amount, category: t.category, needsConfirmation: false });
  }

  // Component 2: Cash growth in checking/savings accounts ONLY
  let cashGrowth = 0;
  const cashGrowthDetails: Array<{ accountLabel: string; slug: string; growth: number; priorBalance: number; currentBalance: number }> = [];
  
  for (const account of accountBalanceHistory) {
    if (!isCashAccount(account.accountType)) continue;
    
    const currentBalance = getBalanceForMonth(account, currentMonth);
    const priorBalance = getBalanceForMonth(account, prior.yearMonth);
    
    if (currentBalance !== null && priorBalance !== null) {
      const growth = currentBalance - priorBalance;
      if (growth > 0) {
        cashGrowth += growth;
        cashGrowthDetails.push({
          accountLabel: account.label,
          slug: account.slug,
          growth,
          priorBalance,
          currentBalance,
        });
      }
    }
  }

  // Component 3: Debt principal paid down (debt balance decreases, excluding new draws)
  let debtPrincipal = 0;
  const debtPrincipalDetails: Array<{ accountLabel: string; slug: string; reduction: number; priorBalance: number; currentBalance: number }> = [];
  
  for (const account of accountBalanceHistory) {
    if (!isDebtAccount(account.accountType)) continue;
    
    const currentBalance = getBalanceForMonth(account, currentMonth);
    const priorBalance = getBalanceForMonth(account, prior.yearMonth);
    
    if (currentBalance !== null && priorBalance !== null) {
      // Debt balances are negative, so reduction = abs(prior) - abs(current)
      // e.g., -$5000 to -$4000 means $1000 paid down
      const reduction = Math.abs(priorBalance) - Math.abs(currentBalance);
      if (reduction > 0) {
        debtPrincipal += reduction;
        debtPrincipalDetails.push({
          accountLabel: account.label,
          slug: account.slug,
          reduction,
          priorBalance,
          currentBalance,
        });
      }
    }
  }

  // Normalize by months elapsed (handles gaps)
  const normalize = (val: number) => monthsElapsed > 0 ? val / monthsElapsed : val;
  
  return {
    total: normalize(contributions + cashGrowth + debtPrincipal),
    contributions: normalize(contributions),
    cashGrowth: normalize(cashGrowth),
    debtPrincipal: normalize(debtPrincipal),
    needsConfirmation: needsConfirmationList,
    details: {
      contributions: contributionDetails,
      cashGrowth: cashGrowthDetails.map(d => ({ ...d, growth: normalize(d.growth) })),
      debtPrincipal: debtPrincipalDetails.map(d => ({ ...d, reduction: normalize(d.reduction) })),
    },
  };
}

/**
 * Compute average monthly savings over a time window.
 * Uses computeMonthlySavings for each month and averages.
 */
export function computeAverageSavings(
  monthlyHistory: MonthlyHistoryEntry[],
  accountBalanceHistory: AccountBalanceHistory[],
  expenseTxns: ExpenseTxnRecord[],
  months: string[],
  confirmedItems: Map<string, boolean> = new Map()
): number {
  if (months.length === 0) return 0;

  const savingsByMonth = months.map(m => 
    computeMonthlySavings(monthlyHistory, accountBalanceHistory, expenseTxns, m, confirmedItems).total
  );

  const total = savingsByMonth.reduce((sum, s) => sum + s, 0);
  return total / months.length;
}
