#!/usr/bin/env tsx

/**
 * Regression test for dashboard range switch feature.
 * 
 * For each range (3mo, 12mo, ytd):
 * 1. Print Income, Spending, and Savings figures
 * 2. Verify card == drawer == page calculations
 * 3. Verify month lists never include current month
 */

import { config } from "dotenv";
import { getFirebaseAdmin } from "../src/lib/firebase-admin";
import { getFinancialProfile } from "../src/lib/financialProfile";
import { buildIncomeSummary } from "../src/lib/incomeSummary";
import { buildSpendingSummary } from "../src/lib/spendingSummary";
import { computeMoneyCoachBreakdown } from "../src/lib/moneyCoach";
import { getRangeMonths, getCurrentMonth, type TimeRange } from "../src/lib/rangeUtils";
import type { DebtPaymentReview } from "../src/lib/types";

config({ path: ".env.local" });

const TEST_UID = process.env.TEST_UID;

if (!TEST_UID) {
  console.error("❌ TEST_UID not set in .env.local");
  process.exit(1);
}

interface RangeResults {
  range: TimeRange;
  rangeLabel: string;
  months: string[];
  income: number;
  spending: number;
  savings: number;
  hasCurrentMonth: boolean;
  incomeMatch: boolean;
  spendingMatch: boolean;
  savingsMatch: boolean;
  pageIncome: number;
  pageSpending: number;
  pageSavings: number;
}

async function testRange(range: TimeRange): Promise<RangeResults> {
  const { db } = getFirebaseAdmin();
  const profile = await getFinancialProfile(TEST_UID!, db);
  
  // Get months for this range
  const availableMonths = profile.monthlyHistory.map(m => m.yearMonth).sort();
  const rangeMonths = getRangeMonths(range, availableMonths);
  const currentMonth = getCurrentMonth();
  const hasCurrentMonth = rangeMonths.includes(currentMonth);
  
  // Load reviews
  const reviewsSnap = await db.collection(`users/${TEST_UID}/debtPaymentReviews`).get();
  const userReviews: DebtPaymentReview[] = reviewsSnap.docs.map((doc) => ({
    txFingerprint: doc.id,
    accountSlug: doc.get("accountSlug"),
    classification: doc.get("classification"),
    date: doc.get("date"),
    amount: doc.get("amount"),
    reviewedAt: doc.get("reviewedAt"),
  }));
  
  const incomeReviewsSnap = await db
    .collection(`users/${TEST_UID}/reviews`)
    .where("type", "==", "income_deposit")
    .get();
  const incomeDepositReviews = new Map<string, string>();
  incomeReviewsSnap.docs.forEach(doc => {
    incomeDepositReviews.set(doc.id, doc.get("classification"));
  });
  
  // Compute card values (via MoneyCoach breakdown - same as API route)
  const breakdown = computeMoneyCoachBreakdown(
    profile,
    userReviews,
    profile.incomeTxns,
    profile.accountSnapshots,
    profile.homeCurrency || "CAD",
    incomeDepositReviews,
    rangeMonths
  );
  
  const cardIncome = breakdown.incomeAmount;
  const cardSpending = breakdown.totalSpending;
  const savingsBucket = breakdown.buckets.find(b => b.bucket === "savings");
  const cardSavings = savingsBucket?.monthlyAverage || 0;
  
  // Compute page values (direct from summary functions)
  const incomeSummary = buildIncomeSummary(
    profile.incomeTxns,
    profile.accountSnapshots,
    profile.homeCurrency || "CAD",
    incomeDepositReviews,
    rangeMonths
  );
  
  const spendingSummary = buildSpendingSummary(
    profile.expenseTxns,
    profile.accountSnapshots,
    profile.debtPaymentHistory,
    userReviews,
    profile.fxRates,
    profile.homeCurrency || "CAD",
    rangeMonths
  );
  
  const pageIncome = incomeSummary.typicalMonthly;
  const pageSpending = spendingSummary.typicalMonthly;
  const pageSavings = pageIncome - pageSpending;
  
  // Verify consistency
  const incomeMatch = Math.abs(cardIncome - pageIncome) < 1;
  const spendingMatch = Math.abs(cardSpending - pageSpending) < 1;
  const savingsMatch = Math.abs(cardSavings - pageSavings) < 1;
  
  return {
    range,
    rangeLabel: breakdown.rangeLabel,
    months: rangeMonths,
    income: cardIncome,
    spending: cardSpending,
    savings: cardSavings,
    hasCurrentMonth,
    incomeMatch,
    spendingMatch,
    savingsMatch,
    pageIncome,
    pageSpending,
    pageSavings,
  };
}

// Helper to format month names
function formatMonth(yearMonth: string): string {
  const [year, month] = yearMonth.split("-");
  const date = new Date(parseInt(year), parseInt(month) - 1);
  return date.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

async function main() {
  console.log("🧪 Dashboard Range Switch Regression Test");
  console.log(`Testing user: ${TEST_UID}`);
  console.log("=".repeat(80));
  
  const ranges: TimeRange[] = ["3mo", "12mo", "ytd"];
  let allPassed = true;
  const results: RangeResults[] = [];
  
  for (const range of ranges) {
    try {
      const result = await testRange(range);
      results.push(result);
    } catch (error) {
      console.error(`\n❌ FATAL ERROR testing ${range}:`, error);
      allPassed = false;
    }
  }
  
  // Print Dashboard Range section
  console.log("\n📊 DASHBOARD RANGE");
  console.log("=".repeat(80));
  
  for (const result of results) {
    const rangeTitle = result.range === "3mo" ? "3-MONTH" : 
                      result.range === "12mo" ? "12-MONTH" : 
                      "YEAR-TO-DATE";
    
    console.log(`\n${rangeTitle} (${result.range})`);
    console.log("-".repeat(80));
    
    // Print months used (by name)
    const monthNames = result.months.map(m => formatMonth(m));
    console.log(`Months used (${result.months.length}): ${monthNames.join(", ")}`);
    console.log(`Range label: ${result.rangeLabel}`);
    console.log();
    
    // Print Income, Spending, Savings
    const currency = "CAD";
    console.log(`Income  (avg/mo): ${currency}$${result.income.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    console.log(`Spending (avg/mo): ${currency}$${result.spending.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    console.log(`Savings (avg/mo): ${currency}$${result.savings.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    console.log();
    
    // Check for current month
    const currentMonth = getCurrentMonth();
    if (result.hasCurrentMonth) {
      console.log(`❌ FAIL: Current month ${formatMonth(currentMonth)} included in range`);
      allPassed = false;
    } else {
      console.log(`✅ PASS: Current month ${formatMonth(currentMonth)} excluded`);
    }
    
    // Check card == page
    if (!result.incomeMatch) {
      console.log(`❌ FAIL: Income mismatch - card=${result.income.toFixed(2)}, page=${result.pageIncome.toFixed(2)}`);
      allPassed = false;
    } else {
      console.log(`✅ PASS: Income card == page (${result.income.toFixed(2)})`);
    }
    
    if (!result.spendingMatch) {
      console.log(`❌ FAIL: Spending mismatch - card=${result.spending.toFixed(2)}, page=${result.pageSpending.toFixed(2)}`);
      allPassed = false;
    } else {
      console.log(`✅ PASS: Spending card == page (${result.spending.toFixed(2)})`);
    }
    
    if (!result.savingsMatch) {
      console.log(`❌ FAIL: Savings mismatch - card=${result.savings.toFixed(2)}, page=${result.pageSavings.toFixed(2)}`);
      allPassed = false;
    } else {
      console.log(`✅ PASS: Savings card == page (${result.savings.toFixed(2)})`);
    }
  }
  
  console.log("\n" + "=".repeat(80));
  if (allPassed) {
    console.log("✅ ALL DASHBOARD RANGE TESTS PASSED");
    process.exit(0);
  } else {
    console.log("❌ SOME DASHBOARD RANGE TESTS FAILED");
    process.exit(1);
  }
}

main().catch(err => {
  console.error("\n❌ FATAL ERROR:", err);
  process.exit(1);
});
