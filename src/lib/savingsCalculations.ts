/**
 * Savings Calculations — shared data layer for all savings metrics.
 * 
 * SINGLE SOURCE OF TRUTH for savings calculations across dashboard, drawers, and pages.
 * 
 * Key principle: Savings = NET change in financial position
 * 
 * Calculation for month M:
 * Savings = (cash/savings balances at end of M - end of M-1) 
 *         + (total debt at end of M-1 - total debt at end of M)
 *         + contributions to outside accounts not tracked in balances
 * 
 * This is a NET change:
 * - Debt increases subtract from savings (e.g., new FlexLine draw)
 * - Debt transfers net to 0 (paying CC with FlexLine: CC down + FlexLine up = 0)
 * - Can be negative (spent more cash than debt paid)
 * 
 * Balance sources:
 * - Use month-END balances from accountBalanceHistory for ALL accounts
 * - If no balance for a month, carry forward most recent prior balance (any age)
 * - Account with no baseline at or before prior month contributes 0
 * 
 * Accounts included:
 * - Cash/savings: checking, savings (NOT investment accounts)
 * - Debt: credit cards, loans, FlexLine/LOC, mortgage
 * 
 * Excluded (tracked in computeAssetGains):
 * - Investment accounts
 * - Manual assets (home, car)
 */

import type { MonthlyHistoryEntry, AccountBalanceHistory } from "./financialProfile";
import type { ExpenseTxnRecord } from "./extractTransactions";
import { isCoreExcluded } from "./spendingMetrics";
import { getParentCategory } from "./categoryTaxonomy";

/**
 * User confirmation for whether a transaction counts as savings.
 * Stored in users/{uid}/reviews collection with type: "savings_item".
 */
export interface SavingsConfirmation {
  /** Unique ID for this confirmation (merchant + category + accountSlug fingerprint) */
  id: string;
  /** Merchant name from the transaction */
  merchant: string;
  /** Transaction category */
  category: string;
  /** Account slug */
  accountSlug: string;
  /** Account name */
  accountName: string;
  /** Account last 4 digits */
  accountLast4: string;
  /** Sample amount (for display) */
  amount: number;
  /** Sample date (for display) */
  date: string;
  /** Transaction month (YYYY-MM) */
  txMonth: string;
  /** User's decision: true = counts as savings, false = exclude, undefined = needs review */
  countAsSavings?: boolean;
  /** When the user made this decision */
  confirmedAt?: string;
}

/**
 * Get confirmation key for a transaction (merchant + category + accountSlug).
 */
function getConfirmationKey(merchant: string, category: string, accountSlug: string): string {
  return `${merchant.toLowerCase().trim()}:${category.toLowerCase().trim()}:${accountSlug}`;
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
 * Get account balance for a specific month, with carry-forward logic.
 * If no balance for the month, returns most recent prior balance (any age).
 * Returns null only if no balance exists at or before the month.
 */
function getBalanceForMonth(
  account: AccountBalanceHistory,
  month: string
): { balance: number; carriedForward: boolean } | null {
  // Try exact month first
  const exact = account.entries.find(e => e.yearMonth === month);
  if (exact) {
    return { balance: exact.balance, carriedForward: false };
  }
  
  // Find most recent prior balance
  const priors = account.entries
    .filter(e => e.yearMonth < month)
    .sort((a, b) => b.yearMonth.localeCompare(a.yearMonth));
  
  if (priors.length > 0) {
    return { balance: priors[0].balance, carriedForward: true };
  }
  
  // No balance at or before this month
  return null;
}

/**
 * Check if an account type is a cash/savings account.
 * Includes checking and savings, but NOT investment accounts.
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
 * Account balance detail for inspection.
 */
export interface AccountBalanceDetail {
  accountLabel: string;
  slug: string;
  accountType: string;
  priorBalance: number;
  currentBalance: number;
  priorCarriedForward: boolean;
  currentCarriedForward: boolean;
  change: number;
}

/**
 * Per-account detail for a single month.
 */
export interface MonthAccountDetail {
  accountLabel: string;
  accountLast4: string;
  slug: string;
  accountType: string;
  priorBalance: number;
  currentBalance: number;
  change: number;
  priorCarriedForward: boolean;
  currentCarriedForward: boolean;
}

/**
 * Per-month savings breakdown with component reconciliation.
 */
export interface MonthSavingsBreakdown {
  month: string;
  netCashChange: number;
  netDebtChange: number;
  contributionsToOutside: number;
  total: number;
  /** For negative months, identify the main driver */
  driver?: string;
  /** Per-account details for this month (for expandable view) */
  accounts: {
    cashAccounts: MonthAccountDetail[];
    debtAccounts: MonthAccountDetail[];
    contributions: Array<{ merchant: string; amount: number; category: string; needsConfirmation: boolean }>;
  };
}

/**
 * Window-period savings result with per-month reconciliation.
 */
export interface WindowSavingsResult {
  /** Per-month breakdown (each row sums: cash + debt + contributions = total) */
  monthlyBreakdown: MonthSavingsBreakdown[];
  /** Monthly average of each component */
  monthlyAverage: {
    netCashChange: number;
    netDebtChange: number;
    contributionsToOutside: number;
    total: number;
  };
  /** Per-account changes over the entire window */
  windowPeriodAccounts: {
    cashAccounts: AccountBalanceDetail[];
    debtAccounts: AccountBalanceDetail[];
  };
  /** Items needing confirmation */
  needsConfirmation: SavingsConfirmation[];
}

/**
 * Result of monthly savings calculation with detailed breakdown.
 */
export interface MonthlySavingsResult {
  total: number;
  netCashChange: number;
  netDebtChange: number;
  contributionsToOutside: number;
  /** Transactions that need user confirmation */
  needsConfirmation: SavingsConfirmation[];
  /** Detailed breakdown by component */
  details: {
    cashAccounts: AccountBalanceDetail[];
    debtAccounts: AccountBalanceDetail[];
    contributions: Array<{ merchant: string; amount: number; category: string; needsConfirmation: boolean }>;
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
      const currentResult = getBalanceForMonth(account, currentMonth);
      const priorResult = getBalanceForMonth(account, prior.yearMonth);
      
      if (currentResult && priorResult) {
        investmentBalanceChange += (currentResult.balance - priorResult.balance);
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
 * Compute monthly savings using NET balance change approach.
 * 
 * For month M:
 * Savings = (sum of cash/savings balances at end of M - end of M-1)
 *         + (total debt at end of M-1 - total debt at end of M)
 *         + contributions to outside accounts not tracked
 * 
 * This NET approach means:
 * - Debt transfers (e.g., paying CC with FlexLine) net to 0
 * - Can be negative if spent more cash than debt paid
 * - Balances are carried forward if missing
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
      netCashChange: 0,
      netDebtChange: 0,
      contributionsToOutside: 0,
      needsConfirmation: [],
      details: { cashAccounts: [], debtAccounts: [], contributions: [] },
    };
  }

  const monthsElapsed = getMonthsBetween(prior.yearMonth, currentMonth);
  const needsConfirmationList: SavingsConfirmation[] = [];

  // Component 1: Net cash/savings balance change
  let netCashChange = 0;
  const cashDetails: AccountBalanceDetail[] = [];
  
  for (const account of accountBalanceHistory) {
    if (!isCashAccount(account.accountType)) continue;
    
    const currentResult = getBalanceForMonth(account, currentMonth);
    const priorResult = getBalanceForMonth(account, prior.yearMonth);
    
    // Only include if we have a baseline (balance at or before prior month)
    if (currentResult && priorResult) {
      const change = currentResult.balance - priorResult.balance;
      netCashChange += change;
      
      cashDetails.push({
        accountLabel: account.label,
        slug: account.slug,
        accountType: account.accountType,
        priorBalance: priorResult.balance,
        currentBalance: currentResult.balance,
        priorCarriedForward: priorResult.carriedForward,
        currentCarriedForward: currentResult.carriedForward,
        change,
      });
    }
  }

  // Component 2: Net debt change (debt reduction is positive)
  // Total debt at M-1 minus total debt at M
  let totalDebtPrior = 0;
  let totalDebtCurrent = 0;
  const debtDetails: AccountBalanceDetail[] = [];
  
  for (const account of accountBalanceHistory) {
    if (!isDebtAccount(account.accountType)) continue;
    
    const currentResult = getBalanceForMonth(account, currentMonth);
    const priorResult = getBalanceForMonth(account, prior.yearMonth);
    
    // Only include if we have a baseline
    if (currentResult && priorResult) {
      // Debt balances are negative, use absolute values for totals
      totalDebtPrior += Math.abs(priorResult.balance);
      totalDebtCurrent += Math.abs(currentResult.balance);
      
      const change = Math.abs(priorResult.balance) - Math.abs(currentResult.balance);
      
      debtDetails.push({
        accountLabel: account.label,
        slug: account.slug,
        accountType: account.accountType,
        priorBalance: priorResult.balance,
        currentBalance: currentResult.balance,
        priorCarriedForward: priorResult.carriedForward,
        currentCarriedForward: currentResult.carriedForward,
        change, // Positive = debt paid down, negative = new borrowing
      });
    }
  }
  
  const netDebtChange = totalDebtPrior - totalDebtCurrent;

  // Component 3: Contributions to outside accounts (not tracked in balance history)
  // These leave the bank system, so add them to savings
  let contributionsToOutside = 0;
  const contributionDetails: Array<{ merchant: string; amount: number; category: string; needsConfirmation: boolean }> = [];
  
  // Get list of tracked account slugs to avoid double-counting
  const trackedSlugs = new Set(accountBalanceHistory.map(a => a.slug));
  
  // Build account lookup for getting names and last 4
  const accountLookup = new Map(
    accountBalanceHistory.map(a => {
      const last4Match = a.label.match(/\(\.\.\.(\d{4})\)/);
      const last4 = last4Match ? last4Match[1] : a.slug.slice(-4);
      return [a.slug, { name: a.label, last4 }];
    })
  );
  
  for (const t of expenseTxns) {
    if (t.txMonth !== currentMonth) continue;
    if (isCoreExcluded(t.category)) continue;
    
    const parent = getParentCategory(t.category);
    if (parent !== "Investments & Savings") continue;
    
    // Skip if this transaction goes to a tracked investment account
    // (those are handled by balance changes in computeAssetGains)
    // For now, assume all "Investments & Savings" transactions go outside
    // (refinement: check if destination account is tracked)
    
    const amount = Math.abs(t.amount);
    const key = getConfirmationKey(t.merchant, t.category, t.accountSlug);
    
    // Check if this needs user confirmation
    if (needsConfirmation(t.category, t.merchant)) {
      const confirmed = confirmedItems.get(key);
      
      if (confirmed === undefined) {
        // Needs confirmation - add to list but don't count yet
        const accountInfo = accountLookup.get(t.accountSlug);
        
        // Only emit if we have account info and non-zero amount
        if (accountInfo && amount > 0) {
          needsConfirmationList.push({
            id: key,
            merchant: t.merchant,
            category: t.category,
            accountSlug: t.accountSlug,
            accountName: accountInfo.name,
            accountLast4: accountInfo.last4,
            amount,
            date: t.date,
            txMonth: t.txMonth,
          });
        }
        contributionDetails.push({ merchant: t.merchant, amount, category: t.category, needsConfirmation: true });
        continue;
      } else if (!confirmed) {
        // User said no - skip it
        continue;
      }
      // User said yes - fall through and count it
    }
    
    contributionsToOutside += amount;
    contributionDetails.push({ merchant: t.merchant, amount, category: t.category, needsConfirmation: false });
  }

  // Total savings = cash change + debt change + outside contributions
  const total = netCashChange + netDebtChange + contributionsToOutside;

  // Normalize by months elapsed (handles gaps)
  const normalize = (val: number) => monthsElapsed > 0 ? val / monthsElapsed : val;
  
  return {
    total: normalize(total),
    netCashChange: normalize(netCashChange),
    netDebtChange: normalize(netDebtChange),
    contributionsToOutside: normalize(contributionsToOutside),
    needsConfirmation: needsConfirmationList,
    details: {
      cashAccounts: cashDetails.map(d => ({ ...d, change: normalize(d.change) })),
      debtAccounts: debtDetails.map(d => ({ ...d, change: normalize(d.change) })),
      contributions: contributionDetails,
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

/**
 * Compute savings for a window of months with per-month reconciliation.
 * 
 * Returns:
 * - Per-month breakdown where components sum to total
 * - Per-account changes over the entire window period
 * - Monthly averages matching the header
 */
export function computeWindowSavings(
  monthlyHistory: MonthlyHistoryEntry[],
  accountBalanceHistory: AccountBalanceHistory[],
  expenseTxns: ExpenseTxnRecord[],
  months: string[],
  confirmedItems: Map<string, boolean> = new Map()
): WindowSavingsResult {
  if (months.length === 0) {
    return {
      monthlyBreakdown: [],
      monthlyAverage: { netCashChange: 0, netDebtChange: 0, contributionsToOutside: 0, total: 0 },
      windowPeriodAccounts: { cashAccounts: [], debtAccounts: [] },
      needsConfirmation: [],
    };
  }

  // Compute per-month savings
  const monthlyBreakdown: MonthSavingsBreakdown[] = [];
  const allConfirmations = new Set<string>();
  
  for (const month of months) {
    const result = computeMonthlySavings(monthlyHistory, accountBalanceHistory, expenseTxns, month, confirmedItems);
    
    // Build per-month per-account details
    const monthCashAccounts: MonthAccountDetail[] = result.details.cashAccounts.map(acc => {
      // Extract last 4 digits from account label (e.g., "TD Checking (...1234)" -> "1234")
      const last4Match = acc.accountLabel.match(/\(\.\.\.(\d{4})\)/);
      const last4 = last4Match ? last4Match[1] : acc.slug.slice(-4);
      
      return {
        accountLabel: acc.accountLabel,
        accountLast4: last4,
        slug: acc.slug,
        accountType: acc.accountType,
        priorBalance: acc.priorBalance,
        currentBalance: acc.currentBalance,
        change: acc.change,
        priorCarriedForward: acc.priorCarriedForward,
        currentCarriedForward: acc.currentCarriedForward,
      };
    }).sort((a, b) => Math.abs(b.change) - Math.abs(a.change)); // Sort by absolute impact
    
    const monthDebtAccounts: MonthAccountDetail[] = result.details.debtAccounts.map(acc => {
      const last4Match = acc.accountLabel.match(/\(\.\.\.(\d{4})\)/);
      const last4 = last4Match ? last4Match[1] : acc.slug.slice(-4);
      
      return {
        accountLabel: acc.accountLabel,
        accountLast4: last4,
        slug: acc.slug,
        accountType: acc.accountType,
        priorBalance: acc.priorBalance,
        currentBalance: acc.currentBalance,
        change: acc.change,
        priorCarriedForward: acc.priorCarriedForward,
        currentCarriedForward: acc.currentCarriedForward,
      };
    }).sort((a, b) => Math.abs(b.change) - Math.abs(a.change)); // Sort by absolute impact
    
    // Identify driver for negative months
    let driver: string | undefined;
    if (result.total < 0) {
      // Find account with largest negative impact
      const cashLosses = result.details.cashAccounts
        .filter(a => a.change < 0)
        .sort((a, b) => a.change - b.change); // Most negative first
      
      const debtIncreases = result.details.debtAccounts
        .filter(a => a.change < 0) // Negative change = more debt = bad
        .sort((a, b) => a.change - b.change);
      
      if (debtIncreases.length > 0 && cashLosses.length > 0) {
        const largestDebtIncrease = Math.abs(debtIncreases[0].change);
        const largestCashLoss = Math.abs(cashLosses[0].change);
        
        if (largestDebtIncrease > largestCashLoss) {
          driver = `New borrowing on ${debtIncreases[0].accountLabel}`;
        } else {
          driver = `Cash spent down from ${cashLosses[0].accountLabel}`;
        }
      } else if (debtIncreases.length > 0) {
        driver = `New borrowing on ${debtIncreases[0].accountLabel}`;
      } else if (cashLosses.length > 0) {
        driver = `Cash spent down from ${cashLosses[0].accountLabel}`;
      }
    }
    
    monthlyBreakdown.push({
      month,
      netCashChange: result.netCashChange,
      netDebtChange: result.netDebtChange,
      contributionsToOutside: result.contributionsToOutside,
      total: result.total,
      driver,
      accounts: {
        cashAccounts: monthCashAccounts,
        debtAccounts: monthDebtAccounts,
        contributions: result.details.contributions,
      },
    });
    
    result.needsConfirmation.forEach(c => allConfirmations.add(c.id));
  }

  // Compute monthly averages
  const monthlyAverage = {
    netCashChange: monthlyBreakdown.reduce((sum, m) => sum + m.netCashChange, 0) / months.length,
    netDebtChange: monthlyBreakdown.reduce((sum, m) => sum + m.netDebtChange, 0) / months.length,
    contributionsToOutside: monthlyBreakdown.reduce((sum, m) => sum + m.contributionsToOutside, 0) / months.length,
    total: monthlyBreakdown.reduce((sum, m) => sum + m.total, 0) / months.length,
  };

  // Compute window-period account changes
  // Start balance = month-end balance of the month before the window (or most recent prior)
  // End balance = month-end balance of the last month in the window
  const firstMonth = months[0];
  const lastMonth = months[months.length - 1];
  const priorMonth = findPriorMonth(monthlyHistory, firstMonth);
  
  const cashAccounts: AccountBalanceDetail[] = [];
  const debtAccounts: AccountBalanceDetail[] = [];
  
  for (const account of accountBalanceHistory) {
    const isCash = isCashAccount(account.accountType);
    const isDebt = isDebtAccount(account.accountType);
    
    if (!isCash && !isDebt) continue;
    
    const endResult = getBalanceForMonth(account, lastMonth);
    const startResult = priorMonth ? getBalanceForMonth(account, priorMonth.yearMonth) : null;
    
    if (!endResult || !startResult) continue;
    
    // For debt accounts, use absolute values so paydown is positive, borrowing is negative
    const change = isDebt
      ? Math.abs(startResult.balance) - Math.abs(endResult.balance)
      : endResult.balance - startResult.balance;
    
    const detail: AccountBalanceDetail = {
      accountLabel: account.label,
      slug: account.slug,
      accountType: account.accountType,
      priorBalance: startResult.balance,
      currentBalance: endResult.balance,
      priorCarriedForward: startResult.carriedForward,
      currentCarriedForward: endResult.carriedForward,
      change,
    };
    
    if (isCash) {
      cashAccounts.push(detail);
    } else {
      debtAccounts.push(detail);
    }
  }

  return {
    monthlyBreakdown,
    monthlyAverage,
    windowPeriodAccounts: { cashAccounts, debtAccounts },
    needsConfirmation: [], // Savings confirmations handled via shared review framework
  };
}
