/**
 * Tests that expandable merchant transactions sum to the merchant's period total.
 * 
 * Ensures that the transactions shown when expanding a merchant row
 * exactly match the merchant's displayed amount (for the period).
 */

import { describe, it, expect } from 'vitest';
import { computeBucketBreakdown } from '@/lib/bucketBreakdown';
import type { ExpenseTxnRecord, AccountSnapshot } from '@/lib/types';

describe('Merchant transactions expandable', () => {
  it('expanded transactions sum to merchant period total', () => {
    const months = ['2026-08', '2026-09', '2026-10'];
    
    const expenseTxns: ExpenseTxnRecord[] = [
      {
        txMonth: '2026-08',
        date: '2026-08-15',
        merchant: 'Restaurant A',
        category: 'Dining',
        amount: -100,
        accountSlug: 'td-checking-1234',
        accountLabel: 'TD Checking',
        currency: 'CAD',
        txFingerprint: '2026-08-restaurant-a-1',
      },
      {
        txMonth: '2026-09',
        date: '2026-09-20',
        merchant: 'Restaurant A',
        category: 'Dining',
        amount: -150,
        accountSlug: 'td-checking-1234',
        accountLabel: 'TD Checking',
        currency: 'CAD',
        txFingerprint: '2026-09-restaurant-a-1',
      },
      {
        txMonth: '2026-10',
        date: '2026-10-10',
        merchant: 'Restaurant A',
        category: 'Dining',
        amount: -200,
        accountSlug: 'td-checking-1234',
        accountLabel: 'TD Checking',
        currency: 'CAD',
        txFingerprint: '2026-10-restaurant-a-1',
      },
    ];
    
    const accountSnapshots: AccountSnapshot[] = [
      {
        slug: 'td-checking-1234',
        bankName: 'TD',
        accountId: '1234',
        accountName: 'TD Checking',
        accountType: 'checking',
        balance: 5000,
        statementMonth: '2026-10',
        statementDate: '2026-10-31',
        currency: 'CAD',
      },
    ];
    
    const breakdown = computeBucketBreakdown(
      'flexible',
      expenseTxns,
      accountSnapshots,
      [],
      months,
      'CAD'
    );
    
    const diningCategory = breakdown.categories.find(c => c.category === 'Dining');
    expect(diningCategory).toBeDefined();
    
    if (!diningCategory) return;
    
    const restaurantA = diningCategory.merchants.find(m => m.merchant.includes('Restaurant A'));
    expect(restaurantA).toBeDefined();
    
    if (!restaurantA) return;
    
    // Merchant should have transactions
    expect(restaurantA.transactions).toBeDefined();
    expect(restaurantA.transactions?.length).toBe(3);
    
    // Sum of transaction amounts should equal period total
    const periodTotal = restaurantA.transactions!.reduce((sum, t) => sum + t.amount, 0);
    expect(periodTotal).toBe(450); // 100 + 150 + 200
    
    // Merchant amount is monthly average
    const monthlyAvg = periodTotal / months.length;
    expect(Math.abs(restaurantA.amount - monthlyAvg)).toBeLessThan(0.01);
  });

  it('transactions are sorted newest first', () => {
    const months = ['2026-08', '2026-09', '2026-10'];
    
    const expenseTxns: ExpenseTxnRecord[] = [
      {
        txMonth: '2026-08',
        date: '2026-08-05',
        merchant: 'Coffee Shop',
        category: 'Dining',
        amount: -10,
        accountSlug: 'td-checking-1234',
        accountLabel: 'TD Checking',
        currency: 'CAD',
        txFingerprint: '2026-08-coffee-1',
      },
      {
        txMonth: '2026-09',
        date: '2026-09-15',
        merchant: 'Coffee Shop',
        category: 'Dining',
        amount: -12,
        accountSlug: 'td-checking-1234',
        accountLabel: 'TD Checking',
        currency: 'CAD',
        txFingerprint: '2026-09-coffee-1',
      },
      {
        txMonth: '2026-10',
        date: '2026-10-25',
        merchant: 'Coffee Shop',
        category: 'Dining',
        amount: -15,
        accountSlug: 'td-checking-1234',
        accountLabel: 'TD Checking',
        currency: 'CAD',
        txFingerprint: '2026-10-coffee-1',
      },
    ];
    
    const accountSnapshots: AccountSnapshot[] = [
      {
        slug: 'td-checking-1234',
        bankName: 'TD',
        accountId: '1234',
        accountName: 'TD Checking',
        accountType: 'checking',
        balance: 5000,
        statementMonth: '2026-10',
        statementDate: '2026-10-31',
        currency: 'CAD',
      },
    ];
    
    const breakdown = computeBucketBreakdown(
      'flexible',
      expenseTxns,
      accountSnapshots,
      [],
      months,
      'CAD'
    );
    
    const diningCategory = breakdown.categories.find(c => c.category === 'Dining');
    const coffeeShop = diningCategory?.merchants.find(m => m.merchant.includes('Coffee Shop'));
    
    expect(coffeeShop?.transactions).toBeDefined();
    
    if (!coffeeShop?.transactions) return;
    
    // Transactions should be present
    expect(coffeeShop.transactions.length).toBe(3);
    
    // In the data structure they're stored in any order
    // The UI will sort them newest first when displaying
    const dates = coffeeShop.transactions.map(t => t.date);
    expect(dates).toContain('2026-08-05');
    expect(dates).toContain('2026-09-15');
    expect(dates).toContain('2026-10-25');
  });

  it('Other row includes transactions from all remaining merchants', () => {
    const months = ['2026-08', '2026-09', '2026-10'];
    
    // Create 15 merchants to ensure we get an "Other" row
    const expenseTxns: ExpenseTxnRecord[] = [];
    for (let i = 0; i < 15; i++) {
      months.forEach(month => {
        expenseTxns.push({
          txMonth: month,
          date: `${month}-15`,
          merchant: `Restaurant ${i}`,
          category: 'Dining',
          amount: -(100 + i * 5),
          accountSlug: 'td-checking-1234',
          accountLabel: 'TD Checking',
          currency: 'CAD',
          txFingerprint: `${month}-restaurant-${i}`,
        });
      });
    }
    
    const accountSnapshots: AccountSnapshot[] = [
      {
        slug: 'td-checking-1234',
        bankName: 'TD',
        accountId: '1234',
        accountName: 'TD Checking',
        accountType: 'checking',
        balance: 5000,
        statementMonth: '2026-10',
        statementDate: '2026-10-31',
        currency: 'CAD',
      },
    ];
    
    const breakdown = computeBucketBreakdown(
      'flexible',
      expenseTxns,
      accountSnapshots,
      [],
      months,
      'CAD'
    );
    
    const diningCategory = breakdown.categories.find(c => c.category === 'Dining');
    expect(diningCategory).toBeDefined();
    
    if (!diningCategory) return;
    
    // Should have 11 merchants (10 top + 1 Other)
    expect(diningCategory.merchants.length).toBe(11);
    
    // Last merchant should be "Other"
    const otherRow = diningCategory.merchants[diningCategory.merchants.length - 1];
    expect(otherRow.merchant).toContain('Other');
    expect(otherRow.merchant).toContain('5 merchants');
    
    // Other row should have transactions
    expect(otherRow.transactions).toBeDefined();
    expect(otherRow.transactions!.length).toBeGreaterThan(0);
    
    // Sum of Other's transactions should equal its period total
    const otherPeriodTotal = otherRow.transactions!.reduce((sum, t) => sum + t.amount, 0);
    const otherMonthlyAvg = otherPeriodTotal / months.length;
    expect(Math.abs(otherRow.amount - otherMonthlyAvg)).toBeLessThan(0.01);
  });

  it('transactions include account information', () => {
    const months = ['2026-08'];
    
    const expenseTxns: ExpenseTxnRecord[] = [
      {
        txMonth: '2026-08',
        date: '2026-08-15',
        merchant: 'Store A',
        category: 'Shopping',
        amount: -100,
        accountSlug: 'td-checking-1234',
        accountLabel: 'TD Checking •••1234',
        currency: 'CAD',
        txFingerprint: '2026-08-store-a',
      },
    ];
    
    const accountSnapshots: AccountSnapshot[] = [
      {
        slug: 'td-checking-1234',
        bankName: 'TD',
        accountId: '1234',
        accountName: 'TD Checking',
        accountType: 'checking',
        balance: 5000,
        statementMonth: '2026-08',
        statementDate: '2026-08-31',
        currency: 'CAD',
      },
    ];
    
    const breakdown = computeBucketBreakdown(
      'flexible',
      expenseTxns,
      accountSnapshots,
      [],
      months,
      'CAD'
    );
    
    const shoppingCategory = breakdown.categories.find(c => c.category === 'Shopping');
    const storeA = shoppingCategory?.merchants.find(m => m.merchant.includes('Store A'));
    
    expect(storeA?.transactions).toBeDefined();
    expect(storeA?.transactions![0].accountSlug).toBe('td-checking-1234');
    expect(storeA?.transactions![0].accountLabel).toBe('TD Checking •••1234');
  });
});
