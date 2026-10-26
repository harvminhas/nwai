/**
 * Merchant Alias Resolution and Transaction Detail Tests
 * 
 * Tests for:
 * 1. Merchant alias resolution (Amazon / Amazon.ca / Amzn Mktp CA → Amazon)
 * 2. Transaction details in merchant breakdown
 * 3. Period totals vs monthly averages for non-recurring items
 */

import { describe, test, expect } from 'vitest';
import { resolveMerchantAlias } from '../lib/merchantUtils';
import { merchantSlug } from '../lib/applyRules';
import { computeBucketBreakdown } from '../lib/bucketBreakdown';
import type { ExpenseTxnRecord, AccountSnapshot, DebtPaymentHistoryEntry } from '../lib/extractTransactions';

describe('Merchant Alias Resolution', () => {
  test('resolves Amazon variants to canonical name', () => {
    const variants = [
      'Amazon',
      'Amazon.ca',
      'AMAZON.COM',
      'Amzn Mktp CA',
      'AMZNMKTPLACE',
    ];

    for (const variant of variants) {
      const slug = merchantSlug(variant);
      const resolved = resolveMerchantAlias(slug, variant);
      expect(resolved).toBe('Amazon');
    }
  });

  test('resolves Home Depot variants to canonical name', () => {
    const variants = [
      'HOME DEPOT',
      'HomeDepot.com',
      'The Home Depot',
    ];

    for (const variant of variants) {
      const slug = merchantSlug(variant);
      const resolved = resolveMerchantAlias(slug, variant);
      expect(resolved).toBe('Home Depot');
    }
  });

  test('resolves Google Cloud variants to canonical name', () => {
    const variants = [
      'GOOGLE CLOUD',
      'Google Cloud CA',
      'google-cloud-us',
    ];

    for (const variant of variants) {
      const slug = merchantSlug(variant);
      const resolved = resolveMerchantAlias(slug, variant);
      expect(resolved).toBe('Google Cloud');
    }
  });

  test('returns normalized name for non-aliased merchants', () => {
    const slug = merchantSlug('STARBUCKS');
    const resolved = resolveMerchantAlias(slug, 'STARBUCKS');
    expect(resolved).toBe('Starbucks');
  });
});

describe('Merchant Transaction Details', () => {
  const accountSnapshots: AccountSnapshot[] = [
    {
      slug: 'td-1234',
      bankName: 'TD',
      accountName: 'TD Chequing',
      accountType: 'checking',
      balance: 5000,
      currency: 'CAD',
      accountId: '1234',
      statementMonth: '2026-09',
    },
  ];

  const debtPaymentHistory: DebtPaymentHistoryEntry[] = [];
  const months = ['2026-07', '2026-08', '2026-09'];
  const homeCurrency = 'CAD';

  test('includes transaction count and details', () => {
    const expenseTxns: ExpenseTxnRecord[] = [
      { merchant: 'Amazon', description: 'Books', amount: 50.00, category: 'Shopping', date: '2026-07-05', txMonth: '2026-07', accountSlug: 'td-1234', accountLabel: 'TD Chequing', currency: 'CAD' },
      { merchant: 'Amazon', description: 'Electronics', amount: 100.00, category: 'Shopping', date: '2026-08-10', txMonth: '2026-08', accountSlug: 'td-1234', accountLabel: 'TD Chequing', currency: 'CAD' },
      { merchant: 'Amazon', description: 'Clothing', amount: 75.00, category: 'Shopping', date: '2026-09-15', txMonth: '2026-09', accountSlug: 'td-1234', accountLabel: 'TD Chequing', currency: 'CAD' },
    ];

    const breakdown = computeBucketBreakdown(
      'flexible',
      expenseTxns,
      accountSnapshots,
      debtPaymentHistory,
      months,
      homeCurrency
    );

    const shoppingCategory = breakdown.categories.find(c => c.category === 'Shopping');
    expect(shoppingCategory).toBeDefined();
    
    const amazonMerchant = shoppingCategory!.merchants.find(m => m.merchant === 'Amazon');
    expect(amazonMerchant).toBeDefined();
    
    // Should have transaction count
    expect(amazonMerchant!.txCount).toBe(3);
    
    // Should have transaction details
    expect(amazonMerchant!.transactions).toBeDefined();
    expect(amazonMerchant!.transactions!.length).toBe(3);
    
    // Check transaction structure
    const firstTxn = amazonMerchant!.transactions![0];
    expect(firstTxn).toHaveProperty('date');
    expect(firstTxn).toHaveProperty('amount');
    expect(firstTxn).toHaveProperty('description');
    expect(firstTxn).toHaveProperty('accountSlug');
  });

  test('shows period total for non-recurring merchants', () => {
    const expenseTxns: ExpenseTxnRecord[] = [
      // Amazon - varying amounts (not recurring)
      { merchant: 'Amazon', description: 'Purchase', amount: 50.00, category: 'Shopping', date: '2026-07-05', txMonth: '2026-07', accountSlug: 'td-1234', accountLabel: 'TD Chequing', currency: 'CAD' },
      { merchant: 'Amazon', description: 'Purchase', amount: 100.00, category: 'Shopping', date: '2026-08-10', txMonth: '2026-08', accountSlug: 'td-1234', accountLabel: 'TD Chequing', currency: 'CAD' },
      { merchant: 'Amazon', description: 'Purchase', amount: 75.00, category: 'Shopping', date: '2026-09-15', txMonth: '2026-09', accountSlug: 'td-1234', accountLabel: 'TD Chequing', currency: 'CAD' },
    ];

    const breakdown = computeBucketBreakdown(
      'flexible',
      expenseTxns,
      accountSnapshots,
      debtPaymentHistory,
      months,
      homeCurrency
    );

    const shoppingCategory = breakdown.categories.find(c => c.category === 'Shopping');
    const amazonMerchant = shoppingCategory!.merchants.find(m => m.merchant === 'Amazon');
    
    // Should show actual period total: 50 + 100 + 75 = 225
    // NOT monthly average: 225 / 3 = 75
    expect(amazonMerchant!.amount).toBeCloseTo(225.00, 2);
  });

  test('merges Amazon variants into one merchant', () => {
    const expenseTxns: ExpenseTxnRecord[] = [
      { merchant: 'Amazon', description: 'Purchase', amount: 50.00, category: 'Shopping', date: '2026-07-05', txMonth: '2026-07', accountSlug: 'td-1234', accountLabel: 'TD Chequing', currency: 'CAD' },
      { merchant: 'Amazon.ca', description: 'Purchase', amount: 100.00, category: 'Shopping', date: '2026-08-10', txMonth: '2026-08', accountSlug: 'td-1234', accountLabel: 'TD Chequing', currency: 'CAD' },
      { merchant: 'Amzn Mktp CA', description: 'Purchase', amount: 75.00, category: 'Shopping', date: '2026-09-15', txMonth: '2026-09', accountSlug: 'td-1234', accountLabel: 'TD Chequing', currency: 'CAD' },
    ];

    const breakdown = computeBucketBreakdown(
      'flexible',
      expenseTxns,
      accountSnapshots,
      debtPaymentHistory,
      months,
      homeCurrency
    );

    const shoppingCategory = breakdown.categories.find(c => c.category === 'Shopping');
    expect(shoppingCategory).toBeDefined();
    
    // Should have only ONE merchant (all Amazon variants merged)
    expect(shoppingCategory!.merchants.length).toBe(1);
    
    // Merchant name should be canonical "Amazon"
    expect(shoppingCategory!.merchants[0].merchant).toBe('Amazon');
    
    // Total should be sum of all variants
    expect(shoppingCategory!.merchants[0].amount).toBeCloseTo(225.00, 2);
    
    // Should have 3 transactions
    expect(shoppingCategory!.merchants[0].txCount).toBe(3);
  });

  test('recurring items still show monthly charge', () => {
    const expenseTxns: ExpenseTxnRecord[] = [
      // Aviva insurance - consistent monthly (recurring)
      { merchant: 'AVIVA GENERAL INSURANCE', description: 'Insurance', amount: 763.00, category: 'Insurance', date: '2026-07-15', txMonth: '2026-07', accountSlug: 'td-1234', accountLabel: 'TD Chequing', currency: 'CAD' },
      { merchant: 'AVIVA GENERAL INSURANCE', description: 'Insurance', amount: 763.00, category: 'Insurance', date: '2026-08-15', txMonth: '2026-08', accountSlug: 'td-1234', accountLabel: 'TD Chequing', currency: 'CAD' },
      { merchant: 'AVIVA GENERAL INSURANCE', description: 'Insurance', amount: 763.00, category: 'Insurance', date: '2026-09-15', txMonth: '2026-09', accountSlug: 'td-1234', accountLabel: 'TD Chequing', currency: 'CAD' },
    ];

    const breakdown = computeBucketBreakdown(
      'fixed',
      expenseTxns,
      accountSnapshots,
      debtPaymentHistory,
      months,
      homeCurrency
    );

    const insuranceCategory = breakdown.categories.find(c => c.category === 'Insurance');
    const avivaMerchant = insuranceCategory!.merchants.find(m => m.merchant.includes('Aviva'));
    
    // Should show monthly recurring charge (detected), not period total
    expect(avivaMerchant!.amount).toBeCloseTo(763.00, 2);
  });
});
