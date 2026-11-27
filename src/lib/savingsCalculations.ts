/**
 * Savings Calculations — the one Net savings function.
 *
 * Net savings for month M is balances only: how much the user's own money
 * accounts moved between the close of M-1 and the close of M.
 *
 *   Net savings(M) = Σ cash accounts  (closing M − closing M-1)
 *                  + Σ debt accounts  (|closing M-1| − |closing M|)
 *
 * - Cash accounts: chequing, savings, cash. A balance going up adds.
 * - Debt accounts: credit cards, lines of credit, loans, mortgages. Paying
 *   debt down adds; a card or loan balance going up subtracts.
 * - Transaction categories never matter. Spending a CA$8,000 withdrawal
 *   lowers that month by CA$8,000 whether it is tagged Cash & ATM or
 *   Asset purchase.
 * - Excluded: investment accounts and assets (house, car, manual assets).
 *   Money moved into an investment account leaves cash, so it lowers Net
 *   savings; there is no add-back for Investments & Savings outflows.
 * - Month-end balances come from accountBalanceHistory, which already
 *   includes derived month-ends for multi-month statements. A month without
 *   a balance carries forward the most recent prior balance (any age).
 * - An account with no balance at or before M-1 has no baseline and adds 0.
 * - A month where no account has a baseline and its own month-end balance
 *   is not measured: it is left out of averages instead of counting as 0.
 * - Balances are converted to the home currency when options are given.
 *
 * Used by the dashboard Net savings card and savings rate (moneyCoach),
 * the Net savings drawer, computeSavingsForRange, and chat. Cash Flow's
 * "Leftover" (money in − money out) is a different number on purpose.
 */

import type { MonthlyHistoryEntry, AccountBalanceHistory } from "./financialProfile";
import type { ExpenseTxnRecord } from "./extractTransactions";
import { isTransferInterestOrCardServicing } from "./spendingMetrics";
import { getParentCategory } from "./categoryTaxonomy";
import { toHome } from "./currencyUtils";

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

/** Calendar month before a YYYY-MM month. */
function previousCalendarMonth(yearMonth: string): string {
  const [year, month] = yearMonth.split("-").map(Number);
  const date = new Date(year, month - 2, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
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
): { balance: number; carriedForward: boolean; derived?: boolean; sourceStatement?: string; actualMonth: string } | null {
  // Try exact month first
  const exact = account.entries.find(e => e.yearMonth === month);
  if (exact) {
    return { 
      balance: exact.balance, 
      carriedForward: false,
      derived: exact.derived,
      sourceStatement: exact.sourceStatement,
      actualMonth: month
    };
  }
  
  // Find most recent prior balance
  const priors = account.entries
    .filter(e => e.yearMonth < month)
    .sort((a, b) => b.yearMonth.localeCompare(a.yearMonth));
  
  if (priors.length > 0) {
    const prior = priors[0];
    return { 
      balance: prior.balance, 
      carriedForward: true,
      derived: prior.derived,
      sourceStatement: prior.sourceStatement,
      actualMonth: prior.yearMonth
    };
  }
  
  // No balance at or before this month
  return null;
}

/**
 * Check if an account type is a cash/savings account.
 * Includes checking and savings, but NOT investment accounts.
 */
const CASH_ACCOUNT_TYPES = new Set(["checking", "chequing", "savings", "cash"]);

function isCashAccount(accountType: string): boolean {
  return CASH_ACCOUNT_TYPES.has(accountType.toLowerCase());
}

/**
 * Check if an account type is a debt account.
 */
const DEBT_ACCOUNT_TYPES = new Set([
  "credit",
  "credit_card",
  "loc",
  "line_of_credit",
  "loan",
  "auto_loan",
  "student_loan",
  "personal_loan",
  "mortgage",
  "other_debt",
]);

function isDebtAccount(accountType: string): boolean {
  return DEBT_ACCOUNT_TYPES.has(accountType.toLowerCase());
}

/** Home-currency conversion for Net savings balances. */
export interface NetSavingsOptions {
  homeCurrency?: string | null;
  fxRates?: Record<string, number>;
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
  priorDerived?: boolean;
  currentDerived?: boolean;
  priorSourceStatement?: string;
  currentSourceStatement?: string;
  priorActualMonth: string;
  currentActualMonth: string;
}

/**
 * Per-month savings breakdown with component reconciliation.
 */
export interface MonthSavingsBreakdown {
  month: string;
  netCashChange: number;
  netDebtChange: number;
  /** Always 0: Investments & Savings outflows are no longer added back. */
  contributionsToOutside: number;
  total: number;
  /** False when no account had a baseline and its own month-end balance. */
  measured: boolean;
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
  /** Months that count toward the average (see {@link MonthSavingsBreakdown.measured}). */
  measuredMonths: string[];
  /** Monthly average of each component over measured months */
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
  /** Always 0: Investments & Savings outflows are no longer added back. */
  contributionsToOutside: number;
  /** Prior calendar month whose closing balances are the baseline */
  priorMonth: string;
  /** False when no account had a baseline and its own month-end balance. */
  measured: boolean;
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
      !isTransferInterestOrCardServicing(t.category) &&
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
 * Net savings for one month — balances only (see the file header).
 *
 * `monthlyHistory`, `expenseTxns`, and `confirmedItems` are accepted for
 * older callers and ignored: categories and confirmations never change Net
 * savings. Pass `options` to convert foreign-currency balances.
 */
export function computeMonthlySavings(
  _monthlyHistory: MonthlyHistoryEntry[],
  accountBalanceHistory: AccountBalanceHistory[],
  _expenseTxns: ExpenseTxnRecord[],
  currentMonth: string,
  _confirmedItems: Map<string, boolean> = new Map(),
  options?: NetSavingsOptions,
): MonthlySavingsResult {
  const priorMonth = previousCalendarMonth(currentMonth);
  const inHome = (amount: number, currency: string) =>
    options ? toHome(amount, currency, { homeCurrency: options.homeCurrency, fxRates: options.fxRates }) : amount;

  let netCashChange = 0;
  let netDebtChange = 0;
  let measured = false;
  const cashDetails: AccountBalanceDetail[] = [];
  const debtDetails: AccountBalanceDetail[] = [];

  for (const account of accountBalanceHistory) {
    const isCash = isCashAccount(account.accountType);
    const isDebt = !isCash && isDebtAccount(account.accountType);
    if (!isCash && !isDebt) continue;

    const currentResult = getBalanceForMonth(account, currentMonth);
    const priorResult = getBalanceForMonth(account, priorMonth);
    // No baseline at or before the prior month → this account adds 0.
    if (!currentResult || !priorResult) continue;
    if (!currentResult.carriedForward) measured = true;

    const prior = inHome(priorResult.balance, account.currency);
    const current = inHome(currentResult.balance, account.currency);
    // Cash: up is saved. Debt: balances may be stored negative; paydown is saved.
    const change = isCash ? current - prior : Math.abs(prior) - Math.abs(current);

    const detail: AccountBalanceDetail = {
      accountLabel: account.label,
      slug: account.slug,
      accountType: account.accountType,
      priorBalance: priorResult.balance,
      currentBalance: currentResult.balance,
      priorCarriedForward: priorResult.carriedForward,
      currentCarriedForward: currentResult.carriedForward,
      change,
    };
    if (isCash) {
      netCashChange += change;
      cashDetails.push(detail);
    } else {
      netDebtChange += change;
      debtDetails.push(detail);
    }
  }

  return {
    total: netCashChange + netDebtChange,
    netCashChange,
    netDebtChange,
    contributionsToOutside: 0,
    priorMonth,
    measured,
    needsConfirmation: [],
    details: { cashAccounts: cashDetails, debtAccounts: debtDetails, contributions: [] },
  };
}

/**
 * Average monthly Net savings over measured months in `months`.
 * Same number as {@link computeWindowSavings}`.monthlyAverage.total`.
 */
export function computeAverageSavings(
  monthlyHistory: MonthlyHistoryEntry[],
  accountBalanceHistory: AccountBalanceHistory[],
  expenseTxns: ExpenseTxnRecord[],
  months: string[],
  confirmedItems: Map<string, boolean> = new Map(),
  options?: NetSavingsOptions,
): number {
  return computeWindowSavings(
    monthlyHistory,
    accountBalanceHistory,
    expenseTxns,
    months,
    confirmedItems,
    options,
  ).monthlyAverage.total;
}

function monthAccountDetail(
  acc: AccountBalanceDetail,
  accountBalanceHistory: AccountBalanceHistory[],
  priorMonth: string,
  month: string,
): MonthAccountDetail {
  // Extract last 4 digits from account label (e.g., "TD Checking (...1234)" -> "1234")
  const last4Match = acc.accountLabel.match(/\(\.\.\.(\d{4})\)/);
  const last4 = last4Match ? last4Match[1] : acc.slug.slice(-4);
  const accountHistory = accountBalanceHistory.find((a) => a.slug === acc.slug);
  const priorResult = accountHistory ? getBalanceForMonth(accountHistory, priorMonth) : null;
  const currentResult = accountHistory ? getBalanceForMonth(accountHistory, month) : null;
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
    priorDerived: priorResult?.derived,
    currentDerived: currentResult?.derived,
    priorSourceStatement: priorResult?.sourceStatement,
    currentSourceStatement: currentResult?.sourceStatement,
    priorActualMonth: priorResult?.actualMonth || "",
    currentActualMonth: currentResult?.actualMonth || month,
  };
}

function negativeMonthDriver(result: MonthlySavingsResult): string | undefined {
  if (result.total >= 0) return undefined;
  const cashLosses = result.details.cashAccounts
    .filter((a) => a.change < 0)
    .sort((a, b) => a.change - b.change);
  const debtIncreases = result.details.debtAccounts
    .filter((a) => a.change < 0) // Negative change = more debt
    .sort((a, b) => a.change - b.change);
  if (debtIncreases.length > 0 && cashLosses.length > 0) {
    return Math.abs(debtIncreases[0].change) > Math.abs(cashLosses[0].change)
      ? `New borrowing on ${debtIncreases[0].accountLabel}`
      : `Cash spent down from ${cashLosses[0].accountLabel}`;
  }
  if (debtIncreases.length > 0) return `New borrowing on ${debtIncreases[0].accountLabel}`;
  if (cashLosses.length > 0) return `Cash spent down from ${cashLosses[0].accountLabel}`;
  return undefined;
}

/**
 * Net savings for a window: per-month rows (with per-account detail) and the
 * monthly average over measured months. The dashboard card, savings rate,
 * drawer, computeSavingsForRange, and chat all read this.
 */
export function computeWindowSavings(
  monthlyHistory: MonthlyHistoryEntry[],
  accountBalanceHistory: AccountBalanceHistory[],
  expenseTxns: ExpenseTxnRecord[],
  months: string[],
  confirmedItems: Map<string, boolean> = new Map(),
  options?: NetSavingsOptions,
): WindowSavingsResult {
  const monthlyBreakdown: MonthSavingsBreakdown[] = months.map((month) => {
    const result = computeMonthlySavings(
      monthlyHistory,
      accountBalanceHistory,
      expenseTxns,
      month,
      confirmedItems,
      options,
    );
    const byImpact = (a: MonthAccountDetail, b: MonthAccountDetail) =>
      Math.abs(b.change) - Math.abs(a.change);
    return {
      month,
      netCashChange: result.netCashChange,
      netDebtChange: result.netDebtChange,
      contributionsToOutside: 0,
      total: result.total,
      measured: result.measured,
      driver: negativeMonthDriver(result),
      accounts: {
        cashAccounts: result.details.cashAccounts
          .map((acc) => monthAccountDetail(acc, accountBalanceHistory, result.priorMonth, month))
          .sort(byImpact),
        debtAccounts: result.details.debtAccounts
          .map((acc) => monthAccountDetail(acc, accountBalanceHistory, result.priorMonth, month))
          .sort(byImpact),
        contributions: [],
      },
    };
  });

  const measuredRows = monthlyBreakdown.filter((m) => m.measured);
  const avg = (pick: (m: MonthSavingsBreakdown) => number) =>
    measuredRows.length > 0
      ? measuredRows.reduce((sum, m) => sum + pick(m), 0) / measuredRows.length
      : 0;
  const monthlyAverage = {
    netCashChange: avg((m) => m.netCashChange),
    netDebtChange: avg((m) => m.netDebtChange),
    contributionsToOutside: 0,
    total: avg((m) => m.total),
  };

  // Per-account change over the whole window: close of the month before the
  // first month → close of the last month (same signs as the monthly rows).
  const cashAccounts: AccountBalanceDetail[] = [];
  const debtAccounts: AccountBalanceDetail[] = [];
  if (months.length > 0) {
    const startMonth = previousCalendarMonth(months[0]);
    const lastMonth = months[months.length - 1];
    const inHome = (amount: number, currency: string) =>
      options ? toHome(amount, currency, { homeCurrency: options.homeCurrency, fxRates: options.fxRates }) : amount;
    for (const account of accountBalanceHistory) {
      const isCash = isCashAccount(account.accountType);
      const isDebt = !isCash && isDebtAccount(account.accountType);
      if (!isCash && !isDebt) continue;
      const endResult = getBalanceForMonth(account, lastMonth);
      const startResult = getBalanceForMonth(account, startMonth);
      if (!endResult || !startResult) continue;
      const start = inHome(startResult.balance, account.currency);
      const end = inHome(endResult.balance, account.currency);
      const detail: AccountBalanceDetail = {
        accountLabel: account.label,
        slug: account.slug,
        accountType: account.accountType,
        priorBalance: startResult.balance,
        currentBalance: endResult.balance,
        priorCarriedForward: startResult.carriedForward,
        currentCarriedForward: endResult.carriedForward,
        change: isDebt ? Math.abs(start) - Math.abs(end) : end - start,
      };
      (isCash ? cashAccounts : debtAccounts).push(detail);
    }
  }

  return {
    monthlyBreakdown,
    measuredMonths: measuredRows.map((m) => m.month),
    monthlyAverage,
    windowPeriodAccounts: { cashAccounts, debtAccounts },
    needsConfirmation: [],
  };
}
