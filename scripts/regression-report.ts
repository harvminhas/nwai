/**
 * Regression test script for dashboard bucket calculations.
 * 
 * Verifies that card values and drawer totals match, and compares against
 * a saved baseline to catch regressions.
 * 
 * Usage:
 *   npx tsx --env-file=.env.local scripts/regression-report.ts <uid>
 *   npx tsx --env-file=.env.local scripts/regression-report.ts <uid> --save-baseline
 * 
 * Read-only (never writes to Firestore), PowerShell-safe (no comma args).
 */

import * as fs from "fs";
import * as path from "path";
import { getFirebaseAdmin } from "../src/lib/firebase-admin";
import { getFinancialProfile } from "../src/lib/financialProfile";
import { computeMoneyCoachBreakdown } from "../src/lib/moneyCoach";
import { computeBucketBreakdown } from "../src/lib/bucketBreakdown";
import { computeAverageSavings, computeMonthlySavings, computeWindowSavings } from "../src/lib/savingsCalculations";
import { buildIncomeSummary } from "../src/lib/incomeSummary";
import { buildSpendingSummary } from "../src/lib/spendingSummary";
import { buildSubscriptionSummary } from "../src/lib/subscriptionEngine";
import { computeMonthlyBuckets } from "../src/lib/monthlyBucketComputation";
import type { MoneyCoachBucket } from "../src/lib/moneyCoachBuckets";
import type { DebtPaymentReview } from "../src/lib/types";
import { getParentCategory } from "../src/lib/categoryTaxonomy";

const BASELINE_PATH = path.join(__dirname, "regression-baseline.json");

interface BucketReport {
  bucket: MoneyCoachBucket;
  cardValue: number;
  drawerTotal: number;
  match: boolean;
  categories?: Array<{ name: string; amount: number }>;
  loans?: Array<{ name: string; amount: number }>;
}

interface RegressionReport {
  uid: string;
  timestamp: string;
  buckets: BucketReport[];
  income: {
    typicalMonthly: number;
    regularSourcesCount: number;
    last3MonthsTotal: number;
  };
  summary: {
    totalMismatches: number;
    baselineComparison?: {
      changes: Array<{ bucket: string; oldValue: number; newValue: number; pctChange: number }>;
      significantChanges: number;
    };
  };
}

function formatCurrency(amount: number, currency: string = "CAD"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

async function generateReport(uid: string, saveBaseline: boolean): Promise<void> {
  console.log(`\n🧪 Regression Report for UID: ${uid}\n`);
  console.log(`Time: ${new Date().toISOString()}\n`);

  const { db } = getFirebaseAdmin();
  const errors: string[] = []; // Collect errors, exit at the end
  
  // Get financial profile
  const profile = await getFinancialProfile(uid, db);
  const currency = profile.homeCurrency || "CAD";
  
  // Load user debt payment reviews
  const reviewsSnap = await db.collection(`users/${uid}/debtPaymentReviews`).get();
  const userReviews: DebtPaymentReview[] = reviewsSnap.docs.map((doc) => ({
    txFingerprint: doc.id,
    accountSlug: doc.get("accountSlug"),
    classification: doc.get("classification"),
    date: doc.get("date"),
    amount: doc.get("amount"),
    reviewedAt: doc.get("reviewedAt"),
  }));
  
  // Compute Money Coach breakdown (card values)
  const breakdown = computeMoneyCoachBreakdown(profile, userReviews);
  
  // Get last 3 complete months
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const completeMonths = profile.monthlyHistory
    .filter(h => h.yearMonth < currentMonth && h.incomeTotal > 0)
    .slice(-3)
    .map(h => h.yearMonth);
  
  console.log(`📅 Last 3 complete months: ${completeMonths.join(", ")}\n`);
  
  // Test income summary
  const incomeSummary = buildIncomeSummary(
    profile.incomeTxns,
    profile.accountSnapshots,
    currency
  );
  
  console.log(`💰 Income Summary (buildIncomeSummary):`);
  console.log(`   Typical monthly (last 3 complete): ${formatCurrency(incomeSummary.typicalMonthly, currency)}`);
  console.log(`   Regular sources: ${incomeSummary.regularSources.length}`);
  console.log(`   One-off sources: ${incomeSummary.oneOffSources.length}`);
  console.log(`   Transfer sources: ${incomeSummary.transferSources.length}`);
  console.log(`   Last 3 months total: ${formatCurrency(incomeSummary.last3MonthsTotal, currency)}\n`);
  
  // Test spending summary
  const spendingSummary = buildSpendingSummary(
    profile.expenseTxns,
    profile.accountSnapshots,
    profile.debtPaymentHistory,
    userReviews,
    profile.fxRates || {},
    currency
  );
  
  console.log(`💳 Spending Summary (buildSpendingSummary):`);
  console.log(`   Last complete month (${spendingSummary.lastCompleteMonth}): ${formatCurrency(spendingSummary.lastMonthTotal, currency)}`);
  console.log(`   Typical monthly (last 3 complete): ${formatCurrency(spendingSummary.typicalMonthly, currency)}`);
  console.log(`   Fixed: ${formatCurrency(spendingSummary.buckets.find(b => b.bucket === "fixed")?.total || 0, currency)}`);
  console.log(`   Essentials: ${formatCurrency(spendingSummary.buckets.find(b => b.bucket === "essentials")?.total || 0, currency)}`);
  console.log(`   Flexible: ${formatCurrency(spendingSummary.buckets.find(b => b.bucket === "flexible")?.total || 0, currency)}`);
  console.log(`   Categories: ${spendingSummary.categories.length}`);
  console.log(`   Merchants: ${spendingSummary.merchants.length}`);
  
  // Count unique merchants before merging (from raw transactions)
  const rawMerchants = new Set(profile.expenseTxns.map(t => t.merchant)).size;
  console.log(`   Raw merchants (before merging): ${rawMerchants}`);
  console.log(`   After normalization/merging: ${spendingSummary.merchants.length}`);
  console.log(`   Reduction: ${rawMerchants - spendingSummary.merchants.length} (${((1 - spendingSummary.merchants.length / rawMerchants) * 100).toFixed(1)}%)\n`);
  
  // Verify 12-month history reconciliation with DETAILED ERROR OUTPUT
  let hasSpendingError = false;
  for (const month of spendingSummary.monthlyHistory) {
    const categorySum = month.categories.reduce((s, c) => s + c.amount, 0);
    const bucketSum = month.fixed + month.essentials + month.flexible;
    const totalDiff = Math.abs(month.total - bucketSum);
    const categoryDiff = Math.abs(month.total - categorySum);
    
    if (totalDiff > 0.01 || categoryDiff > 0.01) {
      hasSpendingError = true;
      console.error(`❌ SPENDING RECONCILIATION ERROR for ${month.yearMonth}:`);
      console.error(`   Total:      ${formatCurrency(month.total, currency)}`);
      console.error(`   Buckets:    ${formatCurrency(bucketSum, currency)} (F ${formatCurrency(month.fixed, currency)} + E ${formatCurrency(month.essentials, currency)} + F ${formatCurrency(month.flexible, currency)})`);
      console.error(`   Categories: ${formatCurrency(categorySum, currency)}`);
      console.error(`   Total vs Buckets diff:    ${formatCurrency(totalDiff, currency)}`);
      console.error(`   Total vs Categories diff: ${formatCurrency(categoryDiff, currency)}`);
      
      // Show category breakdown
      if (month.categories.length > 0) {
        console.error(`   Categories breakdown:`);
        month.categories.slice(0, 10).forEach(c => {
          console.error(`      ${c.category.padEnd(30)} ${formatCurrency(c.amount, currency)}`);
        });
        if (month.categories.length > 10) {
          console.error(`      ... and ${month.categories.length - 10} more`);
        }
      }
      console.error();
    }
  }
  
  if (hasSpendingError) {
    console.error("❌ Spending reconciliation failed\n");
    errors.push("Spending reconciliation failed");
  } else {
    console.log(`✅ Spending reconciliation passed (${spendingSummary.monthlyHistory.length} months)\n`);
  }
  
  // Verify spending buckets match dashboard cards for last 3 months
  console.log(`💵 Spending Buckets vs Dashboard (3-month average):`);
  const spendingBuckets = ["fixed", "essentials", "flexible"] as const;
  let hasBucketMismatch = false;
  
  for (const bucket of spendingBuckets) {
    const dashboardBucket = breakdown.buckets.find(b => b.bucket === bucket);
    const spendingBucket = spendingSummary.buckets.find(b => b.bucket === bucket);
    
    if (dashboardBucket && spendingBucket) {
      const dashboardAvg = dashboardBucket.monthlyAverage;
      const spendingAvg = spendingBucket.total; // Already 3-month average
      const diff = Math.abs(dashboardAvg - spendingAvg);
      const match = diff < 1.0; // Within $1
      
      console.log(`   ${bucket}: Dashboard = ${formatCurrency(dashboardAvg, currency)}, Spending page = ${formatCurrency(spendingAvg, currency)} ${match ? "✓" : `✗ (diff: ${formatCurrency(diff, currency)})`}`);
      
      if (!match) {
        hasBucketMismatch = true;
      }
    }
  }
  
  if (hasBucketMismatch) {
    console.error("\n❌ BUCKET MISMATCH: Spending page buckets don't match dashboard cards\n");
    errors.push("Bucket mismatch between spending page and dashboard");
  } else {
    console.log(`✅ Spending buckets match dashboard cards\n`);
  }
  
  // Verify monthly history totals match individual month calculations
  console.log(`💵 Monthly History Validation (chart data):`);
  let hasMonthlyMismatch = false;
  
  for (const month of spendingSummary.monthlyHistory.slice(-3)) {
    // Re-compute this month using computeMonthlyBuckets to verify consistency
    const recomputed = computeMonthlyBuckets(
      month.yearMonth,
      profile.expenseTxns,
      profile.accountSnapshots,
      profile.debtPaymentHistory,
      userReviews,
      profile.fxRates || {},
      currency
    );
    
    const totalDiff = Math.abs(month.total - recomputed.total);
    const fixedDiff = Math.abs(month.fixed - recomputed.buckets.fixed);
    const essentialsDiff = Math.abs(month.essentials - recomputed.buckets.essentials);
    const flexibleDiff = Math.abs(month.flexible - recomputed.buckets.flexible);
    
    const match = totalDiff < 0.01 && fixedDiff < 0.01 && essentialsDiff < 0.01 && flexibleDiff < 0.01;
    
    if (!match) {
      hasMonthlyMismatch = true;
      console.error(`   ❌ ${month.yearMonth}:`);
      console.error(`      API total:  ${formatCurrency(month.total, currency)} (F ${formatCurrency(month.fixed, currency)} + E ${formatCurrency(month.essentials, currency)} + F ${formatCurrency(month.flexible, currency)})`);
      console.error(`      Recomputed: ${formatCurrency(recomputed.total, currency)} (F ${formatCurrency(recomputed.buckets.fixed, currency)} + E ${formatCurrency(recomputed.buckets.essentials, currency)} + F ${formatCurrency(recomputed.buckets.flexible, currency)})`);
      console.error(`      Diffs: total ${formatCurrency(totalDiff, currency)}, fixed ${formatCurrency(fixedDiff, currency)}, essentials ${formatCurrency(essentialsDiff, currency)}, flexible ${formatCurrency(flexibleDiff, currency)}`);
    } else {
      console.log(`   ✓ ${month.yearMonth}: ${formatCurrency(month.total, currency)}`);
    }
  }
  
  if (hasMonthlyMismatch) {
    console.error("\n❌ MONTHLY HISTORY MISMATCH: API monthly totals don't match recomputed values\n");
    errors.push("Monthly history data inconsistency");
  } else {
    console.log(`✅ Monthly history data consistent\n`);
  }
  
  // Verify typical monthly matches bucket sum
  const bucketSum = spendingSummary.buckets.reduce((s, b) => s + b.total, 0);
  const typicalDiff = Math.abs(spendingSummary.typicalMonthly - bucketSum);
  if (typicalDiff > 1.0) {
    console.error(`❌ TYPICAL MONTHLY MISMATCH:`);
    console.error(`   Typical monthly = ${formatCurrency(spendingSummary.typicalMonthly, currency)}`);
    console.error(`   Bucket sum = ${formatCurrency(bucketSum, currency)}`);
    console.error(`   Difference = ${formatCurrency(typicalDiff, currency)}\n`);
    errors.push("Typical monthly doesn't match bucket sum");
  }
  
  // Test subscriptions
  // Load user-confirmed subscription merchants
  const subReviewsSnap = await db
    .collection(`users/${uid}/reviews`)
    .where("type", "==", "subscription")
    .get();
  
  const userConfirmedSlugs: string[] = [];
  const reviewDecisions = {
    is_subscription: 0,
    not_subscription: 0,
    still_active: 0,
    cancelled: 0,
  };
  
  subReviewsSnap.docs.forEach(doc => {
    const classification = doc.get("classification");
    const merchantSlug = doc.get("merchantSlug") || doc.id;
    
    if (classification === "is_subscription") {
      userConfirmedSlugs.push(merchantSlug);
      reviewDecisions.is_subscription++;
    } else if (classification === "not_subscription") {
      reviewDecisions.not_subscription++;
    } else if (classification === "still_active") {
      userConfirmedSlugs.push(merchantSlug);
      reviewDecisions.still_active++;
    } else if (classification === "cancelled") {
      reviewDecisions.cancelled++;
    }
  });
  
  console.log(`\n🔄 Subscriptions (buildSubscriptionSummary):`);
  console.log(`   Review decisions applied:`);
  console.log(`     • is_subscription: ${reviewDecisions.is_subscription}`);
  console.log(`     • not_subscription: ${reviewDecisions.not_subscription}`);
  console.log(`     • still_active: ${reviewDecisions.still_active}`);
  console.log(`     • cancelled: ${reviewDecisions.cancelled}`);
  
  const subscriptionSummary = buildSubscriptionSummary(
    profile.expenseTxns,
    currency,
    spendingSummary.typicalMonthly,
    userConfirmedSlugs
  );
  
  console.log(`   Active confirmed: ${subscriptionSummary.activeCount}`);
  console.log(`   Candidates (to review): ${subscriptionSummary.candidateCount}`);
  console.log(`   Inactive/cancelled: ${subscriptionSummary.inactive.length}`);
  console.log(`   Monthly total: ${formatCurrency(subscriptionSummary.monthlyTotal, currency)} (confirmed only)`);
  console.log(`   Yearly total: ${formatCurrency(subscriptionSummary.yearlyTotal, currency)} (confirmed only)`);
  console.log(`   New subscriptions: ${subscriptionSummary.newCount}`);
  console.log(`   Price increases: ${subscriptionSummary.priceIncreaseCount}`);
  
  // Print lists
  if (subscriptionSummary.subscriptions.length > 0) {
    console.log(`\n   ✅ Confirmed Active (${subscriptionSummary.subscriptions.length}):`);
    subscriptionSummary.subscriptions.forEach(sub => {
      console.log(`      • ${sub.merchant} (${sub.category}) - ${formatCurrency(sub.amount, currency)}/${sub.cadence}`);
    });
  }
  
  if (subscriptionSummary.candidates.length > 0) {
    console.log(`\n   ⚠️  Candidates to Review (${subscriptionSummary.candidates.length}):`);
    subscriptionSummary.candidates.forEach(sub => {
      // Find all transactions for this merchant to show charge dates
      const merchantTxns = profile.expenseTxns
        .filter(txn => {
          const txnSlug = require("@/lib/applyRules").merchantSlug(txn.merchant);
          return txnSlug === sub.merchantSlug || txnSlug.includes(sub.merchantSlug);
        })
        .sort((a, b) => a.date.localeCompare(b.date));
      
      const chargeDates = merchantTxns.map(t => t.date).join(", ");
      console.log(`      • ${sub.merchant} (${sub.category}) - ${formatCurrency(sub.amount, currency)}/${sub.cadence}`);
      console.log(`        Charge dates: ${chargeDates}`);
    });
  }
  
  if (subscriptionSummary.inactive.length > 0) {
    console.log(`\n   💤 Inactive/Cancelled (${subscriptionSummary.inactive.length}):`);
    subscriptionSummary.inactive.forEach(sub => {
      console.log(`      • ${sub.merchant} (${sub.category}) - last ${sub.lastDate}`);
    });
  }
  
  // Hard-excluded categories that should never appear
  const HARD_EXCLUDED_CATEGORIES = [
    "Interest", "Fees", "Debt Payments", "Transfers", "Transfers & Payments",
    "Loans", "Insurance", "Taxes", "Income", "Cash & ATM", "Investments & Savings",
    "Groceries", "Shopping", "Dining", "School Fees", "Charity", "Education"
  ];
  
  const HARD_EXCLUDED_PARENTS = [
    "Debt", "Taxes", "Investments & Savings", "Groceries", "Shopping", 
    "Dining", "Education", "Housing"
  ];
  
  // Check all detected subscriptions (confirmed, candidates, and inactive)
  const allSubs = [
    ...subscriptionSummary.subscriptions,
    ...subscriptionSummary.candidates,
    ...subscriptionSummary.inactive
  ];
  
  const hardExcludedItems = allSubs.filter(sub => {
    const parent = getParentCategory(sub.category);
    return HARD_EXCLUDED_CATEGORIES.includes(sub.category) || HARD_EXCLUDED_PARENTS.includes(parent);
  });
  
  if (hardExcludedItems.length > 0) {
    console.error(`\n❌ HARD-EXCLUDED ITEMS DETECTED IN SUBSCRIPTIONS:`);
    hardExcludedItems.forEach(sub => {
      const parent = getParentCategory(sub.category);
      console.error(`   • ${sub.merchant} (${sub.category}, parent: ${parent}) - ${formatCurrency(sub.amount, currency)}`);
    });
    console.error();
    errors.push("Hard-excluded categories found in subscriptions");
  }
  
  // Check sanity failures
  if (subscriptionSummary.sanityCheckFailures.length > 0) {
    console.error(`\n❌ SUBSCRIPTION SANITY CHECK FAILED:`);
    subscriptionSummary.sanityCheckFailures.forEach(f => console.error(`   • ${f}`));
    console.error();
    errors.push("Subscription sanity check failed");
  }
  
  // Check for duplicate canonical merchants (same merchantSlug appearing multiple times)
  const slugCounts = new Map<string, { count: number; merchants: string[] }>();
  allSubs.forEach(sub => {
    if (!slugCounts.has(sub.merchantSlug)) {
      slugCounts.set(sub.merchantSlug, { count: 0, merchants: [] });
    }
    const entry = slugCounts.get(sub.merchantSlug)!;
    entry.count++;
    entry.merchants.push(sub.merchant);
  });
  
  const duplicates = Array.from(slugCounts.entries()).filter(([_, data]) => data.count > 1);
  if (duplicates.length > 0) {
    console.error(`\n❌ DUPLICATE CANONICAL MERCHANTS DETECTED:`);
    duplicates.forEach(([slug, data]) => {
      console.error(`   • "${slug}" appears ${data.count} times: ${data.merchants.join(", ")}`);
    });
    console.error();
    errors.push("Duplicate canonical merchants found");
  }
  
  // Additional sanity: subscriptions should be reasonable
  const subPct = (subscriptionSummary.monthlyTotal / spendingSummary.typicalMonthly) * 100;
  console.log(`\n   Subscriptions as % of spending: ${subPct.toFixed(1)}%`);
  
  if (subscriptionSummary.activeCount > 30) {
    console.error(`\n❌ Too many subscriptions: ${subscriptionSummary.activeCount} (max 30)\n`);
    errors.push("Too many subscriptions");
  }
  
  if (subPct > 10) {
    console.error(`\n❌ Subscriptions too high: ${subPct.toFixed(1)}% of spending (max 10%)\n`);
    errors.push("Subscriptions percentage too high");
  }
  
  if (hardExcludedItems.length === 0 && subscriptionSummary.sanityCheckFailures.length === 0 && subscriptionSummary.activeCount <= 30 && subPct <= 10) {
    console.log(`✅ Subscription detection passed all checks\n`);
  }
  
  // Check for pending savings reviews
  const savingsReviewsSnap = await db
    .collection(`users/${uid}/reviews`)
    .where("type", "==", "savings_item")
    .get();
  
  const reviewedSavingsIds = new Set(savingsReviewsSnap.docs.map(doc => doc.id));
  
  // Compute savings for each complete month to get pending confirmations
  const allSavingsConfirmations: any[] = [];
  for (const month of completeMonths) {
    const result = computeMonthlySavings(
      profile.monthlyHistory,
      profile.accountBalanceHistory,
      profile.expenseTxns,
      month
    );
    for (const item of result.needsConfirmation) {
      if (!reviewedSavingsIds.has(item.id)) {
        allSavingsConfirmations.push(item);
      }
    }
  }
  
  // Dedupe by ID
  const seenIds = new Set<string>();
  const uniqueSavingsConfirmations = allSavingsConfirmations.filter(item => {
    if (seenIds.has(item.id)) return false;
    seenIds.add(item.id);
    return true;
  });
  
  if (uniqueSavingsConfirmations.length > 0) {
    console.log(`⚠️  Pending Savings Reviews (${uniqueSavingsConfirmations.length}):`);
    for (const item of uniqueSavingsConfirmations) {
      console.log(`   • ${item.merchant} - ${item.accountName} - ${formatCurrency(item.amount, currency)} (${item.txMonth})`);
    }
    console.log();
  } else {
    console.log(`✅ No pending savings reviews\n`);
  }
  
  // Test each bucket
  const buckets: MoneyCoachBucket[] = ["fixed", "essentials", "flexible", "savings"];
  const reports: BucketReport[] = [];
  
  for (const bucket of buckets) {
    // Get card value from Money Coach
    const bucketSummary = breakdown.buckets.find(b => b.bucket === bucket);
    const cardValue = bucketSummary?.monthlyAverage || 0;
    
    let drawerTotal: number;
    let categories: Array<{ name: string; amount: number }> = [];
    let loans: Array<{ name: string; amount: number }> = [];
    
    if (bucket === "savings") {
      // Savings drawer uses NET balance calculation, not category breakdown
      drawerTotal = computeAverageSavings(
        profile.monthlyHistory,
        profile.accountBalanceHistory,
        profile.expenseTxns,
        completeMonths
      );
      
      // Get window reconciliation breakdown
      const windowSavings = computeWindowSavings(
        profile.monthlyHistory,
        profile.accountBalanceHistory,
        profile.expenseTxns,
        completeMonths
      );
      
      // Verify reconciliation: components sum to total for each month
      let hasReconciliationError = false;
      for (const month of windowSavings.monthlyBreakdown) {
        const sum = month.netCashChange + month.netDebtChange + month.contributionsToOutside;
        const diff = Math.abs(sum - month.total);
        if (diff > 0.01) { // Allow 1 cent rounding
          hasReconciliationError = true;
          console.error(`❌ RECONCILIATION ERROR for ${month.month}:`);
          console.error(`   Cash + Debt + Contributions = ${formatCurrency(sum, currency)}`);
          console.error(`   Total = ${formatCurrency(month.total, currency)}`);
          console.error(`   Difference = ${formatCurrency(diff, currency)}\n`);
        }
      }
      
      // Verify monthly average matches mean
      const meanTotal = windowSavings.monthlyBreakdown.reduce((s, m) => s + m.total, 0) / completeMonths.length;
      if (Math.abs(meanTotal - windowSavings.monthlyAverage.total) > 0.01) {
        hasReconciliationError = true;
        console.error(`❌ MONTHLY AVERAGE MISMATCH:`);
        console.error(`   Mean of monthly totals = ${formatCurrency(meanTotal, currency)}`);
        console.error(`   Reported average = ${formatCurrency(windowSavings.monthlyAverage.total, currency)}\n`);
      }
      
      // Verify account changes sum to components
      const totalCashFromMonths = windowSavings.monthlyBreakdown.reduce((s, m) => s + m.netCashChange, 0);
      const totalCashFromAccounts = windowSavings.windowPeriodAccounts.cashAccounts.reduce((s, a) => s + a.change, 0);
      if (Math.abs(totalCashFromMonths - totalCashFromAccounts) > 0.01) {
        hasReconciliationError = true;
        console.error(`❌ CASH ACCOUNT SUM MISMATCH:`);
        console.error(`   Sum of monthly cash changes = ${formatCurrency(totalCashFromMonths, currency)}`);
        console.error(`   Sum of account changes = ${formatCurrency(totalCashFromAccounts, currency)}\n`);
      }
      
      const totalDebtFromMonths = windowSavings.monthlyBreakdown.reduce((s, m) => s + m.netDebtChange, 0);
      const totalDebtFromAccounts = windowSavings.windowPeriodAccounts.debtAccounts.reduce((s, a) => s + a.change, 0);
      if (Math.abs(totalDebtFromMonths - totalDebtFromAccounts) > 0.01) {
        hasReconciliationError = true;
        console.error(`❌ DEBT ACCOUNT SUM MISMATCH:`);
        console.error(`   Sum of monthly debt changes = ${formatCurrency(totalDebtFromMonths, currency)}`);
        console.error(`   Sum of account changes = ${formatCurrency(totalDebtFromAccounts, currency)}\n`);
      }
      
      if (hasReconciliationError) {
        console.error("❌ Savings reconciliation failed\n");
        process.exit(1);
      }
      
      // Store reconciliation for display
      categories = [
        { name: "Cash change", amount: windowSavings.monthlyAverage.netCashChange },
        { name: "Debt paydown", amount: windowSavings.monthlyAverage.netDebtChange },
        { name: "Outside contributions", amount: windowSavings.monthlyAverage.contributionsToOutside },
      ].filter(c => Math.abs(c.amount) > 0.5);
    } else {
      // Other buckets use category breakdown
      const drawerBreakdown = computeBucketBreakdown(
        bucket,
        profile.expenseTxns,
        profile.accountSnapshots,
        profile.debtPaymentHistory,
        completeMonths,
        currency,
        userReviews,
        profile.fxRates || {}
      );
      
      drawerTotal = drawerBreakdown.monthlyAverage;
      
      categories = drawerBreakdown.categories.map(cat => ({
        name: cat.category,
        amount: cat.amount,
      }));
      
      // Extract loan details for Fixed bucket
      if (bucket === "fixed") {
        const loanCategory = drawerBreakdown.categories.find(c => c.category === "Loan payments");
        if (loanCategory) {
          for (const merchant of loanCategory.merchants) {
            loans.push({
              name: merchant.merchant,
              amount: merchant.amount,
            });
          }
        }
      }
    }
    
    const match = Math.abs(cardValue - drawerTotal) < 1; // Allow $1 rounding difference
    
    const report: BucketReport = {
      bucket,
      cardValue,
      drawerTotal,
      match,
      categories,
      loans: loans.length > 0 ? loans : undefined,
    };
    
    reports.push(report);
  }
  
  // Print results
  console.log("=".repeat(80));
  console.log("BUCKET COMPARISON (Card Value vs Drawer Total)");
  console.log("=".repeat(80) + "\n");
  
  let totalMismatches = 0;
  
  for (const report of reports) {
    const status = report.match ? "✓" : "✗ MISMATCH";
    const bucketName = report.bucket.toUpperCase().padEnd(12);
    
    console.log(`${status} ${bucketName}`);
    console.log(`   Card:   ${formatCurrency(report.cardValue, currency)}`);
    console.log(`   Drawer: ${formatCurrency(report.drawerTotal, currency)}`);
    
    if (!report.match) {
      const diff = report.drawerTotal - report.cardValue;
      console.log(`   Diff:   ${formatCurrency(diff, currency)}`);
      totalMismatches++;
    }
    
    if (report.categories && report.categories.length > 0) {
      console.log(`\n   Monthly Average Components:`);
      for (const cat of report.categories) {
        console.log(`     ${cat.name.padEnd(30)} ${formatCurrency(cat.amount, currency)}`);
      }
      
      // For savings, also print the reconciliation table
      if (report.bucket === "savings") {
        console.log(`\n   Per-Month Reconciliation:`);
        console.log(`     Month      Cash Change   Debt Change   Contributions   Net Savings`);
        console.log(`     ${"─".repeat(75)}`);
        
        // Get the window data again for display
        const windowSavings = computeWindowSavings(
          profile.monthlyHistory,
          profile.accountBalanceHistory,
          profile.expenseTxns,
          completeMonths
        );
        
        for (const month of windowSavings.monthlyBreakdown) {
          const monthLabel = month.month.split('-')[1]; // Just the month number
          console.log(
            `     ${monthLabel.padEnd(10)} ` +
            `${formatCurrency(month.netCashChange, currency).padStart(12)}  ` +
            `${formatCurrency(month.netDebtChange, currency).padStart(12)}  ` +
            `${formatCurrency(month.contributionsToOutside, currency).padStart(12)}  ` +
            `${formatCurrency(month.total, currency).padStart(12)}`
          );
        }
        
        console.log(`     ${"─".repeat(75)}`);
        console.log(
          `     Avg       ` +
          `${formatCurrency(windowSavings.monthlyAverage.netCashChange, currency).padStart(12)}  ` +
          `${formatCurrency(windowSavings.monthlyAverage.netDebtChange, currency).padStart(12)}  ` +
          `${formatCurrency(windowSavings.monthlyAverage.contributionsToOutside, currency).padStart(12)}  ` +
          `${formatCurrency(windowSavings.monthlyAverage.total, currency).padStart(12)}`
        );
        
        // Print per-account detail for first month (Harvinder-agnostic fixture)
        if (windowSavings.monthlyBreakdown.length > 0) {
          const firstMonth = windowSavings.monthlyBreakdown[0];
          const monthName = new Date(firstMonth.month + '-15').toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
          
          console.log(`\n   Per-Account Detail for ${monthName}:`);
          
          if (firstMonth.accounts.cashAccounts.length > 0) {
            console.log(`\n     💵 Cash & Savings:`);
            for (const acc of firstMonth.accounts.cashAccounts) {
              const cfFlag = (acc.priorCarriedForward || acc.currentCarriedForward) ? ' [CF]' : '';
              console.log(
                `       ${acc.accountLabel.padEnd(40)} ` +
                `${formatCurrency(acc.priorBalance, currency).padStart(10)} → ` +
                `${formatCurrency(acc.currentBalance, currency).padStart(10)} = ` +
                `${(acc.change >= 0 ? '+' : '') + formatCurrency(acc.change, currency)}${cfFlag}`
              );
            }
            const cashSum = firstMonth.accounts.cashAccounts.reduce((sum, a) => sum + a.change, 0);
            console.log(`       ${'Total Cash Change:'.padEnd(40)} ${formatCurrency(cashSum, currency)} (should match ${formatCurrency(firstMonth.netCashChange, currency)})`);
          }
          
          if (firstMonth.accounts.debtAccounts.length > 0) {
            console.log(`\n     💳 Debt:`);
            for (const acc of firstMonth.accounts.debtAccounts) {
              const cfFlag = (acc.priorCarriedForward || acc.currentCarriedForward) ? ' [CF]' : '';
              const label = acc.change > 0 ? 'Paid down' : acc.change < 0 ? 'New borrowing' : 'No change';
              console.log(
                `       ${acc.accountLabel.padEnd(40)} ` +
                `${formatCurrency(acc.priorBalance, currency).padStart(10)} → ` +
                `${formatCurrency(acc.currentBalance, currency).padStart(10)} = ` +
                `${(acc.change >= 0 ? '+' : '') + formatCurrency(acc.change, currency)} (${label})${cfFlag}`
              );
            }
            const debtSum = firstMonth.accounts.debtAccounts.reduce((sum, a) => sum + a.change, 0);
            console.log(`       ${'Total Debt Change:'.padEnd(40)} ${formatCurrency(debtSum, currency)} (should match ${formatCurrency(firstMonth.netDebtChange, currency)})`);
          }
          
          if (firstMonth.accounts.contributions.length > 0) {
            console.log(`\n     🏦 Outside Contributions:`);
            for (const contrib of firstMonth.accounts.contributions) {
              const confFlag = contrib.needsConfirmation ? ' [Needs confirmation]' : '';
              console.log(
                `       ${contrib.merchant.padEnd(40)} ${formatCurrency(contrib.amount, currency)}${confFlag}`
              );
            }
            const contribSum = firstMonth.accounts.contributions
              .filter(c => !c.needsConfirmation)
              .reduce((sum, c) => sum + c.amount, 0);
            console.log(`       ${'Total Contributions:'.padEnd(40)} ${formatCurrency(contribSum, currency)} (should match ${formatCurrency(firstMonth.contributionsToOutside, currency)})`);
          }
        }
      }
    }
    
    if (report.loans && report.loans.length > 0) {
      console.log(`\n   Loan Details:`);
      for (const loan of report.loans) {
        console.log(`     ${loan.name.padEnd(40)} ${formatCurrency(loan.amount, currency)}`);
      }
    }
    
    console.log();
  }
  
  console.log("=".repeat(80));
  console.log(`SUMMARY: ${totalMismatches} mismatch(es) found`);
  console.log("=".repeat(80) + "\n");
  
  // Compare against baseline
  let baselineComparison;
  if (fs.existsSync(BASELINE_PATH)) {
    const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, "utf-8")) as RegressionReport;
    
    console.log(`📊 Comparing against baseline (${baseline.timestamp}):\n`);
    
    const changes: Array<{ bucket: string; oldValue: number; newValue: number; pctChange: number }> = [];
    let significantChanges = 0;
    
    for (const report of reports) {
      const baselineBucket = baseline.buckets.find(b => b.bucket === report.bucket);
      if (baselineBucket) {
        const oldValue = baselineBucket.cardValue;
        const newValue = report.cardValue;
        const pctChange = oldValue !== 0 ? ((newValue - oldValue) / oldValue) * 100 : 0;
        
        if (Math.abs(pctChange) > 0.1) { // Show any change > 0.1%
          const flag = Math.abs(pctChange) > 5 ? "⚠️  " : "   ";
          console.log(`${flag}${report.bucket.toUpperCase().padEnd(12)} ${formatCurrency(oldValue, currency)} → ${formatCurrency(newValue, currency)} (${pctChange > 0 ? "+" : ""}${pctChange.toFixed(1)}%)`);
          
          changes.push({ bucket: report.bucket, oldValue, newValue, pctChange });
          
          if (Math.abs(pctChange) > 5) {
            significantChanges++;
          }
        }
      }
    }
    
    if (changes.length === 0) {
      console.log("   No changes detected.\n");
    } else {
      console.log();
    }
    
    if (significantChanges > 0) {
      console.log(`⚠️  WARNING: ${significantChanges} bucket(s) changed by more than 5%\n`);
    }
    
    baselineComparison = { changes, significantChanges };
  } else {
    console.log("ℹ️  No baseline found. Run with --save-baseline to create one.\n");
  }
  
  // Save baseline if requested
  if (saveBaseline) {
    const reportData: RegressionReport = {
      uid,
      timestamp: new Date().toISOString(),
      buckets: reports,
      income: {
        typicalMonthly: incomeSummary.typicalMonthly,
        regularSourcesCount: incomeSummary.regularSources.length,
        last3MonthsTotal: incomeSummary.last3MonthsTotal,
      },
      summary: {
        totalMismatches,
        baselineComparison,
      },
    };
    
    fs.writeFileSync(BASELINE_PATH, JSON.stringify(reportData, null, 2), "utf-8");
    console.log(`✅ Baseline saved to ${BASELINE_PATH}\n`);
  }
  
  // Exit with error code if any errors were collected
  if (errors.length > 0) {
    console.error(`\n❌ Test failed with ${errors.length} error(s):`);
    errors.forEach((e, i) => console.error(`   ${i + 1}. ${e}`));
    console.error();
    process.exit(1);
  }
  
  // Exit with error code if mismatches found
  if (totalMismatches > 0) {
    console.error(`❌ Test failed: ${totalMismatches} card/drawer mismatch(es)\n`);
    process.exit(1);
  }
  
  if (baselineComparison && baselineComparison.significantChanges > 0) {
    console.error(`❌ Test failed: ${baselineComparison.significantChanges} significant change(s) from baseline\n`);
    process.exit(1);
  }
  
  console.log("✅ All tests passed\n");
}

// Main
const args = process.argv.slice(2);
const uid = args.find(arg => !arg.startsWith("--"));
const saveBaseline = args.includes("--save-baseline");

if (!uid) {
  console.error("Usage: npx tsx --env-file=.env.local scripts/regression-report.ts <uid> [--save-baseline]");
  process.exit(1);
}

generateReport(uid, saveBaseline).catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
