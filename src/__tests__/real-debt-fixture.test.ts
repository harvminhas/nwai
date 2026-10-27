/**
 * Test script using REAL stored data from uploads/nwai-real-debt-data.json
 * Verifies Scotia Plan Loan (1142.25) and TD FlexLine (~3,290-3,380 median) detection
 * with bucket breakdown for Fixed costs, Jul-Sep 2026.
 */

import { computeBucketBreakdown } from "../lib/bucketBreakdown";
import type { AccountSnapshot, DebtPaymentHistoryEntry } from "../lib/extractTransactions";
import type { MonthlyHistoryEntry } from "../lib/financialProfile";
import { readFileSync } from "fs";
import { join } from "path";

// Load real data
const realDataPath = "/home/ubuntu/.cursor/projects/workspace/uploads/nwai-real-debt-data_3c3b.json";
const realData = JSON.parse(readFileSync(realDataPath, "utf-8"));

console.log("=== Real Debt Data Test ===\n");

// Build debt payment history from real data
const debtPaymentHistory: DebtPaymentHistoryEntry[] = [];

// Scotia Plan Loan (last4 7780) - dedupe by last4+month, only non-zero payments
debtPaymentHistory.push({
  accountSlug: "scotiabank-7780",
  statementMonth: "2026-05",
  paymentsMade: 1142.25,
  currency: "CAD",
});
// Aug has paymentsMade=0, so it's excluded (only non-zero count)

// TD FlexLine (last4 0085) - all paymentsMade from the fixture
const flexlinePayments = realData.td_flexline_last4_0085_paymentsMade_by_statement;
for (const [stmtDate, amount] of Object.entries(flexlinePayments) as [string, number][]) {
  const stmtMonth = stmtDate.slice(0, 7); // YYYY-MM
  debtPaymentHistory.push({
    accountSlug: "td-flexline-0085",
    statementMonth: stmtMonth,
    paymentsMade: amount,
    currency: "CAD",
  });
}

console.log(`Loaded ${debtPaymentHistory.length} payment history entries`);
console.log("Scotia Plan: 1 payment (May 1142.25)");
console.log(`FlexLine: ${Object.keys(flexlinePayments).length} payments`);
console.log("");

// Build account snapshots (latest per account)
const accountSnapshots: AccountSnapshot[] = [
  {
    slug: "scotiabank-7780",
    bankName: "Scotiabank",
    accountId: "7780",
    accountName: "Scotia Plan Loan",
    accountType: "loan",
    balance: -46957.41,
    statementMonth: "2026-08",
    interestRate: null,
    currency: "CAD",
    paymentsMade: 0, // Aug shows 0, but May had 1142.25
  },
  {
    slug: "td-flexline-0085",
    bankName: "TD Bank",
    accountId: "0085",
    accountName: "TD Home Equity FlexLine",
    accountType: "line_of_credit",
    balance: -508000,
    statementMonth: "2026-09",
    interestRate: 4.65,
    currency: "CAD",
    paymentsMade: 32302.18, // Sep is the huge prepayment
  },
];

// Mock monthly history for Jul-Sep 2026
const monthlyHistory: MonthlyHistoryEntry[] = [
  { yearMonth: "2026-07", incomeTotal: 5000, expensesTotal: 3500 },
  { yearMonth: "2026-08", incomeTotal: 5000, expensesTotal: 3500 },
  { yearMonth: "2026-09", incomeTotal: 5000, expensesTotal: 3500 },
];

// Call the real bucket breakdown function
const months = ["2026-07", "2026-08", "2026-09"];
const breakdown = computeBucketBreakdown(
  "fixed",
  [], // expenseTxns not needed for debt payments
  accountSnapshots,
  debtPaymentHistory,
  months,
  "CAD",
  [], // userReviews
  {}, // fxRates
  undefined, // merchantCadence
  undefined // subscriptions
);

console.log("=== Fixed Bucket Breakdown (Jul-Sep 2026) ===\n");
console.log(`Total monthly average: CA$${breakdown.monthlyAverage.toFixed(2)}`);
console.log(`\nCategories (${breakdown.categories.length}):\n`);

for (const cat of breakdown.categories) {
  console.log(`  ${cat.category}: CA$${cat.amount.toFixed(2)}${cat.isScheduled ? " (scheduled)" : ""}${cat.isEstimated ? " (est.)" : ""}`);
  if (cat.merchants && cat.merchants.length > 0) {
    for (const merch of cat.merchants) {
      console.log(`    - ${merch.merchant}: CA$${merch.amount.toFixed(2)}${merch.method ? ` [${merch.method}]` : ""}`);
    }
  }
}

// Verify expected values
console.log("\n=== Verification ===\n");

const loanPaymentsCat = breakdown.categories.find(c => c.category.includes("Loan payment"));
if (loanPaymentsCat) {
  const scotiaMerchant = loanPaymentsCat.merchants.find(m => m.merchant.includes("Scotia"));
  const flexlineMerchant = loanPaymentsCat.merchants.find(m => m.merchant.includes("FlexLine"));

  console.log("✓ Loan payments category found");
  
  if (scotiaMerchant) {
    const scotiaDiff = Math.abs(scotiaMerchant.amount - 1142.25);
    if (scotiaDiff < 0.01) {
      console.log(`✓ Scotia Plan: CA$${scotiaMerchant.amount.toFixed(2)} (EXPECTED: 1142.25)`);
    } else {
      console.log(`✗ Scotia Plan: CA$${scotiaMerchant.amount.toFixed(2)} (EXPECTED: 1142.25, diff: ${scotiaDiff.toFixed(2)})`);
    }
  } else {
    console.log("✗ Scotia Plan not found in merchants!");
  }

  if (flexlineMerchant) {
    // Expected median ~3,290-3,380 (excluding Jul 10156 and Sep 32302 anomalies)
    const inExpectedRange = flexlineMerchant.amount >= 3200 && flexlineMerchant.amount <= 3900;
    if (inExpectedRange) {
      console.log(`✓ FlexLine: CA$${flexlineMerchant.amount.toFixed(2)} (EXPECTED: ~3,290-3,380 median)`);
    } else {
      console.log(`✗ FlexLine: CA$${flexlineMerchant.amount.toFixed(2)} (EXPECTED: ~3,290-3,380, out of range)`);
    }
  } else {
    console.log("✗ FlexLine not found in merchants!");
  }
} else {
  console.log("✗ Loan payments category not found!");
}

console.log("\n=== Test complete ===");
