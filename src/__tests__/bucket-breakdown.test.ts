/**
 * Bucket Breakdown Integration Test
 * 
 * Verifies that computeBucketBreakdown correctly categorizes expense transactions
 * into Fixed, Essentials, Flexible, and Savings buckets.
 */

import { describe, test, expect } from 'vitest';
import { computeBucketBreakdown } from '../lib/bucketBreakdown';
import type { ExpenseTxnRecord, AccountSnapshot, DebtPaymentHistoryEntry } from '../lib/extractTransactions';

describe('Bucket Breakdown', () => {
  // Realistic expense transactions for Jul-Sep 2026
  const expenseTxns: ExpenseTxnRecord[] = [
    // July 2026 - Dining
    { txKey: 'tx1', merchant: 'Starbucks', description: 'Coffee', amount: 5.50, category: 'Dining', date: '2026-07-03', txMonth: '2026-07', accountSlug: 'td-1234', accountLabel: 'TD Chequing', currency: 'CAD' },
    { txKey: 'tx2', merchant: 'McDonalds', description: 'Lunch', amount: 12.00, category: 'Dining', date: '2026-07-05', txMonth: '2026-07', accountSlug: 'td-1234', accountLabel: 'TD Chequing', currency: 'CAD' },
    
    // July 2026 - Groceries
    { txKey: 'tx3', merchant: 'Loblaws', description: 'Groceries', amount: 150.00, category: 'Groceries', date: '2026-07-10', txMonth: '2026-07', accountSlug: 'td-1234', accountLabel: 'TD Chequing', currency: 'CAD' },
    { txKey: 'tx4', merchant: 'Walmart', description: 'Groceries', amount: 85.00, category: 'Groceries', date: '2026-07-20', txMonth: '2026-07', accountSlug: 'td-1234', accountLabel: 'TD Chequing', currency: 'CAD' },
    
    // July 2026 - Shopping
    { txKey: 'tx5', merchant: 'Amazon', description: 'Electronics', amount: 200.00, category: 'Shopping', date: '2026-07-15', txMonth: '2026-07', accountSlug: 'td-1234', accountLabel: 'TD Chequing', currency: 'CAD' },
    
    // July 2026 - Transportation
    { txKey: 'tx6', merchant: 'Esso', description: 'Gas', amount: 60.00, category: 'Transportation', date: '2026-07-08', txMonth: '2026-07', accountSlug: 'td-1234', accountLabel: 'TD Chequing', currency: 'CAD' },
    
    // July 2026 - Subscriptions
    { txKey: 'tx7', merchant: 'Netflix', description: 'Subscription', amount: 16.99, category: 'Subscriptions', date: '2026-07-01', txMonth: '2026-07', accountSlug: 'td-1234', accountLabel: 'TD Chequing', currency: 'CAD' },
    
    // August 2026 - Similar mix
    { txKey: 'tx8', merchant: 'Starbucks', description: 'Coffee', amount: 6.00, category: 'Dining', date: '2026-08-02', txMonth: '2026-08', accountSlug: 'td-1234', accountLabel: 'TD Chequing', currency: 'CAD' },
    { txKey: 'tx9', merchant: 'Loblaws', description: 'Groceries', amount: 145.00, category: 'Groceries', date: '2026-08-12', txMonth: '2026-08', accountSlug: 'td-1234', accountLabel: 'TD Chequing', currency: 'CAD' },
    { txKey: 'tx10', merchant: 'Amazon', description: 'Books', amount: 50.00, category: 'Shopping', date: '2026-08-18', txMonth: '2026-08', accountSlug: 'td-1234', accountLabel: 'TD Chequing', currency: 'CAD' },
    { txKey: 'tx11', merchant: 'Esso', description: 'Gas', amount: 65.00, category: 'Transportation', date: '2026-08-10', txMonth: '2026-08', accountSlug: 'td-1234', accountLabel: 'TD Chequing', currency: 'CAD' },
    { txKey: 'tx12', merchant: 'Netflix', description: 'Subscription', amount: 16.99, category: 'Subscriptions', date: '2026-08-01', txMonth: '2026-08', accountSlug: 'td-1234', accountLabel: 'TD Chequing', currency: 'CAD' },
    
    // September 2026 - Similar mix
    { txKey: 'tx13', merchant: 'Starbucks', description: 'Coffee', amount: 5.75, category: 'Dining', date: '2026-09-04', txMonth: '2026-09', accountSlug: 'td-1234', accountLabel: 'TD Chequing', currency: 'CAD' },
    { txKey: 'tx14', merchant: 'Loblaws', description: 'Groceries', amount: 160.00, category: 'Groceries', date: '2026-09-15', txMonth: '2026-09', accountSlug: 'td-1234', accountLabel: 'TD Chequing', currency: 'CAD' },
    { txKey: 'tx15', merchant: 'Amazon', description: 'Clothing', amount: 75.00, category: 'Shopping', date: '2026-09-20', txMonth: '2026-09', accountSlug: 'td-1234', accountLabel: 'TD Chequing', currency: 'CAD' },
    { txKey: 'tx16', merchant: 'Esso', description: 'Gas', amount: 70.00, category: 'Transportation', date: '2026-09-12', txMonth: '2026-09', accountSlug: 'td-1234', accountLabel: 'TD Chequing', currency: 'CAD' },
    { txKey: 'tx17', merchant: 'Netflix', description: 'Subscription', amount: 16.99, category: 'Subscriptions', date: '2026-09-01', txMonth: '2026-09', accountSlug: 'td-1234', accountLabel: 'TD Chequing', currency: 'CAD' },
  ];

  const accountSnapshots: AccountSnapshot[] = [
    {
      slug: 'td-1234',
      bankName: 'TD',
      accountName: 'TD Chequing',
      accountType: 'checking',
      balance: 5000,
      currency: 'CAD',
    },
  ];

  const debtPaymentHistory: DebtPaymentHistoryEntry[] = [];
  const months = ['2026-07', '2026-08', '2026-09'];
  const homeCurrency = 'CAD';

  test('Fixed bucket contains Subscriptions', () => {
    const breakdown = computeBucketBreakdown(
      'fixed',
      expenseTxns,
      accountSnapshots,
      debtPaymentHistory,
      months,
      homeCurrency
    );

    expect(breakdown.categories.length).toBeGreaterThan(0);
    const subsCategory = breakdown.categories.find(c => c.category === 'Subscriptions');
    expect(subsCategory).toBeDefined();
    expect(subsCategory!.amount).toBeCloseTo(16.99, 2); // Monthly average: 3 * 16.99 / 3 = 16.99
  });

  test('Essentials bucket contains Groceries and Transportation', () => {
    const breakdown = computeBucketBreakdown(
      'essentials',
      expenseTxns,
      accountSnapshots,
      debtPaymentHistory,
      months,
      homeCurrency
    );

    expect(breakdown.categories.length).toBeGreaterThan(0);
    
    const groceries = breakdown.categories.find(c => c.category === 'Groceries');
    expect(groceries).toBeDefined();
    // Jul: 150 + 85 = 235, Aug: 145, Sep: 160
    // Total: 540 / 3 months = 180/month
    expect(groceries!.amount).toBeCloseTo(180, 2);

    const transport = breakdown.categories.find(c => c.category === 'Transportation');
    expect(transport).toBeDefined();
    // Jul: 60, Aug: 65, Sep: 70
    // Total: 195 / 3 months = 65/month
    expect(transport!.amount).toBeCloseTo(65, 2);
  });

  test('Flexible bucket contains Dining and Shopping', () => {
    const breakdown = computeBucketBreakdown(
      'flexible',
      expenseTxns,
      accountSnapshots,
      debtPaymentHistory,
      months,
      homeCurrency
    );

    expect(breakdown.categories.length).toBeGreaterThan(0);
    
    const dining = breakdown.categories.find(c => c.category === 'Dining');
    expect(dining).toBeDefined();
    // Jul: 5.50 + 12.00 = 17.50, Aug: 6.00, Sep: 5.75
    // Total: 29.25 / 3 months = 9.75/month
    expect(dining!.amount).toBeCloseTo(9.75, 2);

    const shopping = breakdown.categories.find(c => c.category === 'Shopping');
    expect(shopping).toBeDefined();
    // Jul: 200, Aug: 50, Sep: 75
    // Total: 325 / 3 months = 108.33/month
    expect(shopping!.amount).toBeCloseTo(108.33, 2);
  });

  test('Monthly averages are correct', () => {
    const fixed = computeBucketBreakdown('fixed', expenseTxns, accountSnapshots, debtPaymentHistory, months, homeCurrency);
    const essentials = computeBucketBreakdown('essentials', expenseTxns, accountSnapshots, debtPaymentHistory, months, homeCurrency);
    const flexible = computeBucketBreakdown('flexible', expenseTxns, accountSnapshots, debtPaymentHistory, months, homeCurrency);

    // Fixed: 3 * 16.99 / 3 = 16.99
    expect(fixed.monthlyAverage).toBeCloseTo(16.99, 2);

    // Essentials: (235 + 60) + (145 + 65) + (160 + 70) = 735 / 3 = 245
    expect(essentials.monthlyAverage).toBeCloseTo(245, 2);

    // Flexible: (17.50 + 200) + (6 + 50) + (5.75 + 75) = 354.25 / 3 = 118.08
    expect(flexible.monthlyAverage).toBeCloseTo(118.08, 2);
  });

  test('Categories are not empty when transactions exist', () => {
    const buckets = ['fixed', 'essentials', 'flexible', 'savings'] as const;
    
    for (const bucket of buckets) {
      const breakdown = computeBucketBreakdown(
        bucket,
        expenseTxns,
        accountSnapshots,
        debtPaymentHistory,
        months,
        homeCurrency
      );

      if (bucket === 'savings') {
        // Savings bucket should be empty (no investment transactions in fixture)
        expect(breakdown.categories.length).toBe(0);
      } else {
        // Other buckets should have categories
        expect(breakdown.categories.length).toBeGreaterThan(0);
      }
    }
  });
});
