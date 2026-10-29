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
import type { AccountBalanceHistory, MonthlyHistoryEntry, DebtPaymentReview, FinancialProfileCache } from "./financialProfile";
import { computeMonthlySavings } from "./savingsCalculations";
import { buildSpendingSummary } from "./spendingMetrics";
import { computeIncomeMetrics } from "./incomeMetrics";

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
  profile: FinancialProfileCache,
  debtPaymentReviews: DebtPaymentReview[],
  incomeDepositReviews: Map<string, string>,
  bucketTotals: {
    income: number;
    fixed: number;
    essentials: number;
    flexible: number;
    netSavings: number;
  }
): GapReconciliation {
  const rangeMonths = getRangeMonths(range, Array.from(new Set([...(profile.expenseTxns ?? []), ...(profile.incomeTxns ?? [])].map(t => t.txMonth))).sort());
  const numMonths = rangeMonths.length || 1;
  
  console.log("\n=== NET SAVINGS COMPUTATION ===");
  console.log("Net Savings = netCashChange + netDebtChange + contributionsToOutside");
  console.log("  netCashChange = Δ(cash/savings account balances)");
  console.log("  netDebtChange = reduction in debt (positive = paid down)");
  console.log("  contributionsToOutside = investment contributions");
  console.log();
  
  // Use the SAME bucket calculation as the dashboard
  const spendingSummary = buildSpendingSummary(
    profile.expenseTxns,
    profile.accountSnapshots,
    profile.debtPaymentHistory,
    debtPaymentReviews,
    profile.fxRates ?? {},
    profile.homeCurrency ?? "CAD",
    rangeMonths
  );
  
  // Use the SAME income calculation as the dashboard
  const incomeMetrics = computeIncomeMetrics(
    profile.monthlyHistory,
    profile.incomeTxns,
    profile.accountSnapshots,
    profile.homeCurrency ?? "CAD",
    incomeDepositReviews,
    rangeMonths
  );
  
  // Build per-month data using exact same sources as cards
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
    uncategorizedTxns: Array<{ date: string; merchant: string; amount: number; category: string }>;
  }> = [];
  
  let totalIncome = 0;
  let totalFixed = 0;
  let totalEssentials = 0;
  let totalFlexible = 0;
  let totalNetCashChange = 0;
  let totalNetDebtChange = 0;
  let totalContributions = 0;
  let totalNetSavings = 0;
  
  // Get monthly bucket values from spendingSummary
  const monthlyBuckets = spendingSummary.monthlyHistory;
  
  for (const month of rangeMonths) {
    // Income for this month (from income metrics, same as cards)
    const monthData = incomeMetrics.monthlyIncome.find(m => m.yearMonth === month);
    const monthIncome = monthData ? monthData.total : 0;
    
    // Buckets for this month (from spending summary, same as cards)
    const bucketData = monthlyBuckets.find(m => m.yearMonth === month);
    const fixed = bucketData ? bucketData.fixed : 0;
    const essentials = bucketData ? bucketData.essentials : 0;
    const flexible = bucketData ? bucketData.flexible : 0;
    
    // Get Net Savings components from computeMonthlySavings
    const monthlySavingsResult = computeMonthlySavings(
      profile.monthlyHistory,
      profile.accountBalanceHistory,
      profile.expenseTxns,
      month,
      new Map()
    );
    
    const netCashChange = monthlySavingsResult.netCashChange;
    const netDebtChange = monthlySavingsResult.netDebtChange;
    const contributionsToOutside = monthlySavingsResult.contributionsToOutside;
    const netSavings = monthlySavingsResult.total;
    
    const gap = netSavings - (monthIncome - fixed - essentials - flexible);
    
    // Find uncategorized/transfer transactions not in buckets
    const monthTxns = profile.expenseTxns.filter(t => t.txMonth === month);
    const uncategorizedTxns = monthTxns
      .filter(t => {
        const cat = (t.category || "").toLowerCase();
        return cat === "other" || cat === "uncategorized" || cat === "transfers" || !cat;
      })
      .map(t => ({
        date: t.date || '',
        merchant: t.source || t.merchant || '',
        amount: Math.abs(t.amount),
        category: t.category || 'uncategorized',
      }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 5); // Top 5
    
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
      uncategorizedTxns,
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
  console.log("PER-MONTH BREAKDOWN (using exact card calculations):");
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
    
    // Print top uncategorized/transfer transactions if any
    if (data.uncategorizedTxns.length > 0) {
      console.log(`    Top uncategorized/transfer txns in ${data.month}:`);
      for (const txn of data.uncategorizedTxns) {
        console.log(`      ${txn.date} ${txn.merchant.slice(0, 40).padEnd(40)} $${txn.amount.toFixed(2).padStart(10)} [${txn.category}]`);
      }
    }
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
  console.log(`Card values (for comparison):`);
  console.log(`  Income: ${bucketTotals.income.toFixed(2)}, Fixed: ${bucketTotals.fixed.toFixed(2)}, Essentials: ${bucketTotals.essentials.toFixed(2)}, Flexible: ${bucketTotals.flexible.toFixed(2)}`);
  console.log(`  Net Savings: ${bucketTotals.netSavings.toFixed(2)}`);
  console.log();
  
  // Expected vs actual savings (from bucketTotals)
  const expectedSavings = bucketTotals.income - bucketTotals.fixed - bucketTotals.essentials - bucketTotals.flexible;
  const actualSavings = bucketTotals.netSavings;
  const gap = actualSavings - expectedSavings;
  
  // Build components from monthly data
  const components: GapComponent[] = [];
  
  // Component 1: Debt payments in Fixed
  // These are in Fixed (expense) but netDebtChange captures the paydown effect
  // The principal portion is already counted in netDebtChange, so we don't need to add it back
  // What we care about is: if netDebtChange is negative (new borrowing), that's cash source
  
  // Calculate total new borrowing (months where netDebtChange < 0)
  let totalNewBorrowing = 0;
  for (const monthData of perMonthData) {
    if (monthData.netDebtChange < 0) {
      totalNewBorrowing += Math.abs(monthData.netDebtChange);
    }
  }
  const newBorrowingMonthly = totalNewBorrowing / numMonths;
  
  if (newBorrowingMonthly > 1) {
    components.push({
      name: "New borrowing (FlexLine draws, card charges)",
      amount: newBorrowingMonthly,
      description: "Debt increased (netDebtChange negative) - cash available but not income",
    });
  }
  
  // Component 2: Investment gains (market changes beyond contributions)
  const investmentContributionsTxns = profile.expenseTxns.filter(t => {
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
    perMonthDiagnostic: perMonthData as any,
  };
}
