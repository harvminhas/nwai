/**
 * Tests for savings calculations.
 * 
 * Validates that:
 * 1. Market gains are NOT counted as savings
 * 2. Manual asset value changes (home, car) are NOT counted as savings
 * 3. Actual contributions + debt paydown ARE counted as savings
 * 4. Balance-based debt principal calculation works correctly
 * 5. Balance-based cash growth calculation works correctly
 */

import { computeMonthlySavings, computeAssetGains, computeAverageSavings } from "../savingsCalculations";
import type { MonthlyHistoryEntry, AccountBalanceHistory } from "../financialProfile";
import type { ExpenseTxnRecord } from "../extractTransactions";

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
  const accountBalanceHistory = [
    { 
      slug: "investment-tfsa",
      label: "TFSA Investment",
      accountType: "investment",
      currency: "CAD",
      entries: [
        { yearMonth: "2026-09", balance: 50000 },
        { yearMonth: "2026-10", balance: 55000 }, // +$5K market gain
      ],
    },
  ] as AccountBalanceHistory[];

  const result = computeMonthlySavings(monthlyHistory, accountBalanceHistory, expenseTxns, "2026-10");
  const gains = computeAssetGains(monthlyHistory, accountBalanceHistory, expenseTxns, "2026-10");

  console.log(`  Net worth increased by: $${(105000 - 100000).toLocaleString()}`);
  console.log(`  Investment account increased by: $5,000 (market gain)`);
  console.log(`  Contributions: $0`);
  console.log(`  Savings calculated: $${Math.round(result.total).toLocaleString()}`);
  console.log(`  Market gains tracked: $${Math.round(gains.marketGains).toLocaleString()}`);
  console.log(`  Expected savings: $0 (no contributions)`);
  console.log(`  Status: ${result.total === 0 ? "✓ PASS" : `✗ FAIL - got $${result.total}, expected $0`}\n`);
}

// Test 2: Home value increase should NOT count as savings
console.log("=== TEST 2: Home Equity Gain NOT Counted ===");
{
  const monthlyHistory = [
    { yearMonth: "2026-09", netWorth: 500000, totalAssets: 550000 },
    { yearMonth: "2026-10", netWorth: 510000, totalAssets: 560000 }, // Home appreciated $10K
  ] as MonthlyHistoryEntry[];

  const expenseTxns = [] as ExpenseTxnRecord[];
  
  // No account snapshots (manual asset like house isn't in accountBalanceHistory)
  const accountBalanceHistory = [] as AccountBalanceHistory[];

  const result = computeMonthlySavings(monthlyHistory, accountBalanceHistory, expenseTxns, "2026-10");
  const gains = computeAssetGains(monthlyHistory, accountBalanceHistory, expenseTxns, "2026-10");

  console.log(`  Net worth increased by: $${(510000 - 500000).toLocaleString()}`);
  console.log(`  Total assets increased by: $${(560000 - 550000).toLocaleString()}`);
  console.log(`  Savings calculated: $${Math.round(result.total).toLocaleString()}`);
  console.log(`  Manual asset changes tracked: $${Math.round(gains.manualAssetChanges).toLocaleString()}`);
  console.log(`  Expected savings: $0 (no actual contributions)`);
  console.log(`  Status: ${result.total === 0 ? "✓ PASS" : `✗ FAIL - got $${result.total}, expected $0`}\n`);
}

// Test 3: Actual contribution + debt paydown SHOULD count as savings (balance-based)
console.log("=== TEST 3: Contribution + Debt Paydown Counted (Balance-Based) ===");
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

  // Credit card debt paid down $1,500 (from balance history)
  const accountBalanceHistory = [
    {
      slug: "credit-visa",
      label: "RBC Visa",
      accountType: "credit",
      currency: "CAD",
      entries: [
        { yearMonth: "2026-09", balance: -5000 },
        { yearMonth: "2026-10", balance: -3500 }, // Paid down $1,500
      ],
    },
  ] as AccountBalanceHistory[];

  const result = computeMonthlySavings(monthlyHistory, accountBalanceHistory, expenseTxns, "2026-10");

  console.log(`  RRSP contribution: $2,000`);
  console.log(`  Debt paid down (balance-based): $1,500`);
  console.log(`  Net worth increased by: $${(53500 - 50000).toLocaleString()}`);
  console.log(`  Savings calculated: $${Math.round(result.total).toLocaleString()}`);
  console.log(`  Components: contributions=$${Math.round(result.contributions)}, debt=$${Math.round(result.debtPrincipal)}, cash=$${Math.round(result.cashGrowth)}`);
  console.log(`  Expected savings: $3,500 (contribution + debt paydown)`);
  console.log(`  Status: ${Math.abs(result.total - 3500) < 50 ? "✓ PASS" : `⚠️  FAIL - got $${result.total}, expected $3,500`}\n`);
}

// Test 4: Balance-based debt principal paid (car loan + FlexLine)
console.log("=== TEST 4: Balance-Based Debt Principal (Multiple Accounts) ===");
{
  const monthlyHistory = [
    { yearMonth: "2026-06", netWorth: 50000 },
    { yearMonth: "2026-07", netWorth: 54442 }, // +$4,442
  ] as MonthlyHistoryEntry[];

  const expenseTxns = [] as ExpenseTxnRecord[];

  // Scotia car loan + TD FlexLine balances
  const accountBalanceHistory = [
    {
      slug: "loan-scotia-auto",
      label: "Scotia Auto Loan",
      accountType: "loan",
      currency: "CAD",
      entries: [
        { yearMonth: "2026-06", balance: -25000 },
        { yearMonth: "2026-07", balance: -23858 }, // Paid $1,142
      ],
    },
    {
      slug: "loc-td-flexline",
      label: "TD Home Equity FlexLine",
      accountType: "loc",
      currency: "CAD",
      entries: [
        { yearMonth: "2026-06", balance: -80000 },
        { yearMonth: "2026-07", balance: -76700 }, // Paid $3,300
      ],
    },
  ] as AccountBalanceHistory[];

  const result = computeMonthlySavings(monthlyHistory, accountBalanceHistory, expenseTxns, "2026-07");

  console.log(`  Scotia Auto Loan: -$25,000 → -$23,858 = $1,142 paid`);
  console.log(`  TD FlexLine: -$80,000 → -$76,700 = $3,300 paid`);
  console.log(`  Total debt principal paid: $4,442`);
  console.log(`  Savings calculated: $${Math.round(result.total).toLocaleString()}`);
  console.log(`  Debt detail: ${result.details.debtPrincipal.map(d => `${d.accountLabel}=$${Math.round(d.reduction)}`).join(", ")}`);
  console.log(`  Expected savings: $4,442 (debt principal only)`);
  console.log(`  Status: ${Math.abs(result.total - 4442) < 1 ? "✓ PASS" : `⚠️  FAIL - got $${result.total}, expected $4,442`}\n`);
}

// Test 5: Balance-based cash growth in checking/savings
console.log("=== TEST 5: Balance-Based Cash Growth ===");
{
  const monthlyHistory = [
    { yearMonth: "2026-08", netWorth: 50000 },
    { yearMonth: "2026-09", netWorth: 52000 }, // +$2K
  ] as MonthlyHistoryEntry[];

  const expenseTxns = [] as ExpenseTxnRecord[];

  // Checking account with cash growth
  const accountBalanceHistory = [
    {
      slug: "checking-td-chequing",
      label: "TD Chequing",
      accountType: "checking",
      currency: "CAD",
      entries: [
        { yearMonth: "2026-08", balance: 5000 },
        { yearMonth: "2026-09", balance: 7000 }, // +$2,000 cash growth
      ],
    },
  ] as AccountBalanceHistory[];

  const result = computeMonthlySavings(monthlyHistory, accountBalanceHistory, expenseTxns, "2026-09");

  console.log(`  TD Chequing: $5,000 → $7,000 = $2,000 cash growth`);
  console.log(`  Savings calculated: $${Math.round(result.total).toLocaleString()}`);
  console.log(`  Cash detail: ${result.details.cashGrowth.map(d => `${d.accountLabel}=$${Math.round(d.growth)}`).join(", ")}`);
  console.log(`  Expected savings: $2,000 (cash growth only)`);
  console.log(`  Status: ${Math.abs(result.total - 2000) < 1 ? "✓ PASS" : `⚠️  FAIL - got $${result.total}, expected $2,000`}\n`);
}

// Test 6: Gap handling - use most recent prior month
console.log("=== TEST 6: Gap Handling (Prior Month Missing) ===");
{
  const monthlyHistory = [
    { yearMonth: "2026-07", netWorth: 100000 },
    // Aug and Sept missing
    { yearMonth: "2026-10", netWorth: 106000 }, // +$6K over 3 months
  ] as MonthlyHistoryEntry[];

  const expenseTxns = [
    // $500 contribution in Oct only
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

  // Debt paid down $4,500 over 3 months (normalized to $1,500/mo)
  const accountBalanceHistory = [
    {
      slug: "credit-visa",
      label: "Visa",
      accountType: "credit",
      currency: "CAD",
      entries: [
        { yearMonth: "2026-07", balance: -10000 },
        { yearMonth: "2026-10", balance: -5500 }, // Paid down $4,500
      ],
    },
  ] as AccountBalanceHistory[];

  const result = computeMonthlySavings(monthlyHistory, accountBalanceHistory, expenseTxns, "2026-10");

  console.log(`  July balance: -$10,000`);
  console.log(`  Aug-Sept: [missing]`);
  console.log(`  Oct balance: -$5,500 → $4,500 paid over 3 months`);
  console.log(`  Contributions: $500 (Oct only)`);
  console.log(`  Savings calculated: $${Math.round(result.total).toLocaleString()}/mo`);
  console.log(`  Expected: ~$1,667/mo ($500 contribution + $4,500 debt ÷ 3 months)`);
  console.log(`  Status: ${Math.abs(result.total - 1667) < 100 ? "✓ PASS" : `⚠️  Got $${Math.round(result.total)}/mo, expected ~$1,667/mo`}\n`);
}

// Test 7: Average savings calculation
console.log("=== TEST 7: Average Savings Calculation ===");
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

  const accountBalanceHistory = [
    // Debt paid down varying amounts each month
    { 
      slug: "credit-visa", 
      label: "Visa",
      accountType: "credit",
      currency: "CAD",
      entries: [
        { yearMonth: "2026-07", balance: -10000 },
        { yearMonth: "2026-08", balance: -9000 }, // -$1K
        { yearMonth: "2026-09", balance: -7500 }, // -$1.5K
        { yearMonth: "2026-10", balance: -6800 }, // -$700
      ],
    },
  ] as AccountBalanceHistory[];

  const avgSavings = computeAverageSavings(
    monthlyHistory, 
    accountBalanceHistory,
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
console.log("  - Uses accountBalanceHistory (existing data source for balances)");
console.log("  - Investment account balance changes are NOT counted (only transactions)");
console.log("  - Manual asset value changes (home, car) are NOT counted");
console.log("  - Market gains are tracked separately in computeAssetGains()");
console.log("  - Gap handling: uses most recent prior month, normalizes by elapsed months\n");
