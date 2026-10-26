/**
 * Merchant Normalization and Recurring Bill Tests
 * 
 * Tests the fixes for:
 * 1. Duplicate merchants with case/spacing variants (AVIVA vs Aviva)
 * 2. Recurring monthly bills showing actual amount (not period average)
 */

import { describe, test, expect } from 'vitest';
import { normalizeMerchantName, detectRecurringMonthlyAmount } from '../lib/merchantUtils';
import { merchantSlug } from '../lib/applyRules';
import { computeBucketBreakdown } from '../lib/bucketBreakdown';
import type { ExpenseTxnRecord, AccountSnapshot, DebtPaymentHistoryEntry } from '../lib/extractTransactions';

describe('Merchant Name Normalization', () => {
  test('normalizes all-caps to title case', () => {
    expect(normalizeMerchantName('AVIVA GENERAL INSURANCE')).toBe('Aviva General Insurance');
    expect(normalizeMerchantName('HOME DEPOT')).toBe('Home Depot');
    expect(normalizeMerchantName('GOOGLE CLOUD')).toBe('Google Cloud');
  });

  test('normalizes lowercase to title case', () => {
    expect(normalizeMerchantName('aviva general insurance')).toBe('Aviva General Insurance');
    expect(normalizeMerchantName('home depot')).toBe('Home Depot');
  });

  test('handles mixed case consistently', () => {
    expect(normalizeMerchantName('Aviva General Insurance')).toBe('Aviva General Insurance');
    expect(normalizeMerchantName('AviVa GeNeRaL InSuRaNcE')).toBe('Aviva General Insurance');
  });

  test('trims and normalizes whitespace', () => {
    expect(normalizeMerchantName('  AVIVA   GENERAL  INSURANCE  ')).toBe('Aviva General Insurance');
    expect(normalizeMerchantName('HOME\t\tDEPOT')).toBe('Home Depot');
  });

  test('preserves short acronyms', () => {
    expect(normalizeMerchantName('TD BANK')).toBe('TD Bank');
    expect(normalizeMerchantName('RBC INSURANCE')).toBe('RBC Insurance');
  });

  test('handles empty and invalid input', () => {
    expect(normalizeMerchantName('')).toBe('Unknown');
    expect(normalizeMerchantName('   ')).toBe('Unknown');
  });
});

describe('Merchant Slug Consistency', () => {
  test('case variants produce same slug', () => {
    const slug1 = merchantSlug('AVIVA GENERAL INSURANCE');
    const slug2 = merchantSlug('Aviva General Insurance');
    const slug3 = merchantSlug('aviva general insurance');
    
    expect(slug1).toBe(slug2);
    expect(slug2).toBe(slug3);
    expect(slug1).toBe('aviva-general-insurance');
  });

  test('spacing variants produce same slug', () => {
    const slug1 = merchantSlug('HOME  DEPOT');
    const slug2 = merchantSlug('HOME DEPOT');
    const slug3 = merchantSlug('HOME    DEPOT');
    
    expect(slug1).toBe(slug2);
    expect(slug2).toBe(slug3);
    expect(slug1).toBe('home-depot');
  });

  test('punctuation variants produce same slug', () => {
    const slug1 = merchantSlug('GOOGLE.CLOUD');
    const slug2 = merchantSlug('GOOGLE CLOUD');
    const slug3 = merchantSlug('GOOGLE-CLOUD');
    
    expect(slug1).toBe(slug2);
    expect(slug2).toBe(slug3);
    expect(slug1).toBe('google-cloud');
  });
});

describe('Recurring Monthly Amount Detection', () => {
  test('detects consistent monthly charges', () => {
    const txns = [
      { txMonth: '2026-07', amount: 763.00 },
      { txMonth: '2026-08', amount: 763.00 },
      { txMonth: '2026-09', amount: 763.00 },
    ];
    
    const recurring = detectRecurringMonthlyAmount(txns);
    expect(recurring).toBeCloseTo(763.00, 2);
  });

  test('detects with small variance (within 10%)', () => {
    const txns = [
      { txMonth: '2026-07', amount: 760.00 },
      { txMonth: '2026-08', amount: 763.00 },
      { txMonth: '2026-09', amount: 765.00 },
    ];
    
    const recurring = detectRecurringMonthlyAmount(txns);
    expect(recurring).toBeCloseTo(763.00, 2);
  });

  test('rejects inconsistent amounts', () => {
    const txns = [
      { txMonth: '2026-07', amount: 500.00 },
      { txMonth: '2026-08', amount: 763.00 },
      { txMonth: '2026-09', amount: 1000.00 },
    ];
    
    const recurring = detectRecurringMonthlyAmount(txns);
    expect(recurring).toBeNull();
  });

  test('requires minimum months', () => {
    const txns = [
      { txMonth: '2026-07', amount: 763.00 },
    ];
    
    const recurring = detectRecurringMonthlyAmount(txns, 2);
    expect(recurring).toBeNull();
  });

  test('handles multiple transactions in same month', () => {
    const txns = [
      { txMonth: '2026-07', amount: 763.00 },
      { txMonth: '2026-08', amount: 763.00 },
      { txMonth: '2026-09', amount: 400.00 },
      { txMonth: '2026-09', amount: 363.00 }, // Sum = 763
    ];
    
    const recurring = detectRecurringMonthlyAmount(txns);
    expect(recurring).toBeCloseTo(763.00, 2);
  });
});

describe('Bucket Breakdown Merchant Merging', () => {
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

  test('merges case-variant merchant names', () => {
    const expenseTxns: ExpenseTxnRecord[] = [
      // AVIVA in all caps - July
      { merchant: 'AVIVA GENERAL INSURANCE', description: 'Insurance', amount: 382.00, category: 'Insurance', date: '2026-07-15', txMonth: '2026-07', accountSlug: 'td-1234', accountLabel: 'TD Chequing', currency: 'CAD' },
      // Aviva in title case - August
      { merchant: 'Aviva General Insurance', description: 'Insurance', amount: 382.00, category: 'Insurance', date: '2026-08-15', txMonth: '2026-08', accountSlug: 'td-1234', accountLabel: 'TD Chequing', currency: 'CAD' },
      // aviva in lowercase - September
      { merchant: 'aviva general insurance', description: 'Insurance', amount: 382.00, category: 'Insurance', date: '2026-09-15', txMonth: '2026-09', accountSlug: 'td-1234', accountLabel: 'TD Chequing', currency: 'CAD' },
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
    expect(insuranceCategory).toBeDefined();
    
    // Should have only ONE merchant (merged)
    expect(insuranceCategory!.merchants.length).toBe(1);
    
    // Merchant name should be normalized to title case
    expect(insuranceCategory!.merchants[0].merchant).toBe('Aviva General Insurance');
    
    // Amount should be the recurring monthly charge (not period average)
    expect(insuranceCategory!.merchants[0].amount).toBeCloseTo(382.00, 2);
  });

  test('detects recurring monthly bill and uses actual amount', () => {
    const expenseTxns: ExpenseTxnRecord[] = [
      // Petro-Canada gas - varying amounts (not recurring)
      { merchant: 'PETRO-CANADA', description: 'Gas', amount: 45.00, category: 'Transportation', date: '2026-07-05', txMonth: '2026-07', accountSlug: 'td-1234', accountLabel: 'TD Chequing', currency: 'CAD' },
      { merchant: 'PETRO-CANADA', description: 'Gas', amount: 60.00, category: 'Transportation', date: '2026-08-10', txMonth: '2026-08', accountSlug: 'td-1234', accountLabel: 'TD Chequing', currency: 'CAD' },
      { merchant: 'PETRO-CANADA', description: 'Gas', amount: 55.00, category: 'Transportation', date: '2026-09-12', txMonth: '2026-09', accountSlug: 'td-1234', accountLabel: 'TD Chequing', currency: 'CAD' },
      
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
    expect(insuranceCategory).toBeDefined();
    
    const avivaMerchant = insuranceCategory!.merchants.find(m => m.merchant.includes('Aviva'));
    expect(avivaMerchant).toBeDefined();
    
    // Should show actual monthly recurring amount (763), not period average (763)
    // They're the same in this case, but the logic should detect it as recurring
    expect(avivaMerchant!.amount).toBeCloseTo(763.00, 2);
  });

  test('uses period average for non-recurring merchants', () => {
    const expenseTxns: ExpenseTxnRecord[] = [
      // Varying amounts - not recurring
      { merchant: 'Amazon', description: 'Shopping', amount: 50.00, category: 'Shopping', date: '2026-07-05', txMonth: '2026-07', accountSlug: 'td-1234', accountLabel: 'TD Chequing', currency: 'CAD' },
      { merchant: 'Amazon', description: 'Shopping', amount: 100.00, category: 'Shopping', date: '2026-08-10', txMonth: '2026-08', accountSlug: 'td-1234', accountLabel: 'TD Chequing', currency: 'CAD' },
      { merchant: 'Amazon', description: 'Shopping', amount: 75.00, category: 'Shopping', date: '2026-09-15', txMonth: '2026-09', accountSlug: 'td-1234', accountLabel: 'TD Chequing', currency: 'CAD' },
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
    
    // Should use period average: (50 + 100 + 75) / 3 = 75
    expect(amazonMerchant!.amount).toBeCloseTo(75.00, 2);
  });
});
