/**
 * Test that savings confirmations affect the computed savings figure.
 * 
 * Verifies that:
 * 1. Ambiguous savings items generate confirmation requests
 * 2. Confirming as "is_savings" includes the amount
 * 3. Confirming as "not_savings" excludes the amount
 * 4. The total savings figure changes accordingly
 */

import { computeMonthlySavings, computeAverageSavings } from "../savingsCalculations";
import type { MonthlyHistoryEntry, AccountBalanceHistory, ExpenseTxnRecord } from "../types";

console.log("🧪 Savings Confirmation Test\n");

// Mock data with an ambiguous life insurance transaction
const monthlyHistory: MonthlyHistoryEntry[] = [
  { 
    yearMonth: "2026-07", 
    incomeTotal: 5000, 
    expensesTotal: 0, 
    coreExpensesTotal: 0, 
    debtPaymentsTotal: 0,
    cardServicingPaymentsTotal: 0,
    minDebtPaymentsTotal: 0,
    incomeTotalAllCredits: 5000, 
    netWorth: 10000, 
    totalAssets: 10000, 
    totalDebts: 0 
  },
  { 
    yearMonth: "2026-08", 
    incomeTotal: 5000, 
    expensesTotal: 0, 
    coreExpensesTotal: 0, 
    debtPaymentsTotal: 0,
    cardServicingPaymentsTotal: 0,
    minDebtPaymentsTotal: 0,
    incomeTotalAllCredits: 5000, 
    netWorth: 11000, 
    totalAssets: 11000, 
    totalDebts: 0 
  },
];

const accountBalanceHistory: AccountBalanceHistory[] = [
  {
    slug: "checking-td",
    label: "TD Chequing (...1234)",
    accountType: "checking",
    currency: "CAD",
    entries: [
      { yearMonth: "2026-07", balance: 10000 },
      { yearMonth: "2026-08", balance: 10500 }, // +$500 cash (income $5,000 - expenses)
    ],
  },
];

const expenseTxns: ExpenseTxnRecord[] = [
  {
    date: "2026-08-15",
    txMonth: "2026-08",
    amount: -157,
    merchant: "IND ALL LIFE IN INS",
    category: "Investments & Savings",
    accountSlug: "checking-td",
    accountLabel: "TD Chequing (...1234)",
  },
];

console.log("=== TEST 1: Ambiguous transaction generates confirmation ===\n");

// Compute savings without confirmations
const result1 = computeMonthlySavings(
  monthlyHistory,
  accountBalanceHistory,
  expenseTxns,
  "2026-08"
);

console.log(`📋 Confirmation items: ${result1.needsConfirmation.length}`);
if (result1.needsConfirmation.length > 0) {
  const item = result1.needsConfirmation[0];
  console.log(`   • Merchant: ${item.merchant}`);
  console.log(`   • Amount: CA$${item.amount}`);
  console.log(`   • Account: ${item.accountName}`);
  console.log(`   • Category: ${item.category}`);
  console.log(`   • ID: ${item.id}`);
}

console.log(`\n💰 Savings without confirmation:`);
console.log(`   Total: CA$${Math.round(result1.total)}`);
console.log(`   Cash change: CA$${Math.round(result1.netCashChange)}`);
console.log(`   Debt change: CA$${Math.round(result1.netDebtChange)}`);
console.log(`   Outside contributions: CA$${Math.round(result1.contributionsToOutside)}`);

const hasConfirmation = result1.needsConfirmation.length === 1;
const itemIsValid = hasConfirmation && 
  result1.needsConfirmation[0].merchant === "IND ALL LIFE IN INS" &&
  result1.needsConfirmation[0].amount === 157 &&
  result1.needsConfirmation[0].accountName === "TD Chequing (...1234)";

// Expected: cash change = +$500, debt = $0, outside = $0 (not counted yet)
// Total = $500 + $0 + $0 = $500
const totalWithoutConfirmation = result1.total;
const expectedWithout = 500;
const matchesExpectedWithout = Math.abs(totalWithoutConfirmation - expectedWithout) < 1;

console.log(`\n   ✓ Has confirmation: ${hasConfirmation ? "PASS" : "FAIL"}`);
console.log(`   ✓ Item is valid: ${itemIsValid ? "PASS" : "FAIL"}`);
console.log(`   ✓ Total matches expected ($${expectedWithout}): ${matchesExpectedWithout ? "PASS" : "FAIL"}`);

console.log("\n=== TEST 2: Confirming as 'is_savings' includes the amount ===\n");

// Create confirmation map saying "yes, it's savings"
const confirmedYes = new Map<string, boolean>();
if (hasConfirmation) {
  confirmedYes.set(result1.needsConfirmation[0].id, true);
}

const result2 = computeMonthlySavings(
  monthlyHistory,
  accountBalanceHistory,
  expenseTxns,
  "2026-08",
  confirmedYes
);

console.log(`💰 Savings with confirmation (YES):`);
console.log(`   Total: CA$${Math.round(result2.total)}`);
console.log(`   Cash change: CA$${Math.round(result2.netCashChange)}`);
console.log(`   Debt change: CA$${Math.round(result2.netDebtChange)}`);
console.log(`   Outside contributions: CA$${Math.round(result2.contributionsToOutside)}`);

// Expected: cash = $500, debt = $0, outside = $157
// Total = $500 + $0 + $157 = $657
const totalWithYes = result2.total;
const expectedWithYes = 657;
const matchesExpectedYes = Math.abs(totalWithYes - expectedWithYes) < 1;

console.log(`\n   ✓ Total matches expected ($${expectedWithYes}): ${matchesExpectedYes ? "PASS" : "FAIL"}`);
console.log(`   ✓ No pending confirmations: ${result2.needsConfirmation.length === 0 ? "PASS" : "FAIL"}`);

console.log("\n=== TEST 3: Confirming as 'not_savings' excludes the amount ===\n");

// Create confirmation map saying "no, not savings"
const confirmedNo = new Map<string, boolean>();
if (hasConfirmation) {
  confirmedNo.set(result1.needsConfirmation[0].id, false);
}

const result3 = computeMonthlySavings(
  monthlyHistory,
  accountBalanceHistory,
  expenseTxns,
  "2026-08",
  confirmedNo
);

console.log(`💰 Savings with confirmation (NO):`);
console.log(`   Total: CA$${Math.round(result3.total)}`);
console.log(`   Cash change: CA$${Math.round(result3.netCashChange)}`);
console.log(`   Debt change: CA$${Math.round(result3.netDebtChange)}`);
console.log(`   Outside contributions: CA$${Math.round(result3.contributionsToOutside)}`);

// Expected: cash = $500, debt = $0, outside = $0 (excluded)
// Total = $500 + $0 + $0 = $500
const totalWithNo = result3.total;
const expectedWithNo = 500;
const matchesExpectedNo = Math.abs(totalWithNo - expectedWithNo) < 1;

console.log(`\n   ✓ Total matches expected ($${expectedWithNo}): ${matchesExpectedNo ? "PASS" : "FAIL"}`);
console.log(`   ✓ No pending confirmations: ${result3.needsConfirmation.length === 0 ? "PASS" : "FAIL"}`);

console.log("\n=== TEST 4: Confirmation affects average savings ===\n");

// Test with computeAverageSavings (used by card and drawer)
const avgWithoutConfirmation = computeAverageSavings(
  monthlyHistory,
  accountBalanceHistory,
  expenseTxns,
  ["2026-08"]
);

const avgWithYes = computeAverageSavings(
  monthlyHistory,
  accountBalanceHistory,
  expenseTxns,
  ["2026-08"],
  confirmedYes
);

const avgWithNo = computeAverageSavings(
  monthlyHistory,
  accountBalanceHistory,
  expenseTxns,
  ["2026-08"],
  confirmedNo
);

console.log(`📊 Average savings (single month):`);
console.log(`   Without confirmation: CA$${Math.round(avgWithoutConfirmation)}`);
console.log(`   With YES: CA$${Math.round(avgWithYes)}`);
console.log(`   With NO: CA$${Math.round(avgWithNo)}`);

const avgDifferenceYes = Math.abs(avgWithYes - avgWithoutConfirmation);
const avgDifferenceNo = Math.abs(avgWithNo - avgWithoutConfirmation);

console.log(`\n   ✓ YES increases by ~$157: ${Math.abs(avgDifferenceYes - 157) < 1 ? "PASS" : "FAIL"}`);
console.log(`   ✓ NO stays the same: ${avgDifferenceNo < 1 ? "PASS" : "FAIL"}`);

// Final result
const allTestsPass = 
  hasConfirmation &&
  itemIsValid &&
  matchesExpectedWithout &&
  matchesExpectedYes &&
  matchesExpectedNo &&
  result2.needsConfirmation.length === 0 &&
  result3.needsConfirmation.length === 0 &&
  Math.abs(avgDifferenceYes - 157) < 1 &&
  avgDifferenceNo < 1;

console.log(`\n${allTestsPass ? "✅" : "❌"} Savings confirmation test ${allTestsPass ? "PASSED" : "FAILED"}\n`);

if (!allTestsPass) {
  throw new Error("Savings confirmation test failed");
}

