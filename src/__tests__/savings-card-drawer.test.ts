/**
 * Net Savings Card vs Drawer Consistency Test
 * 
 * Verifies that the Net Savings card value on the dashboard
 * matches the total shown in the drill-down drawer.
 */

import { describe, test, expect } from 'vitest';
import { computeMoneyCoachBreakdown } from '../lib/moneyCoach';
import { computeBucketBreakdown, getMonthsForWindow } from '../lib/bucketBreakdown';
import type { FinancialProfileCache } from '../lib/financialProfile';
import type { ExpenseTxnRecord, AccountSnapshot, DebtPaymentHistoryEntry } from '../lib/extractTransactions';

describe('Net Savings Card vs Drawer Consistency', () => {
  // Create a minimal financial profile for testing
  const createTestProfile = (expenseTxns: ExpenseTxnRecord[]): FinancialProfileCache => {
    const monthlyHistory = [
      { yearMonth: '2026-07', expensesTotal: 1000, coreExpensesTotal: 900, incomeTotal: 5000, incomeTotalAllCredits: 5000, debtPaymentsTotal: 100, cardServicingPaymentsTotal: 0, minDebtPaymentsTotal: 100 },
      { yearMonth: '2026-08', expensesTotal: 1000, coreExpensesTotal: 900, incomeTotal: 5000, incomeTotalAllCredits: 5000, debtPaymentsTotal: 100, cardServicingPaymentsTotal: 0, minDebtPaymentsTotal: 100 },
      { yearMonth: '2026-09', expensesTotal: 1000, coreExpensesTotal: 900, incomeTotal: 5000, incomeTotalAllCredits: 5000, debtPaymentsTotal: 100, cardServicingPaymentsTotal: 0, minDebtPaymentsTotal: 100 },
    ];

    return {
      updatedAt: new Date().toISOString(),
      sourceVersion: 'test',
      schemaVersion: '56',
      expenseTxns,
      incomeTxns: [],
      accountSnapshots: [{
        slug: 'td-1234',
        bankName: 'TD',
        accountName: 'TD Chequing',
        accountType: 'checking',
        balance: 5000,
        currency: 'CAD',
        accountId: '1234',
        statementMonth: '2026-09',
      }],
      allTxMonths: ['2026-07', '2026-08', '2026-09'],
      latestTxMonth: '2026-09',
      monthlyHistory,
      netWorth: 5000,
      homeCurrency: 'CAD',
      accountBalanceHistory: [],
      debtPaymentHistory: [],
      cashIncomeEntries: [],
      cashCommitmentEntries: [],
    } as FinancialProfileCache;
  };

  test('card value equals drawer total for savings bucket', () => {
    const expenseTxns: ExpenseTxnRecord[] = [
      // Investments & Savings category transactions
      { merchant: 'Wealthsimple', description: 'TFSA contribution', amount: 500.00, category: 'Investments & Savings', date: '2026-07-15', txMonth: '2026-07', accountSlug: 'td-1234', accountLabel: 'TD Chequing', currency: 'CAD' },
      { merchant: 'Wealthsimple', description: 'TFSA contribution', amount: 500.00, category: 'Investments & Savings', date: '2026-08-15', txMonth: '2026-08', accountSlug: 'td-1234', accountLabel: 'TD Chequing', currency: 'CAD' },
      { merchant: 'Wealthsimple', description: 'TFSA contribution', amount: 500.00, category: 'Investments & Savings', date: '2026-09-15', txMonth: '2026-09', accountSlug: 'td-1234', accountLabel: 'TD Chequing', currency: 'CAD' },
    ];

    const profile = createTestProfile(expenseTxns);

    // Compute card value (from money coach)
    const moneyCoachBreakdown = computeMoneyCoachBreakdown(profile, []);
    const savingsCard = moneyCoachBreakdown.buckets.find(b => b.bucket === 'savings');
    expect(savingsCard).toBeDefined();
    const cardValue = savingsCard!.monthlyAverage;

    // Compute drawer value (from bucket breakdown)
    const currentYear = new Date().getFullYear();
    const months = getMonthsForWindow(profile.monthlyHistory, 'last3', currentYear);
    const drawerBreakdown = computeBucketBreakdown(
      'savings',
      profile.expenseTxns,
      profile.accountSnapshots,
      profile.debtPaymentHistory,
      months,
      profile.homeCurrency,
      [],
      {},
      {},
      []
    );
    const drawerValue = drawerBreakdown.monthlyAverage;

    // Card and drawer values MUST match
    expect(cardValue).toBeCloseTo(drawerValue, 2);
    
    // Both should be CA$500/month (consistent monthly contribution)
    expect(cardValue).toBeCloseTo(500.00, 2);
    expect(drawerValue).toBeCloseTo(500.00, 2);
  });

  test('card value equals drawer total for empty savings bucket', () => {
    const expenseTxns: ExpenseTxnRecord[] = [
      // No savings transactions - only other categories
      { merchant: 'Walmart', description: 'Groceries', amount: 100.00, category: 'Groceries', date: '2026-07-15', txMonth: '2026-07', accountSlug: 'td-1234', accountLabel: 'TD Chequing', currency: 'CAD' },
    ];

    const profile = createTestProfile(expenseTxns);

    // Compute card value
    const moneyCoachBreakdown = computeMoneyCoachBreakdown(profile, []);
    const savingsCard = moneyCoachBreakdown.buckets.find(b => b.bucket === 'savings');
    expect(savingsCard).toBeDefined();
    const cardValue = savingsCard!.monthlyAverage;

    // Compute drawer value
    const currentYear = new Date().getFullYear();
    const months = getMonthsForWindow(profile.monthlyHistory, 'last3', currentYear);
    const drawerBreakdown = computeBucketBreakdown(
      'savings',
      profile.expenseTxns,
      profile.accountSnapshots,
      profile.debtPaymentHistory,
      months,
      profile.homeCurrency,
      [],
      {},
      {},
      []
    );
    const drawerValue = drawerBreakdown.monthlyAverage;

    // Both should be CA$0 (no savings)
    expect(cardValue).toBeCloseTo(drawerValue, 2);
    expect(cardValue).toBe(0);
    expect(drawerValue).toBe(0);
  });
});
