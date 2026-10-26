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
  
  // Investment account with market gain, no contributions
  const accountSnapshots = [
    { 
      slug: "investment-tfsa",
      accountType: "investment",
      balance: 50000,
      statementMonth: "2026-09"
    },
    { 
      slug: "investment-tfsa",
      accountType: "investment",
      balance: 55000, // +$5K market gain
      statementMonth: "2026-10"
    },
  ] as AccountSnapshot[];

  const savings = computeMonthlySavings(monthlyHistory, accountSnapshots, expenseTxns, "2026-10");
  const gains = computeAssetGains(monthlyHistory, accountSnapshots, expenseTxns, "2026-10");

  console.log(`  Net worth increased by: $${(105000 - 100000).toLocaleString()}`);
  console.log(`  Investment account increased by: $5,000 (market gain)`);
  console.log(`  Contributions: $0`);
  console.log(`  Savings calculated: $${Math.round(savings).toLocaleString()}`);
  console.log(`  Market gains tracked: $${Math.round(gains.marketGains).toLocaleString()}`);
  console.log(`  Expected savings: $0 (no contributions)`);
  console.log(`  Status: ${savings === 0 ? "✓ PASS" : `✗ FAIL - got $${savings}, expected $0`}\n`);
}

// Test 2: Home value increase should NOT count as savings
console.log("=== TEST 2: Home Equity Gain NOT Counted ===");
{
  const monthlyHistory = [
    { yearMonth: "2026-09", netWorth: 500000, totalAssets: 550000 },
    { yearMonth: "2026-10", netWorth: 510000, totalAssets: 560000 }, // Home appreciated $10K
  ] as MonthlyHistoryEntry[];

  const expenseTxns = [] as ExpenseTxnRecord[];
  
  // No account snapshots (manual asset like house isn't in accountSnapshots)
  const accountSnapshots = [] as AccountSnapshot[];

  const savings = computeMonthlySavings(monthlyHistory, accountSnapshots, expenseTxns, "2026-10");
  const gains = computeAssetGains(monthlyHistory, accountSnapshots, expenseTxns, "2026-10");

  console.log(`  Net worth increased by: $${(510000 - 500000).toLocaleString()}`);
  console.log(`  Total assets increased by: $${(560000 - 550000).toLocaleString()}`);
  console.log(`  Savings calculated: $${Math.round(savings).toLocaleString()}`);
  console.log(`  Manual asset changes tracked: $${Math.round(gains.manualAssetChanges).toLocaleString()}`);
  console.log(`  Expected savings: $0 (no actual contributions)`);
  console.log(`  Status: ${savings === 0 ? "✓ PASS" : `✗ FAIL - got $${savings}, expected $0`}\n`);
}

// Test 3: Actual contribution + debt paydown SHOULD count as savings
console.log("=== TEST 3: Contribution + Debt Paydown Counted ===");
{
  const monthlyHistory = [
    { yearMonth: "2026-09", netWorth: 50000, debtPaymentsTotal: 0 },
    { yearMonth: "2026-10", netWorth: 53500, debtPaymentsTotal: 1500 }, // +$3.5K net worth
  ] as MonthlyHistoryEntry[];

  const expenseTxns = [
    // $2K contribution to RRSP (using canonical category name)
    { 
      txMonth: "2026-10", 
      date: "2026-10-15",
      category: "CA: RRSP", // Canonical category that maps to "Investments & Savings"
      merchant: "Wealthsimple", 
      amount: -2000,
      accountSlug: "checking-1234",
      accountLabel: "Checking"
    },
  ] as ExpenseTxnRecord[];

  // Credit card debt paid down $1,500
  const accountSnapshots = [
    {
      slug: "credit-visa",
      accountType: "credit",
      balance: -5000,
      statementMonth: "2026-09"
    },
    {
      slug: "credit-visa",
      accountType: "credit",
      balance: -3500, // Paid down $1,500
      statementMonth: "2026-10"
    },
  ] as AccountSnapshot[];

  const savings = computeMonthlySavings(monthlyHistory, accountSnapshots, expenseTxns, "2026-10");

  console.log(`  RRSP contribution: $2,000`);
  console.log(`  Debt paid down: $1,500`);
  console.log(`  Net worth increased by: $${(53500 - 50000).toLocaleString()}`);
  console.log(`  Savings calculated: $${Math.round(savings).toLocaleString()}`);
  console.log(`  Expected savings: $3,500 (contribution + debt paydown)`);
  console.log(`  Status: ${Math.abs(savings - 3500) < 50 ? "✓ PASS" : `⚠️  FAIL - got $${savings}, expected $3,500`}\n`);
}

// Test 4: Gap handling - use most recent prior month
console.log("=== TEST 4: Gap Handling (Prior Month Missing) ===");
{
  const monthlyHistory = [
    { yearMonth: "2026-07", netWorth: 100000 },
    // Aug and Sept missing
    { yearMonth: "2026-10", netWorth: 106000 }, // +$6K over 3 months
  ] as MonthlyHistoryEntry[];

  const expenseTxns = [
    // $500 contribution in Oct only (others were before the baseline month)
    { 
      txMonth: "2026-10", 
      date: "2026-10-15",
      category: "CA: RRSP", 
      merchant: "Wealthsimple",
      amount: -500, 
      accountSlug: "checking",
      accountLabel: "Checking"
    },
  ] as ExpenseTxnRecord[];

  // Debt paid down $4,500 over 3 months
  const accountSnapshots = [
    {
      slug: "credit-visa",
      accountType: "credit",
      balance: -10000,
      statementMonth: "2026-07"
    },
    {
      slug: "credit-visa",
      accountType: "credit",
      balance: -5500, // Paid down $4,500 over 3 months
      statementMonth: "2026-10"
    },
  ] as AccountSnapshot[];

  const savings = computeMonthlySavings(monthlyHistory, accountSnapshots, expenseTxns, "2026-10");

  console.log(`  July net worth: $100,000`);
  console.log(`  Aug-Sept: [missing]`);
  console.log(`  Oct net worth: $106,000 (+$6K over 3 months)`);
  console.log(`  Contributions: $500 (only Oct counted, others before baseline)`);
  console.log(`  Debt paid: $4,500 (÷ 3 months = $1,500/mo)`);
  console.log(`  Savings calculated: $${Math.round(savings).toLocaleString()}/mo`);
  console.log(`  Expected: ~$1,667/mo ($500 contribution + $4,500 debt ÷ 3 months)`);
  console.log(`  Status: ${Math.abs(savings - 1667) < 100 ? "✓ PASS" : `⚠️  Got $${Math.round(savings)}/mo, expected ~$1,667/mo`}\n`);
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

  const expenseTxns = [
    { 
      txMonth: "2026-08", 
      date: "2026-08-15",
      category: "CA: RRSP", 
      merchant: "Wealthsimple",
      amount: -1000, 
      accountSlug: "checking",
      accountLabel: "Checking"
    },
    { 
      txMonth: "2026-09", 
      date: "2026-09-15",
      category: "CA: TFSA", 
      merchant: "Wealthsimple",
      amount: -1500, 
      accountSlug: "checking",
      accountLabel: "Checking"
    },
    { 
      txMonth: "2026-10", 
      date: "2026-10-15",
      category: "Investment", 
      merchant: "Questrade",
      amount: -800, 
      accountSlug: "checking",
      accountLabel: "Checking"
    },
  ] as ExpenseTxnRecord[];

  const accountSnapshots = [
    // Debt paid down varying amounts each month
    { slug: "credit-visa", accountType: "credit", balance: -10000, statementMonth: "2026-07" },
    { slug: "credit-visa", accountType: "credit", balance: -9000, statementMonth: "2026-08" }, // -$1K
    { slug: "credit-visa", accountType: "credit", balance: -7500, statementMonth: "2026-09" }, // -$1.5K
    { slug: "credit-visa", accountType: "credit", balance: -6800, statementMonth: "2026-10" }, // -$700
  ] as AccountSnapshot[];

  const avgSavings = computeAverageSavings(
    monthlyHistory, 
    accountSnapshots,
    expenseTxns, 
    ["2026-08", "2026-09", "2026-10"]
  );

  console.log(`  Aug: $1,000 contribution + $1,000 debt = $2,000`);
  console.log(`  Sep: $1,500 contribution + $1,500 debt = $3,000`);
  console.log(`  Oct: $800 contribution + $700 debt = $1,500`);
  console.log(`  Average calculated: $${Math.round(avgSavings).toLocaleString()}/mo`);
  console.log(`  Expected: $2,167/mo (($2K + $3K + $1.5K) ÷ 3)`);
  console.log(`  Status: ${Math.abs(avgSavings - 2167) < 50 ? "✓ PASS" : `⚠️  Got $${Math.round(avgSavings)}/mo, expected $2,167/mo`}\n`);
}

console.log("✅ Tests complete\n");
console.log("📝 KEY PRINCIPLES:");
console.log("  - Savings = contributions + cash growth + debt paydown ONLY");
console.log("  - Investment account balance changes are NOT counted (only transactions)");
console.log("  - Manual asset value changes (home, car) are NOT counted");
console.log("  - Market gains are tracked separately in computeAssetGains()");
console.log("  - Gap handling: uses most recent prior month, normalizes by elapsed months\n");
