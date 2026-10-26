#!/usr/bin/env node
/**
 * Financial Profile Inspector CLI
 * 
 * Read-only tool to inspect a user's financial profile using the same
 * data access layer functions that the pages use.
 * 
 * Usage:
 *   npm run inspect:profile -- --uid <uid> [--months 2026-07,2026-09]
 * 
 * Requires: .env.local with Firestore credentials
 * Makes NO writes, prints NO secrets
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import { getFirebaseAdmin } from '../lib/firebase-admin';
import { getFinancialProfile } from '../lib/financialProfile';
import { computeScheduledDebtPayments, getAllUnreviewedAnomalies } from '../lib/debtPayments';
import { computeBucketBreakdown, getMonthsForWindow } from '../lib/bucketBreakdown';
import type { DebtPaymentReview } from '../lib/types';

// Load environment variables
config({ path: resolve(process.cwd(), '.env.local') });

interface Args {
  uid: string;
  months?: string[];
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  let uid = '';
  let months: string[] | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--uid' && args[i + 1]) {
      uid = args[i + 1];
      i++;
    } else if (args[i] === '--months' && args[i + 1]) {
      months = args[i + 1].split(',').map(m => m.trim());
      i++;
    }
  }

  if (!uid) {
    console.error('Usage: npm run inspect:profile -- --uid <uid> [--months 2026-07,2026-09]');
    process.exit(1);
  }

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
  console.log(`  Home currency: ${profile.homeCurrency}`);
  console.log(`  Accounts: ${profile.accountSnapshots.length}`);
  console.log(`  Expense transactions: ${profile.expenseTxns.length}`);
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

  const monthsToAnalyze = requestedMonths || 
    (profile.monthlyHistory.length > 0 
      ? profile.monthlyHistory.slice(-3).map(h => h.yearMonth)
      : []);

  if (monthsToAnalyze.length > 0) {
    console.log('');
    console.log('─'.repeat(80));
    console.log(`BUCKET BREAKDOWN (${monthsToAnalyze.join(', ')})`);
    console.log('─'.repeat(80));

    for (const bucket of ['fixed', 'variable', 'savings'] as const) {
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
        for (const cat of breakdown.categories.slice(0, 5)) { // Top 5
          const badge = cat.isScheduled ? ' [scheduled]' : cat.isEstimated ? ' [est.]' : '';
          console.log(`  ${cat.category}: ${fmt(cat.amount, profile.homeCurrency)}${badge}`);
          if (cat.merchants && cat.merchants.length > 0) {
            for (const merch of cat.merchants.slice(0, 3)) {
              const method = merch.method ? ` [${merch.method}]` : '';
              console.log(`    - ${merch.merchant}: ${fmt(merch.amount, profile.homeCurrency)}${method}`);
            }
          }
        }
      }
    }
  }

  // ── Subscriptions ──────────────────────────────────────────────────────────

  console.log('');
  console.log('─'.repeat(80));
  console.log('SUBSCRIPTIONS & MERCHANT CADENCE');
  console.log('─'.repeat(80));

  if (profile.confirmedSubscriptions && profile.confirmedSubscriptions.length > 0) {
    console.log('');
    console.log('Confirmed Subscriptions:');
    for (const sub of profile.confirmedSubscriptions.slice(0, 10)) {
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
  console.error('Error:', err.message);
  process.exit(1);
});
