/**
 * Verification script for drawer data layer.
 * Tests each drawer (income + 4 buckets) × each window (last3, 12month, ytd)
 * with realistic mock FinancialProfileCache data.
 * 
 * Run: npx tsx src/lib/__tests__/drawerVerification.ts
 */

import { computeDetailedIncomeMetrics } from "../incomeMetrics";
import { computeBucketBreakdown, compute3MonthTrend } from "../bucketBreakdown";
import type { MonthlyHistoryEntry } from "../financialProfile";
import type { IncomeTxnRecord, ExpenseTxnRecord, AccountSnapshot } from "../extractTransactions";

// Mock realistic data
const mockMonthlyHistory: MonthlyHistoryEntry[] = [
  { 
    yearMonth: "2026-01", incomeTotal: 8500, expensesTotal: 6200, 
    coreExpensesTotal: 6200, incomeTotalAllCredits: 8500, 
    debtPaymentsTotal: 0, cardServicingPaymentsTotal: 0, minDebtPaymentsTotal: 0,
    totalAssets: 15000, totalDebts: 0, netWorth: 15000
  },
  { 
    yearMonth: "2026-02", incomeTotal: 8500, expensesTotal: 6800, 
    coreExpensesTotal: 6800, incomeTotalAllCredits: 8500, 
    debtPaymentsTotal: 0, cardServicingPaymentsTotal: 0, minDebtPaymentsTotal: 0,
    totalAssets: 16700, totalDebts: 0, netWorth: 16700
  },
  { 
    yearMonth: "2026-03", incomeTotal: 8500, expensesTotal: 6500, 
    coreExpensesTotal: 6500, incomeTotalAllCredits: 8500, 
    debtPaymentsTotal: 0, cardServicingPaymentsTotal: 0, minDebtPaymentsTotal: 0,
    totalAssets: 18400, totalDebts: 0, netWorth: 18400
  },
  { 
    yearMonth: "2026-04", incomeTotal: 9000, expensesTotal: 6400, 
    coreExpensesTotal: 6400, incomeTotalAllCredits: 9000, 
    debtPaymentsTotal: 0, cardServicingPaymentsTotal: 0, minDebtPaymentsTotal: 0,
    totalAssets: 21000, totalDebts: 0, netWorth: 21000
  },
  { 
    yearMonth: "2026-05", incomeTotal: 9000, expensesTotal: 7000, 
    coreExpensesTotal: 7000, incomeTotalAllCredits: 9000, 
    debtPaymentsTotal: 0, cardServicingPaymentsTotal: 0, minDebtPaymentsTotal: 0,
    totalAssets: 23000, totalDebts: 0, netWorth: 23000
  },
  { 
    yearMonth: "2026-06", incomeTotal: 9000, expensesTotal: 6900, 
    coreExpensesTotal: 6900, incomeTotalAllCredits: 9000, 
    debtPaymentsTotal: 0, cardServicingPaymentsTotal: 0, minDebtPaymentsTotal: 0,
    totalAssets: 25100, totalDebts: 0, netWorth: 25100
  },
  { 
    yearMonth: "2026-07", incomeTotal: 9000, expensesTotal: 7200, 
    coreExpensesTotal: 7200, incomeTotalAllCredits: 9000, 
    debtPaymentsTotal: 0, cardServicingPaymentsTotal: 0, minDebtPaymentsTotal: 0,
    totalAssets: 26900, totalDebts: 0, netWorth: 26900
  },
  { 
    yearMonth: "2026-08", incomeTotal: 9200, expensesTotal: 6800, 
    coreExpensesTotal: 6800, incomeTotalAllCredits: 9200, 
    debtPaymentsTotal: 0, cardServicingPaymentsTotal: 0, minDebtPaymentsTotal: 0,
    totalAssets: 29300, totalDebts: 0, netWorth: 29300
  },
  { 
    yearMonth: "2026-09", incomeTotal: 9200, expensesTotal: 7100, 
    coreExpensesTotal: 7100, incomeTotalAllCredits: 9200, 
    debtPaymentsTotal: 0, cardServicingPaymentsTotal: 0, minDebtPaymentsTotal: 0,
    totalAssets: 31400, totalDebts: 0, netWorth: 31400
  },
  // Current incomplete month (should be excluded from "last 3 months" calculations)
  { 
    yearMonth: "2026-10", incomeTotal: 9200, expensesTotal: 7000, 
    coreExpensesTotal: 7000, incomeTotalAllCredits: 9200, 
    debtPaymentsTotal: 0, cardServicingPaymentsTotal: 0, minDebtPaymentsTotal: 0,
    totalAssets: 33600, totalDebts: 0, netWorth: 33600
  },
];

const mockIncomeTxns: IncomeTxnRecord[] = [
  { txMonth: "2026-08", date: "2026-08-15", source: "Acme Corp", description: "Salary", category: "Salary", amount: 9200, accountSlug: "checking-1234" },
  { txMonth: "2026-09", date: "2026-09-15", source: "Acme Corp", description: "Salary", category: "Salary", amount: 9200, accountSlug: "checking-1234" },
  { txMonth: "2026-10", date: "2026-10-15", source: "Acme Corp", description: "Salary", category: "Salary", amount: 9200, accountSlug: "checking-1234" },
];

const mockExpenseTxns: ExpenseTxnRecord[] = [
  { txMonth: "2026-10", date: "2026-10-15", category: "Groceries", merchant: "Whole Foods", amount: -450, accountSlug: "checking-1234", accountLabel: "Checking", currency: "CAD" },
  { txMonth: "2026-10", date: "2026-10-20", category: "Dining", merchant: "Chipotle", amount: -35, accountSlug: "checking-1234", accountLabel: "Checking", currency: "CAD" },
  { txMonth: "2026-10", date: "2026-10-01", category: "Housing", merchant: "Landlord", amount: -2000, accountSlug: "checking-1234", accountLabel: "Checking", currency: "CAD" },
  { txMonth: "2026-10", date: "2026-10-12", category: "Transportation", merchant: "Gas Station", amount: -120, accountSlug: "checking-1234", accountLabel: "Checking", currency: "CAD" },
  { txMonth: "2026-10", date: "2026-10-05", category: "Subscriptions", merchant: "Netflix", amount: -15, accountSlug: "credit-5678", accountLabel: "Chase Visa", currency: "CAD" },
  
  // Mortgage (TD Home Equity FlexLine): regular monthly payments + one large prepayment
  { txMonth: "2026-10", date: "2026-10-01", category: "Debt Payments", merchant: "TD MORTGAGE PAYMENT", amount: -2845, accountSlug: "td-heloc-9999", accountLabel: "TD Mortgage", currency: "CAD" },
  { txMonth: "2026-10", date: "2026-10-15", category: "Debt Payments", merchant: "TD MORTGAGE PREPAYMENT", amount: -32000, accountSlug: "td-heloc-9999", accountLabel: "TD Mortgage", currency: "CAD" },
  { txMonth: "2026-09", date: "2026-09-01", category: "Debt Payments", merchant: "TD MORTGAGE PAYMENT", amount: -2850, accountSlug: "td-heloc-9999", accountLabel: "TD Mortgage", currency: "CAD" },
  { txMonth: "2026-08", date: "2026-08-01", category: "Debt Payments", merchant: "TD MORTGAGE PAYMENT", amount: -2855, accountSlug: "td-heloc-9999", accountLabel: "TD Mortgage", currency: "CAD" },
  { txMonth: "2026-07", date: "2026-07-01", category: "Debt Payments", merchant: "TD MORTGAGE PAYMENT", amount: -2848, accountSlug: "td-heloc-9999", accountLabel: "TD Mortgage", currency: "CAD" },
  { txMonth: "2026-06", date: "2026-06-01", category: "Debt Payments", merchant: "TD MORTGAGE PAYMENT", amount: -2852, accountSlug: "td-heloc-9999", accountLabel: "TD Mortgage", currency: "CAD" },
  { txMonth: "2026-05", date: "2026-05-01", category: "Debt Payments", merchant: "TD MORTGAGE PAYMENT", amount: -2847, accountSlug: "td-heloc-9999", accountLabel: "TD Mortgage", currency: "CAD" },
  
  { txMonth: "2026-09", date: "2026-09-15", category: "Groceries", merchant: "Safeway", amount: -480, accountSlug: "checking-1234", accountLabel: "Checking", currency: "CAD" },
  { txMonth: "2026-09", date: "2026-09-20", category: "Dining", merchant: "Starbucks", amount: -25, accountSlug: "credit-5678", accountLabel: "Chase Visa", currency: "CAD" },
  { txMonth: "2026-08", date: "2026-08-15", category: "Groceries", merchant: "Trader Joes", amount: -420, accountSlug: "checking-1234", accountLabel: "Checking", currency: "CAD" },
  
  // Car loan payments (regular pattern)
  { txMonth: "2026-09", date: "2026-09-15", category: "Debt Payments", merchant: "SCOTIA PLAN PAYMENT", amount: -1087, accountSlug: "scotia-plan-1234", accountLabel: "Scotia Plan", currency: "CAD" },
  { txMonth: "2026-08", date: "2026-08-15", category: "Debt Payments", merchant: "SCOTIA PLAN PAYMENT", amount: -1094, accountSlug: "scotia-plan-1234", accountLabel: "Scotia Plan", currency: "CAD" },
  { txMonth: "2026-07", date: "2026-07-15", category: "Debt Payments", merchant: "SCOTIA PLAN PAYMENT", amount: -1089, accountSlug: "scotia-plan-1234", accountLabel: "Scotia Plan", currency: "CAD" },
  { txMonth: "2026-06", date: "2026-06-15", category: "Debt Payments", merchant: "SCOTIA PLAN PAYMENT", amount: -1091, accountSlug: "scotia-plan-1234", accountLabel: "Scotia Plan", currency: "CAD" },
];

const mockAccountSnapshots: AccountSnapshot[] = [
  {
    slug: "credit-5678",
    bankName: "Chase",
    accountId: "5678",
    accountName: "Chase Visa",
    accountType: "credit",
    balance: -1500,
    statementMonth: "2026-10",
    interestRate: 19.99,
    paymentsMade: 1200,
  },
  {
    slug: "td-heloc-9999",
    bankName: "TD",
    accountId: "9999",
    accountName: "TD Home Equity FlexLine (Mortgage)",
    accountType: "mortgage",
    balance: -425000, // Mortgage balance
    statementMonth: "2026-10",
    interestRate: 4.5,
    paymentsMade: 33160, // Large prepayment this month
  },
  {
    slug: "scotia-plan-1234",
    bankName: "Scotia",
    accountId: "1234",
    accountName: "Scotia Plan",
    accountType: "loan",
    balance: -25000, // Car loan
    statementMonth: "2026-10",
    interestRate: 5.9,
    paymentsMade: 1089,
  },
];

const currentYear = 2026;
const buckets: Array<"fixed" | "essentials" | "flexible" | "savings"> = ["fixed", "essentials", "flexible", "savings"];
const windows: Array<"last3" | "12month" | "ytd"> = ["last3", "12month", "ytd"];

console.log("🧪 Drawer Data Layer Verification\n");

// Test Income drawer
console.log("=== INCOME DRAWER ===");
for (const window of windows) {
  try {
    const metrics = computeDetailedIncomeMetrics(
      mockMonthlyHistory,
      mockIncomeTxns,
      window,
      currentYear,
      true
    );

    // Verify all required fields exist
    const checks = [
      ["windowAmount", typeof metrics.windowAmount === "number"],
      ["windowLabel", typeof metrics.windowLabel === "string"],
      ["windowMonths", Array.isArray(metrics.windowMonths)],
      ["regularSources", Array.isArray(metrics.regularSources)],
      ["oneOffSources", Array.isArray(metrics.oneOffSources)],
      ["ytdTotal", typeof metrics.ytdTotal === "number"],
      ["ytdRegular", typeof metrics.ytdRegular === "number"],
      ["ytdOneOff", typeof metrics.ytdOneOff === "number"],
      ["projectedFullYear", typeof metrics.projectedFullYear === "number"],
    ];

    const allPass = checks.every(([_, pass]) => pass);
    console.log(`  ${window}: ${allPass ? "✓" : "✗"} ${checks.filter(([_, p]) => !p).map(([n]) => n).join(", ")}`);

    if (!allPass) {
      console.log("    Details:", metrics);
    }
  } catch (err) {
    console.log(`  ${window}: ✗ ERROR - ${err instanceof Error ? err.message : String(err)}`);
  }
}

// Test Bucket drawers
console.log("\n=== BUCKET DRAWERS ===");
for (const bucket of buckets) {
  console.log(`\n${bucket.toUpperCase()}:`);
  
  for (const window of windows) {
    try {
      // Get months for window
      const months = mockMonthlyHistory
        .slice(window === "last3" ? -3 : window === "ytd" ? 0 : -12)
        .map(h => h.yearMonth);

      const breakdown = computeBucketBreakdown(
        bucket,
        mockExpenseTxns,
        mockAccountSnapshots,
        months,
        "CAD"
      );

      const trend = compute3MonthTrend(
        bucket,
        mockExpenseTxns,
        mockAccountSnapshots,
        mockMonthlyHistory
      );

      // Verify breakdown structure
      const breakdownChecks = [
        ["bucket", breakdown.bucket === bucket],
        ["monthlyAverage", typeof breakdown.monthlyAverage === "number"],
        ["categories", Array.isArray(breakdown.categories)],
        ["notCountedHere", Array.isArray(breakdown.notCountedHere)],
      ];

      // Verify trend structure
      const trendChecks = [
        ["trend.months", Array.isArray(trend.months)],
        ["trend.values", Array.isArray(trend.values)],
        ["trend.length", trend.months.length === trend.values.length],
      ];

      // Verify category structure
      const categoriesValid = breakdown.categories.every(cat =>
        typeof cat.category === "string" &&
        typeof cat.amount === "number" &&
        typeof cat.pctOfBucket === "number" &&
        Array.isArray(cat.merchants)
      );

      const allChecks = [...breakdownChecks, ...trendChecks, ["categories valid", categoriesValid]];
      const allPass = allChecks.every(([_, pass]) => pass);

      console.log(`  ${window}: ${allPass ? "✓" : "✗"} ${allChecks.filter(([_, p]) => !p).map(([n]) => n).join(", ")}`);

      if (!allPass) {
        console.log("    Breakdown:", breakdown);
        console.log("    Trend:", trend);
      }
    } catch (err) {
      console.log(`  ${window}: ✗ ERROR - ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

console.log("\n✅ Verification complete");

// Sanity check: Test that percentages don't exceed 150%
console.log("\n=== SANITY CHECK: Percentage Sums ===");
for (const bucket of buckets) {
  for (const window of windows) {
    try {
      const months = mockMonthlyHistory
        .slice(window === "last3" ? -3 : window === "ytd" ? 0 : -12)
        .map(h => h.yearMonth);

      const breakdown = computeBucketBreakdown(
        bucket,
        mockExpenseTxns,
        mockAccountSnapshots,
        months,
        "CAD"
      );

      const totalPct = breakdown.categories.reduce((sum, c) => sum + c.pctOfBucket, 0);
      
      if (Math.abs(totalPct - 100) > 1) {
        console.log(`  ⚠️  ${bucket}/${window}: Category percentages sum to ${Math.round(totalPct)}% (expected ~100%)`);
      }
    } catch (err) {
      // Already logged above
    }
  }
}

console.log("\n✅ All checks complete\n");

// ========================================================================
// BUG REPRODUCTION: Screenshot scenario (Oct 26 current month with no data)
// ========================================================================
console.log("=== BUG REPRODUCTION: Income Drawer Calculation ===\n");

const bugScenarioHistory: MonthlyHistoryEntry[] = [
  { yearMonth: "2026-06", incomeTotal: 7460, expensesTotal: 0, netWorth: 0, coreExpensesTotal: 0, debtPaymentsTotal: 0, cardServicingPaymentsTotal: 0, minDebtPaymentsTotal: 0, incomeTotalAllCredits: 7460, totalAssets: 0, totalDebts: 0 },
  { yearMonth: "2026-07", incomeTotal: 10011, expensesTotal: 0, netWorth: 0, coreExpensesTotal: 0, debtPaymentsTotal: 0, cardServicingPaymentsTotal: 0, minDebtPaymentsTotal: 0, incomeTotalAllCredits: 10011, totalAssets: 0, totalDebts: 0 },
  { yearMonth: "2026-08", incomeTotal: 15226, expensesTotal: 0, netWorth: 0, coreExpensesTotal: 0, debtPaymentsTotal: 0, cardServicingPaymentsTotal: 0, minDebtPaymentsTotal: 0, incomeTotalAllCredits: 15226, totalAssets: 0, totalDebts: 0 },
  { yearMonth: "2026-09", incomeTotal: 41424, expensesTotal: 0, netWorth: 0, coreExpensesTotal: 0, debtPaymentsTotal: 0, cardServicingPaymentsTotal: 0, minDebtPaymentsTotal: 0, incomeTotalAllCredits: 41424, totalAssets: 0, totalDebts: 0 },
  // Oct 26 - current month with partial data (should be EXCLUDED from "last 3 months")
  { yearMonth: "2026-10", incomeTotal: 3533, expensesTotal: 0, netWorth: 0, coreExpensesTotal: 0, debtPaymentsTotal: 0, cardServicingPaymentsTotal: 0, minDebtPaymentsTotal: 0, incomeTotalAllCredits: 3533, totalAssets: 0, totalDebts: 0 },
];

const bugScenarioIncome: IncomeTxnRecord[] = [
  { txMonth: "2026-07", source: "Payroll", category: "Salary", amount: 10011, date: "2026-07-31", accountSlug: "checking", currency: "CAD", description: "Salary" },
  { txMonth: "2026-08", source: "Payroll", category: "Salary", amount: 15226, date: "2026-08-31", accountSlug: "checking", currency: "CAD", description: "Salary" },
  { txMonth: "2026-09", source: "Payroll", category: "Salary", amount: 41424, date: "2026-09-30", accountSlug: "checking", currency: "CAD", description: "Salary" },
  { txMonth: "2026-10", source: "Payroll", category: "Salary", amount: 3533, date: "2026-10-15", accountSlug: "checking", currency: "CAD", description: "Salary" },
];

try {
  const bugMetrics = computeDetailedIncomeMetrics(
    bugScenarioHistory,
    bugScenarioIncome,
    "last3",
    2026,
    true
  );

  const expectedAvg = Math.round((10011 + 15226 + 41424) / 3); // = 22,220
  const actualAvg = bugMetrics.windowAmount;

  console.log(`Expected "Last 3 months" average: CA$${expectedAvg.toLocaleString()}`);
  console.log(`Actual computed windowAmount: CA$${actualAvg.toLocaleString()}`);
  console.log(`Window months used: ${bugMetrics.windowMonths.join(", ")}`);
  console.log(`Regular sources:`, bugMetrics.regularSources.map(s => `${s.source}: $${Math.round(s.amount)}`).join(", "));
  console.log(`One-off sources:`, bugMetrics.oneOffSources.map(s => `${s.source}: $${Math.round(s.amount)}`).join(", "));
  
  // Verify calculation breakdown
  if (bugMetrics.calculation) {
    console.log(`\nCalculation breakdown:`);
    bugMetrics.calculation.monthlyAmounts.forEach(m => {
      console.log(`  ${m.month}: CA$${m.amount.toLocaleString()}`);
    });
    console.log(`  Sum: CA$${bugMetrics.calculation.sum.toLocaleString()}`);
    console.log(`  Count: ${bugMetrics.calculation.count}`);
    console.log(`  Average: CA$${Math.round(bugMetrics.calculation.sum / bugMetrics.calculation.count).toLocaleString()}`);
    console.log(`  One-off detection: ${bugMetrics.calculation.oneOffDetectionApplied ? "enabled" : "disabled"}`);
  }

  if (actualAvg === expectedAvg) {
    console.log(`\n✅ BUG FIXED: Calculation is correct!\n`);
  } else {
    console.log(`\n❌ BUG PRESENT: windowAmount should be CA$${expectedAvg.toLocaleString()}, not CA$${actualAvg.toLocaleString()}\n`);
    
    // Explain the likely root cause
    if (bugMetrics.windowMonths.includes("2026-10")) {
      console.log(`🐛 ROOT CAUSE: Current month (2026-10) is included in windowMonths.`);
      console.log(`   getMonthsForWindow() should exclude the current month for "last3" window.\n`);
    } else if (bugMetrics.oneOffSources.length > 0) {
      console.log(`🐛 ROOT CAUSE: Sep's CA$41,424 was detected as one-off (>40% above median CA$15,226).`);
      console.log(`   The entire income source was moved to oneOffSources and excluded from windowAmount.\n`);
    }
  }
} catch (err) {
  console.log(`❌ ERROR: ${err instanceof Error ? err.message : String(err)}\n`);
}

console.log("=== END BUG REPRODUCTION ===\n");

// ── Regression Test: Large LOC Paydown (Bug Fix Verification) ──────────────────

console.log("=== REGRESSION TEST: Anomaly Detection ===");
console.log("Test scenario:");
console.log("  Mortgage: regular ~CA$2,850/mo + one CA$32,000 prepayment (anomaly)");
console.log("  Car loan: regular ~CA$1,090/mo (4 payments)");
console.log("\nExpected:");
console.log("  Mortgage Fixed: ~CA$2,850 (usual payment, CA$32K flagged as anomaly)");
console.log("  Car loan Fixed: ~CA$1,090 (usual payment)\n");

try {
  // Test debt payment detection directly
  const { computeScheduledDebtPayments, getAllUnreviewedAnomalies } = require("../debtPayments");
  
  const scheduledPayments = computeScheduledDebtPayments(mockAccountSnapshots, mockExpenseTxns);
  const anomalies = getAllUnreviewedAnomalies(mockAccountSnapshots, mockExpenseTxns);
  
  console.log("Detected scheduled payments:");
  for (const payment of scheduledPayments) {
    console.log(`  ${payment.accountName}: CA$${Math.round(payment.amount)}/mo`);
    console.log(`    Method: ${payment.method}`);
    console.log(`    Anomalies: ${payment.unreviewedAnomalies?.length || 0}`);
  }
  
  console.log(`\nTotal unreviewed anomalies: ${anomalies.length}`);
  for (const anomaly of anomalies) {
    console.log(`  ${anomaly.date}: CA$${Math.round(anomaly.amount)} - ${anomaly.reason}`);
  }
  
  // Verify mortgage
  const mortgage = scheduledPayments.find(p => p.accountSlug === "td-heloc-9999");
  if (mortgage) {
    if (mortgage.amount >= 2840 && mortgage.amount <= 2860) {
      console.log(`\n✓ Mortgage: CA$${Math.round(mortgage.amount)} (correct usual payment)`);
    } else {
      console.log(`\n✗ Mortgage: CA$${Math.round(mortgage.amount)} (expected ~CA$2,850)`);
    }
    
    if (mortgage.unreviewedAnomalies && mortgage.unreviewedAnomalies.length === 1) {
      const anomaly = mortgage.unreviewedAnomalies[0];
      if (anomaly.amount >= 31000 && anomaly.amount <= 33000) {
        console.log(`✓ Anomaly detected: CA$${Math.round(anomaly.amount)} (prepayment)`);
      } else {
        console.log(`✗ Anomaly amount wrong: CA$${Math.round(anomaly.amount)}`);
      }
    } else {
      console.log(`✗ Expected 1 anomaly, found ${mortgage.unreviewedAnomalies?.length || 0}`);
    }
  } else {
    console.log("\n✗ Mortgage not found");
  }
  
  // Verify car loan
  const carLoan = scheduledPayments.find(p => p.accountSlug === "scotia-plan-1234");
  if (carLoan) {
    if (carLoan.amount >= 1085 && carLoan.amount <= 1095) {
      console.log(`\n✓ Car loan: CA$${Math.round(carLoan.amount)} (correct usual payment)`);
    } else {
      console.log(`\n✗ Car loan: CA$${Math.round(carLoan.amount)} (expected ~CA$1,090)`);
    }
    
    if (!carLoan.unreviewedAnomalies || carLoan.unreviewedAnomalies.length === 0) {
      console.log(`✓ No anomalies (all payments regular)`);
    } else {
      console.log(`✗ Unexpected anomalies: ${carLoan.unreviewedAnomalies.length}`);
    }
  } else {
    console.log("\n✗ Car loan not found");
  }

} catch (err) {
  console.log(`✗ ERROR: ${err instanceof Error ? err.message : String(err)}`);
}

console.log("\n✅ Regression test complete\n");
