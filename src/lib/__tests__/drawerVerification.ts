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
