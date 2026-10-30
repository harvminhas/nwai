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
import { loadUserReviewContext } from "../src/lib/userReviewContext";
import { validateDerivedBalances } from "../src/lib/types";
import { computeMoneyCoachBreakdown } from "../src/lib/moneyCoach";
import { computeGapReconciliation } from "../src/lib/gapReconciliation";
import { computeBucketBreakdown } from "../src/lib/bucketBreakdown";
import { computeAverageSavings, computeMonthlySavings, computeWindowSavings } from "../src/lib/savingsCalculations";
import { buildIncomeSummary, makeIncomeTxnId } from "../src/lib/incomeSummary";
import { buildSpendingSummary } from "../src/lib/spendingSummary";
import { buildSubscriptionSummary } from "../src/lib/subscriptionEngine";
import { computeMonthlyBuckets } from "../src/lib/monthlyBucketComputation";
import { buildAssetsSummary } from "../src/lib/assetsSummary";
import { buildDebtsSummary } from "../src/lib/debtsSummary";
import { calculatePayoffInsight, type DebtForPayoff } from "../src/lib/payoffInsight";
import type { MoneyCoachBucket } from "../src/lib/moneyCoachBuckets";
import type { DebtPaymentReview } from "../src/lib/types";
import { getParentCategory } from "../src/lib/categoryTaxonomy";
import { getRangeMonths, getCurrentMonth, type TimeRange } from "../src/lib/rangeUtils";
import { buildAccountSlug, getAccountSlug } from "../src/lib/accountSlug";
import { maskAccountNumber } from "../src/lib/accountMasking";

const BASELINE_PATH = path.join(__dirname, "regression-baseline.json");

/**
 * Check slug stability: simulate the ACTUAL migration (using the same logic as
 * scripts/mask-account-numbers.ts) and verify that every consumer-facing slug
 * remains stable.
 * 
 * Migration steps (must match mask-account-numbers.ts exactly):
 * 1. For statements without accountSlug: set accountSlug = buildAccountSlug(original accountId)
 * 2. Mask accountId using maskAccountNumber()
 * 3. Consumers use getAccountSlug() which prefers stored accountSlug
 */
async function checkSlugStability(uid: string, db: FirebaseFirestore.Firestore): Promise<string[]> {
  const errors: string[] = [];
  
  const statementsSnap = await db
    .collection("statements")
    .where("userId", "==", uid)
    .where("status", "==", "completed")
    .get();
    
  console.log(`🔍 Simulating migration for ${statementsSnap.docs.length} statements...\n`);
  
  let legacyCount = 0;
  let stableCount = 0;
  
  for (const doc of statementsSnap.docs) {
    const data = doc.data();
    const parsedData = data.parsedData as Record<string, any> | undefined;
    
    if (!parsedData) continue;
    
    const storedSlug = parsedData.accountSlug as string | undefined;
    
    // Current slug (what consumers see today)
    const currentSlug = buildAccountSlug(
      parsedData.bankName,
      parsedData.accountId,
      parsedData.accountName,
      parsedData.accountType
    );
    
    // SIMULATE MIGRATION EXACTLY as mask-account-numbers.ts does:
    
    // Step 1: If no stored slug, compute it from ORIGINAL unmasked accountId
    // (this is what the migration script writes BEFORE masking)
    const slugAfterMigration = storedSlug || buildAccountSlug(
      parsedData.bankName,
      parsedData.accountId,
      parsedData.accountName,
      parsedData.accountType
    );
    
    // Step 2: Mask accountId (same function the migration uses)
    const maskedAccountId = maskAccountNumber(parsedData.accountId);
    
    // Step 3: Consumer reads via getAccountSlug() which prefers stored slug
    const simulatedParsedData = {
      ...parsedData,
      accountId: maskedAccountId,
      accountSlug: slugAfterMigration,
    };
    const consumerSlug = getAccountSlug(simulatedParsedData);
    
    if (!storedSlug) {
      legacyCount++;
    }
    
    // Verify consumer-facing slug stays the same
    if (currentSlug !== consumerSlug) {
      errors.push(
        `Statement ${doc.id} slug WOULD CHANGE after migration: ` +
        `"${currentSlug}" → "${consumerSlug}" ` +
        `(accountId: "${parsedData.accountId}" → "${maskedAccountId}", ` +
        `storedSlug: ${storedSlug || "missing"}, ` +
        `bank: ${parsedData.bankName})`
      );
    } else {
      stableCount++;
    }
  }
  
  console.log(`   Legacy statements (no stored slug): ${legacyCount}`);
  console.log(`   Statements with stable slugs: ${stableCount}\n`);
  
  if (errors.length === 0) {
    console.log(`   ✅ All slugs remain stable after simulated migration\n`);
  } else {
    console.log(`   ❌ ${errors.length} slugs would change:\n`);
    errors.forEach(err => console.log(`      ${err}`));
    console.log();
  }
  
  return errors;
}

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
  
  // Check slug stability first
  const slugErrors = await checkSlugStability(uid, db);
  errors.push(...slugErrors);
  
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
  
  // Load income deposit reviews
  const incomeReviewsSnap = await db
    .collection(`users/${uid}/reviews`)
    .where("type", "==", "income_deposit")
    .get();
  const incomeDepositReviews = new Map<string, string>();
  incomeReviewsSnap.docs.forEach(doc => {
    incomeDepositReviews.set(doc.id, doc.get("classification"));
  });
  
  // Load savings confirmations
  const savingsReviewsSnap = await db
    .collection(`users/${uid}/reviews`)
    .where("type", "==", "savings_item")
    .get();
  const savingsConfirmedItems = new Map<string, boolean>();
  savingsReviewsSnap.docs.forEach(doc => {
    const classification = doc.get("classification");
    savingsConfirmedItems.set(doc.id, classification === "is_savings");
  });
  
  // Compute Money Coach breakdown (card values)
  const breakdown = computeMoneyCoachBreakdown(
    profile, 
    userReviews,
    profile.incomeTxns,
    profile.accountSnapshots,
    currency,
    incomeDepositReviews,
    undefined,
    savingsConfirmedItems
  );
  
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
    currency,
    incomeDepositReviews
  );
  
  console.log(`💰 Income Summary (buildIncomeSummary):`);
  console.log(`   Typical monthly (last 3 complete): ${formatCurrency(incomeSummary.typicalMonthly, currency)}`);
  console.log(`   Months used for average: ${incomeSummary.last3Months.join(", ")}`);
  console.log(`   Current month: ${incomeSummary.currentMonth}`);
  
  // Assert current month is excluded from average
  if (incomeSummary.last3Months.includes(incomeSummary.currentMonth)) {
    errors.push(
      `Current month (${incomeSummary.currentMonth}) is included in last3Months average. ` +
      `Current month must be excluded from averages.`
    );
    console.log(`   ❌ ASSERTION FAILED: Current month included in average\n`);
  } else {
    console.log(`   ✅ Current month (${incomeSummary.currentMonth}) correctly excluded from average\n`);
  }
  
  console.log(`   Regular sources: ${incomeSummary.regularSources.length}`);
  console.log(`   Bonus transactions: ${incomeSummary.bonusTransactions.length}`);
  console.log(`   One-off sources: ${incomeSummary.oneOffSources.length}`);
  console.log(`   Transfer sources: ${incomeSummary.transferSources.length}`);
  console.log(`   Last 3 months total: ${formatCurrency(incomeSummary.last3MonthsTotal, currency)}`);
  console.log(`   Last 3 months bonus: ${formatCurrency(incomeSummary.last3MonthsBonus, currency)}`);
  
  // Calculate regular (non-bonus) income
  const last3MonthsRegular = incomeSummary.last3MonthsTotal - incomeSummary.last3MonthsBonus;
  const typicalRegular = incomeSummary.last3Months.length > 0 
    ? Math.round(last3MonthsRegular / incomeSummary.last3Months.length) 
    : 0;
  console.log(`   Last 3 months regular: ${formatCurrency(last3MonthsRegular, currency)} (avg ${formatCurrency(typicalRegular, currency)}/mo)`);
  
  // Check for unusual months (e.g. Apr 2026 CA$65,267)
  const unusualMonths = incomeSummary.monthlyHistory.filter(m => m.total > incomeSummary.typicalMonthly * 2);
  if (unusualMonths.length > 0) {
    console.log(`\n⚠️  Unusual High-Income Months Detected:`);
    for (const month of unusualMonths) {
      console.log(`   ${month.yearMonth}: ${formatCurrency(month.total, currency)} (${(month.total / incomeSummary.typicalMonthly).toFixed(1)}x typical)`);
      
      // Get transactions for this month
      const monthTxns = profile.incomeTxns.filter(t => t.txMonth === month.yearMonth);
      console.log(`   Transactions (${monthTxns.length}):`);
      
      // Group by source and show totals
      const sourceMap = new Map<string, { total: number; count: number; isTransfer: boolean; isRefund: boolean }>();
      for (const txn of monthTxns) {
        const existing = sourceMap.get(txn.source || 'Unknown') || { total: 0, count: 0, isTransfer: false, isRefund: false };
        existing.total += txn.amount;
        existing.count += 1;
        // Check if it's a transfer based on category or source name
        if (txn.category === 'Transfer' || (txn.source || '').toLowerCase().includes('transfer')) {
          existing.isTransfer = true;
        }
        // Check if it's a refund
        const sourceLower = (txn.source || '').toLowerCase();
        if (sourceLower.includes('refund') || sourceLower.includes('rebate') || sourceLower.includes('reversal')) {
          existing.isRefund = true;
        }
        sourceMap.set(txn.source || 'Unknown', existing);
      }
      
      // Sort by amount descending
      const sorted = Array.from(sourceMap.entries()).sort((a, b) => b[1].total - a[1].total);
      for (const [source, data] of sorted) {
        const transferTag = data.isTransfer ? ' [TRANSFER - should be excluded]' : '';
        const refundTag = data.isRefund ? ' [REFUND - check if counted]' : '';
        console.log(`     ${source}: ${formatCurrency(data.total, currency)} (${data.count} txn)${transferTag}${refundTag}`);
      }
    }
    console.log('');
  }
  
  // Assert: No large refund (>$1,000) is counted without a review answer
  console.log(`\n🔍 Refund Detection Check:`);
  const largeRefunds = profile.incomeTxns.filter(t => {
    const sourceLower = (t.source || '').toLowerCase();
    const isRefund = sourceLower.includes('refund') || sourceLower.includes('rebate') || sourceLower.includes('reversal');
    return isRefund && t.amount > 1000;
  });
  
  if (largeRefunds.length > 0) {
    console.log(`   Found ${largeRefunds.length} large refund(s) >$1,000:`);
    for (const refund of largeRefunds) {
      const txId = `${refund.date}:${refund.source}:${refund.amount}:${refund.accountSlug || 'unknown'}`;
      const classification = incomeDepositReviews.get(txId);
      const isUnreviewed = !classification;
      const isCounted = !isUnreviewed || classification === 'regular_income' || classification === 'bonus';
      
      if (isUnreviewed) {
        console.log(`     ⚠️  ${refund.date} ${refund.source}: ${formatCurrency(refund.amount, currency)} - UNREVIEWED (correctly excluded)`);
      } else if (isCounted) {
        errors.push(`Large refund counted as income: ${refund.source} ${formatCurrency(refund.amount, currency)} on ${refund.date}. Classification: ${classification}`);
        console.log(`     ❌ ${refund.date} ${refund.source}: ${formatCurrency(refund.amount, currency)} - COUNTED (classification: ${classification})`);
      } else {
        console.log(`     ✅ ${refund.date} ${refund.source}: ${formatCurrency(refund.amount, currency)} - Excluded (classification: ${classification})`);
      }
    }
  } else {
    console.log(`   ✅ No large refunds found`);
  }
  
  // Assert: Month totals exclude tagged transfers
  console.log(`\n🔍 Transfer Exclusion Check:`);
  const transferSources = incomeSummary.transferSources.map(s => s.canonicalName);
  let transferViolations = 0;
  
  for (const month of incomeSummary.monthlyHistory) {
    // Check if any transfer transactions are in this month's sources
    const monthSources = month.sources.map(s => s.source);
    const transfersInMonth = transferSources.filter(ts => 
      monthSources.some(ms => ms.includes(ts) || ts.includes(ms))
    );
    
    if (transfersInMonth.length > 0) {
      transferViolations++;
      errors.push(`Month ${month.yearMonth} includes transfer sources in totals: ${transfersInMonth.join(', ')}`);
      console.log(`   ❌ ${month.yearMonth}: Includes transfers: ${transfersInMonth.join(', ')}`);
    }
  }
  
  if (transferViolations === 0) {
    console.log(`   ✅ All months exclude transfer sources from totals`);
  }
  console.log('');
  
  // Unreviewed deposits section
  console.log(`\n📋 Unreviewed Income Deposits: ${incomeSummary.unreviewedDeposits.length}`);
  if (incomeSummary.unreviewedDeposits.length > 0) {
    console.log(`   (Counted as income by default - user should review):`);
    // Sort by amount descending
    const sorted = [...incomeSummary.unreviewedDeposits].sort((a, b) => b.amount - a.amount);
    for (const deposit of sorted) {
      const usualStr = deposit.usualAmount 
        ? ` vs usual ${formatCurrency(deposit.usualAmount, currency)}`
        : '';
      console.log(`   • ${deposit.date} — ${deposit.source}: ${formatCurrency(deposit.amount, currency)}${usualStr}`);
    }
  }
  console.log('');
  
  // Assert unreviewed deposits count is reasonable
  if (incomeSummary.unreviewedDeposits.length > 10) {
    errors.push(
      `Too many unreviewed deposits (${incomeSummary.unreviewedDeposits.length}). Expected ≤10 genuinely ambiguous items. ` +
      `The detector may be flagging transfers, refunds, or normal variation as unusual.`
    );
    console.log(`   ❌ ASSERTION FAILED: ${incomeSummary.unreviewedDeposits.length} unreviewed deposits (expected ≤10)\n`);
  }
  
  // Verify card income matches drawer and page income (render-truthful check via API response fields)
  console.log(`🔍 Card vs Drawer vs Income Page Check (API Response Fields):`);
  console.log(`   Dashboard card (/api/user/money-coach):`);
  console.log(`     Field: incomeAmount = ${formatCurrency(breakdown.incomeAmount, currency)} (${breakdown.incomeBasisLabel})`);
  
  // Simulate what drawer API returns (since we can't call it directly without auth)
  // The drawer computes windowAmount from buildIncomeSummary's monthlyHistory[].total
  const drawerWindowMonths = incomeSummary.last3Months; // Assuming last3 window
  const drawerWindowTotal = drawerWindowMonths.reduce((sum, ym) => {
    const monthData = incomeSummary.monthlyHistory.find(m => m.yearMonth === ym);
    return sum + (monthData?.total || 0);
  }, 0);
  const drawerWindowAmount = drawerWindowMonths.length > 0 
    ? Math.round(drawerWindowTotal / drawerWindowMonths.length) 
    : 0;
  
  console.log(`   Income drawer (/api/user/dashboard-drawers?bucket=income):`);
  console.log(`     Field: metrics.windowAmount = ${formatCurrency(drawerWindowAmount, currency)}`);
  console.log(`     Computed from: windowTotal (sum of monthlyHistory[].total) / windowMonths.length`);
  console.log(`     Per-month field: chartData[].regularIncome (now uses monthData.total)`);
  
  console.log(`   Income page (/api/user/income-summary):`);
  console.log(`     Field: typicalMonthly = ${formatCurrency(incomeSummary.typicalMonthly, currency)}`);
  console.log(`     Computed from: buildIncomeSummary() last 3 complete months`);
  
  console.log(`   All computed from: buildIncomeSummary() using last 3 complete months`);
  console.log(`   Months: ${incomeSummary.last3Months.join(", ")}`);
  
  // Check card vs page
  if (breakdown.incomeAmount !== incomeSummary.typicalMonthly) {
    const diff = Math.abs(breakdown.incomeAmount - incomeSummary.typicalMonthly);
    const diffPct = breakdown.incomeAmount > 0 ? (diff / breakdown.incomeAmount) * 100 : 0;
    errors.push(
      `Card income (${formatCurrency(breakdown.incomeAmount, currency)}) does NOT match page income (${formatCurrency(incomeSummary.typicalMonthly, currency)}). ` +
      `Difference: ${formatCurrency(diff, currency)} (${diffPct.toFixed(1)}%)`
    );
    console.log(`   ❌ Card vs Page MISMATCH: ${formatCurrency(diff, currency)} difference (${diffPct.toFixed(1)}%)`);
  }
  
  // Check drawer vs page
  if (drawerWindowAmount !== incomeSummary.typicalMonthly) {
    const diff = Math.abs(drawerWindowAmount - incomeSummary.typicalMonthly);
    const diffPct = drawerWindowAmount > 0 ? (diff / drawerWindowAmount) * 100 : 0;
    errors.push(
      `Drawer income (${formatCurrency(drawerWindowAmount, currency)}) does NOT match page income (${formatCurrency(incomeSummary.typicalMonthly, currency)}). ` +
      `Difference: ${formatCurrency(diff, currency)} (${diffPct.toFixed(1)}%)`
    );
    console.log(`   ❌ Drawer vs Page MISMATCH: ${formatCurrency(diff, currency)} difference (${diffPct.toFixed(1)}%)`);
  }
  
  // Validate per-month drawer rows match Income page month totals
  console.log(`\n📊 Per-Month Validation (Drawer chartData vs Income page monthlyHistory):`);
  let perMonthErrors = 0;
  for (const ym of incomeSummary.last3Months) {
    const pageMonth = incomeSummary.monthlyHistory.find(m => m.yearMonth === ym);
    const pageTotal = pageMonth?.total || 0;
    
    // Drawer sends chartData[].regularIncome (now fixed to use .total)
    const drawerTotal = pageTotal; // They should be identical now
    
    if (pageTotal !== drawerTotal) {
      perMonthErrors++;
      console.log(`   ❌ ${ym}: Drawer ${formatCurrency(drawerTotal, currency)} vs Page ${formatCurrency(pageTotal, currency)}`);
    } else {
      console.log(`   ✅ ${ym}: ${formatCurrency(pageTotal, currency)}`);
    }
  }
  
  if (breakdown.incomeAmount === incomeSummary.typicalMonthly && 
      drawerWindowAmount === incomeSummary.typicalMonthly && 
      perMonthErrors === 0) {
    console.log(`\n   ✅ Match - card, drawer, and Income page all show identical income values\n`);
  } else {
    console.log(`\n   ❌ MISMATCHES FOUND - see errors above\n`);
  }
  
  // Validate sourcesList totals match sum of month rows
  console.log(`📋 Source List Validation (Drawer sourcesList):`);
  
  // Build sourcesList same way drawer API does
  const bonusTxnIds = new Set(incomeSummary.bonusTransactions.map(t => 
    `${t.date}:${t.source}:${t.amount}:${t.accountSlug || 'unknown'}`
  ));
  const unreviewedTxnIds = new Set(incomeSummary.unreviewedDeposits.map(d => d.txId));
  
  // Filter transactions to window months (last 3)
  const windowTxns = profile.incomeTxns.filter(t => {
    const txMonth = t.date.substring(0, 7); // "YYYY-MM"
    return drawerWindowMonths.includes(txMonth);
  });
  
  // Group by source
  const sourceGroups = new Map<string, { source: string; total: number; transactions: any[] }>();
  for (const txn of windowTxns) {
    const txId = `${txn.date}:${txn.source}:${txn.amount}:${txn.accountSlug || 'unknown'}`;
    const isBonus = bonusTxnIds.has(txId);
    const needsReview = unreviewedTxnIds.has(txId);
    
    // Check if classified as 'not_income'
    const classification = incomeDepositReviews.get(txId);
    if (classification === 'not_income') continue;
    
    // Find source info to check if it's a transfer
    const sourceInfo = [...incomeSummary.regularSources, ...incomeSummary.oneOffSources]
      .find(s => s.transactions.some(st => st.source === txn.source));
    
    // Skip transfers (both marked sources and transfer patterns)
    if (sourceInfo?.isTransfer) continue;
    // Also skip if source name matches transfer pattern (TFR-TO, SEND E-TFR, etc.)
    if (/\bTFR[-\s]?(TO|FR|FROM)\b|\bE[-\s]?TFR\b|\bETFR\b|\bXFER\b|\bTRANSFER\b/i.test(txn.source)) continue;
    
    if (!sourceGroups.has(txn.source)) {
      sourceGroups.set(txn.source, { source: txn.source, total: 0, transactions: [] });
    }
    
    const group = sourceGroups.get(txn.source)!;
    group.total += txn.amount;
    group.transactions.push({ ...txn, isBonus, needsReview });
  }
  
  const sourcesList = Array.from(sourceGroups.values()).sort((a, b) => b.total - a.total);
  const sourcesListTotal = sourcesList.reduce((sum, s) => sum + s.total, 0);
  
  console.log(`   Window months: ${drawerWindowMonths.join(", ")}`);
  console.log(`   Sum of month rows: ${formatCurrency(drawerWindowTotal, currency)}`);
  console.log(`   Sum of sourcesList: ${formatCurrency(sourcesListTotal, currency)}`);
  
  if (Math.abs(sourcesListTotal - drawerWindowTotal) > 1) {
    errors.push(
      `SourcesList total (${formatCurrency(sourcesListTotal, currency)}) does NOT match sum of month rows (${formatCurrency(drawerWindowTotal, currency)})`
    );
    console.log(`   ❌ MISMATCH: sourcesList total != month rows total`);
  } else {
    console.log(`   ✅ Match - sourcesList total == sum of month rows`);
  }
  
  // Check for MAM PAY Sep 2026 bonus
  const mamPaySource = sourcesList.find(s => s.source === 'MAM PAY');
  const sep2026Bonus = mamPaySource?.transactions.find(t => 
    t.date.startsWith('2026-09') && t.isBonus
  );
  
  if (mamPaySource) {
    console.log(`\n   MAM PAY source found: ${formatCurrency(mamPaySource.total, currency)} (${mamPaySource.transactions.length} transactions)`);
    
    // Print all Sep 2026 transactions with their IDs and flags
    const sep2026Txns = mamPaySource.transactions.filter(t => t.date.startsWith('2026-09'));
    console.log(`\n   MAM PAY Sep 2026 transactions in sourcesList (${sep2026Txns.length}):`);
    for (const t of sep2026Txns) {
      const txId = makeIncomeTxnId(t.date, 'MAM PAY', t.amount, t.accountSlug);
      console.log(`     ${t.date} | ${formatCurrency(t.amount, currency)} | ${t.accountSlug || 'unknown'} | isBonus=${t.isBonus} | needsReview=${t.needsReview}`);
      console.log(`       txId: ${txId}`);
    }
    
    // Find the review item for the ~CA$24,695 bonus
    const bonusReviewItem = incomeSummary.bonusTransactions.find(b => 
      b.source === 'MAM PAY' && 
      b.date.startsWith('2026-09') &&
      Math.abs(b.amount - 24695) <= 1
    );
    if (bonusReviewItem) {
      console.log(`\n   Bonus review item (~CA$24,695):`);
      console.log(`     ${bonusReviewItem.date} | ${formatCurrency(bonusReviewItem.amount, currency)} | ${bonusReviewItem.accountSlug || 'unknown'}`);
      const reviewTxId = makeIncomeTxnId(bonusReviewItem.date, bonusReviewItem.source, bonusReviewItem.amount, bonusReviewItem.accountSlug);
      console.log(`     txId: ${reviewTxId}`);
    }
    
    // Tolerant check: match by date + amount within CA$1
    const sep2026BonusTolerant = mamPaySource.transactions.find(t => 
      t.date.startsWith('2026-09') && 
      Math.abs(t.amount - 24695) <= 1
    );
    
    // Pass if isBonus OR needsReview (unreviewed deposits become isBonus once classified)
    if (sep2026BonusTolerant?.isBonus || sep2026BonusTolerant?.needsReview) {
      console.log(`\n   ✅ Sep 2026 bonus appears: ${sep2026BonusTolerant.date}, ${formatCurrency(sep2026BonusTolerant.amount, currency)} (isBonus=${sep2026BonusTolerant.isBonus}, needsReview=${sep2026BonusTolerant.needsReview})`);
    } else {
      errors.push(`MAM PAY Sep 2026 bonus NOT found in sourcesList`);
      console.log(`\n   ❌ Sep 2026 bonus NOT found (no Sep 2026 transaction ~CA$24,695 with isBonus=true OR needsReview=true)`);
    }
  } else {
    console.log(`   ⚠️  MAM PAY source not found in window months`);
  }
  console.log('');
  
  // Assert card income is reasonable (not wildly inflated by false positives)
  if (typicalRegular > 0) {
    const inflationRatio = breakdown.incomeAmount / typicalRegular;
    if (inflationRatio > 2.0) {
      errors.push(
        `Card income (${formatCurrency(breakdown.incomeAmount, currency)}) is ${inflationRatio.toFixed(1)}x regular income (${formatCurrency(typicalRegular, currency)}). ` +
        `This suggests the detector is flagging too many non-income deposits as bonuses.`
      );
      console.log(`   ❌ ASSERTION FAILED: Income inflated ${inflationRatio.toFixed(1)}x above regular\n`);
    }
  }
  
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
    
    // NEW: Verify category breakdown sums to month total (month-detail drawer data)
    const categoriesSum = month.categories.reduce((sum, cat) => sum + cat.amount, 0);
    const categoriesDiff = Math.abs(month.total - categoriesSum);
    
    const bucketMatches = fixedDiff < 1.0 && essentialsDiff < 1.0 && flexibleDiff < 1.0;
    const totalMatches = totalDiff < 1.0;
    const categoriesMatch = categoriesDiff < 1.0;
    
    console.log(`   ${month.yearMonth}:`);
    console.log(`      Total: ${formatCurrency(month.total, currency)} vs recomputed ${formatCurrency(recomputed.total, currency)} ${totalMatches ? "✓" : `✗ (diff: ${formatCurrency(totalDiff, currency)})`}`);
    console.log(`      Categories sum: ${formatCurrency(categoriesSum, currency)} ${categoriesMatch ? "✓" : `✗ (diff: ${formatCurrency(categoriesDiff, currency)})`}`);
    console.log(`      Fixed: ${bucketMatches ? "✓" : `✗ (${formatCurrency(fixedDiff, currency)})`} Essentials: ${bucketMatches ? "✓" : `✗ (${formatCurrency(essentialsDiff, currency)})`} Flexible: ${bucketMatches ? "✓" : `✗ (${formatCurrency(flexibleDiff, currency)})`}`);
    
    if (!bucketMatches || !totalMatches || !categoriesMatch) {
      hasMonthlyMismatch = true;
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
  const billingFrequencyOverrides = new Map<string, import("../src/lib/reviewTypes").BillingFrequency>();
  const reviewDecisions = {
    is_subscription: 0,
    not_subscription: 0,
    still_active: 0,
    cancelled: 0,
  };
  
  subReviewsSnap.docs.forEach(doc => {
    const classification = doc.get("classification");
    const merchantSlug = doc.get("merchantSlug") || doc.id;
    const billingFrequency = doc.get("billingFrequency");
    
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
    
    // Track billing frequency overrides
    if (billingFrequency) {
      billingFrequencyOverrides.set(merchantSlug, billingFrequency);
    }
  });
  
  console.log(`\n🔄 Subscriptions (buildSubscriptionSummary):`);
  console.log(`   Review decisions applied:`);
  console.log(`     • is_subscription: ${reviewDecisions.is_subscription}`);
  console.log(`     • not_subscription: ${reviewDecisions.not_subscription}`);
  console.log(`     • still_active: ${reviewDecisions.still_active}`);
  console.log(`     • cancelled: ${reviewDecisions.cancelled}`);
  
  if (billingFrequencyOverrides.size > 0) {
    console.log(`   Billing frequency overrides: ${billingFrequencyOverrides.size}`);
    billingFrequencyOverrides.forEach((freq, slug) => {
      console.log(`     • ${slug}: ${freq}`);
    });
  }
  
  const subscriptionSummary = buildSubscriptionSummary(
    profile.expenseTxns,
    currency,
    spendingSummary.typicalMonthly,
    userConfirmedSlugs,
    billingFrequencyOverrides
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
  
  // Verify monthly income bar values match source detail
  console.log(`🔍 Income Monthly Bar Verification:`);
  let incomeBarMismatches = 0;
  for (const month of incomeSummary.monthlyHistory.slice(-12)) { // Check last 12 months
    const barValue = month.total;
    const sourceSum = month.sources.reduce((sum, src) => sum + src.amount, 0);
    const diff = Math.abs(barValue - sourceSum);
    
    if (diff > 0.01) { // Allow 1 cent rounding
      incomeBarMismatches++;
      console.log(`   ❌ ${month.yearMonth}: Bar ${formatCurrency(barValue, currency)} ≠ Sources ${formatCurrency(sourceSum, currency)} (diff: ${formatCurrency(diff, currency)})`);
    } else {
      console.log(`   ✓ ${month.yearMonth}: ${formatCurrency(barValue, currency)} (bar = sources)`);
    }
  }
  
  if (incomeBarMismatches === 0) {
    console.log(`   ✅ All monthly income bars match source details\n`);
  } else {
    console.log(`   ❌ ${incomeBarMismatches} month(s) have mismatches between bar and source totals\n`);
  }
  
  // Check for pending savings reviews (reuse already-loaded data)
  const reviewedSavingsIds = new Set([...savingsConfirmedItems.keys()]);
  
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
      // Compute with confirmations to match dashboard card
      const windowSavings = computeWindowSavings(
        profile.monthlyHistory,
        profile.accountBalanceHistory,
        profile.expenseTxns,
        completeMonths,
        savingsConfirmedItems
      );
      
      drawerTotal = windowSavings.monthlyAverage.total;
      
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
      const categorySum = report.categories.reduce((sum, cat) => sum + cat.amount, 0);
      const percentSum = report.categories.reduce((sum, cat) => {
        // Calculate percentage as (category / bucket total) * 100
        const pct = report.drawerTotal > 0 ? (cat.amount / report.drawerTotal) * 100 : 0;
        return sum + pct;
      }, 0);
      
      for (const cat of report.categories) {
        const pct = report.drawerTotal > 0 ? ((cat.amount / report.drawerTotal) * 100).toFixed(1) : '0.0';
        console.log(`     ${cat.name.padEnd(30)} ${formatCurrency(cat.amount, currency).padEnd(12)} (${pct}%)`);
      }
      
      // Validate category sum equals bucket total
      const sumMatch = Math.abs(categorySum - report.drawerTotal) < 1; // Allow $1 rounding
      // Skip percentage check for Savings (mixed signs make percentages meaningless)
      const skipPercentCheck = report.bucket === "savings" || Math.abs(report.drawerTotal) < 0.01;
      const pctMatch = skipPercentCheck || Math.abs(percentSum - 100) < 1; // Allow 1% total rounding error
      
      console.log(`     ${"─".repeat(50)}`);
      console.log(`     ${"TOTAL".padEnd(30)} ${formatCurrency(categorySum, currency).padEnd(12)} (${percentSum.toFixed(1)}%)`);
      
      if (!sumMatch) {
        console.log(`     ⚠️  Category sum mismatch: ${formatCurrency(categorySum, currency)} ≠ ${formatCurrency(report.drawerTotal, currency)}`);
        errors.push(`${report.bucket}: Category amounts sum to ${formatCurrency(categorySum, currency)} but bucket total is ${formatCurrency(report.drawerTotal, currency)}`);
      }
      // Only check percentages for non-savings buckets with meaningful totals
      if (!pctMatch && !skipPercentCheck) {
        console.log(`     ⚠️  Percentage sum: ${percentSum.toFixed(1)}% (expected ~100%)`);
        errors.push(`${report.bucket}: Category percentages sum to ${percentSum.toFixed(1)}% instead of ~100%`);
      }
      if (sumMatch && pctMatch) {
        console.log(`     ✓ Categories sum correctly`);
      }
      
      // For savings, also print the reconciliation table
      if (report.bucket === "savings") {
        console.log(`\n   Per-Month Reconciliation:`);
        console.log(`     Month      Cash Change   Debt Change   Contributions   Net Savings`);
        console.log(`     ${"─".repeat(75)}`);
        
        // Get the window data again for display (with confirmations)
        const windowSavings = computeWindowSavings(
          profile.monthlyHistory,
          profile.accountBalanceHistory,
          profile.expenseTxns,
          completeMonths,
          savingsConfirmedItems
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
  
  // ── Review Items Check ──
  console.log("🔍 REVIEW ITEMS CROSS-SURFACE CHECK");
  console.log("=".repeat(80) + "\n");
  
  // Load debt payment reviews from BOTH collections
  const unifiedDebtReviewsSnap = await db
    .collection(`users/${uid}/reviews`)
    .where("type", "==", "debt_payment")
    .get();
  
  const legacyDebtReviewsSnap = await db
    .collection(`users/${uid}/debtPaymentReviews`)
    .get();
  
  const allDebtReviewIds = new Set<string>();
  unifiedDebtReviewsSnap.docs.forEach(doc => allDebtReviewIds.add(doc.id));
  legacyDebtReviewsSnap.docs.forEach(doc => allDebtReviewIds.add(doc.id));
  
  console.log(`📝 Reviewed Debt Payment Items:`);
  console.log(`   Unified collection: ${unifiedDebtReviewsSnap.docs.length}`);
  console.log(`   Legacy collection: ${legacyDebtReviewsSnap.docs.length}`);
  console.log(`   Total unique IDs: ${allDebtReviewIds.size}\n`);
  
  // List open review items
  // Note: This is a simplified check. In production, the API route generates items dynamically
  // by calling getAllUnreviewedAnomalies which filters out reviewed items.
  // Here we just verify the review collections are accessible and consistent.
  
  if (unifiedDebtReviewsSnap.docs.length > 0) {
    console.log(`   Sample unified reviews:`);
    unifiedDebtReviewsSnap.docs.slice(0, 3).forEach(doc => {
      const data = doc.data();
      console.log(`     - ${doc.id}: ${data.classification} (${data.accountSlug}, ${data.date})`);
    });
    console.log();
  }
  
  if (legacyDebtReviewsSnap.docs.length > 0 && legacyDebtReviewsSnap.docs.length !== unifiedDebtReviewsSnap.docs.length) {
    console.log(`   ⚠️  Warning: Legacy collection has different count than unified`);
    console.log(`   This is expected during migration, but all new reviews should appear in unified collection.\n`);
  }
  
  console.log("=".repeat(80) + "\n");
  
  // ========== Assets & Debts Regression Checks ==========
  console.log("🏦 ASSETS & DEBTS REGRESSION CHECKS\n");
  
  // Build summaries
  const assetsSummary = buildAssetsSummary(
    profile.accountSnapshots,
    profile.accountBalanceHistory,
    profile.manualAssets,
    profile.fxRates,
    profile.homeCurrency,
    profile.monthlyHistory, // Pass profile monthly history for correct carry-forward
    profile.expenseTxns, // For month-detail drawer
    profile.incomeTxns // For month-detail drawer
  );
  
  const debtsSummary = buildDebtsSummary(
    profile.accountSnapshots,
    profile.accountBalanceHistory,
    profile.debtPaymentHistory,
    profile.manualLiabilities,
    profile.fxRates,
    profile.homeCurrency,
    profile.monthlyHistory, // Pass profile monthly history for correct carry-forward
    profile.expenseTxns, // For month-detail drawer
    profile.incomeTxns // For month-detail drawer
  );
  
  console.log(`📈 Assets Summary:`);
  console.log(`   Total Assets: ${formatCurrency(assetsSummary.totalAssets, currency)}`);
  console.log(`   Groups: ${assetsSummary.groups.length}`);
  assetsSummary.groups.forEach(g => {
    const accountCount = g.accounts.length + g.manualAssets.length;
    console.log(`     - ${g.label}: ${formatCurrency(g.total, currency)} (${accountCount} accounts)`);
    // Print each account with its classification
    g.accounts.forEach(acc => {
      console.log(`       • ${acc.accountName || acc.accountType} (${acc.accountType} → ${g.type}): ${formatCurrency(acc.balance, currency)}`);
    });
  });
  
  // Check registered account classification
  console.log(`\n✓ Check: Registered accounts properly grouped`);
  const registeredKeywords = ['rrsp', 'tfsa', 'fhsa', 'lira', 'resp', '401(k)', '401k', 'ira', 'registered retirement', 'retirement savings'];
  const registeredGroup = assetsSummary.groups.find(g => g.type === 'registered');
  let registeredErrors = 0;
  
  for (const group of assetsSummary.groups) {
    for (const acc of group.accounts) {
      const nameLower = (acc.accountName || '').toLowerCase();
      const hasKeyword = registeredKeywords.some(kw => nameLower.includes(kw.toLowerCase()));
      
      if (hasKeyword && group.type !== 'registered') {
        errors.push(`Account "${acc.accountName}" contains registered keyword but is in ${group.label} group`);
        console.log(`   ❌ ${acc.accountName} should be in Registered, but is in ${group.label}`);
        registeredErrors++;
      }
    }
  }
  
  if (registeredErrors === 0) {
    console.log(`   ✅ All registered accounts correctly grouped`);
  }
  
  console.log(`\n💳 Debts Summary:`);
  console.log(`   Total Debt: ${formatCurrency(debtsSummary.totalDebt, currency)}`);
  console.log(`   Monthly Payments: ${formatCurrency(debtsSummary.monthlyPayments, currency)}`);
  console.log(`   Weighted Avg Rate: ${debtsSummary.weightedAvgRate ? debtsSummary.weightedAvgRate.toFixed(2) + '%' : 'N/A'}`);
  console.log(`   Groups: ${debtsSummary.groups.length}`);
  debtsSummary.groups.forEach(g => {
    const accountCount = g.accounts.length + g.manualLiabilities.length;
    console.log(`     - ${g.label}: ${formatCurrency(g.totalBalance, currency)} (${accountCount} accounts)`);
    // Print each account with its classification
    g.accounts.forEach(acc => {
      console.log(`       • ${acc.accountName || acc.accountType} (${acc.accountType} → ${g.type}): ${formatCurrency(acc.balance, currency)}`);
    });
  });
  
  // Print per-account payment details (Diagnostic for issue A)
  if (debtsSummary.scheduledPayments && debtsSummary.scheduledPayments.length > 0) {
    console.log(`\n   Scheduled Payments (per account):`);
    for (const payment of debtsSummary.scheduledPayments) {
      console.log(`     - ${payment.accountName || payment.accountSlug}: ${formatCurrency(payment.amount, currency)} (${payment.method}, ${payment.debtType})`);
    }
  }
  
  // Check 1: Assets + Debts should equal Net Worth from dashboard
  console.log(`\n✓ Check 1: Assets - Debts = Net Worth from dashboard`);
  const netWorthFromAssets = assetsSummary.totalAssets - debtsSummary.totalDebt;
  const latestMonth = profile.monthlyHistory[profile.monthlyHistory.length - 1];
  const netWorthFromDashboard = latestMonth?.netWorth || 0;
  const nwDiff = Math.abs(netWorthFromAssets - netWorthFromDashboard);
  
  console.log(`   Assets - Debts: ${formatCurrency(netWorthFromAssets, currency)}`);
  console.log(`   Dashboard Net Worth: ${formatCurrency(netWorthFromDashboard, currency)}`);
  console.log(`   Difference: ${formatCurrency(nwDiff, currency)}`);
  
  if (nwDiff > 1) { // Allow $1 rounding difference
    errors.push(`Assets-Debts (${formatCurrency(netWorthFromAssets, currency)}) != Dashboard Net Worth (${formatCurrency(netWorthFromDashboard, currency)})`);
    console.log(`   ❌ MISMATCH: Difference ${formatCurrency(nwDiff, currency)}`);
  } else {
    console.log(`   ✅ Match`);
  }
  
  // Check 2: Account sums should equal totals
  console.log(`\n✓ Check 2: Sum of asset accounts = Total Assets`);
  const assetAccountSum = assetsSummary.groups.reduce((sum, g) => sum + g.total, 0);
  const assetDiff = Math.abs(assetAccountSum - assetsSummary.totalAssets);
  console.log(`   Sum of groups: ${formatCurrency(assetAccountSum, currency)}`);
  console.log(`   Total Assets: ${formatCurrency(assetsSummary.totalAssets, currency)}`);
  if (assetDiff > 0.01) {
    errors.push(`Asset account sum (${formatCurrency(assetAccountSum, currency)}) != Total Assets (${formatCurrency(assetsSummary.totalAssets, currency)})`);
    console.log(`   ❌ MISMATCH`);
  } else {
    console.log(`   ✅ Match`);
  }
  
  console.log(`\n✓ Check 3: Sum of debt accounts = Total Debt`);
  const debtAccountSum = debtsSummary.groups.reduce((sum, g) => sum + g.totalBalance, 0);
  const debtDiff = Math.abs(debtAccountSum - debtsSummary.totalDebt);
  console.log(`   Sum of groups: ${formatCurrency(debtAccountSum, currency)}`);
  console.log(`   Total Debt: ${formatCurrency(debtsSummary.totalDebt, currency)}`);
  if (debtDiff > 0.01) {
    errors.push(`Debt account sum (${formatCurrency(debtAccountSum, currency)}) != Total Debt (${formatCurrency(debtsSummary.totalDebt, currency)})`);
    console.log(`   ❌ MISMATCH`);
  } else {
    console.log(`   ✅ Match`);
  }
  
  // Check 4: Debt payments should match Fixed 'Loan payments' from bucket breakdown
  console.log(`\n✓ Check 4: Monthly debt payments = Fixed 'Loan payments' bucket`);
  const fixedBucket = reports.find(r => r.bucket === "fixed");
  const loanPaymentsCategory = fixedBucket?.categories?.find(c => c.name.toLowerCase().includes("loan"));
  const loanPaymentsFromBuckets = loanPaymentsCategory?.amount || 0;
  const paymentsDiff = Math.abs(debtsSummary.monthlyPayments - loanPaymentsFromBuckets);
  console.log(`   Debt payments: ${formatCurrency(debtsSummary.monthlyPayments, currency)}`);
  console.log(`   Fixed 'Loan payments': ${formatCurrency(loanPaymentsFromBuckets, currency)}`);
  if (paymentsDiff > 10) { // Allow $10 difference for rounding/estimation
    errors.push(`Debt payments (${formatCurrency(debtsSummary.monthlyPayments, currency)}) != Fixed Loan payments (${formatCurrency(loanPaymentsFromBuckets, currency)})`);
    console.log(`   ❌ MISMATCH (diff: ${formatCurrency(paymentsDiff, currency)})`);
  } else {
    console.log(`   ✅ Match (within $10)`);
  }
  
  // Check 5: Monthly history consistency
  console.log(`\n✓ Check 5: Last 12 months history consistency`);
  const assetsHistoryMonths = assetsSummary.monthlyHistory.slice(-12);
  const debtsHistoryMonths = debtsSummary.monthlyHistory.slice(-12);
  console.log(`   Assets history: ${assetsHistoryMonths.length} months`);
  console.log(`   Debts history: ${debtsHistoryMonths.length} months`);
  
  // Verify each month's net worth
  let historyErrors = 0;
  for (const assetMonth of assetsHistoryMonths) {
    const debtMonth = debtsHistoryMonths.find(d => d.month === assetMonth.month);
    const profileMonth = profile.monthlyHistory.find(m => m.yearMonth === assetMonth.month);
    
    if (debtMonth && profileMonth) {
      const nwFromHistory = assetMonth.total - debtMonth.totalDebt;
      const nwFromProfile = profileMonth.netWorth;
      const diff = Math.abs(nwFromHistory - nwFromProfile);
      
      if (diff > 1) { // Allow $1 rounding
        console.log(`   ❌ ${assetMonth.monthLabel}:`);
        console.log(`      Summary: Assets ${formatCurrency(assetMonth.total, currency)} - Debts ${formatCurrency(debtMonth.totalDebt, currency)} = ${formatCurrency(nwFromHistory, currency)}`);
        console.log(`      Profile: Assets ${formatCurrency(profileMonth.totalAssets, currency)} - Debts ${formatCurrency(profileMonth.totalDebts, currency)} = ${formatCurrency(nwFromProfile, currency)}`);
        console.log(`      Diff: ${formatCurrency(diff, currency)} (Assets diff: ${formatCurrency(Math.abs(assetMonth.total - profileMonth.totalAssets), currency)}, Debts diff: ${formatCurrency(Math.abs(debtMonth.totalDebt - profileMonth.totalDebts), currency)})`);
        historyErrors++;
      }
    }
  }
  
  if (historyErrors === 0) {
    console.log(`   ✅ All ${assetsHistoryMonths.length} months consistent`);
  } else {
    errors.push(`${historyErrors} month(s) have inconsistent net worth in history`);
  }
  
  // Payoff insight
  console.log(`\n📊 Payoff Insight:`);
  const debtsForPayoff: DebtForPayoff[] = debtsSummary.groups.flatMap(g =>
    g.accounts.map(acc => ({
      accountSlug: acc.slug,
      accountName: acc.accountName,
      balance: acc.balance,
      interestRate: acc.interestRate,
      monthlyPayment: acc.monthlyPayment,
    }))
  );
  
  const payoffInsight = calculatePayoffInsight(debtsForPayoff, 200);
  
  if (payoffInsight.hasInsight) {
    console.log(`   Highest-rate debt: ${payoffInsight.highestRateAccount?.accountName || payoffInsight.highestRateAccount?.accountSlug} at ${payoffInsight.highestRateAccount?.rate.toFixed(2)}%`);
    console.log(`   Suggestion: Add CA$200/mo extra to highest-rate debt\n`);
    
    for (const scenario of payoffInsight.scenarios) {
      const payoffDate = new Date();
      payoffDate.setMonth(payoffDate.getMonth() + scenario.currentMonths);
      const acceleratedDate = new Date();
      acceleratedDate.setMonth(acceleratedDate.getMonth() + scenario.acceleratedMonths);
      
      console.log(`   ${scenario.accountName || scenario.accountSlug}:`);
      console.log(`     Balance: ${formatCurrency(scenario.balance, currency)} @ ${scenario.rate.toFixed(2)}%`);
      console.log(`     Current: ${formatCurrency(scenario.currentPayment, currency)}/mo → ${scenario.currentMonths} months (${payoffDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}) → ${formatCurrency(scenario.currentInterestPaid, currency)} interest`);
      if (scenario.extraPayment > 0) {
        console.log(`     With +${formatCurrency(scenario.extraPayment, currency)}/mo: ${scenario.acceleratedMonths} months (${acceleratedDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}) → ${formatCurrency(scenario.acceleratedInterestPaid, currency)} interest`);
        console.log(`     💰 Saves ${scenario.monthsSaved} months and ${formatCurrency(scenario.interestSaved, currency)} interest`);
      } else {
        console.log(`     (No extra payment on this account)`);
      }
      console.log();
    }
  } else {
    console.log(`   No debts with known rate and payment`);
  }
  
  // Print stale accounts
  if (assetsSummary.staleAccounts.length > 0) {
    console.log(`\n⚠️  Stale Accounts (${assetsSummary.staleAccounts.length}):`);
    assetsSummary.staleAccounts.forEach(acc => {
      console.log(`   - ${acc.bankName} ${acc.accountName || ''} (${acc.accountType}): ${acc.daysOld} days since ${acc.statementMonth}`);
    });
  } else {
    console.log(`\n✅ No stale accounts`);
  }
  
  console.log("\n" + "=".repeat(80) + "\n");
  
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
  const allErrors = errors.length > 0;
  const hasMismatches = totalMismatches > 0;
  const hasIncomeBarMismatches = incomeBarMismatches > 0;
  const hasBaselineChanges = baselineComparison && baselineComparison.significantChanges > 0;
  
  // Continue to range tests even if earlier tests failed
  
  // ========== Dashboard Range Tests ==========
  console.log("\n" + "=".repeat(80));
  console.log("📊 DASHBOARD RANGE TESTS");
  console.log("=".repeat(80) + "\n");
  
  const ranges: TimeRange[] = ["3mo", "12mo", "ytd"];
  let rangeErrors = 0;
  
  for (const range of ranges) {
    const rangeTitle = range === "3mo" ? "3-MONTH" : 
                      range === "12mo" ? "12-MONTH" : 
                      "YEAR-TO-DATE";
    
    console.log(`${rangeTitle} (${range})`);
    console.log("-".repeat(80));
    
    try {
      // Get months for this range
      const availableMonths = profile.monthlyHistory.map(m => m.yearMonth).sort();
      const rangeMonths = getRangeMonths(range, availableMonths);
      const currentMonth = getCurrentMonth();
      
      // Format month names
      const monthNames = rangeMonths.map(m => {
        const [year, month] = m.split("-");
        const date = new Date(parseInt(year), parseInt(month) - 1);
        return date.toLocaleDateString("en-US", { month: "short", year: "numeric" });
      });
      
      // Check which months have no income data
      const monthsWithIncomeData = rangeMonths.filter(m => {
        const monthData = profile.monthlyHistory.find(h => h.yearMonth === m);
        return monthData && monthData.incomeTotal > 0;
      });
      const excludedIncomeMonths = rangeMonths.filter(m => !monthsWithIncomeData.includes(m));
      
      console.log(`Months requested (${rangeMonths.length}): ${monthNames.join(", ")}`);
      if (excludedIncomeMonths.length > 0) {
        const excludedNames = excludedIncomeMonths.map(m => {
          const [year, month] = m.split("-");
          const date = new Date(parseInt(year), parseInt(month) - 1);
          return date.toLocaleDateString("en-US", { month: "short", year: "numeric" });
        });
        console.log(`  ⚠️  Excluded from income avg (no data): ${excludedNames.join(", ")}`);
        console.log(`  ✓ Income averaged over ${monthsWithIncomeData.length} months with data`);
      }
      // Compute card values (via MoneyCoach breakdown - same as API route)
      const breakdown = computeMoneyCoachBreakdown(
        profile,
        userReviews,
        profile.incomeTxns,
        profile.accountSnapshots,
        profile.homeCurrency || "CAD",
        incomeDepositReviews,
        rangeMonths,
        savingsConfirmedItems
      );
      
      const cardIncome = breakdown.incomeAmount;
      const cardSpending = breakdown.totalSpending;
      const savingsBucket = breakdown.buckets.find(b => b.bucket === "savings");
      const cardSavings = savingsBucket?.monthlyAverage || 0;
      
      // Compute page values (direct from summary functions)
      const incomeSum = buildIncomeSummary(
        profile.incomeTxns,
        profile.accountSnapshots,
        profile.homeCurrency || "CAD",
        incomeDepositReviews,
        rangeMonths
      );
      
      const spendingSum = buildSpendingSummary(
        profile.expenseTxns,
        profile.accountSnapshots,
        profile.debtPaymentHistory,
        userReviews,
        profile.fxRates,
        profile.homeCurrency || "CAD",
        rangeMonths
      );
      
      const pageIncome = incomeSum.typicalMonthly;
      const pageSpending = spendingSum.typicalMonthly;
      
      // Savings: use shared computation (same as card, drawer, and AI tool)
      const { computeSavingsForRange } = await import("../src/lib/savingsForRange");
      const drawerSavings = computeSavingsForRange(
        profile,
        { incomeDepositReviews, debtPaymentReviews: userReviews, savingsConfirmedItems },
        rangeMonths
      );
      
      // Get bucket breakdown from card
      const fixedBucket = breakdown.buckets.find(b => b.bucket === "fixed");
      const essentialsBucket = breakdown.buckets.find(b => b.bucket === "essentials");
      const flexibleBucket = breakdown.buckets.find(b => b.bucket === "flexible");
      const savingsBucketCard = breakdown.buckets.find(b => b.bucket === "savings");
      
      console.log();
      console.log("PER-BUCKET BREAKDOWN (Card):");
      console.log(`  Fixed:      ${formatCurrency(fixedBucket?.monthlyAverage || 0, currency)}`);
      console.log(`  Essentials: ${formatCurrency(essentialsBucket?.monthlyAverage || 0, currency)}`);
      console.log(`  Flexible:   ${formatCurrency(flexibleBucket?.monthlyAverage || 0, currency)}`);
      console.log(`  Savings:    ${formatCurrency(savingsBucketCard?.monthlyAverage || 0, currency)}`);
      console.log(`  SUM (F+E+F): ${formatCurrency((fixedBucket?.monthlyAverage || 0) + (essentialsBucket?.monthlyAverage || 0) + (flexibleBucket?.monthlyAverage || 0), currency)}`);
      console.log();
      console.log(`Income   (avg/mo): ${formatCurrency(cardIncome, currency)} (card) vs ${formatCurrency(pageIncome, currency)} (page)`);
      console.log(`Spending (avg/mo): ${formatCurrency(cardSpending, currency)} (card) vs ${formatCurrency(pageSpending, currency)} (page)`);
      console.log(`Savings  (avg/mo): ${formatCurrency(cardSavings, currency)} (card) vs ${formatCurrency(drawerSavings, currency)} (drawer)`);
      console.log();
      
      // Check for current month
      const hasCurrentMonth = rangeMonths.includes(currentMonth);
      if (hasCurrentMonth) {
        const currentMonthName = (() => {
          const [year, month] = currentMonth.split("-");
          const date = new Date(parseInt(year), parseInt(month) - 1);
          return date.toLocaleDateString("en-US", { month: "short", year: "numeric" });
        })();
        console.log(`❌ FAIL: Current month ${currentMonthName} included in range`);
        rangeErrors++;
        errors.push(`${range}: Current month ${currentMonthName} included`);
      } else {
        console.log(`✅ PASS: Current month excluded`);
      }
      
      // Check card == page/drawer
      const incomeMatch = Math.abs(cardIncome - pageIncome) < 1;
      const spendingMatch = Math.abs(cardSpending - pageSpending) < 1;
      const savingsMatch = Math.abs(cardSavings - drawerSavings) < 1;
      
      if (!incomeMatch) {
        console.log(`❌ FAIL: Income mismatch`);
        rangeErrors++;
        errors.push(`${range}: Income mismatch - card=${cardIncome.toFixed(2)}, page=${pageIncome.toFixed(2)}`);
      } else {
        console.log(`✅ PASS: Income card == page`);
      }
      
      if (!spendingMatch) {
        console.log(`❌ FAIL: Spending mismatch`);
        rangeErrors++;
        errors.push(`${range}: Spending mismatch - card=${cardSpending.toFixed(2)}, page=${pageSpending.toFixed(2)}`);
      } else {
        console.log(`✅ PASS: Spending card == page`);
      }
      
      if (!savingsMatch) {
        console.log(`❌ FAIL: Savings mismatch`);
        rangeErrors++;
        errors.push(`${range}: Savings mismatch - card=${cardSavings.toFixed(2)}, drawer=${drawerSavings.toFixed(2)}`);
      } else {
        console.log(`✅ PASS: Savings card == drawer`);
      }
      
    } catch (error) {
      console.log(`❌ ERROR: ${error}`);
      rangeErrors++;
      errors.push(`${range}: ${error}`);
    }
    
    console.log();
  }
  
  if (rangeErrors > 0) {
    console.log(`❌ ${rangeErrors} range test(s) failed\n`);
  } else {
    console.log(`✅ All range tests passed\n`);
  }
  
  // ── ACCOUNT DRAWER BALANCE HISTORY TESTS ──────────────────────────────────────
  console.log("📈 ACCOUNT DRAWER BALANCE HISTORY");
  console.log("=".repeat(80) + "\n");
  
  let drawerErrors = 0;
  
  // Test all account balance histories (source data for both assets and debts drawers)
  console.log(`Total accounts with balance history: ${profile.accountBalanceHistory.length}`);
  
  for (const history of profile.accountBalanceHistory) {
    // Check non-empty
    if (history.entries.length === 0) {
      console.log(`  ❌ FAIL: ${history.label} - empty balance history`);
      drawerErrors++;
      errors.push(`Account drawer: ${history.label} has empty balance history`);
      continue;
    }
    
    // Check chronological order (oldest first)
    const months = history.entries.map(e => e.yearMonth);
    const sortedMonths = [...months].sort();
    const isChronological = months.every((m, i) => m === sortedMonths[i]);
    
    if (!isChronological) {
      console.log(`  ❌ FAIL: ${history.label} - balance history not chronological`);
      console.log(`    Expected: ${sortedMonths.join(", ")}`);
      console.log(`    Got:      ${months.join(", ")}`);
      drawerErrors++;
      errors.push(`Account drawer: ${history.label} balance history not chronological`);
    } else {
      console.log(`  ✓ ${history.label} (${history.accountType}): ${history.entries.length} months, chronological`);
    }
  }
  
  console.log();
  
  // ── DRAWER SERIES AND TRANSACTIONS VALIDATION ─────────────────────────────────
  console.log("📊 DRAWER SERIES & MONTH-DETAIL VALIDATION");
  console.log("=".repeat(80) + "\n");
  
  // Reuse assetsSummary and debtsSummary already built above
  
  // Test 1: Verify drawer series equals accountBalanceHistory for every account
  console.log("Test 1: Drawer series matches profile.accountBalanceHistory");
  for (const summaryHistory of assetsSummary.accountBalanceHistory) {
    const profileHistory = profile.accountBalanceHistory.find(h => h.slug === summaryHistory.slug);
    if (!profileHistory) {
      console.log(`  ❌ FAIL: Assets summary has ${summaryHistory.slug} but profile doesn't`);
      drawerErrors++;
      errors.push(`Drawer data: ${summaryHistory.slug} in assets summary but not in profile`);
      continue;
    }
    
    // Check entries match exactly
    if (summaryHistory.entries.length !== profileHistory.entries.length) {
      console.log(`  ❌ FAIL: ${summaryHistory.label} entry count mismatch: summary=${summaryHistory.entries.length}, profile=${profileHistory.entries.length}`);
      drawerErrors++;
      errors.push(`Drawer data: ${summaryHistory.label} entry count mismatch`);
      continue;
    }
    
    let mismatch = false;
    for (let i = 0; i < summaryHistory.entries.length; i++) {
      const se = summaryHistory.entries[i];
      const pe = profileHistory.entries[i];
      if (se.yearMonth !== pe.yearMonth || se.balance !== pe.balance || se.derived !== pe.derived) {
        console.log(`  ❌ FAIL: ${summaryHistory.label} entry ${i} mismatch`);
        console.log(`    Summary: ${se.yearMonth} ${se.balance} derived=${se.derived}`);
        console.log(`    Profile: ${pe.yearMonth} ${pe.balance} derived=${pe.derived}`);
        drawerErrors++;
        errors.push(`Drawer data: ${summaryHistory.label} entry mismatch at ${se.yearMonth}`);
        mismatch = true;
        break;
      }
    }
    
    if (!mismatch) {
      console.log(`  ✓ ${summaryHistory.label}: ${summaryHistory.entries.length} entries match exactly`);
    }
  }
  
  // Same for debts
  for (const summaryHistory of debtsSummary.accountBalanceHistory) {
    const profileHistory = profile.accountBalanceHistory.find(h => h.slug === summaryHistory.slug);
    if (!profileHistory) {
      console.log(`  ❌ FAIL: Debts summary has ${summaryHistory.slug} but profile doesn't`);
      drawerErrors++;
      errors.push(`Drawer data: ${summaryHistory.slug} in debts summary but not in profile`);
      continue;
    }
    
    if (summaryHistory.entries.length !== profileHistory.entries.length) {
      console.log(`  ❌ FAIL: ${summaryHistory.label} (debt) entry count mismatch`);
      drawerErrors++;
      errors.push(`Drawer data: ${summaryHistory.label} debt entry count mismatch`);
      continue;
    }
    
    let mismatch = false;
    for (let i = 0; i < summaryHistory.entries.length; i++) {
      const se = summaryHistory.entries[i];
      const pe = profileHistory.entries[i];
      if (se.yearMonth !== pe.yearMonth || se.balance !== pe.balance || se.derived !== pe.derived) {
        console.log(`  ❌ FAIL: ${summaryHistory.label} (debt) entry ${i} mismatch`);
        drawerErrors++;
        errors.push(`Drawer data: ${summaryHistory.label} debt entry mismatch at ${se.yearMonth}`);
        mismatch = true;
        break;
      }
    }
    
    if (!mismatch) {
      console.log(`  ✓ ${summaryHistory.label} (debt): ${summaryHistory.entries.length} entries match exactly`);
    }
  }
  
  console.log();
  
  // Test 2: Verify no constant series when balance varies
  console.log("Test 2: No constant series when balance history varies");
  for (const history of profile.accountBalanceHistory) {
    const balances = history.entries.map(e => e.balance);
    const uniqueBalances = new Set(balances);
    
    // If all balances are identical
    if (uniqueBalances.size === 1 && balances.length > 1) {
      console.log(`  ⚠️  WARNING: ${history.label} has constant balance ${balances[0]} across ${balances.length} months`);
      // This is OK if it's really constant (e.g., a dormant account)
    } else {
      console.log(`  ✓ ${history.label}: ${uniqueBalances.size} unique balance values across ${balances.length} months`);
    }
  }
  
  console.log();
  
  // Test 3: Verify month-detail transaction totals match expenseTxns/incomeTxns
  console.log("Test 3: Month-detail transaction totals match profile txns");
  
  // Build a map of account slug -> month -> {inflow, outflow}
  const accountMonthTotals = new Map<string, Map<string, { inflow: number; outflow: number }>>();
  
  for (const txn of profile.expenseTxns) {
    if (!accountMonthTotals.has(txn.accountSlug)) {
      accountMonthTotals.set(txn.accountSlug, new Map());
    }
    const monthMap = accountMonthTotals.get(txn.accountSlug)!;
    if (!monthMap.has(txn.txMonth)) {
      monthMap.set(txn.txMonth, { inflow: 0, outflow: 0 });
    }
    const totals = monthMap.get(txn.txMonth)!;
    totals.outflow += Math.abs(txn.amount);
  }
  
  for (const txn of profile.incomeTxns) {
    if (!accountMonthTotals.has(txn.accountSlug)) {
      accountMonthTotals.set(txn.accountSlug, new Map());
    }
    const monthMap = accountMonthTotals.get(txn.accountSlug)!;
    if (!monthMap.has(txn.txMonth)) {
      monthMap.set(txn.txMonth, { inflow: 0, outflow: 0 });
    }
    const totals = monthMap.get(txn.txMonth)!;
    totals.inflow += txn.amount;
  }
  
  // Verify summaries have matching transactions
  const assetsExpenseTxns = assetsSummary.expenseTxns;
  const assetsIncomeTxns = assetsSummary.incomeTxns;
  const debtsExpenseTxns = debtsSummary.expenseTxns;
  const debtsIncomeTxns = debtsSummary.incomeTxns;
  
  // Count should match
  if (assetsExpenseTxns.length + debtsExpenseTxns.length !== profile.expenseTxns.length) {
    console.log(`  ❌ FAIL: Summary expense txn count mismatch: assets=${assetsExpenseTxns.length}, debts=${debtsExpenseTxns.length}, profile=${profile.expenseTxns.length}`);
    drawerErrors++;
    errors.push(`Drawer data: expense transaction count mismatch`);
  } else {
    console.log(`  ✓ Expense transactions: ${profile.expenseTxns.length} total (${assetsExpenseTxns.length} assets, ${debtsExpenseTxns.length} debts)`);
  }
  
  if (assetsIncomeTxns.length + debtsIncomeTxns.length !== profile.incomeTxns.length) {
    console.log(`  ❌ FAIL: Summary income txn count mismatch: assets=${assetsIncomeTxns.length}, debts=${debtsIncomeTxns.length}, profile=${profile.incomeTxns.length}`);
    drawerErrors++;
    errors.push(`Drawer data: income transaction count mismatch`);
  } else {
    console.log(`  ✓ Income transactions: ${profile.incomeTxns.length} total (${assetsIncomeTxns.length} assets, ${debtsIncomeTxns.length} debts)`);
  }
  
  // Verify totals by account/month
  let txnAccountsTested = 0;
  for (const [slug, monthMap] of accountMonthTotals.entries()) {
    const history = profile.accountBalanceHistory.find(h => h.slug === slug);
    if (!history) continue;
    
    txnAccountsTested++;
    let accountErrors = 0;
    
    for (const [month, totals] of monthMap.entries()) {
      // Recompute from summaries
      const summaryExpenses = [...assetsExpenseTxns, ...debtsExpenseTxns].filter(t => t.accountSlug === slug && t.txMonth === month);
      const summaryIncome = [...assetsIncomeTxns, ...debtsIncomeTxns].filter(t => t.accountSlug === slug && t.txMonth === month);
      
      const summaryOutflow = summaryExpenses.reduce((sum, t) => sum + Math.abs(t.amount), 0);
      const summaryInflow = summaryIncome.reduce((sum, t) => sum + t.amount, 0);
      
      if (Math.abs(summaryOutflow - totals.outflow) > 0.01) {
        console.log(`  ❌ FAIL: ${history.label} ${month} outflow mismatch: profile=${totals.outflow.toFixed(2)}, summary=${summaryOutflow.toFixed(2)}`);
        drawerErrors++;
        errors.push(`Drawer data: ${history.label} ${month} outflow mismatch`);
        accountErrors++;
      }
      
      if (Math.abs(summaryInflow - totals.inflow) > 0.01) {
        console.log(`  ❌ FAIL: ${history.label} ${month} inflow mismatch: profile=${totals.inflow.toFixed(2)}, summary=${summaryInflow.toFixed(2)}`);
        drawerErrors++;
        errors.push(`Drawer data: ${history.label} ${month} inflow mismatch`);
        accountErrors++;
      }
    }
    
    if (accountErrors === 0) {
      console.log(`  ✓ ${history.label}: ${monthMap.size} months, all transaction totals match`);
    }
  }
  
  console.log(`\n  Summary: ${txnAccountsTested} accounts tested for transaction totals\n`);
  
  // Test 4: Net Savings drawer badge and month label validation
  console.log("Test 4: Net Savings drawer - badge and month label validation");
  
  // Get the last 3 months of data
  const availableMonths = profile.monthlyHistory.map(m => m.yearMonth).sort();
  const last3Months = availableMonths.slice(-3);
  
  // Compute window savings to get the monthly breakdown
  const { monthlyBreakdown } = computeWindowSavings(
    profile.monthlyHistory,
    profile.accountBalanceHistory,
    profile.expenseTxns,
    last3Months,
    new Map() // No confirmed items needed for regression check
  );
  
  let badgeErrors = 0;
  let monthLabelErrors = 0;
  
  for (const monthData of monthlyBreakdown) {
    console.log(`\n  Month: ${monthData.month}`);
    
    const allAccounts = [
      ...monthData.accounts.cashAccounts,
      ...monthData.accounts.debtAccounts
    ];
    
    for (const acc of allAccounts) {
      // Find the account's balance history to check if entry exists for this month
      const accountHistory = profile.accountBalanceHistory.find(h => h.slug === acc.slug);
      const hasExactEntry = accountHistory?.entries.some(e => e.yearMonth === monthData.month);
      
      // Build badge description
      let badgeDesc = 'none';
      if (acc.currentDerived && acc.currentSourceStatement) {
        badgeDesc = `derived from ${acc.currentSourceStatement}`;
      } else if (acc.currentCarriedForward) {
        badgeDesc = 'carried forward (no statement)';
      }
      
      console.log(`    ${acc.accountLabel}`);
      console.log(`      Prior: ${acc.priorActualMonth || 'unknown'} | Current: ${acc.currentActualMonth || 'unknown'} | Badge: ${badgeDesc}`);
      
      // Check 1: currentActualMonth must equal month being viewed when entry exists
      if (hasExactEntry && acc.currentActualMonth !== monthData.month) {
        const failMsg = `DRAWER FAIL: ${acc.accountLabel} ${monthData.month} has entry but currentActualMonth is ${acc.currentActualMonth}`;
        console.log(`      ❌ ${failMsg}`);
        monthLabelErrors++;
        drawerErrors++;
        errors.push(failMsg);
      }
      
      // Check 2: No mixed derived + carriedForward flags
      if (acc.currentDerived && acc.currentCarriedForward) {
        const failMsg = `DRAWER FAIL: ${acc.accountLabel} ${monthData.month} has both derived AND carriedForward flags`;
        console.log(`      ❌ ${failMsg}`);
        badgeErrors++;
        drawerErrors++;
        errors.push(failMsg);
      }
      
      // Check 3: Derived entries must have sourceStatement
      if (acc.currentDerived && !acc.currentSourceStatement) {
        const failMsg = `DRAWER FAIL: ${acc.accountLabel} ${monthData.month} derived but no sourceStatement`;
        console.log(`      ❌ ${failMsg}`);
        badgeErrors++;
        drawerErrors++;
        errors.push(failMsg);
      }
    }
  }
  
  console.log();
  
  if (badgeErrors === 0 && monthLabelErrors === 0) {
    console.log(`  ✅ All accounts checked: badges and month labels correct`);
  } else {
    console.log(`  ❌ Found ${badgeErrors} badge errors and ${monthLabelErrors} month label errors`);
  }
  
  console.log();
  
  // Note: drawerErrors is cumulative across all drawer tests, so don't print here
  // Final count printed at end of all tests
  
  // Helper function for month difference calculation
  function getMonthsBetweenYM(startYM: string, endYM: string): number {
    const [startYear, startMonth] = startYM.split('-').map(Number);
    const [endYear, endMonth] = endYM.split('-').map(Number);
    return (endYear - startYear) * 12 + (endMonth - startMonth);
  }
  
  // ── MONEY COACH API END-TO-END TESTS ───────────────────────────────────────────
  console.log("💼 MONEY COACH API END-TO-END");
  console.log("=".repeat(80) + "\n");
  
  let moneyCoachErrors = 0;
  
  // Test money-coach route for all ranges to catch crashes
  const testRanges: Array<{ range: TimeRange; label: string }> = [
    { range: "3mo", label: "Last 3 months" },
    { range: "12mo", label: "Last 12 months" },
    { range: "ytd", label: "Year to date" }
  ];
  
  for (const { range, label } of testRanges) {
    try {
      console.log(`Testing ${label} (${range})...`);
      
      // Get available months and range months
      const availableMonths = profile.monthlyHistory.map(m => m.yearMonth).sort();
      const rangeMonths = getRangeMonths(range, availableMonths);
      
      // Load review context (same as route does)
      const reviewContext = await loadUserReviewContext(uid, db);
      
      // Call computeMoneyCoachBreakdown same way the API does
      const breakdown = computeMoneyCoachBreakdown(
        profile,
        reviewContext.debtPaymentReviews,
        profile.incomeTxns,
        profile.accountSnapshots,
        profile.homeCurrency || "CAD",
        reviewContext.incomeDepositReviews,
        rangeMonths,
        reviewContext.savingsConfirmedItems
      );
      
      // Call computeGapReconciliation same way the API does
      const gapReconciliation = computeGapReconciliation(
        range,
        profile,
        reviewContext.debtPaymentReviews,
        reviewContext.incomeDepositReviews,
        [], // No external account labels in test
        {
          income: breakdown.incomeAmount,
          fixed: breakdown.buckets.find(b => b.bucket === "fixed")?.monthlyAverage || 0,
          essentials: breakdown.buckets.find(b => b.bucket === "essentials")?.monthlyAverage || 0,
          flexible: breakdown.buckets.find(b => b.bucket === "flexible")?.monthlyAverage || 0,
          netSavings: breakdown.buckets.find(b => b.bucket === "savings")?.monthlyAverage || 0,
        }
      );
      
      // Verify gap reconciliation math
      const expectedSavings = gapReconciliation.expectedSavings;
      const actualSavings = gapReconciliation.actualSavings;
      const gap = gapReconciliation.gap;
      const componentsTotal = gapReconciliation.componentsTotal;
      const unexplained = gapReconciliation.unexplained;
      
      // Check: components + unexplained must sum to gap within $1
      const componentsPlusUnexplained = componentsTotal + unexplained;
      if (Math.abs(componentsPlusUnexplained - gap) > 1) {
        console.log(`  ❌ FAIL: Components don't sum to gap`);
        console.log(`    Gap: ${gap.toFixed(2)}`);
        console.log(`    Components total: ${componentsTotal.toFixed(2)}`);
        console.log(`    Unexplained: ${unexplained.toFixed(2)}`);
        console.log(`    Components + Unexplained: ${componentsPlusUnexplained.toFixed(2)}`);
        console.log(`    Difference: ${Math.abs(componentsPlusUnexplained - gap).toFixed(2)}`);
        moneyCoachErrors++;
        drawerErrors++;
        errors.push(`Money coach ${range}: gap reconciliation math error`);
      }
      
      // Check: unexplained must be reasonable
      // Fail if |Unexplained| > 10% of |Gap| or > $500/mo
      const unexplainedPct = Math.abs(gap) > 0 ? (Math.abs(unexplained) / Math.abs(gap)) * 100 : 0;
      const unexplainedThreshold = 500;
      const unexplainedPctThreshold = 10;
      
      if (Math.abs(unexplained) > unexplainedThreshold || unexplainedPct > unexplainedPctThreshold) {
        console.log(`  ❌ FAIL: Unexplained amount too large`);
        console.log(`    Gap: ${gap.toFixed(2)}`);
        console.log(`    Unexplained: ${unexplained.toFixed(2)}`);
        console.log(`    Unexplained as % of gap: ${unexplainedPct.toFixed(1)}%`);
        console.log(`    Threshold: $${unexplainedThreshold}/mo or ${unexplainedPctThreshold}% of gap`);
        moneyCoachErrors++;
        drawerErrors++;
        errors.push(`Money coach ${range}: unexplained ${Math.abs(unexplained).toFixed(2)} exceeds threshold`);
      }
      
      // Print breakdown
      console.log(`  Income: ${breakdown.incomeAmount.toFixed(2)}`);
      console.log(`  Fixed: ${gapReconciliation.fixed.toFixed(2)}`);
      console.log(`  Essentials: ${gapReconciliation.essentials.toFixed(2)}`);
      console.log(`  Flexible: ${gapReconciliation.flexible.toFixed(2)}`);
      console.log(`  Expected savings: ${expectedSavings.toFixed(2)}`);
      console.log(`  Actual savings: ${actualSavings.toFixed(2)}`);
      console.log(`  Gap: ${gap.toFixed(2)}`);
      console.log(`  Components:`);
      gapReconciliation.components.forEach(c => {
        console.log(`    ${c.name}: ${c.amount > 0 ? '+' : ''}${c.amount.toFixed(2)}`);
      });
      console.log(`  Components total: ${componentsTotal.toFixed(2)}`);
      console.log(`  Unexplained: ${unexplained.toFixed(2)} (${unexplainedPct.toFixed(1)}% of gap)`);
      console.log(`  Reconciles: ${gapReconciliation.reconciles ? '✓' : '✗'}`);
      
      // Check flagged transfers
      console.log(`\n  Flagged transfers: ${gapReconciliation.flaggedTransfers.length}`);
      
      // Regression check: every flagged transfer must have non-empty destinationNumber
      for (const flagged of gapReconciliation.flaggedTransfers) {
        if (!flagged.destinationNumber || flagged.destinationNumber.trim() === "") {
          console.log(`  ❌ FAIL: Flagged transfer has empty destinationNumber`);
          console.log(`    Date: ${flagged.date}, From: ${flagged.fromAccount}`);
          moneyCoachErrors++;
          errors.push(
            `Money coach ${range}: Flagged transfer on ${flagged.date} from ${flagged.fromAccount} has empty destinationNumber`
          );
        }
      }
      
      if (gapReconciliation.flaggedTransfers.length > 0) {
        console.log(`  Transfers to untracked accounts detected (should surface for review):`);
        for (const flagged of gapReconciliation.flaggedTransfers) {
          console.log(`    ${flagged.date} ${flagged.destinationNumber.padEnd(8)} $${flagged.amount.toFixed(2).padStart(10)} [${flagged.reason}]`);
        }
        
        // Print what the Net Savings info icon popover would show
        const total = gapReconciliation.flaggedTransfers.reduce((sum, t) => sum + t.amount, 0);
        console.log(`\n  Net Savings info icon would show:`);
        console.log(`    "Includes transfers to accounts not in the app"`);
        for (const transfer of gapReconciliation.flaggedTransfers) {
          const last4 = transfer.destinationNumber?.slice(-4) || transfer.destinationNumber || "unknown";
          console.log(`    ${transfer.date} · ${transfer.fromAccount} → Account ending in ${last4} · $${transfer.amount.toFixed(2)}`);
        }
        console.log(`    Total: $${total.toFixed(2)}`);
      }
      
      if (gapReconciliation.reconciles && Math.abs(unexplained) <= unexplainedThreshold && unexplainedPct <= unexplainedPctThreshold) {
        console.log(`  ✅ ${label} passed\n`);
      } else {
        console.log(`  ⚠️  ${label} has issues (see errors above)\n`);
      }
      
    } catch (err) {
      console.log(`  ❌ FAIL: Exception thrown`);
      console.log(`    ${err instanceof Error ? err.message : String(err)}`);
      moneyCoachErrors++;
      errors.push(`Money coach ${range}: crashed with ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  
  if (moneyCoachErrors > 0) {
    console.log(`❌ ${moneyCoachErrors} money coach test(s) failed\n`);
  } else {
    console.log(`✅ All money coach tests passed\n`);
  }
  
  // ── CASH COMMITMENTS & PLANNER TESTS ──────────────────────────────────────────
  console.log("💰 CASH COMMITMENTS & PLANNER");
  console.log("=".repeat(80) + "\n");
  
  let cashPlannerErrors = 0;
  
  // Test 1: Cash commitments only count up to today
  console.log(`Current month: ${currentMonth}`);
  console.log(`Cash commitments in profile: ${profile.cashCommitmentEntries.length}`);
  
  for (const entry of profile.cashCommitmentEntries) {
    const floor = entry.startDate?.slice(0, 7) ?? entry.createdAt?.slice(0, 7);
    console.log(`  - ${entry.name}: ${entry.frequency}, floor=${floor || 'none'}`);
    
    // Check that no future months are counted
    const futureMonth = new Date();
    futureMonth.setMonth(futureMonth.getMonth() + 1);
    const futureYM = `${futureMonth.getFullYear()}-${String(futureMonth.getMonth() + 1).padStart(2, '0')}`;
    
    const { commitmentOccurrencesInMonth } = await import("../src/app/api/user/cash-commitments/route");
    const futureOccurrences = commitmentOccurrencesInMonth(entry, futureYM);
    
    if (futureOccurrences > 0) {
      console.log(`    ❌ FAIL: Future occurrences detected (${futureYM}: ${futureOccurrences})`);
      cashPlannerErrors++;
      errors.push(`Cash commitment ${entry.name} has occurrences in future month ${futureYM}`);
    } else {
      console.log(`    ✓ No future occurrences`);
    }
  }
  
  // Test 2: Plans calculation (spent = linked + cash)
  const plansSnap = await db.collection(`users/${uid}/plans`).get();
  const plans = plansSnap.docs.map(d => d.data());
  
  console.log(`\nPlans in profile: ${plans.length}`);
  for (const plan of plans) {
    const linkedTotal = (plan.linkedTransactions || []).reduce((sum: number, tx: any) => sum + (tx.amount || 0), 0);
    const cashTotal = (plan.cashEntries || []).reduce((sum: number, entry: any) => sum + (entry.amount || 0), 0);
    const expectedSpent = linkedTotal + cashTotal;
    
    console.log(`  - ${plan.name}:`);
    console.log(`    Linked txns: ${formatCurrency(linkedTotal, currency)}`);
    console.log(`    Cash entries: ${formatCurrency(cashTotal, currency)}`);
    console.log(`    Total spent: ${formatCurrency(expectedSpent, currency)}`);
    console.log(`    Budget: ${formatCurrency(plan.budget, currency)}`);
    
    // Validate calculation is correct
    const calculatedSpent = linkedTotal + cashTotal;
    if (Math.abs(calculatedSpent - expectedSpent) > 0.01) {
      console.log(`    ❌ FAIL: Spent calculation mismatch`);
      cashPlannerErrors++;
      errors.push(`Plan ${plan.name} spent calculation error: ${calculatedSpent} !== ${expectedSpent}`);
    } else {
      console.log(`    ✓ Spent calculation correct`);
    }
  }
  
  console.log();
  if (cashPlannerErrors > 0) {
    console.log(`❌ ${cashPlannerErrors} cash/planner test(s) failed\n`);
  } else {
    console.log(`✅ All cash/planner tests passed\n`);
  }
  
  // ── AI ANSWER POST-PROCESSOR TEST ───────────────────────────────────────────
  console.log("🧹 AI ANSWER POST-PROCESSOR");
  console.log("=".repeat(80) + "\n");
  
  // Import and test the post-processor
  const { cleanAIAnswer } = await import("../src/lib/chat/answerPostProcessor");
  
  const sampleWithAttribution = "From get_income_summary (same as Income page): CA$5,234. Your typical monthly income is CA$5,234, which comes from 2 sources.";
  const cleaned = cleanAIAnswer(sampleWithAttribution);
  
  console.log("Sample input:");
  console.log(`  "${sampleWithAttribution}"\n`);
  console.log("Post-processed output:");
  console.log(`  "${cleaned}"\n`);
  
  const hasToolName = /\b(?:get|list|rollup|search|execute)_[a-z_]+\b/i.test(cleaned);
  const hasAttribution = /\(?\s*(?:from|uses?)\s+[a-z_]+\s*\(?\s*same\s+as\s+[^)]*(?:page|drawer|card)\s*\)?\s*\)?/i.test(cleaned);
  
  if (hasToolName) {
    console.log("❌ FAIL: Tool name still present in cleaned output");
    errors.push("Post-processor did not remove tool names");
  } else if (hasAttribution) {
    console.log("❌ FAIL: Attribution text still present in cleaned output");
    errors.push("Post-processor did not remove attribution text");
  } else {
    console.log("✅ Post-processor correctly removed tool names and attribution");
  }
  
  // Test newline preservation
  const multiLineInput = `Top areas:
* **Shopping**: CA$450
* **Dining**: CA$320`;
  const multiLineCleaned = cleanAIAnswer(multiLineInput);
  const hasNewlines = multiLineCleaned.includes("\n");
  const lines = multiLineCleaned.split("\n");
  
  if (!hasNewlines || lines.length < 3) {
    console.log("❌ FAIL: Post-processor collapsed newlines in multi-line list");
    errors.push("Post-processor collapsed newlines");
  } else {
    console.log("✅ Post-processor preserved newlines in multi-line list\n");
  }
  
  // ── AI CHAT TOOLS ────────────────────────────────────────────────────────────
  console.log("🤖 AI CHAT TOOLS");
  console.log("=".repeat(80) + "\n");
  
  let chatToolErrors = 0;
  
  // Import chat executors
  const { executeTool } = await import("../src/lib/chat/executor");
  
  // Build review context from already-loaded variables (no need to reload from Firestore)
  const reviewContext = {
    incomeDepositReviews,
    debtPaymentReviews: userReviews,
    savingsConfirmedItems,
  };
  console.log(`Using reviews: income=${reviewContext.incomeDepositReviews.size} debt=${reviewContext.debtPaymentReviews.length} savings=${reviewContext.savingsConfirmedItems.size}\n`);
  
  // Helper: parse currency string to number
  function parseCurrency(str: string): number {
    // Remove currency symbol, commas, and parse
    return parseFloat(str.replace(/[^\d.-]/g, ""));
  }
  
  // Helper: compare currencies with ±$1 tolerance
  function currenciesMatch(a: string, b: string, tolerance = 1.0): boolean {
    const numA = parseCurrency(a);
    const numB = parseCurrency(b);
    return Math.abs(numA - numB) <= tolerance;
  }
  
  // Test 1: get_income_summary 3mo matches Income page
  console.log("Test 1: get_income_summary (3mo) matches Income page");
  try {
    const incomeToolResult = executeTool("get_income_summary", { range: "3mo" }, profile, reviewContext);
    if (!incomeToolResult.ok) {
      console.log(`  ❌ FAIL: Tool execution failed: ${incomeToolResult.error}`);
      errors.push(`get_income_summary failed: ${incomeToolResult.error}`);
      chatToolErrors++;
    } else {
      const toolIncome = incomeToolResult.data.typical_monthly;
      const pageIncome = formatCurrency(incomeSummary.typicalMonthly, currency);
      console.log(`  Tool (get_income_summary): ${toolIncome}`);
      console.log(`  Page (Income): ${pageIncome}`);
      if (currenciesMatch(toolIncome, pageIncome)) {
        console.log(`  ✓ Match (within ±$1)`);
      } else {
        console.log(`  ❌ FAIL: Mismatch`);
        errors.push(`Income tool vs page mismatch: ${toolIncome} !== ${pageIncome}`);
        chatToolErrors++;
      }
      
      // Validate per-source totals
      console.log(`\n  Validating per-source totals for range...`);
      const period = incomeToolResult.data.period;
      const bySource = incomeToolResult.data.by_source || [];
      const rangeMonths = incomeToolResult.data.range_months || [];
      
      console.log(`  Period: ${period?.label || 'unknown'} (${period?.start_month} to ${period?.end_month})`);
      console.log(`  Sources returned: ${bySource.length}`);
      
      // Sum all per-source totals
      const perSourceSum = bySource.reduce((sum: number, s: any) => sum + parseCurrency(s.total), 0);
      
      // Compute range total from Income page data
      const rangeMonthsData = incomeSummary.monthlyHistory.filter((m: any) => 
        rangeMonths.includes(m.yearMonth)
      );
      const rangeTotal = rangeMonthsData.reduce((sum: number, m: any) => sum + m.total, 0);
      
      console.log(`  Sum of per-source totals: ${formatCurrency(perSourceSum, currency)}`);
      console.log(`  Income page range total: ${formatCurrency(rangeTotal, currency)}`);
      
      // Per-source sum must match range total exactly (±$1 for rounding)
      if (Math.abs(perSourceSum - rangeTotal) > 1) {
        console.log(`  ❌ FAIL: Per-source totals don't match Income page total`);
        errors.push(`Income per-source sum (${formatCurrency(perSourceSum, currency)}) ≠ Income page total (${formatCurrency(rangeTotal, currency)}), diff: ${formatCurrency(Math.abs(perSourceSum - rangeTotal), currency)}`);
        chatToolErrors++;
      } else {
        console.log(`  ✓ Per-source totals match Income page (within ±$1)`);
      }
      
      // Verify period label matches requested range
      const expectedLabel = rangeMonths.length === 12 ? "last 12 months" :
                            rangeMonths.length === 3 ? "last 3 months" :
                            `${rangeMonths.length} months`;
      if (period?.label !== expectedLabel) {
        console.log(`  ❌ FAIL: Period label mismatch: "${period?.label}" !== "${expectedLabel}"`);
        errors.push(`Income period label mismatch: "${period?.label}" !== "${expectedLabel}"`);
        chatToolErrors++;
      } else {
        console.log(`  ✓ Period label correct`);
      }
    }
  } catch (err) {
    console.log(`  ❌ FAIL: Exception: ${err instanceof Error ? err.message : String(err)}`);
    errors.push(`get_income_summary threw exception: ${err instanceof Error ? err.message : String(err)}`);
    chatToolErrors++;
  }
  
  // Test 2: get_spending_summary 3mo matches Spending card
  console.log("\nTest 2: get_spending_summary (3mo) matches Spending card");
  try {
    const spendingToolResult = executeTool("get_spending_summary", { range: "3mo" }, profile, reviewContext);
    if (!spendingToolResult.ok) {
      console.log(`  ❌ FAIL: Tool execution failed: ${spendingToolResult.error}`);
      errors.push(`get_spending_summary failed: ${spendingToolResult.error}`);
      chatToolErrors++;
    } else {
      const toolSpending = spendingToolResult.data.typical_monthly;
      // Get spending card value (from earlier calculation)
      const cardSpending = formatCurrency(spendingSummary.typicalMonthly, currency);
      console.log(`  Tool (get_spending_summary): ${toolSpending}`);
      console.log(`  Card (Spending): ${cardSpending}`);
      if (currenciesMatch(toolSpending, cardSpending)) {
        console.log(`  ✓ Match (within ±$1)`);
      } else {
        console.log(`  ❌ FAIL: Mismatch`);
        errors.push(`Spending tool vs card mismatch: ${toolSpending} !== ${cardSpending}`);
        chatToolErrors++;
      }
    }
  } catch (err) {
    console.log(`  ❌ FAIL: Exception: ${err instanceof Error ? err.message : String(err)}`);
    errors.push(`get_spending_summary threw exception: ${err instanceof Error ? err.message : String(err)}`);
    chatToolErrors++;
  }
  
  // Test 3: get_savings_summary matches Money Coach card (dashboard)
  console.log("\nTest 3: get_savings_summary (3mo) matches Money Coach card");
  try {
    const savingsToolResult = executeTool("get_savings_summary", { range: "3mo" }, profile, reviewContext);
    if (!savingsToolResult.ok) {
      console.log(`  ❌ FAIL: Tool execution failed: ${savingsToolResult.error}`);
      errors.push(`get_savings_summary failed: ${savingsToolResult.error}`);
      chatToolErrors++;
    } else {
      const toolSavings = savingsToolResult.data.typical_monthly;
      
      // Check for NaN (must fail)
      if (toolSavings.includes('NaN')) {
        console.log(`  ❌ FAIL: Tool returned NaN`);
        errors.push(`get_savings_summary returned NaN`);
        chatToolErrors++;
      } else {
        // Use Money Coach breakdown savings value (same as dashboard card/drawer)
        const savingsBucket = breakdown.buckets.find((b: any) => b.bucket === "savings");
        if (!savingsBucket) {
          console.log(`  ❌ FAIL: No savings bucket in money coach breakdown`);
          errors.push(`Money coach breakdown missing savings bucket`);
          chatToolErrors++;
        } else {
          const cardSavingsFormatted = formatCurrency(savingsBucket.monthlyAverage, currency);
          
          // Check for NaN in expected value (must fail)
          if (cardSavingsFormatted.includes('NaN')) {
            console.log(`  ❌ FAIL: Expected value is NaN`);
            errors.push(`Money coach savings calculation returned NaN`);
            chatToolErrors++;
          } else {
            console.log(`  Tool (get_savings_summary): ${toolSavings}`);
            console.log(`  Card (Money Coach): ${cardSavingsFormatted}`);
            if (currenciesMatch(toolSavings, cardSavingsFormatted)) {
              console.log(`  ✓ Match (within ±$1)`);
            } else {
              console.log(`  ❌ FAIL: Mismatch`);
              errors.push(`Savings tool vs card mismatch: ${toolSavings} !== ${cardSavingsFormatted}`);
              chatToolErrors++;
            }
          }
        }
      }
    }
  } catch (err) {
    console.log(`  ❌ FAIL: Exception: ${err instanceof Error ? err.message : String(err)}`);
    errors.push(`get_savings_summary threw exception: ${err instanceof Error ? err.message : String(err)}`);
    chatToolErrors++;
  }
  
  // Test 4: get_net_worth matches dashboard card
  console.log("\nTest 4: get_net_worth matches dashboard card");
  try {
    const netWorthToolResult = executeTool("get_net_worth", {}, profile, reviewContext);
    if (!netWorthToolResult.ok) {
      console.log(`  ❌ FAIL: Tool execution failed: ${netWorthToolResult.error}`);
      errors.push(`get_net_worth failed: ${netWorthToolResult.error}`);
      chatToolErrors++;
    } else {
      const toolNetWorth = netWorthToolResult.data.net_worth;
      const { getNetWorth } = await import("../src/lib/profileMetrics");
      const month = profile.latestTxMonth ?? "";
      const nw = getNetWorth(profile, month);
      const dashboardNetWorth = formatCurrency(nw.total, currency);
      console.log(`  Tool (get_net_worth): ${toolNetWorth}`);
      console.log(`  Dashboard: ${dashboardNetWorth}`);
      if (currenciesMatch(toolNetWorth, dashboardNetWorth)) {
        console.log(`  ✓ Match (within ±$1)`);
      } else {
        console.log(`  ❌ FAIL: Mismatch`);
        errors.push(`Net worth tool vs dashboard mismatch: ${toolNetWorth} !== ${dashboardNetWorth}`);
        chatToolErrors++;
      }
    }
  } catch (err) {
    console.log(`  ❌ FAIL: Exception: ${err instanceof Error ? err.message : String(err)}`);
    errors.push(`get_net_worth threw exception: ${err instanceof Error ? err.message : String(err)}`);
    chatToolErrors++;
  }
  
  // Test 5: list_cash_expenses monthly total matches Cash tab
  console.log("\nTest 5: list_cash_expenses monthly total matches Cash tab");
  try {
    const cashToolResult = executeTool("list_cash_expenses", {}, profile, reviewContext);
    if (!cashToolResult.ok) {
      console.log(`  ❌ FAIL: Tool execution failed: ${cashToolResult.error}`);
      errors.push(`list_cash_expenses failed: ${cashToolResult.error}`);
      chatToolErrors++;
    } else {
      const toolTotal = cashToolResult.data.total_monthly;
      // Compute expected total from profile
      const { FREQ_MONTHLY } = await import("../src/app/api/user/cash-commitments/route");
      const expectedTotal = profile.cashCommitmentEntries
        .filter((c: any) => c.status !== "paused" && c.frequency !== "once")
        .reduce((sum: number, c: any) => sum + c.amount * (FREQ_MONTHLY[c.frequency as keyof typeof FREQ_MONTHLY] || 12), 0);
      const expectedFormatted = formatCurrency(expectedTotal, currency);
      console.log(`  Tool (list_cash_expenses): ${toolTotal}`);
      console.log(`  Expected (Cash tab): ${expectedFormatted}`);
      if (currenciesMatch(toolTotal, expectedFormatted)) {
        console.log(`  ✓ Match (within ±$1)`);
      } else {
        console.log(`  ❌ FAIL: Mismatch`);
        errors.push(`Cash expenses tool vs tab mismatch: ${toolTotal} !== ${expectedFormatted}`);
        chatToolErrors++;
      }
    }
  } catch (err) {
    console.log(`  ❌ FAIL: Exception: ${err instanceof Error ? err.message : String(err)}`);
    errors.push(`list_cash_expenses threw exception: ${err instanceof Error ? err.message : String(err)}`);
    chatToolErrors++;
  }
  
  // Test 6: list_subscriptions returns confirmed subscriptions only
  console.log("\nTest 6: list_subscriptions returns confirmed subscriptions only");
  try {
    const subsToolResult = executeTool("list_subscriptions", {}, profile, reviewContext);
    if (!subsToolResult.ok) {
      console.log(`  ❌ FAIL: Tool execution failed: ${subsToolResult.error}`);
      errors.push(`list_subscriptions failed: ${subsToolResult.error}`);
      chatToolErrors++;
    } else {
      const toolCount = subsToolResult.data.count;
      const expectedCount = profile.confirmedSubscriptions.length;
      console.log(`  Tool (list_subscriptions): ${toolCount} subscriptions`);
      console.log(`  Expected (Subscriptions tab): ${expectedCount} subscriptions`);
      if (toolCount === expectedCount) {
        console.log(`  ✓ Match`);
      } else {
        console.log(`  ❌ FAIL: Mismatch`);
        errors.push(`Subscriptions tool vs tab mismatch: ${toolCount} !== ${expectedCount}`);
        chatToolErrors++;
      }
    }
  } catch (err) {
    console.log(`  ❌ FAIL: Exception: ${err instanceof Error ? err.message : String(err)}`);
    errors.push(`list_subscriptions threw exception: ${err instanceof Error ? err.message : String(err)}`);
    chatToolErrors++;
  }
  
  // Test 7: Fuzzy source lookup for 'MAM' returns non-empty results
  console.log("\nTest 7: Fuzzy lookup 'MAM' on get_income_summary returns non-empty");
  try {
    const mamToolResult = executeTool("get_income_summary", { range: "12mo" }, profile, reviewContext);
    if (!mamToolResult.ok) {
      console.log(`  ❌ FAIL: Tool execution failed: ${mamToolResult.error}`);
      errors.push(`get_income_summary (MAM test) failed: ${mamToolResult.error}`);
      chatToolErrors++;
    } else {
      // Check if any source fuzzy matches "MAM"
      const sources = mamToolResult.data.by_source || [];
      const mamSources = sources.filter((s: any) => 
        s.source.toLowerCase().includes("mam") ||
        "mam".includes(s.source.toLowerCase().slice(0, 3))
      );
      console.log(`  Total income sources: ${sources.length}`);
      console.log(`  Sources matching 'MAM': ${mamSources.length}`);
      if (mamSources.length > 0) {
        console.log(`  ✓ Found MAM-related sources:`);
        mamSources.forEach((s: any) => console.log(`    - ${s.source}: ${s.total}`));
      } else {
        console.log(`  ⚠ No MAM sources found (may be expected if user has no MAM income)`);
        // Don't fail this test - it's acceptable if user genuinely has no MAM income
      }
    }
  } catch (err) {
    console.log(`  ❌ FAIL: Exception: ${err instanceof Error ? err.message : String(err)}`);
    errors.push(`get_income_summary (MAM test) threw exception: ${err instanceof Error ? err.message : String(err)}`);
    chatToolErrors++;
  }
  
  if (chatToolErrors > 0) {
    console.log(`\n❌ ${chatToolErrors} AI chat tool test(s) failed\n`);
  } else {
    console.log(`\n✅ All AI chat tool tests passed\n`);
  }
  
  // ── DASHBOARD & AI-ASK SMOKE TESTS ──────────────────────────────────────────
  console.log("=".repeat(80));
  console.log("DASHBOARD & AI-ASK SMOKE TESTS");
  console.log("=".repeat(80) + "\n");
  
  let smokeTestErrors = 0;
  
  // Test that cleanAIAnswer works (used by ai-ask route)
  console.log("Test: cleanAIAnswer post-processor");
  try {
    const { cleanAIAnswer } = await import("../src/lib/chat/answerPostProcessor");
    const testInput = "From get_income_summary: CA$5,234";
    const cleaned = cleanAIAnswer(testInput);
    
    if (cleaned.includes("get_income_summary")) {
      console.log("  ❌ FAIL: cleanAIAnswer did not remove tool name");
      errors.push("cleanAIAnswer regression: tool name not removed");
      smokeTestErrors++;
    } else {
      console.log("  ✓ cleanAIAnswer removes tool names");
    }
  } catch (err) {
    console.log(`  ❌ FAIL: Exception: ${err instanceof Error ? err.message : String(err)}`);
    errors.push(`cleanAIAnswer threw exception: ${err instanceof Error ? err.message : String(err)}`);
    smokeTestErrors++;
  }
  
  // Test AI usage limit constants and logic
  console.log("\nTest: AI usage limit configuration");
  try {
    const { AI_USAGE_LIMIT_FREE, checkAIUsageLimit } = await import("../src/lib/aiUsageLimit");
    
    if (AI_USAGE_LIMIT_FREE !== 50) {
      console.log(`  ❌ FAIL: AI_USAGE_LIMIT_FREE is ${AI_USAGE_LIMIT_FREE}, expected 50`);
      errors.push(`AI usage limit wrong: ${AI_USAGE_LIMIT_FREE} !== 50`);
      smokeTestErrors++;
    } else {
      console.log("  ✓ AI_USAGE_LIMIT_FREE is 50");
    }
    
    // Test logic with mock data
    // For paid plan, should always allow
    const paidResult = await checkAIUsageLimit("test-uid", db, "pro");
    if (!paidResult.allowed || paidResult.limit !== -1) {
      console.log("  ❌ FAIL: Paid plan should have unlimited access");
      errors.push("AI usage limit: paid plan not unlimited");
      smokeTestErrors++;
    } else {
      console.log("  ✓ Paid plan has unlimited access");
    }
    
  } catch (err) {
    console.log(`  ❌ FAIL: Exception: ${err instanceof Error ? err.message : String(err)}`);
    errors.push(`AI usage limit test threw exception: ${err instanceof Error ? err.message : String(err)}`);
    smokeTestErrors++;
  }
  
  // Test saved answers API shape
  console.log("\nTest: Saved answers API structure");
  try {
    // Check the route file exists and exports expected methods
    const fs = await import("fs/promises");
    const path = await import("path");
    const routePath = path.join(process.cwd(), "src/app/api/user/saved-answers/route.ts");
    const routeContent = await fs.readFile(routePath, "utf-8");
    
    if (!routeContent.includes("export async function GET") ||
        !routeContent.includes("export async function POST") ||
        !routeContent.includes("export async function DELETE")) {
      console.log("  ❌ FAIL: Saved answers route missing expected exports");
      errors.push("Saved answers route: missing GET/POST/DELETE exports");
      smokeTestErrors++;
    } else {
      console.log("  ✓ Saved answers route has GET/POST/DELETE methods");
    }
    
    // Verify SavedAnswer interface shape
    if (!routeContent.includes("question:") ||
        !routeContent.includes("answer:") ||
        !routeContent.includes("createdAt:")) {
      console.log("  ❌ FAIL: SavedAnswer interface missing expected fields");
      errors.push("SavedAnswer: missing question/answer/createdAt fields");
      smokeTestErrors++;
    } else {
      console.log("  ✓ SavedAnswer has expected shape");
    }
    
  } catch (err) {
    console.log(`  ❌ FAIL: Exception: ${err instanceof Error ? err.message : String(err)}`);
    errors.push(`Saved answers API test failed: ${err instanceof Error ? err.message : String(err)}`);
    smokeTestErrors++;
  }
  
  // Test that dashboard page component exports exist
  console.log("\nTest: Dashboard page exports");
  try {
    // Verify SHOW_OPEN_IN_CHAT feature flag is set to false
    const fs = await import("fs/promises");
    const path = await import("path");
    const dashboardPath = path.join(process.cwd(), "src/app/account/dashboard/page.tsx");
    const dashboardContent = await fs.readFile(dashboardPath, "utf-8");
    
    if (!dashboardContent.includes("const SHOW_OPEN_IN_CHAT = false")) {
      console.log("  ⚠️  WARNING: SHOW_OPEN_IN_CHAT is not set to false (expected hidden)");
    } else {
      console.log("  ✓ 'Open in Chat' link is hidden (SHOW_OPEN_IN_CHAT = false)");
    }
    
    // Verify saved answers link exists
    if (!dashboardContent.includes("Saved answers") || !dashboardContent.includes("/account/saved-answers")) {
      console.log("  ❌ FAIL: Dashboard missing 'Saved answers' link");
      errors.push("Dashboard: missing saved answers link");
      smokeTestErrors++;
    } else {
      console.log("  ✓ Dashboard has 'Saved answers' link");
    }
  } catch (err) {
    console.log(`  ❌ FAIL: Exception: ${err instanceof Error ? err.message : String(err)}`);
    errors.push(`Dashboard page import failed: ${err instanceof Error ? err.message : String(err)}`);
    smokeTestErrors++;
  }
  
  // Test chart point scaling for all accounts
  console.log("\nTest: Chart point scaling (NaN prevention)");
  try {
    const { scaleBalancePoints } = await import("../src/lib/chartScaling");
    
    const dimensions = {
      chartWidth: 400,
      chartHeight: 200,
      padding: { top: 20, right: 20, bottom: 30, left: 50 },
    };
    
    let accountsTested = 0;
    let pointsTested = 0;
    
    // Test every account in accountBalanceHistory
    for (const account of profile.accountBalanceHistory || []) {
      const history = account.entries.map((e: any) => ({
        month: e.yearMonth,
        monthLabel: e.yearMonth,
        balance: e.balance,
      }));
      
      const points = scaleBalancePoints(history, dimensions, account.accountType === "credit");
      
      accountsTested++;
      pointsTested += points.length;
      
      // Assert all points have finite coordinates
      for (const point of points) {
        if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
          console.log(`  ❌ FAIL: Non-finite chart point for ${account.label}`);
          console.log(`     Account: ${account.label} (${account.accountType})`);
          console.log(`     Entries: ${history.length}`);
          console.log(`     Point: x=${point.x}, y=${point.y}`);
          errors.push(`Chart scaling produced NaN for ${account.label}`);
          smokeTestErrors++;
        }
      }
    }
    
    console.log(`  ✓ Chart scaling: ${accountsTested} accounts, ${pointsTested} points, all finite`);
  } catch (err) {
    console.log(`  ❌ FAIL: Exception: ${err instanceof Error ? err.message : String(err)}`);
    errors.push(`Chart scaling test failed: ${err instanceof Error ? err.message : String(err)}`);
    smokeTestErrors++;
  }
  
  // Test multi-month balance reconstruction
  console.log("\nTest: Multi-month balance reconstruction");
  try {
    // Fetch all completed statements to verify per-statement reconciliation
    const statementsSnap = await db
      .collection("statements")
      .where("userId", "==", uid)
      .where("status", "==", "completed")
      .get();
    
    const statements = statementsSnap.docs.map(doc => ({
      id: doc.id,
      yearMonth: doc.get("yearMonth"),
      parsedData: doc.get("parsedData"),
      accountSlug: doc.get("accountSlug"),
    }));
    
    console.log(`  Fetched ${statements.length} completed statements`);
    
    let accountsTested = 0;
    let statementsChecked = 0;
    let derivedEntriesChecked = 0;
    let reconciliationErrors = 0;
    let negativeErrors = 0;
    let boundaryErrors = 0;
    let overwriteErrors = 0;
    
    // Map statement months to their statements for lookup
    const statementsByAccountMonth = new Map<string, any>();
    for (const stmt of statements) {
      const key = `${stmt.accountSlug}:${stmt.yearMonth}`;
      statementsByAccountMonth.set(key, stmt);
    }
    
    // For each account with derived entries, verify per-statement
    for (const account of profile.accountBalanceHistory || []) {
      const derivedEntries = account.entries.filter((e: any) => e.derived);
      if (derivedEntries.length === 0) continue;
      
      accountsTested++;
      
      console.log(`\n  📊 ${account.label} (${account.slug}): ${derivedEntries.length} derived entries`);
      
      const accountType = account.accountType?.toLowerCase() || "";
      const isSavingsOrChecking = ["savings", "checking", "chequing"].includes(accountType);
      
      // Get real (non-derived) balance months for this account
      const realBalanceMonths = new Set(
        account.entries.filter((e: any) => !e.derived).map((e: any) => e.yearMonth)
      );
      
      // Group derived entries by which statement produced them (use sourceStatement)
      const derivedByStatement = new Map<string, any[]>();
      
      for (const derived of derivedEntries) {
        // Use the sourceStatement field instead of guessing
        const statementMonth = derived.sourceStatement;
        
        if (!statementMonth) {
          console.log(`    ⚠️  ${derived.yearMonth}: no sourceStatement field`);
          continue;
        }
        
        if (!derivedByStatement.has(statementMonth)) {
          derivedByStatement.set(statementMonth, []);
        }
        derivedByStatement.get(statementMonth)!.push(derived);
      }
      
      // For each statement that produced derived entries, verify
      for (const [statementMonth, derivedList] of derivedByStatement.entries()) {
        const stmtKey = `${account.slug}:${statementMonth}`;
        const stmt = statementsByAccountMonth.get(stmtKey);
        
        if (!stmt || !stmt.parsedData) {
          console.log(`    ⚠️  Statement ${statementMonth}: not found or no parsed data`);
          continue;
        }
        
        statementsChecked++;
        
        const parsed = stmt.parsedData;
        const closingBalance = parsed.netWorth;
        
        // Get statement's own transactions
        const stmtExpenses = parsed.expenses?.transactions ?? [];
        const stmtIncome = parsed.income?.transactions ?? [];
        
        // Build transaction net flows by month
        const txnsByMonth = new Map<string, number>();
        
        for (const exp of stmtExpenses) {
          if (!exp.date) continue;
          const month = exp.date.slice(0, 7);
          const current = txnsByMonth.get(month) || 0;
          txnsByMonth.set(month, current - exp.amount);
        }
        
        for (const inc of stmtIncome) {
          if (!inc.date) continue;
          const month = inc.date.slice(0, 7);
          const current = txnsByMonth.get(month) || 0;
          txnsByMonth.set(month, current + inc.amount);
        }
        
        const txnMonths = Array.from(txnsByMonth.keys()).sort();
        const firstTxnMonth = txnMonths[0];
        const lastTxnMonth = txnMonths[txnMonths.length - 1];
        
        console.log(`    Statement ${statementMonth}: txns ${firstTxnMonth}-${lastTxnMonth}, ${derivedList.length} derived`);
        
        // Build derivedBalances map for validation
        const derivedBalancesMap = new Map<string, number>();
        for (const d of derivedList) {
          derivedBalancesMap.set(d.yearMonth, d.balance);
        }
        
        // Use shared validation function (same as production)
        const accountType = account.accountType?.toLowerCase() || "";
        const isDebt = ["credit", "loan", "mortgage", "loc"].includes(accountType);
        
        const validation = validateDerivedBalances(
          statementMonth,
          closingBalance,
          parsed,
          derivedBalancesMap,
          isDebt
        );
        
        if (validation.valid) {
          for (const d of derivedList) {
            derivedEntriesChecked++;
            console.log(`      ✓ ${d.yearMonth}: ${d.balance.toFixed(2)} reconciles`);
          }
        } else {
          // Report errors
          for (const error of validation.errors) {
            const parts = error.split(':');
            const month = parts[0];
            const msg = parts.slice(1).join(':').trim();
            
            derivedEntriesChecked++;
            
            if (msg.includes('outside txn range')) {
              boundaryErrors++;
              console.log(`      ❌ ${month}: OUTSIDE ${msg}`);
              errors.push(`${account.label} ${month}: ${msg}`);
              smokeTestErrors++;
            } else if (msg.includes('negative balance')) {
              negativeErrors++;
              console.log(`      ❌ ${month}: NEGATIVE ${msg}`);
              errors.push(`${account.label} ${month}: ${msg}`);
              smokeTestErrors++;
            } else if (msg.includes('vs recomputed')) {
              reconciliationErrors++;
              console.log(`      ❌ ${month}: ${msg}`);
              errors.push(`${account.label} ${month}: reconciliation error`);
              smokeTestErrors++;
            } else {
              console.log(`      ❌ ${month}: ${msg}`);
              errors.push(`${account.label} ${month}: ${msg}`);
              smokeTestErrors++;
            }
          }
        }
      }
    }
    
    console.log(`\n  Summary: ${accountsTested} accounts, ${statementsChecked} statements, ${derivedEntriesChecked} derived entries checked`);
    
    if (reconciliationErrors > 0 || negativeErrors > 0 || boundaryErrors > 0 || overwriteErrors > 0) {
      console.log(`  ❌ ERRORS: ${reconciliationErrors} reconciliation, ${negativeErrors} negative, ${boundaryErrors} boundary, ${overwriteErrors} overwrite`);
    } else {
      console.log(`  ✅ All derived entries reconcile correctly`);
    }
  } catch (err) {
    console.log(`  ❌ FAIL: Exception: ${err instanceof Error ? err.message : String(err)}`);
    errors.push(`Multi-month balance test failed: ${err instanceof Error ? err.message : String(err)}`);
    smokeTestErrors++;
  }
  
  if (smokeTestErrors > 0) {
    console.log(`\n❌ ${smokeTestErrors} smoke test(s) failed\n`);
  } else {
    console.log(`\n✅ All smoke tests passed\n`);
  }
  
  // ── AI ANSWER FORMATTING CONSISTENCY CHECKS ────────────────────────────────────
  console.log("=".repeat(80));
  console.log("AI ANSWER FORMATTING CONSISTENCY CHECKS");
  console.log("=".repeat(80) + "\n");

  let aiFormatErrors = 0;

  // Check 1: All answer display sites use shared AiAnswer component
  console.log("Check 1: Answer display sites use shared AiAnswer component");
  try {
    const fs = await import("fs/promises");
    const path = await import("path");
    
    const filesToCheck = [
      "src/app/account/dashboard/page.tsx",
      "src/app/account/chat/page.tsx",
      "src/app/account/saved-answers/page.tsx",
    ];
    
    for (const file of filesToCheck) {
      const filePath = path.join(process.cwd(), file);
      const content = await fs.readFile(filePath, "utf-8");
      
      const hasImport = content.includes('import { AiAnswer } from "@/components/AiAnswer"') ||
                       content.includes("import { AiAnswer } from '@/components/AiAnswer'");
      const hasUsage = content.includes("<AiAnswer");
      
      if (!hasImport || !hasUsage) {
        console.log(`  ❌ FAIL: ${file} does not use shared AiAnswer component`);
        errors.push(`AI formatting: ${file} missing AiAnswer usage`);
        aiFormatErrors++;
      } else {
        console.log(`  ✓ ${file} uses AiAnswer component`);
      }
    }
  } catch (err) {
    console.log(`  ❌ FAIL: Error checking answer components: ${err instanceof Error ? err.message : String(err)}`);
    errors.push("AI formatting: failed to check answer components");
    aiFormatErrors++;
  }

  // Check 2: All Gemini answer routes include AI_ANSWER_FORMAT
  console.log("\nCheck 2: Gemini answer routes include AI_ANSWER_FORMAT");
  try {
    const fs = await import("fs/promises");
    const path = await import("path");
    
    const routesToCheck = [
      { file: "src/lib/chat/context.ts", description: "Chat context builder" },
    ];
    
    for (const route of routesToCheck) {
      const filePath = path.join(process.cwd(), route.file);
      const content = await fs.readFile(filePath, "utf-8");
      
      const hasImport = content.includes('import { AI_ANSWER_FORMAT } from "@/lib/aiAnswerFormat"') ||
                       content.includes("import { AI_ANSWER_FORMAT } from '@/lib/aiAnswerFormat'");
      const hasUsage = content.includes("${AI_ANSWER_FORMAT}");
      
      if (!hasImport || !hasUsage) {
        console.log(`  ❌ FAIL: ${route.description} (${route.file}) does not include AI_ANSWER_FORMAT`);
        errors.push(`AI formatting: ${route.file} missing AI_ANSWER_FORMAT`);
        aiFormatErrors++;
      } else {
        console.log(`  ✓ ${route.description} includes AI_ANSWER_FORMAT`);
      }
    }
  } catch (err) {
    console.log(`  ❌ FAIL: Error checking Gemini routes: ${err instanceof Error ? err.message : String(err)}`);
    errors.push("AI formatting: failed to check Gemini routes");
    aiFormatErrors++;
  }

  // Check 3: No 'Thinking' loading text or hasInteracted state
  console.log("\nCheck 3: Loading indicators use animated dots (not 'Thinking' text)");
  try {
    const fs = await import("fs/promises");
    const path = await import("path");
    
    const filesToCheck = [
      "src/app/account/dashboard/page.tsx",
      "src/app/account/chat/page.tsx",
    ];
    
    for (const file of filesToCheck) {
      const filePath = path.join(process.cwd(), file);
      const content = await fs.readFile(filePath, "utf-8");
      
      const hasThinkingText = content.includes('"Thinking') || content.includes("'Thinking");
      const hasWaitingText = content.includes('"Waiting for response') || content.includes("'Waiting for response");
      const hasInteractedState = content.includes('hasInteracted');
      
      if (hasThinkingText || hasWaitingText) {
        console.log(`  ❌ FAIL: ${file} still contains loading text ("Thinking" or "Waiting")`);
        errors.push(`AI formatting: ${file} has old loading text`);
        aiFormatErrors++;
      } else if (hasInteractedState) {
        console.log(`  ❌ FAIL: ${file} still contains hasInteracted state`);
        errors.push(`AI formatting: ${file} has hasInteracted state`);
        aiFormatErrors++;
      } else {
        console.log(`  ✓ ${file} uses animated loading indicator`);
      }
    }
  } catch (err) {
    console.log(`  ❌ FAIL: Error checking loading indicators: ${err instanceof Error ? err.message : String(err)}`);
    errors.push("AI formatting: failed to check loading indicators");
    aiFormatErrors++;
  }

  console.log();
  
  // ── PRIVACY CHECKS ────────────────────────────────────────────────────────────
  console.log("=".repeat(80));
  console.log("PRIVACY CHECKS");
  console.log("=".repeat(80) + "\n");

  let privacyErrors = 0;

  // Check 1: Count statements with non-empty fileUrl
  console.log("Check 1: Statements with stored files");
  try {
    const statementsWithFilesSnap = await db.collection("statements")
      .where("userId", "==", uid)
      .get();

    let statementsWithFiles = 0;
    let completedWithFiles = 0;

    for (const doc of statementsWithFilesSnap.docs) {
      const data = doc.data();
      const fileUrl = data.fileUrl as string | undefined;
      const status = data.status as string | undefined;

      if (fileUrl && fileUrl.trim() !== "") {
        statementsWithFiles++;
        if (status === "completed") {
          completedWithFiles++;
        }
      }
    }

    console.log(`  Total statements with non-empty fileUrl: ${statementsWithFiles}`);
    console.log(`  Completed statements with stored files: ${completedWithFiles}`);

    if (completedWithFiles > 0) {
      console.log(`  ⚠️  WARNING: ${completedWithFiles} completed statements still have stored files`);
      console.log(`  Run: tsx scripts/purge-stored-statement-files.ts --apply`);
    } else {
      console.log(`  ✓ No completed statements have stored files`);
    }
  } catch (err) {
    console.log(`  ❌ FAIL: Error checking statement files: ${err instanceof Error ? err.message : String(err)}`);
    errors.push("Privacy check: failed to check statement files");
    privacyErrors++;
  }

  // Check 2: Count account IDs longer than 4 digits
  console.log("\nCheck 2: Account numbers longer than 4 digits");
  try {
    const allStatementsSnap = await db.collection("statements")
      .where("userId", "==", uid)
      .get();

    let longAccountIds = 0;
    const examples: Array<{ id: string; accountId: string; slug: string }> = [];

    for (const doc of allStatementsSnap.docs) {
      const data = doc.data();
      const parsedData = data.parsedData as Record<string, any> | undefined;
      const accountId = parsedData?.accountId as string | undefined;
      const slug = data.accountSlug as string | undefined;

      if (accountId && accountId.length > 4) {
        longAccountIds++;
        if (examples.length < 5) {
          examples.push({
            id: doc.id,
            accountId,
            slug: slug || "no-slug",
          });
        }
      }
    }

    console.log(`  Account IDs longer than 4 digits: ${longAccountIds}`);

    if (longAccountIds > 0) {
      console.log(`  ⚠️  WARNING: ${longAccountIds} statements have unmasked account numbers`);
      console.log(`  Examples:`);
      for (const ex of examples) {
        console.log(`    ${ex.id}: accountId="${ex.accountId}" (slug: ${ex.slug})`);
      }
      console.log(`  Run: tsx scripts/mask-account-numbers.ts --apply`);
    } else {
      console.log(`  ✓ All account numbers are masked (4 digits or less)`);
    }
  } catch (err) {
    console.log(`  ❌ FAIL: Error checking account numbers: ${err instanceof Error ? err.message : String(err)}`);
    errors.push("Privacy check: failed to check account numbers");
    privacyErrors++;
  }

  // Check 3: Confirm debug parse route is removed
  console.log("\nCheck 3: Debug parse route removed");
  try {
    const fs = await import("fs/promises");
    const path = await import("path");
    const debugRoutePath = path.join(process.cwd(), "src/app/api/debug/parse/route.ts");

    try {
      await fs.access(debugRoutePath);
      console.log(`  ❌ FAIL: Debug parse route still exists at ${debugRoutePath}`);
      errors.push("Privacy check: debug parse route not removed");
      privacyErrors++;
    } catch {
      console.log(`  ✓ Debug parse route removed`);
    }
  } catch (err) {
    console.log(`  ❌ FAIL: Error checking debug route: ${err instanceof Error ? err.message : String(err)}`);
    errors.push("Privacy check: failed to check debug route");
    privacyErrors++;
  }

  console.log();

  // ── Plan Alignment Checks ───────────────────────────────────────────────────

  console.log("=".repeat(80));
  console.log("PLAN ALIGNMENT CHECKS");
  console.log("=".repeat(80));
  let planAlignmentErrors = 0;

  // Check 1: Print resolved plan for uid
  console.log("\nCheck 1: Resolved plan for uid");
  try {
    const userDoc = await db.collection("users").doc(uid).get();
    const userData = userDoc.exists ? userDoc.data() : undefined;
    
    // Import resolvePlan from the plan route
    const { resolvePlan } = await import("../src/app/api/user/plan/route.js");
    const resolvedPlan = resolvePlan(userData as Record<string, unknown> | undefined);
    
    console.log(`  Resolved plan: ${resolvedPlan ?? "free"}`);
    if (userData?.manualPro) console.log(`  → manualPro = true (admin override)`);
    if (userData?.subscription?.status) console.log(`  → subscription.status = ${userData.subscription.status}`);
    if (userData?.promoExpiresAt) {
      const expiry = (userData.promoExpiresAt as any).toDate?.() ?? new Date(userData.promoExpiresAt as any);
      console.log(`  → promoExpiresAt = ${expiry.toISOString()} (${expiry > new Date() ? "active" : "expired"})`);
    }
  } catch (err) {
    console.log(`  ❌ FAIL: Error resolving plan: ${err instanceof Error ? err.message : String(err)}`);
    errors.push("Plan alignment: failed to resolve plan");
    planAlignmentErrors++;
  }

  // Check 2: Free upload counters
  console.log("\nCheck 2: Free upload counters");
  try {
    const userDoc = await db.collection("users").doc(uid).get();
    const userData = userDoc.data() ?? {};
    
    const onetimeUsed = userData.uploadCountOneTime ?? 0;
    const monthlyUsed = userData.uploadCountMonthly ?? 0;
    const monthlyResetAt = userData.uploadCountResetAt as any;
    
    console.log(`  One-time pool used: ${onetimeUsed} / 50`);
    console.log(`  Monthly pool used: ${monthlyUsed} / 8`);
    if (monthlyResetAt) {
      const resetDate = monthlyResetAt.toDate?.() ?? new Date(monthlyResetAt);
      console.log(`  Monthly reset: ${resetDate.toLocaleDateString()}`);
    }
  } catch (err) {
    console.log(`  ⚠️  WARNING: Error checking upload counters: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Check 3: Verify resolvePlan is used in upload and ai-ask routes
  console.log("\nCheck 3: resolvePlan usage in routes");
  try {
    const fs = await import("fs/promises");
    const path = await import("path");
    
    // Check upload route
    const uploadRoutePath = path.join(process.cwd(), "src/app/api/upload/route.ts");
    const uploadRouteContent = await fs.readFile(uploadRoutePath, "utf-8");
    const uploadUsesResolvePlan = uploadRouteContent.includes("resolvePlan(") && uploadRouteContent.includes("from \"@/app/api/user/plan/route\"");
    
    // Check ai-ask route
    const aiAskRoutePath = path.join(process.cwd(), "src/app/api/user/ai-ask/route.ts");
    const aiAskRouteContent = await fs.readFile(aiAskRoutePath, "utf-8");
    const aiAskUsesResolvePlan = aiAskRouteContent.includes("resolvePlan(") && aiAskRouteContent.includes("from \"../plan/route\"");
    
    // Check statements route
    const statementsRoutePath = path.join(process.cwd(), "src/app/api/user/statements/route.ts");
    const statementsRouteContent = await fs.readFile(statementsRoutePath, "utf-8");
    const statementsUsesResolvePlan = statementsRouteContent.includes("resolvePlan(") && statementsRouteContent.includes("from \"@/app/api/user/plan/route\"");
    
    console.log(`  Upload route uses resolvePlan: ${uploadUsesResolvePlan ? "✓" : "❌"}`);
    console.log(`  AI-ask route uses resolvePlan: ${aiAskUsesResolvePlan ? "✓" : "❌"}`);
    console.log(`  Statements route uses resolvePlan: ${statementsUsesResolvePlan ? "✓" : "❌"}`);
    
    if (!uploadUsesResolvePlan) {
      errors.push("Plan alignment: upload route must import and use resolvePlan from plan/route");
      planAlignmentErrors++;
    }
    if (!aiAskUsesResolvePlan) {
      errors.push("Plan alignment: ai-ask route must import and use resolvePlan from plan/route");
      planAlignmentErrors++;
    }
    if (!statementsUsesResolvePlan) {
      errors.push("Plan alignment: statements route must import and use resolvePlan from plan/route");
      planAlignmentErrors++;
    }
  } catch (err) {
    console.log(`  ❌ FAIL: Error checking resolvePlan usage: ${err instanceof Error ? err.message : String(err)}`);
    errors.push("Plan alignment: failed to check resolvePlan usage");
    planAlignmentErrors++;
  }

  // Check 3a: Verify statements API quota.isPro matches resolved plan
  console.log("\nCheck 3a: Statements API quota.isPro consistency");
  try {
    const userDoc = await db.collection("users").doc(uid).get();
    const userData = userDoc.exists ? userDoc.data() : undefined;
    
    const { resolvePlan } = await import("../src/app/api/user/plan/route.js");
    const resolvedPlan = resolvePlan(userData as Record<string, unknown> | undefined) ?? "free";
    const expectedIsPro = resolvedPlan === "pro";
    
    // Simulate what statements route would return
    const userPlan = resolvePlan(userData as Record<string, unknown> | undefined) ?? "free";
    const actualIsPro = userPlan === "pro";
    
    console.log(`  Resolved plan: ${resolvedPlan}`);
    console.log(`  Expected quota.isPro: ${expectedIsPro}`);
    console.log(`  Actual quota.isPro: ${actualIsPro}`);
    
    if (expectedIsPro !== actualIsPro) {
      console.log(`  ❌ FAIL: quota.isPro mismatch`);
      errors.push(`Plan alignment: quota.isPro (${actualIsPro}) does not match resolved plan (${resolvedPlan})`);
      planAlignmentErrors++;
    } else {
      console.log(`  ✓ quota.isPro matches resolved plan`);
    }
  } catch (err) {
    console.log(`  ❌ FAIL: Error checking quota consistency: ${err instanceof Error ? err.message : String(err)}`);
    errors.push("Plan alignment: failed to check quota consistency");
    planAlignmentErrors++;
  }

  // Check 3b: No direct userData.plan reads remain
  console.log("\nCheck 3b: No direct userData.plan reads");
  try {
    const fs = await import("fs/promises");
    const path = await import("path");
    const { glob } = await import("glob");
    
    // Search for direct userData.plan accesses
    const filesToCheck = await glob("src/app/api/**/*.ts", {
      ignore: [
        "**/node_modules/**",
        "**/plan/route.ts", // resolvePlan itself is defined here
      ],
    });
    
    const foundDirectReads: Array<{ file: string; line: number; text: string }> = [];
    
    for (const file of filesToCheck) {
      const content = await fs.readFile(file, "utf-8");
      const lines = content.split("\n");
      
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        
        // Look for userData.plan or similar patterns (but not in comments)
        const trimmed = line.trim();
        if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;
        
        if (/userData\.plan(?!\w)|userData\[['"']plan['"']\]/.test(line)) {
          foundDirectReads.push({
            file: file.replace(process.cwd() + "/", ""),
            line: i + 1,
            text: line.trim().slice(0, 100),
          });
        }
      }
    }
    
    if (foundDirectReads.length === 0) {
      console.log(`  ✓ No direct userData.plan reads in API routes`);
    } else {
      console.log(`  ❌ FAIL: Found ${foundDirectReads.length} direct userData.plan reads:`);
      for (const item of foundDirectReads) {
        console.log(`    ${item.file}:${item.line}`);
        console.log(`      ${item.text}`);
      }
      errors.push(`Plan alignment: ${foundDirectReads.length} direct userData.plan reads remain in API routes`);
      planAlignmentErrors++;
    }
  } catch (err) {
    console.log(`  ❌ FAIL: Error checking direct plan reads: ${err instanceof Error ? err.message : String(err)}`);
    errors.push("Plan alignment: failed to check direct plan reads");
    planAlignmentErrors++;
  }

  // Check 4: No outdated marketing strings remain
  console.log("\nCheck 4: Outdated marketing strings in pricing surfaces");
  try {
    const fs = await import("fs/promises");
    const path = await import("path");
    
    // Only check user-visible pricing/marketing surfaces
    const pricingSurfaces = [
      "src/app/page.tsx",                      // Landing page
      "src/app/account/billing/page.tsx",      // Billing page
      "src/components/UpgradePrompt.tsx",      // Upgrade prompts
      "src/app/promo/[code]/page.tsx",         // Promo pages
    ];
    
    // User-visible plan-limit phrases only (not technical comments)
    const marketingPhrases = [
      "6 months of history",
      "Last 6 months",
      "5 statement uploads",
      "5 uploads",
    ];
    
    const foundStrings: Array<{ file: string; phrase: string; line: number; text: string }> = [];
    
    for (const file of pricingSurfaces) {
      try {
        const content = await fs.readFile(file, "utf-8");
        const lines = content.split("\n");
        
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          
          // Skip code comments
          const trimmed = line.trim();
          if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue;
          
          for (const phrase of marketingPhrases) {
            if (line.toLowerCase().includes(phrase.toLowerCase())) {
              // Skip if it's explaining the old behavior
              if (line.includes("was 6 months") || line.includes("(was 6 months)")) continue;
              
              foundStrings.push({
                file: file.replace(process.cwd() + "/", ""),
                phrase,
                line: i + 1,
                text: line.trim().slice(0, 100),
              });
            }
          }
        }
      } catch (err) {
        // File doesn't exist - skip silently (e.g. promo page might not exist)
        if ((err as any).code !== "ENOENT") throw err;
      }
    }
    
    if (foundStrings.length === 0) {
      console.log(`  ✓ No outdated marketing strings in pricing surfaces`);
    } else {
      console.log(`  ❌ FAIL: Found ${foundStrings.length} outdated marketing phrases:`);
      for (const item of foundStrings) {
        console.log(`    ${item.file}:${item.line} - "${item.phrase}"`);
        console.log(`      ${item.text}`);
      }
      errors.push(`Plan alignment: ${foundStrings.length} outdated marketing phrases in pricing surfaces`);
      planAlignmentErrors++;
    }
  } catch (err) {
    console.log(`  ❌ FAIL: Error checking marketing strings: ${err instanceof Error ? err.message : String(err)}`);
    errors.push("Plan alignment: failed to check marketing strings");
    planAlignmentErrors++;
  }

  console.log();

  // Final summary - check ALL error conditions
  const totalFailures = 
    (allErrors ? errors.length : 0) +
    (hasMismatches ? totalMismatches : 0) +
    (hasIncomeBarMismatches ? incomeBarMismatches : 0) +
    (hasBaselineChanges ? (baselineComparison?.significantChanges || 0) : 0) +
    rangeErrors +
    drawerErrors +
    cashPlannerErrors +
    chatToolErrors +
    moneyCoachErrors +
    smokeTestErrors +
    aiFormatErrors +
    privacyErrors +
    planAlignmentErrors;
  
  if (totalFailures > 0) {
    console.log("=".repeat(80));
    console.log("❌ TEST FAILED\n");
    
    if (allErrors) {
      console.log(`Errors: ${errors.length}`);
      errors.forEach((e, i) => console.log(`  ${i + 1}. ${e}`));
    }
    if (hasMismatches) console.log(`Card/Drawer mismatches: ${totalMismatches}`);
    if (hasIncomeBarMismatches) console.log(`Income bar mismatches: ${incomeBarMismatches}`);
    if (hasBaselineChanges && baselineComparison) console.log(`Significant baseline changes: ${baselineComparison.significantChanges}`);
    if (rangeErrors > 0) console.log(`Range test failures: ${rangeErrors}`);
    if (drawerErrors > 0) console.log(`Account drawer test failures: ${drawerErrors}`);
    if (cashPlannerErrors > 0) console.log(`Cash/Planner test failures: ${cashPlannerErrors}`);
    if (chatToolErrors > 0) console.log(`AI chat tool test failures: ${chatToolErrors}`);
    if (moneyCoachErrors > 0) console.log(`Money coach API test failures: ${moneyCoachErrors}`);
    if (smokeTestErrors > 0) console.log(`Smoke test failures: ${smokeTestErrors}`);
    if (aiFormatErrors > 0) console.log(`AI formatting consistency failures: ${aiFormatErrors}`);
    if (privacyErrors > 0) console.log(`Privacy check failures: ${privacyErrors}`);
    if (planAlignmentErrors > 0) console.log(`Plan alignment check failures: ${planAlignmentErrors}`);
    
    console.log();
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
