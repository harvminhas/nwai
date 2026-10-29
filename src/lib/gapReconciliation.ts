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
 * 
 * This function reconciles the difference between:
 * - Net Savings (balance-based from computeWindowSavings)
 * - Transaction-based: Income - Fixed - Essentials - Flexible
 * 
 * Net Savings = netCashChange + netDebtChange + contributionsToOutside
 * Where:
 * - netCashChange = Δ(cash account balances)
 * - netDebtChange = reduction in debt balances (positive = debt paid down)
 * - contributionsToOutside = investment contributions from transactions
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
  
  console.log("\n=== NET SAVINGS COMPUTATION (from savingsCalculations.ts) ===");
  console.log("Net Savings = netCashChange + netDebtChange + contributionsToOutside");
  console.log("Where:");
  console.log("  netCashChange = Δ(checking + savings account balances)");
  console.log("  netDebtChange = reduction in debt (|prior| - |current|, positive = paid down)");
  console.log("  contributionsToOutside = investment contributions from transactions");
  console.log();
  
  const components: GapComponent[] = [];
  
  // Identity we must satisfy:
  // Net Savings = Income - Fixed - Essentials - Flexible + Components
  // 
  // Therefore:
  // Components = Net Savings - (Income - Fixed - Essentials - Flexible)
  //            = Gap
  //
  // We need to break Gap into named pieces that explain the difference.
  
  // Key insight: Fixed includes debt payments that:
  // 1. Reduce cash (counted as expense in Fixed)
  // 2. Reduce debt (counted as positive in netDebtChange)
  // So debt payments appear TWICE in Net Savings but only once in buckets
  // We need to ADD BACK debt payments to reconcile
  
  const debtPaymentTxns = rangeExpenses.filter(t => {
    const cat = (t.category || "").toLowerCase();
    return cat === "debt payments";
  });
  
  const debtPaymentsTotal = debtPaymentTxns.reduce((sum, t) => sum + Math.abs(t.amount), 0);
  const debtPaymentsMonthly = debtPaymentsTotal / numMonths;
  
  if (debtPaymentsMonthly > 0.01) {
    components.push({
      name: "Debt payments (in Fixed, raise net worth)",
      amount: debtPaymentsMonthly,
      description: "Counted in Fixed but increase net worth via debt reduction",
    });
  }
  
  // Investment gains: balance change minus contributions
  // (contributions are already in contributionsToOutside, part of Net Savings)
  const investmentAccountSlugs = new Set(
    accountSnapshots
      .filter(a => ["investment", "tfsa", "rrsp", "resp"].includes(a.accountType))
      .map(a => a.slug)
  );
  
  function getBalanceForMonth(slug: string, month: string): number | null {
    const history = accountBalanceHistory.find(h => h.slug === slug);
    if (!history) return null;
    const exact = history.entries.find(e => e.yearMonth === month);
    if (exact) return exact.balance;
    const priors = history.entries.filter(e => e.yearMonth < month).sort((a, b) => b.yearMonth.localeCompare(a.yearMonth));
    return priors.length > 0 ? priors[0].balance : null;
  }
  
  let totalInvestmentBalanceChange = 0;
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
        totalInvestmentBalanceChange += (currentBalance - prevBalance);
      }
    }
  }
  
  const investmentContributions = rangeExpenses.filter(t => {
    const cat = (t.category || "").toLowerCase();
    return cat === "investments & savings";
  }).reduce((sum, t) => sum + Math.abs(t.amount), 0);
  
  const investmentGainsTotal = totalInvestmentBalanceChange - investmentContributions;
  const investmentGainsMonthly = investmentGainsTotal / numMonths;
  
  if (Math.abs(investmentGainsMonthly) > 0.01) {
    components.push({
      name: investmentGainsMonthly > 0 ? "Investment gains" : "Investment losses",
      amount: investmentGainsMonthly,
      description: "Market changes beyond contributions",
    });
  }
  
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
