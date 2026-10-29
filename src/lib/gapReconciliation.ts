/**
 * Gap Reconciliation - "How this adds up"
 * 
 * Identity: Net Savings (balance-based) = Income - Fixed - Essentials - Flexible + Adjustments
 * 
 * Where adjustments account for:
 * - Borrowing (new debt = cash available but not income)
 * - Non-transaction balance changes (investment gains/losses, manual adjustments)
 * 
 * NOTE: Debt payments are ALREADY in Fixed costs, so they are NOT a gap component.
 * Only account for new borrowing (which increases available cash without being income).
 * 
 * Used by dashboard UI and regression tests.
 */

import type { ExpenseTxnRecord, IncomeTxnRecord, AccountSnapshot } from "./extractTransactions";
import type { TimeRange } from "./rangeUtils";
import { getRangeMonths } from "./rangeUtils";

export interface GapComponent {
  name: string;
  amount: number; // Positive = adds to gap, negative = reduces gap
  description: string;
}

export interface GapReconciliation {
  // Inputs
  income: number;
  fixed: number;
  essentials: number;
  flexible: number;
  netSavings: number;
  
  // The gap
  expectedSavings: number; // Income - Fixed - Essentials - Flexible
  actualSavings: number; // Net Savings from balance changes
  gap: number; // actualSavings - expectedSavings
  
  // Gap components (all add to gap, negative values reduce it)
  components: GapComponent[];
  
  // Sum check
  componentsTotal: number;
  unexplained: number;
  reconciles: boolean; // abs(unexplained) < 1
}

// Import AccountBalanceHistory type
import type { AccountBalanceHistory } from "./financialProfile";

/**
 * Compute gap reconciliation for a given time range
 */
export function computeGapReconciliation(
  range: TimeRange,
  expenseTxns: ExpenseTxnRecord[],
  incomeTxns: IncomeTxnRecord[],
  accountSnapshots: AccountSnapshot[],
  accountBalanceHistory: AccountBalanceHistory[],
  bucketTotals: {
    income: number;
    fixed: number;
    essentials: number;
    flexible: number;
    netSavings: number;
  }
): GapReconciliation {
  const rangeMonths = getRangeMonths(range, Array.from(new Set([...(expenseTxns ?? []), ...(incomeTxns ?? [])].map(t => t.txMonth))).sort());
  const numMonths = rangeMonths.length || 1;
  
  // Filter transactions to the range
  const rangeExpenses = expenseTxns.filter(t => rangeMonths.includes(t.txMonth));
  const rangeIncome = incomeTxns.filter(t => rangeMonths.includes(t.txMonth));
  
  // Expected vs actual savings (already monthly averages from bucketTotals)
  const expectedSavings = bucketTotals.income - bucketTotals.fixed - bucketTotals.essentials - bucketTotals.flexible;
  const actualSavings = bucketTotals.netSavings;
  const gap = actualSavings - expectedSavings;
  
  const components: GapComponent[] = [];
  
  // Identify debt accounts and asset/investment accounts
  const debtAccountSlugs = new Set(
    accountSnapshots
      .filter(a => a.balance < 0 || ["credit", "credit_card", "loc", "line_of_credit", "loan", "mortgage"].includes(a.accountType))
      .map(a => a.slug)
  );
  
  const investmentAccountSlugs = new Set(
    accountSnapshots
      .filter(a => ["investment", "tfsa", "rrsp", "resp"].includes(a.accountType))
      .map(a => a.slug)
  );
  
  // Helper: get balance for a specific month from accountBalanceHistory
  function getBalanceForMonth(slug: string, month: string): number | null {
    const history = accountBalanceHistory.find(h => h.slug === slug);
    if (!history) return null;
    
    // Try exact month
    const exact = history.entries.find(e => e.yearMonth === month);
    if (exact) return exact.balance;
    
    // Find most recent prior
    const priors = history.entries
      .filter(e => e.yearMonth < month)
      .sort((a, b) => b.yearMonth.localeCompare(a.yearMonth));
    
    return priors.length > 0 ? priors[0].balance : null;
  }
  
  // 1. Borrowing (increases in debt balances = new draws/charges)
  // This is cash that became available but is NOT counted in Income
  // Note: Debt payments are already in Fixed costs, so we only count NEW borrowing
  let totalBorrowingAllMonths = 0;
  
  for (const slug of debtAccountSlugs) {
    for (let i = 0; i < rangeMonths.length; i++) {
      const month = rangeMonths[i];
      
      // Get prior month (either previous month in range, or month before range)
      let priorMonth: string;
      if (i > 0) {
        priorMonth = rangeMonths[i - 1];
      } else {
        const [y, m] = month.split('-').map(Number);
        const prevMonthDate = new Date(y, m - 2, 1); // m-2 because m is 1-indexed
        priorMonth = `${prevMonthDate.getFullYear()}-${String(prevMonthDate.getMonth() + 1).padStart(2, '0')}`;
      }
      
      const prevBalance = getBalanceForMonth(slug, priorMonth);
      const currentBalance = getBalanceForMonth(slug, month);
      
      if (prevBalance !== null && currentBalance !== null) {
        // Debt balances are negative, so increase in debt = more negative = borrowed more
        const debtIncrease = Math.abs(currentBalance) - Math.abs(prevBalance);
        if (debtIncrease > 0) {
          totalBorrowingAllMonths += debtIncrease;
        }
      }
    }
  }
  
  const borrowingMonthly = totalBorrowingAllMonths / numMonths;
  
  if (borrowingMonthly > 0.01) {
    components.push({
      name: "Borrowing",
      amount: borrowingMonthly,
      description: "New debt (LOC draws, card spending not yet paid)",
    });
  }
  
  // 2. Investment balance changes NOT from contributions
  // Investment accounts can grow/shrink from market changes, not just contributions
  // Contributions are already tracked as expenses in "Investments & Savings" category
  let totalInvestmentGainsAllMonths = 0;
  
  // Get total investment contributions from transactions (already in expense buckets)
  const investmentContributions = rangeExpenses.filter(t => {
    const cat = (t.category || "").toLowerCase();
    return cat === "investments & savings";
  }).reduce((sum, t) => sum + Math.abs(t.amount), 0);
  
  const investmentContributionsMonthly = investmentContributions / numMonths;
  
  // Get balance changes for investment accounts
  for (const slug of investmentAccountSlugs) {
    for (let i = 0; i < rangeMonths.length; i++) {
      const month = rangeMonths[i];
      
      let priorMonth: string;
      if (i > 0) {
        priorMonth = rangeMonths[i - 1];
      } else {
        const [y, m] = month.split('-').map(Number);
        const prevMonthDate = new Date(y, m - 2, 1);
        priorMonth = `${prevMonthDate.getFullYear()}-${String(prevMonthDate.getMonth() + 1).padStart(2, '0')}`;
      }
      
      const prevBalance = getBalanceForMonth(slug, priorMonth);
      const currentBalance = getBalanceForMonth(slug, month);
      
      if (prevBalance !== null && currentBalance !== null) {
        // Investment growth (positive = account grew)
        const growth = currentBalance - prevBalance;
        totalInvestmentGainsAllMonths += growth;
      }
    }
  }
  
  const investmentBalanceChangeMonthly = totalInvestmentGainsAllMonths / numMonths;
  
  // Investment gains = balance change minus contributions
  // If balance grew more than contributions, that's market gains (adds to net worth without reducing cash)
  // If balance grew less than contributions, that's market losses (but contributions still left cash)
  const investmentGainsMonthly = investmentBalanceChangeMonthly - investmentContributionsMonthly;
  
  if (Math.abs(investmentGainsMonthly) > 0.01) {
    components.push({
      name: investmentGainsMonthly > 0 ? "Investment gains" : "Investment losses",
      amount: investmentGainsMonthly,
      description: investmentGainsMonthly > 0 
        ? "Market appreciation on investments"
        : "Market depreciation on investments",
    });
  }
  
  // NOTE: Debt payments are ALREADY in Fixed costs, so we don't subtract them again.
  // NOTE: Cash & ATM and Uncategorized are ALREADY in Flexible/Essentials buckets.
  // NOTE: Investment contributions are ALREADY in expense buckets.
  
  // Calculate unexplained
  const componentsTotal = components.reduce((sum, c) => sum + c.amount, 0);
  const unexplained = gap - componentsTotal;
  
  // Add unexplained if significant
  if (Math.abs(unexplained) > 1) {
    components.push({
      name: "Unexplained",
      amount: unexplained,
      description: "Account balance changes, timing differences, or untracked transactions",
    });
  }
  
  return {
    income: bucketTotals.income,
    fixed: bucketTotals.fixed,
    essentials: bucketTotals.essentials,
    flexible: bucketTotals.flexible,
    netSavings: bucketTotals.netSavings,
    expectedSavings,
    actualSavings,
    gap,
    components,
    componentsTotal,
    unexplained,
    reconciles: Math.abs(unexplained) < 1,
  };
}
