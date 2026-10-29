/**
 * Gap Reconciliation - "How this adds up"
 * 
 * Reconciles the gap between:
 *   Net Savings (Y) vs. Income - Fixed - Essentials - Flexible (X)
 * 
 * Breaks the gap into components:
 * - Borrowing (LOC/FlexLine draws, credit advances)
 * - Debt principal paid
 * - Transfers to savings/investments
 * - Cash & ATM withdrawals
 * - Uncategorized expenses
 * - Investment value changes
 * - Unexplained remainder
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

/**
 * Compute gap reconciliation for a given time range
 */
export function computeGapReconciliation(
  range: TimeRange,
  expenseTxns: ExpenseTxnRecord[],
  incomeTxns: IncomeTxnRecord[],
  accountSnapshots: AccountSnapshot[],
  bucketTotals: {
    income: number;
    fixed: number;
    essentials: number;
    flexible: number;
    netSavings: number;
  }
): GapReconciliation {
  const rangeMonths = getRangeMonths(range);
  
  // Filter transactions to the range
  const rangeExpenses = expenseTxns.filter(t => rangeMonths.includes(t.txMonth));
  const rangeIncome = incomeTxns.filter(t => rangeMonths.includes(t.txMonth));
  
  // Expected vs actual savings
  const expectedSavings = bucketTotals.income - bucketTotals.fixed - bucketTotals.essentials - bucketTotals.flexible;
  const actualSavings = bucketTotals.netSavings;
  const gap = actualSavings - expectedSavings;
  
  const components: GapComponent[] = [];
  
  // 1. Borrowing (LOC/FlexLine draws, credit card advances)
  // These are income on debt accounts (increases available cash without being counted as income)
  const debtAccountSlugs = new Set(
    accountSnapshots
      .filter(a => a.balance < 0 || ["credit", "credit_card", "loc", "line_of_credit", "loan"].includes(a.accountType))
      .map(a => a.slug)
  );
  
  const borrowingTxns = rangeIncome.filter(t => {
    const isDebtAccount = debtAccountSlugs.has(t.accountSlug);
    const cat = (t.category || "").toLowerCase();
    const desc = (t.source || "").toLowerCase();
    
    // Income on debt accounts that are draws/advances
    return isDebtAccount && (
      cat.includes("transfer") ||
      cat.includes("advance") ||
      desc.includes("advance") ||
      desc.includes("draw") ||
      desc.includes("flexline") ||
      desc.includes("cash advance")
    );
  });
  
  const borrowing = borrowingTxns.reduce((sum, t) => sum + t.amount, 0);
  if (borrowing > 0.01) {
    components.push({
      name: "Borrowing",
      amount: borrowing,
      description: "LOC/FlexLine draws, credit advances",
    });
  }
  
  // 2. Debt principal paid
  // Payments to debt accounts (paymentsMade) - already counted in expenses as "Debt Payments"
  // but not reflected in bucket totals if excluded by CORE_EXCLUDE_RE
  const debtPayments = rangeExpenses.filter(t => {
    const cat = (t.category || "").toLowerCase();
    return cat === "debt payments";
  }).reduce((sum, t) => sum + Math.abs(t.amount), 0);
  
  if (debtPayments > 0.01) {
    components.push({
      name: "Debt principal paid",
      amount: -debtPayments, // Negative because it reduces available cash
      description: "Credit card and loan payments",
    });
  }
  
  // 3. Transfers to savings/investments
  const savingsTransfers = rangeExpenses.filter(t => {
    const cat = (t.category || "").toLowerCase();
    return cat === "investments & savings";
  }).reduce((sum, t) => sum + Math.abs(t.amount), 0);
  
  if (savingsTransfers > 0.01) {
    components.push({
      name: "Transfers to savings/investments",
      amount: -savingsTransfers, // Negative because money leaves checking
      description: "RRSP, TFSA, investment contributions",
    });
  }
  
  // 4. Cash & ATM
  const cashWithdrawals = rangeExpenses.filter(t => {
    const cat = (t.category || "").toLowerCase();
    return cat === "cash & atm";
  }).reduce((sum, t) => sum + Math.abs(t.amount), 0);
  
  if (cashWithdrawals > 0.01) {
    components.push({
      name: "Cash & ATM",
      amount: -cashWithdrawals, // Negative because cash leaves accounts
      description: "Cash withdrawals and ATM fees",
    });
  }
  
  // 5. Uncategorized
  const uncategorized = rangeExpenses.filter(t => {
    const cat = (t.category || "").toLowerCase();
    return cat === "other" || cat === "uncategorized" || !cat;
  }).reduce((sum, t) => sum + Math.abs(t.amount), 0);
  
  if (uncategorized > 0.01) {
    components.push({
      name: "Uncategorized",
      amount: -uncategorized, // Negative because it's spending
      description: "Transactions without categories",
    });
  }
  
  // 6. Investment value changes
  // This would require tracking investment account balance changes vs contributions
  // For now, we'll compute this as a residual if we have investment accounts
  // TODO: Implement proper investment value tracking
  
  // Calculate unexplained
  const componentsTotal = components.reduce((sum, c) => sum + c.amount, 0);
  const unexplained = gap - componentsTotal;
  
  // Add unexplained if significant
  if (Math.abs(unexplained) > 1) {
    components.push({
      name: "Unexplained",
      amount: unexplained,
      description: "Rounding, timing differences, or untracked changes",
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
