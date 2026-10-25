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
  { yearMonth: "2026-01", incomeTotal: 8500, expensesTotal: 6200, netWorth: 15000 },
  { yearMonth: "2026-02", incomeTotal: 8500, expensesTotal: 6800, netWorth: 16700 },
  { yearMonth: "2026-03", incomeTotal: 8500, expensesTotal: 6500, netWorth: 18400 },
  { yearMonth: "2026-04", incomeTotal: 9000, expensesTotal: 6400, netWorth: 21000 },
  { yearMonth: "2026-05", incomeTotal: 9000, expensesTotal: 7000, netWorth: 23000 },
  { yearMonth: "2026-06", incomeTotal: 9000, expensesTotal: 6900, netWorth: 25100 },
  { yearMonth: "2026-07", incomeTotal: 9000, expensesTotal: 7200, netWorth: 26900 },
  { yearMonth: "2026-08", incomeTotal: 9200, expensesTotal: 6800, netWorth: 29300 },
  { yearMonth: "2026-09", incomeTotal: 9200, expensesTotal: 7100, netWorth: 31400 },
  { yearMonth: "2026-10", incomeTotal: 9200, expensesTotal: 7000, netWorth: 33600 },
];

const mockIncomeTxns: IncomeTxnRecord[] = [
  { txMonth: "2026-08", source: "Acme Corp", category: "Salary", amount: 9200 },
  { txMonth: "2026-09", source: "Acme Corp", category: "Salary", amount: 9200 },
  { txMonth: "2026-10", source: "Acme Corp", category: "Salary", amount: 9200 },
];

const mockExpenseTxns: ExpenseTxnRecord[] = [
  { txMonth: "2026-10", category: "Groceries", merchant: "Whole Foods", amount: -450, accountSlug: "checking-1234" },
  { txMonth: "2026-10", category: "Dining", merchant: "Chipotle", amount: -35, accountSlug: "checking-1234" },
  { txMonth: "2026-10", category: "Housing", merchant: "Landlord", amount: -2000, accountSlug: "checking-1234" },
  { txMonth: "2026-10", category: "Transportation", merchant: "Gas Station", amount: -120, accountSlug: "checking-1234" },
  { txMonth: "2026-10", category: "Subscriptions", merchant: "Netflix", amount: -15, accountSlug: "credit-5678" },
  { txMonth: "2026-09", category: "Groceries", merchant: "Safeway", amount: -480, accountSlug: "checking-1234" },
  { txMonth: "2026-09", category: "Dining", merchant: "Starbucks", amount: -25, accountSlug: "credit-5678" },
  { txMonth: "2026-08", category: "Groceries", merchant: "Trader Joes", amount: -420, accountSlug: "checking-1234" },
];

const mockAccountSnapshots: AccountSnapshot[] = [
  {
    accountSlug: "credit-5678",
    accountLabel: "Chase Visa",
    accountType: "credit",
    balance: -1500,
    limit: 10000,
    paymentsMade: 1200,
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
  { txMonth: "2026-07", source: "Payroll", category: "Salary", amount: 10011, date: "2026-07-31", accountSlug: "checking", currency: "CAD" },
  { txMonth: "2026-08", source: "Payroll", category: "Salary", amount: 15226, date: "2026-08-31", accountSlug: "checking", currency: "CAD" },
  { txMonth: "2026-09", source: "Payroll", category: "Salary", amount: 41424, date: "2026-09-30", accountSlug: "checking", currency: "CAD" },
  { txMonth: "2026-10", source: "Payroll", category: "Salary", amount: 3533, date: "2026-10-15", accountSlug: "checking", currency: "CAD" },
];

try {
  const bugMetrics = computeDetailedIncomeMetrics(
    bugScenarioHistory,
    bugScenarioIncome,
    "last3",
    2026,
    true,
    "2026-10" // Current month - should be excluded from last3
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
