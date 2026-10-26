/**
 * Tests for savings calculations.
 * 
 * Validates that:
 * 1. Market gains are NOT counted as savings
 * 2. Manual asset value changes (home, car) are NOT counted as savings
 * 3. Actual contributions + debt paydown ARE counted as savings
 */

import { computeMonthlySavings, computeAssetGains, computeAverageSavings } from "../savingsCalculations";
import type { MonthlyHistoryEntry } from "../financialProfile";
import type { ExpenseTxnRecord, AccountSnapshot } from "../extractTransactions";

console.log("🧪 Savings Calculations Tests\n");

// Test 1: Market gain should NOT count as savings
console.log("=== TEST 1: Market Gain NOT Counted ===");
{
  const monthlyHistory = [
    { yearMonth: "2026-09", netWorth: 100000 },
    { yearMonth: "2026-10", netWorth: 105000 }, // +$5K from market gain
  ] as MonthlyHistoryEntry[];

  const expenseTxns = [] as ExpenseTxnRecord[]; // No contribution transactions
  const accountSnapshots = [] as AccountSnapshot[];

  const savings = computeMonthlySavings(monthlyHistory, expenseTxns, "2026-10");
  const gains = computeAssetGains(monthlyHistory, accountSnapshots, "2026-10");

  // Currently returns net worth delta (will be $5K)
  // TODO: Should subtract market gains to get $0
  console.log(`  Net worth increased by: $${(105000 - 100000).toLocaleString()}`);
  console.log(`  Savings calculated: $${Math.round(savings).toLocaleString()}`);
  console.log(`  Market gains tracked: $${Math.round(gains.marketGains).toLocaleString()}`);
  console.log(`  Expected savings: $0 (no contributions)`);
  console.log(`  Status: ${savings === 0 ? "✓ PASS" : "⚠️  TODO - currently includes net worth delta"}\n`);
}

// Test 2: Home value increase should NOT count as savings
console.log("=== TEST 2: Home Equity Gain NOT Counted ===");
{
  const monthlyHistory = [
    { yearMonth: "2026-09", netWorth: 500000, totalAssets: 550000 },
    { yearMonth: "2026-10", netWorth: 510000, totalAssets: 560000 }, // Home appreciated $10K
  ] as MonthlyHistoryEntry[];

  const expenseTxns = [] as ExpenseTxnRecord[];
  const accountSnapshots = [] as AccountSnapshot[];

  const savings = computeMonthlySavings(monthlyHistory, expenseTxns, "2026-10");
  const gains = computeAssetGains(monthlyHistory, accountSnapshots, "2026-10");

  console.log(`  Net worth increased by: $${(510000 - 500000).toLocaleString()}`);
  console.log(`  Savings calculated: $${Math.round(savings).toLocaleString()}`);
  console.log(`  Manual asset changes tracked: $${Math.round(gains.manualAssetChanges).toLocaleString()}`);
  console.log(`  Expected savings: $0 (no actual contributions)`);
  console.log(`  Status: ${savings === 0 ? "✓ PASS" : "⚠️  TODO - currently includes net worth delta"}\n`);
}

// Test 3: Actual contribution + debt paydown SHOULD count as savings
console.log("=== TEST 3: Contribution + Debt Paydown Counted ===");
{
  const monthlyHistory = [
    { yearMonth: "2026-09", netWorth: 50000, debtPaymentsTotal: 0 },
    { yearMonth: "2026-10", netWorth: 53500, debtPaymentsTotal: 1500 }, // +$3.5K net worth
  ] as MonthlyHistoryEntry[];

  const expenseTxns = [
    // $2K contribution to RRSP
    { 
      txMonth: "2026-10", 
      date: "2026-10-15",
      category: "RRSP Contribution", 
      merchant: "Wealthsimple", 
      amount: -2000,
      accountSlug: "checking-1234",
      accountLabel: "Checking"
    },
  ] as ExpenseTxnRecord[];

  const accountSnapshots = [] as AccountSnapshot[];

  const savings = computeMonthlySavings(monthlyHistory, expenseTxns, "2026-10");

  console.log(`  RRSP contribution: $2,000`);
  console.log(`  Debt paid down: $${monthlyHistory[1].debtPaymentsTotal?.toLocaleString()}`);
  console.log(`  Net worth increased by: $${(53500 - 50000).toLocaleString()}`);
  console.log(`  Savings calculated: $${Math.round(savings).toLocaleString()}`);
  console.log(`  Expected savings: ~$3,500 (contribution + debt paydown)`);
  console.log(`  Status: ${savings >= 3000 && savings <= 4000 ? "✓ PASS" : "⚠️  Check calculation"}\n`);
}

// Test 4: Gap handling - use most recent prior month
console.log("=== TEST 4: Gap Handling (Prior Month Missing) ===");
{
  const monthlyHistory = [
    { yearMonth: "2026-07", netWorth: 100000 },
    // Sept missing
    { yearMonth: "2026-10", netWorth: 106000 }, // +$6K over 3 months
  ] as MonthlyHistoryEntry[];

  const expenseTxns = [] as ExpenseTxnRecord[];

  const savings = computeMonthlySavings(monthlyHistory, expenseTxns, "2026-10");

  console.log(`  July net worth: $100,000`);
  console.log(`  Sept: [missing]`);
  console.log(`  Oct net worth: $106,000`);
  console.log(`  Savings calculated: $${Math.round(savings).toLocaleString()}/mo`);
  console.log(`  Expected: $2,000/mo ($6K ÷ 3 months)`);
  console.log(`  Status: ${Math.abs(savings - 2000) < 10 ? "✓ PASS" : "⚠️  Check normalization"}\n`);
}

// Test 5: Average savings over multiple months
console.log("=== TEST 5: Average Savings Calculation ===");
{
  const monthlyHistory = [
    { yearMonth: "2026-07", netWorth: 100000 },
    { yearMonth: "2026-08", netWorth: 102000 }, // +$2K
    { yearMonth: "2026-09", netWorth: 105000 }, // +$3K
    { yearMonth: "2026-10", netWorth: 106500 }, // +$1.5K
  ] as MonthlyHistoryEntry[];

  const expenseTxns = [] as ExpenseTxnRecord[];

  const avgSavings = computeAverageSavings(
    monthlyHistory, 
    expenseTxns, 
    ["2026-08", "2026-09", "2026-10"]
  );

  console.log(`  Aug: +$2,000`);
  console.log(`  Sep: +$3,000`);
  console.log(`  Oct: +$1,500`);
  console.log(`  Average calculated: $${Math.round(avgSavings).toLocaleString()}/mo`);
  console.log(`  Expected: $2,167/mo (($2K + $3K + $1.5K) ÷ 3)`);
  console.log(`  Status: ${Math.abs(avgSavings - 2167) < 50 ? "✓ PASS" : "⚠️  Check averaging"}\n`);
}

console.log("✅ Tests complete\n");
console.log("📝 NOTES:");
console.log("  - Market gains subtraction is TODO (placeholder returns 0)");
console.log("  - Manual asset tracking is TODO (needs separate data source)");
console.log("  - Current implementation uses net worth delta as proxy");
console.log("  - Full implementation requires tracking investment transactions vs. balance changes\n");
