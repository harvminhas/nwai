#!/usr/bin/env tsx
/**
 * Financial Profile Inspector CLI
 * 
 * Read-only tool to inspect a user's financial profile using the same
 * data access layer functions that the pages use.
 * 
 * Usage:
 *   npx tsx --env-file=.env.local scripts/inspect-profile.ts <uid> [month1,month2,...]
 * 
 * Example:
 *   npx tsx --env-file=.env.local scripts/inspect-profile.ts 9s3BrR 2026-07,2026-08,2026-09
 * 
 * Requirements:
 *   - .env.local with Firebase Admin credentials
 *   - Use --env-file flag (ESM import hoisting prevents dotenv from loading in time)
 * 
 * Makes NO writes, prints NO secrets
 */
import { resolve } from 'path';
import { getFirebaseAdmin } from '../src/lib/firebase-admin.js';
import { getFinancialProfile } from '../src/lib/financialProfile.js';
import { computeScheduledDebtPayments, getAllUnreviewedAnomalies } from '../src/lib/debtPayments.js';
import { computeBucketBreakdown, getMonthsForWindow } from '../src/lib/bucketBreakdown.js';
import { merchantSlug } from '../src/lib/applyRules.js';
import { normalizeMerchantName } from '../src/lib/merchantUtils.js';
import type { DebtPaymentReview } from '../src/lib/types.js';

interface Args {
  uid: string;
  months?: string[];
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.error('Usage: npx tsx --env-file=.env.local scripts/inspect-profile.ts <uid> [month1,month2,...]');
    console.error('Example: npx tsx --env-file=.env.local scripts/inspect-profile.ts 9s3BrR 2026-07,2026-08,2026-09');
    process.exit(1);
  }

  const uid = args[0];
  const months = args[1] ? args[1].split(',').map(m => m.trim()) : undefined;

  return { uid, months };
}

function fmt(amount: number, currency = 'CAD'): string {
  const symbol = currency === 'USD' ? 'US$' : 'CA$';
  return `${symbol}${amount.toLocaleString('en-US', { 
    minimumFractionDigits: 2, 
    maximumFractionDigits: 2 
  })}`;
}

async function main() {
  const { uid, months: requestedMonths } = parseArgs();

  console.log('='.repeat(80));
  console.log('Financial Profile Inspector');
  console.log('='.repeat(80));
  console.log(`User ID: ${uid}`);
  console.log(`Requested months: ${requestedMonths ? requestedMonths.join(', ') : 'ALL'}`);
  console.log('');

  const { db } = getFirebaseAdmin();

  // Load financial profile
  console.log('Loading financial profile...');
  const profile = await getFinancialProfile(uid, db);

  console.log(`✓ Loaded profile (updated: ${profile.updatedAt})`);
  console.log(`  Schema version: ${profile.schemaVersion || '(unknown)'}`);
  console.log(`  Home currency: ${profile.homeCurrency}`);
  console.log(`  Accounts: ${profile.accountSnapshots.length}`);
  console.log(`  Expense transactions: ${profile.expenseTxns.length}`);
  
  // Guard against stale cache missing debtPaymentHistory
  if (!profile.debtPaymentHistory) {
    console.log(`  ⚠️  Debt payment history: MISSING (stale cache)`);
    console.log('');
    console.log('  The cached profile was built with older code that did not include');
    console.log('  debtPaymentHistory. The schema version has been bumped to v54, so the');
    console.log('  cache will be automatically rebuilt on the next page load.');
    console.log('');
    console.log('  Skipping debt payment sections (they would crash).');
    console.log('');
    console.log('='.repeat(80));
    console.log('Inspection complete (partial - stale cache)');
    console.log('='.repeat(80));
    return;
  }
  
  console.log(`  Debt payment history entries: ${profile.debtPaymentHistory.length}`);
  console.log('');

  // Load user reviews
  const reviewsSnap = await db.collection(`users/${uid}/debtPaymentReviews`).get();
  const userReviews: DebtPaymentReview[] = reviewsSnap.docs.map(doc => ({
    txFingerprint: doc.id,
    accountSlug: doc.get('accountSlug'),
    classification: doc.get('classification'),
    date: doc.get('date'),
    amount: doc.get('amount'),
    reviewedAt: doc.get('reviewedAt'),
  }));

  // ── Scheduled Debt Payments ────────────────────────────────────────────────

  console.log('─'.repeat(80));
  console.log('SCHEDULED DEBT PAYMENTS (Learned from statement history)');
  console.log('─'.repeat(80));

  const scheduledPayments = computeScheduledDebtPayments(
    profile.accountSnapshots,
    profile.debtPaymentHistory,
    userReviews,
    profile.fxRates ?? {},
    profile.homeCurrency
  );

  if (scheduledPayments.length === 0) {
    console.log('  (none)');
  } else {
    for (const payment of scheduledPayments) {
      const snap = profile.accountSnapshots.find(a => a.slug === payment.accountSlug);
      console.log('');
      console.log(`  ${payment.accountName || payment.accountSlug}`);
      console.log(`    Amount: ${fmt(payment.amount, profile.homeCurrency)} / month`);
      console.log(`    Method: ${payment.method}`);
      console.log(`    Type: ${payment.debtType}`);
      console.log(`    Estimated: ${payment.isEstimated}`);
      if (snap) {
        console.log(`    Current balance: ${fmt(Math.abs(snap.balance), snap.currency)}`);
      }
      if (payment.unreviewedAnomalies && payment.unreviewedAnomalies.length > 0) {
        console.log(`    Unreviewed anomalies: ${payment.unreviewedAnomalies.length}`);
        for (const anomaly of payment.unreviewedAnomalies) {
          console.log(`      - ${anomaly.txMonth}: ${fmt(anomaly.amount, profile.homeCurrency)} (${anomaly.reason})`);
        }
      }
    }
  }

  // ── Unreviewed Anomalies ───────────────────────────────────────────────────

  const allAnomalies = getAllUnreviewedAnomalies(
    profile.accountSnapshots,
    profile.debtPaymentHistory,
    userReviews,
    profile.fxRates ?? {},
    profile.homeCurrency
  );

  console.log('');
  console.log('─'.repeat(80));
  console.log('UNREVIEWED ANOMALIES');
  console.log('─'.repeat(80));

  if (allAnomalies.length === 0) {
    console.log('  (none)');
  } else {
    console.log(`  Total: ${allAnomalies.length}`);
    console.log('');
    for (const anomaly of allAnomalies) {
      console.log(`  ${anomaly.txMonth} - ${anomaly.accountSlug}`);
      console.log(`    Amount: ${fmt(anomaly.amount, profile.homeCurrency)}`);
      console.log(`    Reason: ${anomaly.reason}`);
      console.log(`    Description: ${anomaly.description}`);
    }
  }

  // ── Principal Paid ─────────────────────────────────────────────────────────

  console.log('');
  console.log('─'.repeat(80));
  console.log('PRINCIPAL PAID (Balance reduction, month-over-month)');
  console.log('─'.repeat(80));

  const debtAccounts = profile.accountSnapshots.filter(a => 
    a.accountType === 'loan' || 
    a.accountType === 'mortgage' || 
    a.accountType === 'line_of_credit'
  );

  for (const account of debtAccounts) {
    const history = profile.accountBalanceHistory.find(h => h.slug === account.slug);
    if (!history || history.entries.length < 2) continue;

    const sorted = [...history.entries].sort((a, b) => a.yearMonth.localeCompare(b.yearMonth));
    const latest = sorted[sorted.length - 1];
    const prev = sorted[sorted.length - 2];

    const prevBalance = Math.abs(prev.balance);
    const currentBalance = Math.abs(latest.balance);
    const principalPaid = prevBalance - currentBalance;

    console.log('');
    console.log(`  ${account.accountName || account.slug}`);
    console.log(`    ${prev.yearMonth}: ${fmt(prevBalance, history.currency)}`);
    console.log(`    ${latest.yearMonth}: ${fmt(currentBalance, history.currency)}`);
    console.log(`    Principal paid: ${fmt(principalPaid, history.currency)}`);
  }

  // ── Bucket Breakdown ───────────────────────────────────────────────────────

  // Use the same month selection logic as the dashboard
  const currentYear = new Date().getFullYear();
  const monthsToAnalyze = requestedMonths || 
    getMonthsForWindow(profile.monthlyHistory, 'last3', currentYear);

  console.log('');
  console.log('─'.repeat(80));
  console.log('BUCKET BREAKDOWN DEBUG');
  console.log('─'.repeat(80));
  console.log(`Selected months: ${monthsToAnalyze.join(', ')}`);
  console.log(`Total expense transactions in profile: ${profile.expenseTxns.length}`);
  console.log('');
  
  // Debug: show transaction counts and totals per month
  if (monthsToAnalyze.length > 0) {
    console.log('Per-month expense transaction analysis:');
    for (const month of monthsToAnalyze) {
      const monthTxns = profile.expenseTxns.filter(t => t.txMonth === month);
      const monthTotal = monthTxns.reduce((sum, t) => sum + Math.abs(t.amount), 0);
      const categoryCounts = new Map<string, number>();
      for (const txn of monthTxns) {
        categoryCounts.set(txn.category, (categoryCounts.get(txn.category) || 0) + 1);
      }
      
      console.log(`  ${month}: ${monthTxns.length} txns, total ${fmt(monthTotal, profile.homeCurrency)}`);
      
      // Show top 5 categories by transaction count
      const topCats = [...categoryCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);
      
      for (const [cat, count] of topCats) {
        console.log(`    - ${cat}: ${count} txns`);
      }
    }
  }

  if (monthsToAnalyze.length > 0) {
    console.log('');
    console.log('─'.repeat(80));
    console.log(`BUCKET BREAKDOWN RESULTS (${monthsToAnalyze.join(', ')})`);
    console.log('─'.repeat(80));

    for (const bucket of ['fixed', 'essentials', 'flexible', 'savings'] as const) {
      const breakdown = computeBucketBreakdown(
        bucket,
        profile.expenseTxns,
        profile.accountSnapshots,
        profile.debtPaymentHistory,
        monthsToAnalyze,
        profile.homeCurrency,
        userReviews,
        profile.fxRates ?? {},
        profile.merchantCadence,
        profile.confirmedSubscriptions
      );

      console.log('');
      console.log(`${bucket.toUpperCase()}: ${fmt(breakdown.monthlyAverage, profile.homeCurrency)}/month`);
      
      if (breakdown.categories.length > 0) {
        console.log(`  Categories (${breakdown.categories.length}):`);
        for (const cat of breakdown.categories) { // Show ALL categories
          const badge = cat.isScheduled ? ' [scheduled]' : cat.isEstimated ? ' [est.]' : '';
          console.log(`    ${cat.category}: ${fmt(cat.amount, profile.homeCurrency)}${badge}`);
          if (cat.merchants && cat.merchants.length > 0) {
            for (const merch of cat.merchants.slice(0, 3)) { // Top 3 merchants per category
              const method = merch.method ? ` [${merch.method}]` : '';
              console.log(`      - ${merch.merchant}: ${fmt(merch.amount, profile.homeCurrency)}${method}`);
            }
          }
        }
      } else {
        console.log('  (no categories)');
      }
    }
  } else {
    console.log('');
    console.log('─'.repeat(80));
    console.log('BUCKET BREAKDOWN');
    console.log('─'.repeat(80));
    console.log('  (no complete months available)');
  }

  // ── Otter Transactions ─────────────────────────────────────────────────────

  console.log('');
  console.log('─'.repeat(80));
  console.log('OTTER TRANSACTIONS (for debugging annual subscription)');
  console.log('─'.repeat(80));

  const otterTxns = profile.expenseTxns.filter(t => 
    (t.merchant || '').toLowerCase().includes('otter') ||
    (t.description || '').toLowerCase().includes('otter')
  );

  if (otterTxns.length > 0) {
    console.log(`Found ${otterTxns.length} Otter transaction(s):`);
    console.log('');
    for (const txn of otterTxns) {
      console.log(`  Date: ${txn.date}`);
      console.log(`  Merchant: ${txn.merchant}`);
      console.log(`  Amount: ${fmt(txn.amount, txn.currency || profile.homeCurrency)}`);
      console.log(`  Currency: ${txn.currency || profile.homeCurrency}`);
      console.log(`  Category: ${txn.category}`);
      console.log(`  Account: ${txn.accountLabel || txn.accountSlug}`);
      console.log(`  Month: ${txn.txMonth}`);
      console.log('');
    }
  } else {
    console.log('  (none found)');
  }

  // ── Merchant Deduplication Check ───────────────────────────────────────────

  console.log('');
  console.log('─'.repeat(80));
  console.log('MERCHANT NAME DEDUPLICATION (case-variant check)');
  console.log('─'.repeat(80));

  // Find merchants with potential case-variant duplicates
  const merchantsBySlug = new Map<string, Set<string>>();
  for (const txn of profile.expenseTxns) {
    const merchant = txn.merchant || 'Unknown';
    const slug = merchantSlug(merchant);
    if (!merchantsBySlug.has(slug)) {
      merchantsBySlug.set(slug, new Set());
    }
    merchantsBySlug.get(slug)!.add(merchant);
  }

  // Show only those with multiple variants
  const duplicates = Array.from(merchantsBySlug.entries())
    .filter(([, variants]) => variants.size > 1)
    .sort((a, b) => b[1].size - a[1].size);

  if (duplicates.length > 0) {
    console.log(`Found ${duplicates.length} merchant(s) with case-variant duplicates:`);
    console.log('');
    for (const [slug, variants] of duplicates.slice(0, 10)) {
      const variantList = Array.from(variants).sort();
      console.log(`  ${slug}:`);
      for (const variant of variantList) {
        const count = profile.expenseTxns.filter(t => t.merchant === variant).length;
        console.log(`    - "${variant}" (${count} txns)`);
      }
      console.log(`    → Normalized: "${normalizeMerchantName(variantList[0])}"`);
      console.log('');
    }
  } else {
    console.log('  (no case-variant duplicates found)');
  }

  // ── Subscriptions ──────────────────────────────────────────────────────────

  console.log('');
  console.log('─'.repeat(80));
  console.log('SUBSCRIPTIONS & MERCHANT CADENCE');
  console.log('─'.repeat(80));

  if (profile.confirmedSubscriptions && profile.confirmedSubscriptions.length > 0) {
    console.log('');
    console.log(`Confirmed Subscriptions (${profile.confirmedSubscriptions.length} total):`);
    console.log('');
    for (const sub of profile.confirmedSubscriptions) { // Show ALL, no truncation
      const cadence = profile.merchantCadence?.[sub.merchantSlug];
      const freq = cadence || sub.frequency || 'unknown';
      const amount = sub.amount || 0;
      const monthly = freq === 'annual' || freq === 'yearly' ? amount / 12 :
                      freq === 'quarterly' ? amount / 3 :
                      freq === 'biweekly' ? amount * 26 / 12 :
                      freq === 'weekly' ? amount * 52 / 12 :
                      amount;
      
      console.log(`  ${sub.merchant || sub.merchantSlug}`);
      console.log(`    Amount: ${fmt(amount, profile.homeCurrency)} (${freq})`);
      console.log(`    Monthly rate: ${fmt(monthly, profile.homeCurrency)}`);
      if (cadence) {
        console.log(`    Cadence: ${cadence} [user-set]`);
      }
      console.log('');
    }
  } else {
    console.log('  (none)');
  }

  console.log('');
  console.log('='.repeat(80));
  console.log('Inspection complete');
  console.log('='.repeat(80));
}

main().catch(err => {
  console.error('');
  console.error('='.repeat(80));
  console.error('ERROR');
  console.error('='.repeat(80));
  console.error('Message:', err.message);
  console.error('');
  console.error('Stack trace:');
  console.error(err.stack || '(no stack trace available)');
  console.error('='.repeat(80));
  process.exit(1);
});
