/**
 * Test that dashboard cards and drawers show identical numbers.
 * 
 * Bug: Fixed costs card showed $X but drawer showed $Y for same range.
 * Root cause: Card uses computeMonthlyBuckets() but drawer uses computeBucketBreakdown()
 * with different logic.
 */

import { describe, it, expect } from 'vitest';
import { computeMoneyCoachBreakdown } from '../lib/moneyCoach';
import { computeBucketBreakdown } from '../lib/bucketBreakdown';
import type { FinancialProfileCache } from '../lib/financialProfile';
import type { ExpenseTxnRecord, AccountSnapshot, DebtPaymentHistoryEntry } from '../lib/extractTransactions';

describe('Card vs Drawer consistency', () => {
  // Shared test data
  const months = ['2026-06', '2026-07', '2026-08'];
  
  const expenseTxns: ExpenseTxnRecord[] = [
    // Subscriptions (Fixed)
    { txMonth: '2026-06', date: '2026-06-15', merchant: 'Netflix', category: 'Subscriptions', amount: -15, accountSlug: 'td-checking-1234', accountLabel: 'TD Checking', currency: 'CAD' },
    { txMonth: '2026-07', date: '2026-07-15', merchant: 'Netflix', category: 'Subscriptions', amount: -15, accountSlug: 'td-checking-1234', accountLabel: 'TD Checking', currency: 'CAD' },
    { txMonth: '2026-08', date: '2026-08-15', merchant: 'Netflix', category: 'Subscriptions', amount: -15, accountSlug: 'td-checking-1234', accountLabel: 'TD Checking', currency: 'CAD' },
    
    // Groceries (Essentials)
    { txMonth: '2026-06', date: '2026-06-10', merchant: 'Loblaws', category: 'Groceries', amount: -200, accountSlug: 'td-checking-1234', accountLabel: 'TD Checking', currency: 'CAD' },
    { txMonth: '2026-07', date: '2026-07-10', merchant: 'Loblaws', category: 'Groceries', amount: -220, accountSlug: 'td-checking-1234', accountLabel: 'TD Checking', currency: 'CAD' },
    { txMonth: '2026-08', date: '2026-08-10', merchant: 'Loblaws', category: 'Groceries', amount: -210, accountSlug: 'td-checking-1234', accountLabel: 'TD Checking', currency: 'CAD' },
    
    // Dining (Flexible)
    { txMonth: '2026-06', date: '2026-06-20', merchant: 'Tim Hortons', category: 'Dining', amount: -50, accountSlug: 'td-checking-1234', accountLabel: 'TD Checking', currency: 'CAD' },
    { txMonth: '2026-07', date: '2026-07-20', merchant: 'Tim Hortons', category: 'Dining', amount: -45, accountSlug: 'td-checking-1234', accountLabel: 'TD Checking', currency: 'CAD' },
    { txMonth: '2026-08', date: '2026-08-20', merchant: 'Tim Hortons', category: 'Dining', amount: -55, accountSlug: 'td-checking-1234', accountLabel: 'TD Checking', currency: 'CAD' },
  ];
  
  const accountSnapshots: AccountSnapshot[] = [
    {
      slug: 'td-checking-1234',
      bankName: 'TD',
      accountId: '1234',
      accountName: 'TD Everyday Chequing',
      accountType: 'checking',
      balance: 5000,
      statementMonth: '2026-08',
      statementDate: '2026-08-31',
      interestRate: null,
      currency: 'CAD',
    },
    {
      slug: 'cibc-mortgage-5678',
      bankName: 'CIBC',
      accountId: '5678',
      accountName: 'CIBC Mortgage',
      accountType: 'mortgage',
      balance: -350000,
      parsedDebts: 350000,
      statementMonth: '2026-08',
      statementDate: '2026-08-31',
      interestRate: 0.0525,
      currency: 'CAD',
    },
  ];
  
  const debtPaymentHistory: DebtPaymentHistoryEntry[] = [
    { statementMonth: '2026-06', accountSlug: 'cibc-mortgage-5678', paymentsMade: 2000, currency: 'CAD' },
    { statementMonth: '2026-07', accountSlug: 'cibc-mortgage-5678', paymentsMade: 2000, currency: 'CAD' },
    { statementMonth: '2026-08', accountSlug: 'cibc-mortgage-5678', paymentsMade: 2000, currency: 'CAD' },
  ];
  
  // Note: Build monthlyHistory dynamically in buildSpendingSummary, don't pre-compute
  // This ensures both paths compute from raw transactions
  const profile: FinancialProfileCache = {
    uid: 'test-user',
    lastUpdated: new Date().toISOString(),
    schemaVersion: '1',
    homeCurrency: 'CAD',
    monthlyHistory: [], // Empty - will be computed by buildSpendingSummary
    expenseTxns,
    incomeTxns: [],
    accountSnapshots,
    accountBalanceHistory: [],
    debtPaymentHistory,
    coverage: { monthsCovered: 3, monthsSpan: 3, coveragePct: 100, missingMonths: [] },
  };
  
  it('Fixed bucket: card total should equal drawer total', () => {
    // Card path
    const cardBreakdown = computeMoneyCoachBreakdown(
      profile,
      [],
      [],
      accountSnapshots,
      'CAD',
      new Map(),
      months,
    );
    const cardFixed = cardBreakdown.buckets.find(b => b.bucket === 'fixed')?.monthlyAverage || 0;
    
    // Drawer path
    const drawerBreakdown = computeBucketBreakdown(
      'fixed',
      expenseTxns,
      accountSnapshots,
      debtPaymentHistory,
      months,
      'CAD',
      [],
      {},
      undefined,
      undefined
    );
    const drawerFixed = drawerBreakdown.monthlyAverage;
    
    console.log('Fixed bucket comparison:');
    console.log('  Card:', cardFixed);
    console.log('  Drawer:', drawerFixed);
    console.log('  Categories:', drawerBreakdown.categories.map(c => ({ cat: c.category, amt: c.amount })));
    
    // Should be equal!
    expect(drawerFixed).toBe(cardFixed);
  });
  
  it('Essentials bucket: card total should equal drawer total', () => {
    const cardBreakdown = computeMoneyCoachBreakdown(
      profile,
      [],
      [],
      accountSnapshots,
      'CAD',
      new Map(),
      months,
    );
    const cardEssentials = cardBreakdown.buckets.find(b => b.bucket === 'essentials')?.monthlyAverage || 0;
    
    const drawerBreakdown = computeBucketBreakdown(
      'essentials',
      expenseTxns,
      accountSnapshots,
      debtPaymentHistory,
      months,
      'CAD',
      [],
      {},
      undefined,
      undefined
    );
    const drawerEssentials = drawerBreakdown.monthlyAverage;
    
    expect(drawerEssentials).toBe(cardEssentials);
  });
  
  it('Flexible bucket: card total should equal drawer total', () => {
    const cardBreakdown = computeMoneyCoachBreakdown(
      profile,
      [],
      [],
      accountSnapshots,
      'CAD',
      new Map(),
      months,
    );
    const cardFlexible = cardBreakdown.buckets.find(b => b.bucket === 'flexible')?.monthlyAverage || 0;
    
    const drawerBreakdown = computeBucketBreakdown(
      'flexible',
      expenseTxns,
      accountSnapshots,
      debtPaymentHistory,
      months,
      'CAD',
      [],
      {},
      undefined,
      undefined
    );
    const drawerFlexible = drawerBreakdown.monthlyAverage;
    
    expect(drawerFlexible).toBe(cardFlexible);
  });
});
