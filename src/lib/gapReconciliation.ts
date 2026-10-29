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
  
  const borrowingTotal = borrowingTxns.reduce((sum, t) => sum + t.amount, 0);
  const borrowingMonthly = borrowingTotal / numMonths;
  
  if (borrowingMonthly > 0.01) {
    components.push({
      name: "Borrowing",
      amount: borrowingMonthly,
      description: "LOC/FlexLine draws, credit advances (monthly avg)",
    });
  }
  
  // 2. Debt principal paid
  // Payments to debt accounts (paymentsMade) - already counted in expenses as "Debt Payments"
  // but excluded from bucket totals by CORE_EXCLUDE_RE (transfers category)
  const debtPaymentsTxns = rangeExpenses.filter(t => {
    const cat = (t.category || "").toLowerCase();
    return cat === "debt payments";
  });
  
  const debtPaymentsTotal = debtPaymentsTxns.reduce((sum, t) => sum + Math.abs(t.amount), 0);
  const debtPaymentsMonthly = debtPaymentsTotal / numMonths;
  
  if (debtPaymentsMonthly > 0.01) {
    components.push({
      name: "Debt principal paid",
      amount: -debtPaymentsMonthly, // Negative because it reduces available cash
      description: "Credit card and loan payments (monthly avg)",
    });
  }
  
  // 3. Transfers to savings/investments
  const savingsTransfersTxns = rangeExpenses.filter(t => {
    const cat = (t.category || "").toLowerCase();
    return cat === "investments & savings";
  });
  
  const savingsTransfersTotal = savingsTransfersTxns.reduce((sum, t) => sum + Math.abs(t.amount), 0);
  const savingsTransfersMonthly = savingsTransfersTotal / numMonths;
  
  if (savingsTransfersMonthly > 0.01) {
    components.push({
      name: "Transfers to savings/investments",
      amount: -savingsTransfersMonthly, // Negative because money leaves checking
      description: "RRSP, TFSA, investment contributions (monthly avg)",
    });
  }
  
  // NOTE: Cash & ATM and Uncategorized are NOT included here because they are
  // already counted in the Flexible/Essentials buckets. Including them would
  // double-count these transactions.
  
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
