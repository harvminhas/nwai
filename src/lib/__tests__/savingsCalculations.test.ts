/**
 * Tests for savings calculations (NET balance approach).
 * 
 * Validates that:
 * 1. Market gains are NOT counted as savings
 * 2. Manual asset value changes (home, car) are NOT counted as savings
 * 3. Actual savings uses NET approach (cash change + debt change + outside contributions)
 * 4. Debt transfers net to 0 (paying CC with FlexLine)
 * 5. Balance carry-forward works correctly
 * 6. Negative months are handled (spent more than saved)
 */

import { computeMonthlySavings, computeAssetGains, computeAverageSavings } from "../savingsCalculations";
import type { MonthlyHistoryEntry, AccountBalanceHistory } from "../financialProfile";
import type { ExpenseTxnRecord } from "../extractTransactions";

console.log("🧪 Savings Calculations Tests (NET Approach)\n");

// Test 1: Market gain should NOT count as savings
console.log("=== TEST 1: Market Gain NOT Counted ===");
{
  const monthlyHistory = [
    { yearMonth: "2026-09", netWorth: 100000 },
    { yearMonth: "2026-10", netWorth: 105000 }, // +$5K from market gain
  ] as MonthlyHistoryEntry[];

  const expenseTxns = [] as ExpenseTxnRecord[];
  
  // Investment account with market gain
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

  console.log(`  Investment account: $50,000 → $55,000 (+$5,000 market gain)`);
  console.log(`  Savings calculated: $${Math.round(result.total).toLocaleString()}`);
  console.log(`  Market gains tracked: $${Math.round(gains.marketGains).toLocaleString()}`);
  console.log(`  Expected: $0 savings (investment gains excluded)`);
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
  const accountBalanceHistory = [] as AccountBalanceHistory[];

  const result = computeMonthlySavings(monthlyHistory, accountBalanceHistory, expenseTxns, "2026-10");
  const gains = computeAssetGains(monthlyHistory, accountBalanceHistory, expenseTxns, "2026-10");

  console.log(`  Total assets: $550,000 → $560,000 (+$10,000 home equity)`);
  console.log(`  Savings calculated: $${Math.round(result.total).toLocaleString()}`);
  console.log(`  Manual asset changes: $${Math.round(gains.manualAssetChanges).toLocaleString()}`);
  console.log(`  Expected: $0 savings (home equity excluded)`);
  console.log(`  Status: ${result.total === 0 ? "✓ PASS" : `✗ FAIL - got $${result.total}, expected $0`}\n`);
}

// Test 3: NET approach - cash + debt + contributions
console.log("=== TEST 3: NET Approach (Cash + Debt + Contributions) ===");
{
  const monthlyHistory = [
    { yearMonth: "2026-09", netWorth: 50000 },
    { yearMonth: "2026-10", netWorth: 52500 },
  ] as MonthlyHistoryEntry[];

  const expenseTxns = [
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

  const accountBalanceHistory = [
    // Checking account (cash grows by $1,000)
    {
      slug: "checking-td",
      label: "TD Chequing",
      accountType: "checking",
      currency: "CAD",
      entries: [
        { yearMonth: "2026-09", balance: 5000 },
        { yearMonth: "2026-10", balance: 6000 }, // +$1,000 cash
      ],
    },
    // Credit card (debt paid down by $1,000)
    {
      slug: "credit-visa",
      label: "RBC Visa",
      accountType: "credit",
      currency: "CAD",
      entries: [
        { yearMonth: "2026-09", balance: -5000 },
        { yearMonth: "2026-10", balance: -4000 }, // -$1,000 debt
      ],
    },
  ] as AccountBalanceHistory[];

  const result = computeMonthlySavings(monthlyHistory, accountBalanceHistory, expenseTxns, "2026-10");

  console.log(`  Cash change: +$1,000`);
  console.log(`  Debt change: -$1,000 (paid down)`);
  console.log(`  Outside contributions: +$500 (RRSP)`);
  console.log(`  Total savings: $${Math.round(result.total).toLocaleString()}`);
  console.log(`  Expected: $2,500 ($1,000 + $1,000 + $500)`);
  console.log(`  Status: ${Math.abs(result.total - 2500) < 1 ? "✓ PASS" : `✗ FAIL - got $${result.total}, expected $2,500`}\n`);
}

// Test 4: Debt transfer nets to 0 (paying CC with FlexLine)
console.log("=== TEST 4: Debt Transfer Nets to Zero ===");
{
  const monthlyHistory = [
    { yearMonth: "2026-08", netWorth: 50000 },
    { yearMonth: "2026-09", netWorth: 50000 }, // No net change
  ] as MonthlyHistoryEntry[];

  const expenseTxns = [] as ExpenseTxnRecord[];

  const accountBalanceHistory = [
    // Credit card paid off with FlexLine
    {
      slug: "credit-visa",
      label: "RBC Visa",
      accountType: "credit",
      currency: "CAD",
      entries: [
        { yearMonth: "2026-08", balance: -10000 },
        { yearMonth: "2026-09", balance: 0 }, // Paid off completely
      ],
    },
    // FlexLine increased by same amount
    {
      slug: "loc-flexline",
      label: "TD FlexLine",
      accountType: "loc",
      currency: "CAD",
      entries: [
        { yearMonth: "2026-08", balance: -50000 },
        { yearMonth: "2026-09", balance: -60000 }, // Drew $10,000
      ],
    },
  ] as AccountBalanceHistory[];

  const result = computeMonthlySavings(monthlyHistory, accountBalanceHistory, expenseTxns, "2026-09");

  console.log(`  Visa: -$10,000 → $0 (paid off $10,000)`);
  console.log(`  FlexLine: -$50,000 → -$60,000 (drew $10,000)`);
  console.log(`  Net debt change: $10,000 - $10,000 = $0`);
  console.log(`  Total savings: $${Math.round(result.total).toLocaleString()}`);
  console.log(`  Expected: $0 (debt transfer nets to 0)`);
  console.log(`  Status: ${Math.abs(result.total) < 1 ? "✓ PASS" : `✗ FAIL - got $${result.total}, expected $0`}\n`);
}

// Test 5: Carried-forward balance (missing month)
console.log("=== TEST 5: Carried-Forward Balance ===");
{
  const monthlyHistory = [
    { yearMonth: "2026-07", netWorth: 50000 },
    { yearMonth: "2026-08", netWorth: 51000 },
    { yearMonth: "2026-09", netWorth: 52000 },
  ] as MonthlyHistoryEntry[];

  const expenseTxns = [] as ExpenseTxnRecord[];

  const accountBalanceHistory = [
    // Loan with missing Aug balance (should carry forward from July)
    {
      slug: "loan-auto",
      label: "Scotia Auto Loan",
      accountType: "loan",
      currency: "CAD",
      entries: [
        { yearMonth: "2026-07", balance: -20000 },
        // Aug missing - should carry forward -$20,000
        { yearMonth: "2026-09", balance: -18858 }, // Paid $1,142
      ],
    },
  ] as AccountBalanceHistory[];

  const result = computeMonthlySavings(monthlyHistory, accountBalanceHistory, expenseTxns, "2026-09");

  console.log(`  July balance: -$20,000`);
  console.log(`  Aug balance: [carried forward from July: -$20,000]`);
  console.log(`  Sep balance: -$18,858`);
  console.log(`  Debt paid: $20,000 - $18,858 = $1,142`);
  console.log(`  Total savings: $${Math.round(result.total).toLocaleString()}`);
  console.log(`  Expected: $1,142 (with carry-forward)`);
  console.log(`  Status: ${Math.abs(result.total - 1142) < 1 ? "✓ PASS" : `✗ FAIL - got $${result.total}, expected $1,142`}\n`);
  console.log(`  Carried forward flag: ${result.details.debtAccounts[0]?.priorCarriedForward ? "✓" : "✗"}\n`);
}

// Test 6: Negative month (spent more than saved)
console.log("=== TEST 6: Negative Month ===");
{
  const monthlyHistory = [
    { yearMonth: "2026-08", netWorth: 50000 },
    { yearMonth: "2026-09", netWorth: 46000 }, // Lost $4,000
  ] as MonthlyHistoryEntry[];

  const expenseTxns = [] as ExpenseTxnRecord[];

  const accountBalanceHistory = [
    // Checking account depleted
    {
      slug: "checking-td",
      label: "TD Chequing",
      accountType: "checking",
      currency: "CAD",
      entries: [
        { yearMonth: "2026-08", balance: 10000 },
        { yearMonth: "2026-09", balance: 5000 }, // Spent $5,000
      ],
    },
    // Credit card paid down slightly
    {
      slug: "credit-visa",
      label: "RBC Visa",
      accountType: "credit",
      currency: "CAD",
      entries: [
        { yearMonth: "2026-08", balance: -5000 },
        { yearMonth: "2026-09", balance: -4000 }, // Paid $1,000
      ],
    },
  ] as AccountBalanceHistory[];

  const result = computeMonthlySavings(monthlyHistory, accountBalanceHistory, expenseTxns, "2026-09");

  console.log(`  Cash change: -$5,000 (spent down checking)`);
  console.log(`  Debt change: +$1,000 (paid down CC)`);
  console.log(`  Net: -$5,000 + $1,000 = -$4,000`);
  console.log(`  Total savings: $${Math.round(result.total).toLocaleString()}`);
  console.log(`  Expected: -$4,000 (negative month)`);
  console.log(`  Status: ${Math.abs(result.total - (-4000)) < 1 ? "✓ PASS" : `✗ FAIL - got $${result.total}, expected -$4,000`}\n`);
}

// Test 7: Gap handling with normalization
console.log("=== TEST 7: Gap Handling (Normalized) ===");
{
  const monthlyHistory = [
    { yearMonth: "2026-07", netWorth: 100000 },
    // Aug and Sept missing
    { yearMonth: "2026-10", netWorth: 106000 }, // +$6K over 3 months
  ] as MonthlyHistoryEntry[];

  const expenseTxns = [
    { 
      txMonth: "2026-10", 
      date: "2026-10-15",
      category: "CA: RRSP",
      merchant: "Wealthsimple",
      amount: -1500, // $1,500 contribution in Oct
      accountSlug: "checking",
      accountLabel: "Checking"
    },
  ] as ExpenseTxnRecord[];

  const accountBalanceHistory = [
    {
      slug: "credit-visa",
      label: "Visa",
      accountType: "credit",
      currency: "CAD",
      entries: [
        { yearMonth: "2026-07", balance: -10000 },
        { yearMonth: "2026-10", balance: -5500 }, // Paid $4,500 over 3 months
      ],
    },
  ] as AccountBalanceHistory[];

  const result = computeMonthlySavings(monthlyHistory, accountBalanceHistory, expenseTxns, "2026-10");

  console.log(`  July debt: -$10,000`);
  console.log(`  Aug-Sept: [missing]`);
  console.log(`  Oct debt: -$5,500 → $4,500 paid over 3 months`);
  console.log(`  Oct contribution: $1,500`);
  console.log(`  Total over 3 months: $4,500 + $1,500 = $6,000`);
  console.log(`  Normalized per month: $6,000 ÷ 3 = $2,000/mo`);
  console.log(`  Savings calculated: $${Math.round(result.total).toLocaleString()}/mo`);
  console.log(`  Expected: $2,000/mo`);
  console.log(`  Status: ${Math.abs(result.total - 2000) < 1 ? "✓ PASS" : `✗ FAIL - got $${result.total}/mo, expected $2,000/mo`}\n`);
}

console.log("✅ Tests complete\n");
console.log("📝 KEY PRINCIPLES:");
console.log("  - Savings = NET change: (cash up) + (debt down) + (outside contributions)");
console.log("  - Debt transfers net to 0 (e.g., paying CC with FlexLine)");
console.log("  - Can be negative (spent more than saved)");
console.log("  - Balances carry forward if missing");
console.log("  - Uses accountBalanceHistory (existing data source)");
console.log("  - Investment gains and home equity excluded\n");
