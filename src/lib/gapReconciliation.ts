/**
 * Gap Reconciliation - "How this adds up"
 * 
 * Identity: Net Savings = Income - Fixed - Essentials - Flexible + Adjustments
 * 
 * Where Net Savings (from savingsCalculations.ts) is:
 *   netCashChange + netDebtChange + contributionsToOutside
 * 
 * Used by dashboard UI and regression tests.
 */

import type { ExpenseTxnRecord, IncomeTxnRecord, AccountSnapshot } from "./extractTransactions";
import type { TimeRange } from "./rangeUtils";
import { getRangeMonths } from "./rangeUtils";
import type { AccountBalanceHistory, MonthlyHistoryEntry } from "./financialProfile";
import { computeMonthlySavings } from "./savingsCalculations";

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
  
  // Diagnostic per-month data
  perMonthDiagnostic?: Array<{
    month: string;
    income: number;
    fixed: number;
    essentials: number;
    flexible: number;
    netCashChange: number;
    netDebtChange: number;
    contributionsToOutside: number;
    netSavings: number;
    gap: number;
  }>;
}

/**
 * Compute gap reconciliation for a given time range
 */
export function computeGapReconciliation(
  range: TimeRange,
  expenseTxns: ExpenseTxnRecord[],
  incomeTxns: IncomeTxnRecord[],
  accountSnapshots: AccountSnapshot[],
  accountBalanceHistory: AccountBalanceHistory[],
  monthlyHistory: MonthlyHistoryEntry[],
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
  
  console.log("\n=== NET SAVINGS COMPUTATION ===");
  console.log("Net Savings = netCashChange + netDebtChange + contributionsToOutside");
  console.log("  netCashChange = Δ(cash/savings account balances)");
  console.log("  netDebtChange = reduction in debt (positive = paid down)");
  console.log("  contributionsToOutside = investment contributions");
  console.log();
  
  // Compute per-month breakdown
  const perMonthData: Array<{
    month: string;
    income: number;
    fixed: number;
    essentials: number;
    flexible: number;
    netCashChange: number;
    netDebtChange: number;
    contributionsToOutside: number;
    netSavings: number;
    gap: number;
  }> = [];
  
  let totalIncome = 0;
  let totalFixed = 0;
  let totalEssentials = 0;
  let totalFlexible = 0;
  let totalNetCashChange = 0;
  let totalNetDebtChange = 0;
  let totalContributions = 0;
  let totalNetSavings = 0;
  
  for (const month of rangeMonths) {
    // Income from transactions
    const monthIncome = incomeTxns
      .filter(t => t.txMonth === month)
      .reduce((sum, t) => sum + t.amount, 0);
    
    // Expenses by category
    const monthExpenses = expenseTxns.filter(t => t.txMonth === month);
    
    const fixed = monthExpenses.filter(t => {
      const cat = (t.category || "").toLowerCase();
      return cat === "debt payments" || cat === "subscriptions" || 
             t.source?.toLowerCase().includes("mortgage") ||
             t.source?.toLowerCase().includes("rent") ||
             t.source?.toLowerCase().includes("insurance");
    }).reduce((sum, t) => sum + Math.abs(t.amount), 0);
    
    const essentials = monthExpenses.filter(t => {
      const cat = (t.category || "").toLowerCase();
      return cat === "groceries" || cat === "healthcare" || cat === "fees";
    }).reduce((sum, t) => sum + Math.abs(t.amount), 0);
    
    const flexible = monthExpenses.filter(t => {
      const cat = (t.category || "").toLowerCase();
      return cat === "dining" || cat === "shopping" || cat === "entertainment" || 
             cat === "transportation" || cat === "cash & atm";
    }).reduce((sum, t) => sum + Math.abs(t.amount), 0);
    
    // Get Net Savings components from computeMonthlySavings
    const monthlySavingsResult = computeMonthlySavings(
      monthlyHistory,
      accountBalanceHistory,
      expenseTxns,
      month,
      new Map()
    );
    
    const netCashChange = monthlySavingsResult.netCashChange;
    const netDebtChange = monthlySavingsResult.netDebtChange;
    const contributionsToOutside = monthlySavingsResult.contributionsToOutside;
    const netSavings = monthlySavingsResult.total;
    
    const gap = netSavings - (monthIncome - fixed - essentials - flexible);
    
    perMonthData.push({
      month,
      income: monthIncome,
      fixed,
      essentials,
      flexible,
      netCashChange,
      netDebtChange,
      contributionsToOutside,
      netSavings,
      gap,
    });
    
    totalIncome += monthIncome;
    totalFixed += fixed;
    totalEssentials += essentials;
    totalFlexible += flexible;
    totalNetCashChange += netCashChange;
    totalNetDebtChange += netDebtChange;
    totalContributions += contributionsToOutside;
    totalNetSavings += netSavings;
  }
  
  // Print per-month table
  console.log("PER-MONTH BREAKDOWN:");
  console.log(
    "Month     ".padEnd(12) +
    "Income".padStart(10) +
    "Fixed".padStart(10) +
    "Essen".padStart(10) +
    "Flex".padStart(10) +
    "CashΔ".padStart(10) +
    "DebtΔ".padStart(10) +
    "Contrib".padStart(10) +
    "NetSav".padStart(10) +
    "Gap".padStart(10)
  );
  console.log("=".repeat(110));
  
  for (const data of perMonthData) {
    console.log(
      data.month.padEnd(12) +
      data.income.toFixed(0).padStart(10) +
      data.fixed.toFixed(0).padStart(10) +
      data.essentials.toFixed(0).padStart(10) +
      data.flexible.toFixed(0).padStart(10) +
      data.netCashChange.toFixed(0).padStart(10) +
      data.netDebtChange.toFixed(0).padStart(10) +
      data.contributionsToOutside.toFixed(0).padStart(10) +
      data.netSavings.toFixed(0).padStart(10) +
      data.gap.toFixed(0).padStart(10)
    );
  }
  
  const avgIncome = totalIncome / numMonths;
  const avgFixed = totalFixed / numMonths;
  const avgEssentials = totalEssentials / numMonths;
  const avgFlexible = totalFlexible / numMonths;
  const avgNetCashChange = totalNetCashChange / numMonths;
  const avgNetDebtChange = totalNetDebtChange / numMonths;
  const avgContributions = totalContributions / numMonths;
  const avgNetSavings = totalNetSavings / numMonths;
  
  console.log("=".repeat(110));
  console.log(
    "AVERAGE   ".padEnd(12) +
    avgIncome.toFixed(0).padStart(10) +
    avgFixed.toFixed(0).padStart(10) +
    avgEssentials.toFixed(0).padStart(10) +
    avgFlexible.toFixed(0).padStart(10) +
    avgNetCashChange.toFixed(0).padStart(10) +
    avgNetDebtChange.toFixed(0).padStart(10) +
    avgContributions.toFixed(0).padStart(10) +
    avgNetSavings.toFixed(0).padStart(10)
  );
  console.log();
  
  // Expected vs actual savings (from bucketTotals, should match our computed averages)
  const expectedSavings = bucketTotals.income - bucketTotals.fixed - bucketTotals.essentials - bucketTotals.flexible;
  const actualSavings = bucketTotals.netSavings;
  const gap = actualSavings - expectedSavings;
  
  // Build components from monthly data
  const components: GapComponent[] = [];
  
  // Component 1: Debt payments in Fixed that increase net worth
  // Fixed includes debt payments (cash out) but netDebtChange counts debt reduction (positive)
  // So debt payments appear in both Fixed and netDebtChange, need to add back
  const debtPaymentsTxns = expenseTxns.filter(t => {
    const cat = (t.category || "").toLowerCase();
    return cat === "debt payments" && rangeMonths.includes(t.txMonth);
  });
  const debtPaymentsTotal = debtPaymentsTxns.reduce((sum, t) => sum + Math.abs(t.amount), 0);
  const debtPaymentsMonthly = debtPaymentsTotal / numMonths;
  
  if (debtPaymentsMonthly > 1) {
    components.push({
      name: "Debt payments (in Fixed, raise net worth)",
      amount: debtPaymentsMonthly,
      description: "Counted as expense in Fixed but also reduce debt in netDebtChange",
    });
  }
  
  // Component 2: Investment gains (market changes beyond contributions)
  const investmentContributionsTxns = expenseTxns.filter(t => {
    const cat = (t.category || "").toLowerCase();
    return cat === "investments & savings" && rangeMonths.includes(t.txMonth);
  });
  const investmentContributionsTotal = investmentContributionsTxns.reduce((sum, t) => sum + Math.abs(t.amount), 0);
  const investmentContributionsMonthly = investmentContributionsTotal / numMonths;
  
  // contributionsToOutside from Net Savings should match transaction-based contributions
  // Any difference is investment gains/losses
  const investmentGainsMonthly = avgContributions - investmentContributionsMonthly;
  
  if (Math.abs(investmentGainsMonthly) > 1) {
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
      description: "Uncategorized transactions, timing differences, or other adjustments",
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
    perMonthDiagnostic: perMonthData,
  };
}
