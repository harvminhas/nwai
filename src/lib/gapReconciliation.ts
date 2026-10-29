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
import type { AccountBalanceHistory, MonthlyHistoryEntry, FinancialProfileCache } from "./financialProfile";
import type { DebtPaymentReview } from "./types";
import { computeMonthlySavings } from "./savingsCalculations";
import { buildSpendingSummary } from "./spendingSummary";
import { buildIncomeSummary } from "./incomeSummary";

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
  
  // Use buildIncomeSummary to filter income same way as cards
  const incomeSummary = buildIncomeSummary(
    profile.incomeTxns,
    profile.accountSnapshots,
    profile.homeCurrency ?? "CAD",
    incomeDepositReviews,
    rangeMonths
  );
  
  // Get list of tracked account identifiers (last 4 digits)
  const trackedAccountSuffixes = new Set<string>();
  for (const acc of profile.accountSnapshots) {
    const slug = acc.slug || '';
    if (slug.length >= 4) {
      trackedAccountSuffixes.add(slug.slice(-4));
    }
    // Also add from account ID if available
    if (acc.accountId) {
      const cleanId = acc.accountId.replace(/[^0-9]/g, '');
      if (cleanId.length >= 4) {
        trackedAccountSuffixes.add(cleanId.slice(-4));
      }
    }
  }
  
  console.log(`Tracked account suffixes: ${Array.from(trackedAccountSuffixes).join(', ')}`);
  
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
    transfersToUntracked: Array<{ date: string; merchant: string; amount: number; destination: string }>;
    interestAndFees: number;
  }> = [];
  
  let totalIncome = 0;
  let totalFixed = 0;
  let totalEssentials = 0;
  let totalFlexible = 0;
  let totalNetCashChange = 0;
  let totalNetDebtChange = 0;
  let totalContributions = 0;
  let totalNetSavings = 0;
  let totalTransfersToUntracked = 0;
  let totalInterestAndFees = 0;
  
  // Get monthly bucket values from spendingSummary
  const monthlyBuckets = spendingSummary.monthlyHistory;
  
  for (const month of rangeMonths) {
    // Income for this month (using same filtering as buildIncomeSummary - exclude "not_income")
    const monthIncome = profile.incomeTxns
      .filter(t => t.txMonth === month)
      .filter(t => {
        const cat = (t.category || "").toLowerCase();
        // Exclude "not_income" deposits (same as buildIncomeSummary)
        if (cat === "not_income") return false;
        // Exclude transfers (same as INCOME_TRANSFER_RE logic)
        if (cat === "transfer in" || cat === "other") return false;
        return true;
      })
      .reduce((sum, t) => sum + t.amount, 0);
    
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
        return cat === "other" || cat === "uncategorized" || !cat;
      })
      .map(t => ({
        date: t.date || '',
        merchant: t.merchant || '',
        amount: Math.abs(t.amount),
        category: t.category || 'uncategorized',
      }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 5); // Top 5
    
    // Find transfers to untracked accounts
    const transferTxns = monthTxns
      .filter(t => {
        const cat = (t.category || "").toLowerCase();
        return cat === "transfers";
      });
    
    const transfersToUntracked: Array<{ date: string; merchant: string; amount: number; destination: string }> = [];
    let monthTransfersToUntrackedTotal = 0;
    
    for (const txn of transferTxns) {
      const merchant = txn.merchant || '';
      // Extract account number from merchant (e.g. "TFR-TO 4002808")
      const accountMatch = merchant.match(/\d{4,}/);
      if (accountMatch) {
        const accountNum = accountMatch[0];
        const last4 = accountNum.slice(-4);
        
        // Check if this account is tracked
        if (!trackedAccountSuffixes.has(last4)) {
          transfersToUntracked.push({
            date: txn.date || '',
            merchant,
            amount: Math.abs(txn.amount),
            destination: last4,
          });
          monthTransfersToUntrackedTotal += Math.abs(txn.amount);
        }
      }
    }
    
    // Interest and fees on debt accounts
    const interestAndFees = monthTxns
      .filter(t => {
        const cat = (t.category || "").toLowerCase();
        return cat === "fees" || cat.includes("interest");
      })
      .reduce((sum, t) => sum + Math.abs(t.amount), 0);
    
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
      transfersToUntracked,
      interestAndFees,
    });
    
    totalIncome += monthIncome;
    totalFixed += fixed;
    totalEssentials += essentials;
    totalFlexible += flexible;
    totalNetCashChange += netCashChange;
    totalNetDebtChange += netDebtChange;
    totalContributions += contributionsToOutside;
    totalNetSavings += netSavings;
    totalTransfersToUntracked += monthTransfersToUntrackedTotal;
    totalInterestAndFees += interestAndFees;
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
    
    // Print top uncategorized transactions if any
    if (data.uncategorizedTxns.length > 0) {
      console.log(`    Top uncategorized txns in ${data.month}:`);
      for (const txn of data.uncategorizedTxns) {
        console.log(`      ${txn.date} ${txn.merchant.slice(0, 40).padEnd(40)} $${txn.amount.toFixed(2).padStart(10)} [${txn.category}]`);
      }
    }
    
    // Print transfers to untracked accounts if any
    if (data.transfersToUntracked.length > 0) {
      console.log(`    Transfers to untracked accounts in ${data.month}:`);
      for (const txn of data.transfersToUntracked) {
        console.log(`      ${txn.date} ${txn.merchant.slice(0, 40).padEnd(40)} $${txn.amount.toFixed(2).padStart(10)} [dest: ${txn.destination}]`);
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
  const avgTransfersToUntracked = totalTransfersToUntracked / numMonths;
  const avgInterestAndFees = totalInterestAndFees / numMonths;
  
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
  
  // Component 1: Transfers to untracked accounts
  if (avgTransfersToUntracked > 1) {
    components.push({
      name: "Transfers to untracked accounts",
      amount: -avgTransfersToUntracked,
      description: "Transfers to accounts not tracked in the app",
    });
  }
  
  // Component 2: Interest & fees on debt
  if (avgInterestAndFees > 1) {
    components.push({
      name: "Interest & fees on debt",
      amount: -avgInterestAndFees,
      description: "Interest charges and fees on credit cards and loans",
    });
  }
  
  // Component 3: Investment gains (market changes beyond contributions)
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
  
  // Print per-month component breakdown
  console.log("\nPER-MONTH COMPONENT BREAKDOWN:");
  console.log("Month".padEnd(12) + "Transfers".padStart(12) + "Int&Fees".padStart(12) + "InvGains".padStart(12));
  console.log("=".repeat(50));
  for (const data of perMonthData) {
    const monthTransfers = data.transfersToUntracked.reduce((sum, t) => sum + t.amount, 0);
    const monthInvGains = data.contributionsToOutside - 
      (profile.expenseTxns
        .filter(t => t.txMonth === data.month && (t.category || "").toLowerCase() === "investments & savings")
        .reduce((sum, t) => sum + Math.abs(t.amount), 0));
    
    console.log(
      data.month.padEnd(12) +
      (-monthTransfers).toFixed(0).padStart(12) +
      (-data.interestAndFees).toFixed(0).padStart(12) +
      monthInvGains.toFixed(0).padStart(12)
    );
  }
  console.log();
  
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
