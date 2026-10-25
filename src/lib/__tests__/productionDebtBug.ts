/**
 * Production Bug Investigation: Fixed costs showing wrong debt payments
 * 
 * Production screenshot shows:
 * - TD Home Equity FlexLine: CA$9,909/mo (should be ~$2,325)
 * - Scotia Plan: CA$858 (should be ~$1,090)
 * 
 * Run: npx tsx src/lib/__tests__/productionDebtBug.ts
 */

import { computeScheduledDebtPayments } from "../debtPayments";
import type { AccountSnapshot, ExpenseTxnRecord } from "../extractTransactions";

console.log("=== PRODUCTION BUG INVESTIGATION ===\n");

// ── Test Case 1: TD Home Equity FlexLine showing CA$9,909 ──────────────────────

console.log("TEST 1: Why is FlexLine showing CA$9,909 instead of ~CA$2,325?\n");

// Hypothesis: The 1% principal calculation uses the credit LIMIT or a very large balance
const helocWithHugeBalance: AccountSnapshot = {
  slug: "td-heloc-9999",
  bankName: "TD",
  accountId: "9999",
  accountName: "TD Home Equity FlexLine",
  accountType: "line_of_credit",
  balance: -990900, // Outstanding balance ~$991K (NOT $150K as in test)
  statementMonth: "2026-09",
  interestRate: 6.5,
  paymentsMade: 33160,
};

const helocInterestTxns: ExpenseTxnRecord[] = [
  { txMonth: "2026-07", date: "2026-07-01", category: "Interest", merchant: "INTEREST CHARGE", amount: -810, accountSlug: "td-heloc-9999", accountLabel: "TD HELOC", currency: "CAD" },
  { txMonth: "2026-08", date: "2026-08-01", category: "Interest", merchant: "INTEREST CHARGE", amount: -815, accountSlug: "td-heloc-9999", accountLabel: "TD HELOC", currency: "CAD" },
  { txMonth: "2026-09", date: "2026-09-01", category: "Interest", merchant: "INTEREST CHARGE", amount: -820, accountSlug: "td-heloc-9999", accountLabel: "TD HELOC", currency: "CAD" },
];

const scheduled1 = computeScheduledDebtPayments([helocWithHugeBalance], helocInterestTxns, [], {}, "CAD");
const helocPayment = scheduled1[0];

console.log(`Account: ${helocPayment.accountName}`);
console.log(`Balance: CA$${Math.abs(helocWithHugeBalance.balance).toLocaleString()}`);
console.log(`Median interest: CA$${815}`);
console.log(`Calculated scheduled payment: CA$${Math.round(helocPayment.amount).toLocaleString()}/mo`);
console.log(`Expected (from screenshot): CA$9,909/mo`);
console.log(`Formula: medianInterest ($815) + (balance × 1%) = $815 + ($990,900 × 0.01) = $815 + $9,909 = $10,724`);

if (Math.abs(helocPayment.amount - 9909) < 1000) {
  console.log(`\n✓ BUG REPRODUCED: The 1% principal calculation on a $991K HELOC balance gives ~$9.9K!\n`);
  console.log(`ROOT CAUSE: Most HELOCs are INTEREST-ONLY. The minimum payment should be`);
  console.log(`            just the interest charged (~$815), not interest + 1% of balance.`);
  console.log(`            The 1% rule is for small personal LOCs, not massive HELOCs.\n`);
} else {
  console.log(`\n✗ Did not reproduce bug. Got: CA$${Math.round(helocPayment.amount)}\n`);
}

// ── Test Case 2: Scotia Plan showing CA$858 instead of ~CA$1,090 ───────────────

console.log("TEST 2: Why is Scotia Plan showing CA$858 instead of ~CA$1,090?\n");

const scotiaPlan: AccountSnapshot = {
  slug: "scotia-plan-1234",
  bankName: "Scotia",
  accountId: "1234",
  accountName: "Scotia Plan",
  accountType: "loan",
  balance: -25000,
  statementMonth: "2026-09",
  interestRate: 5.9,
  paymentsMade: 1080,
};

// Scenario A: Only 2 payments in the filtered window, but we need the median
const scotiaPayments2Months: ExpenseTxnRecord[] = [
  { txMonth: "2026-08", date: "2026-08-15", category: "Debt Payments", merchant: "SCOTIA PLAN", amount: -1089, accountSlug: "scotia-plan-1234", accountLabel: "Scotia Plan", currency: "CAD" },
  { txMonth: "2026-09", date: "2026-09-15", category: "Debt Payments", merchant: "SCOTIA PLAN", amount: -1087, accountSlug: "scotia-plan-1234", accountLabel: "Scotia Plan", currency: "CAD" },
];

const scheduled2a = computeScheduledDebtPayments([scotiaPlan], scotiaPayments2Months, [], {}, "CAD");
const scotiaPayment2 = scheduled2a[0];

console.log(`Scenario A: Only 2 payments in window (Aug + Sep)`);
console.log(`  Payments: CA$1,089 + CA$1,087`);
console.log(`  Calculated: CA$${Math.round(scotiaPayment2.amount)}/mo`);
console.log(`  Expected: CA$1,088 (median of 2 payments)`);

// Scenario B: What if it's dividing by number of months somewhere?
console.log(`\nScenario B: Arithmetic error`);
console.log(`  If sum of 3 payments ($1,089 + $1,089 + $1,087 = $3,265) / 3.8 months ≈ $858`);
console.log(`  Or: $1,088 median * 2 payments / 2.5 months ≈ $871`);

// Scenario C: Missing a month of data
const scotiaPayments1Month: ExpenseTxnRecord[] = [
  { txMonth: "2026-09", date: "2026-09-15", category: "Debt Payments", merchant: "SCOTIA PLAN", amount: -858, accountSlug: "scotia-plan-1234", accountLabel: "Scotia Plan", currency: "CAD" },
];

const scheduled2b = computeScheduledDebtPayments([scotiaPlan], scotiaPayments1Month, [], {}, "CAD");
const scotiaPayment1 = scheduled2b[0];

console.log(`\nScenario C: Only 1 payment found (maybe a lower partial payment?)`);
console.log(`  Payment: CA$858`);
console.log(`  Calculated: CA$${Math.round(scotiaPayment1.amount)}/mo`);

if (Math.abs(scotiaPayment1.amount - 858) < 5) {
  console.log(`\n✓ BUG REPRODUCED: If only 1 payment of $858 is found, that becomes the scheduled amount!`);
  console.log(`\nROOT CAUSE: Either:`);
  console.log(`  1. Missing transaction data (only 1-2 months visible)`);
  console.log(`  2. The $858 payment was an irregular/partial payment`);
  console.log(`  3. The regular $1,089 payments are categorized differently`);
  console.log(`\nThe function should use ALL available history (not just the 3-month window)`);
  console.log(`to find the recurring payment pattern.\n`);
}

console.log("\n=== REQUIRED FIXES ===\n");
console.log("1. HELOC/LOC minimum payments:");
console.log("   - Interest-only HELOCs: min = interest charged ONLY (no principal)");
console.log("   - Small revolving LOCs: min = interest + 1-2% of balance");
console.log("   - Use account balance size as threshold (e.g., >$100K = interest-only)\n");

console.log("2. Installment loan payments:");
console.log("   - Must use ALL available transaction history (not filtered to window)");
console.log("   - Need sufficient history (at least 3 payments) to find pattern");
console.log("   - Flag when confidence is low (< 3 payments found)\n");

console.log("3. Display requirements:");
console.log("   - Show ALL debt accounts as separate rows");
console.log("   - Add method label: 'fixed payment' / 'est. interest-only' / 'est. 2% of balance'");
console.log("   - Click to see transaction breakdown (counted vs extra paydown)\n");
