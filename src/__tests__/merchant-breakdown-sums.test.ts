/**
 * Tests that merchant rows sum to the category total.
 * 
 * Ensures the bug where dining shows $1,299 avg/mo but top merchants
 * only sum to $1,014 is fixed.
 */

import { describe, it, expect } from 'vitest';
import { computeBucketBreakdown } from '@/lib/bucketBreakdown';
import type { ExpenseTxnRecord, AccountSnapshot } from '@/lib/extractTransactions';

describe('Merchant breakdown sums', () => {
  it('merchant rows plus Other equal category total', () => {
    // Create test data with 15 merchants to ensure we get "Other" row
    const merchants = [
      'Restaurant A', 'Restaurant B', 'Restaurant C', 'Restaurant D', 'Restaurant E',
      'Restaurant F', 'Restaurant G', 'Restaurant H', 'Restaurant I', 'Restaurant J',
      'Restaurant K', 'Restaurant L', 'Restaurant M', 'Restaurant N', 'Restaurant O',
    ];
    
    const expenseTxns: ExpenseTxnRecord[] = [];
    const months = ['2026-08', '2026-09', '2026-10'];
    
    // Create transactions for each merchant across 3 months
    merchants.forEach((merchant, idx) => {
      months.forEach(month => {
        expenseTxns.push({
          txMonth: month,
          date: `${month}-15`,
          merchant,
          category: 'Dining',
          amount: -(100 + idx * 10), // Varying amounts
          accountSlug: 'td-checking-1234',
          accountLabel: 'TD Checking',
          currency: 'CAD',
          txFingerprint: `${month}-${merchant}-${idx}`,
        });
      });
    });
    
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
    
    // Find the Dining category
    const diningCategory = breakdown.categories.find(c => c.category === 'Dining');
    expect(diningCategory).toBeDefined();
    
    if (!diningCategory) return;
    
    // Sum merchant amounts (including "Other" if present)
    const merchantSum = diningCategory.merchants.reduce((sum, m) => sum + m.amount, 0);
    
    // Merchant sum should equal category total (within rounding tolerance)
    expect(Math.abs(merchantSum - diningCategory.amount)).toBeLessThan(0.01);
    
    // Should have top 10 merchants + Other row
    expect(diningCategory.merchants.length).toBe(11); // 10 top + 1 Other
    
    // Last merchant should be "Other"
    const lastMerchant = diningCategory.merchants[diningCategory.merchants.length - 1];
    expect(lastMerchant.merchant).toContain('Other');
    expect(lastMerchant.merchant).toContain('5 merchants'); // 15 total - 10 top = 5 other
  });

  it('merchant amounts use monthly average basis', () => {
    const expenseTxns: ExpenseTxnRecord[] = [
      {
        txMonth: '2026-08',
        date: '2026-08-15',
        merchant: 'Restaurant A',
        category: 'Dining',
        amount: -300, // $300 in month 1
        accountSlug: 'td-checking-1234',
        accountLabel: 'TD Checking',
        currency: 'CAD',
        txFingerprint: '2026-08-restaurant-a',
      },
      {
        txMonth: '2026-09',
        date: '2026-09-15',
        merchant: 'Restaurant A',
        category: 'Dining',
        amount: -600, // $600 in month 2
        accountSlug: 'td-checking-1234',
        accountLabel: 'TD Checking',
        currency: 'CAD',
        txFingerprint: '2026-09-restaurant-a',
      },
      {
        txMonth: '2026-10',
        date: '2026-10-15',
        merchant: 'Restaurant A',
        category: 'Dining',
        amount: -900, // $900 in month 3
        accountSlug: 'td-checking-1234',
        accountLabel: 'TD Checking',
        currency: 'CAD',
        txFingerprint: '2026-10-restaurant-a',
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
    
    const months = ['2026-08', '2026-09', '2026-10'];
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
    
    // Category amount should be monthly average
    const totalSpent = 300 + 600 + 900; // $1,800 total
    const expectedAvg = totalSpent / 3; // $600/month
    expect(Math.abs(diningCategory.amount - expectedAvg)).toBeLessThan(0.01);
    
    // Merchant amount should also be monthly average
    const restaurantA = diningCategory.merchants.find(m => m.merchant.includes('Restaurant A'));
    expect(restaurantA).toBeDefined();
    expect(Math.abs(restaurantA!.amount - expectedAvg)).toBeLessThan(0.01);
  });

  it('no Other row when 10 or fewer merchants', () => {
    const expenseTxns: ExpenseTxnRecord[] = [];
    const months = ['2026-08', '2026-09', '2026-10'];
    
    // Only 5 merchants
    for (let i = 0; i < 5; i++) {
      months.forEach(month => {
        expenseTxns.push({
          txMonth: month,
          date: `${month}-15`,
          merchant: `Restaurant ${i}`,
          category: 'Dining',
          amount: -100,
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
    
    // Should have exactly 5 merchants, no Other row
    expect(diningCategory.merchants.length).toBe(5);
    
    // None should be "Other"
    diningCategory.merchants.forEach(m => {
      expect(m.merchant).not.toContain('Other');
    });
  });
});
