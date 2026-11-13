/**
 * Net Savings Card vs Drawer Consistency Test
 * 
 * Verifies that the Net Savings card value on the dashboard
 * matches the total shown in the drill-down drawer.
 */

import { describe, test, expect } from 'vitest';
import { computeMoneyCoachBreakdown } from '../lib/moneyCoach';
import { averageMonthlyCashFlow, getMonthlyCashFlowForMonths } from '../lib/monthlyCashFlow';
import type { FinancialProfileCache } from '../lib/financialProfile';
import type { ExpenseTxnRecord } from '../lib/extractTransactions';

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
      { merchant: 'Wealthsimple', description: 'TFSA contribution', amount: 500.00, category: 'Investments & Savings', date: '2026-06-15', txMonth: '2026-06', accountSlug: 'td-1234', accountLabel: 'TD Chequing', currency: 'CAD' },
      { merchant: 'Wealthsimple', description: 'TFSA contribution', amount: 500.00, category: 'Investments & Savings', date: '2026-07-15', txMonth: '2026-07', accountSlug: 'td-1234', accountLabel: 'TD Chequing', currency: 'CAD' },
      { merchant: 'Wealthsimple', description: 'TFSA contribution', amount: 500.00, category: 'Investments & Savings', date: '2026-08-15', txMonth: '2026-08', accountSlug: 'td-1234', accountLabel: 'TD Chequing', currency: 'CAD' },
      { merchant: 'Wealthsimple', description: 'TFSA contribution', amount: 500.00, category: 'Investments & Savings', date: '2026-09-15', txMonth: '2026-09', accountSlug: 'td-1234', accountLabel: 'TD Chequing', currency: 'CAD' },
    ];

    const monthlyHistory = [
      { yearMonth: '2026-06', expensesTotal: 1000, coreExpensesTotal: 900, incomeTotal: 5000, incomeTotalAllCredits: 5000, debtPaymentsTotal: 100, cardServicingPaymentsTotal: 0, minDebtPaymentsTotal: 100 },
      { yearMonth: '2026-07', expensesTotal: 1000, coreExpensesTotal: 900, incomeTotal: 5000, incomeTotalAllCredits: 5000, debtPaymentsTotal: 100, cardServicingPaymentsTotal: 0, minDebtPaymentsTotal: 100 },
      { yearMonth: '2026-08', expensesTotal: 1000, coreExpensesTotal: 900, incomeTotal: 5000, incomeTotalAllCredits: 5000, debtPaymentsTotal: 100, cardServicingPaymentsTotal: 0, minDebtPaymentsTotal: 100 },
      { yearMonth: '2026-09', expensesTotal: 1000, coreExpensesTotal: 900, incomeTotal: 5000, incomeTotalAllCredits: 5000, debtPaymentsTotal: 100, cardServicingPaymentsTotal: 0, minDebtPaymentsTotal: 100 },
    ];

    const profile = {
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
      allTxMonths: ['2026-06', '2026-07', '2026-08', '2026-09'],
      latestTxMonth: '2026-09',
      monthlyHistory,
      netWorth: 5000,
      homeCurrency: 'CAD',
      accountBalanceHistory: [],
      debtPaymentHistory: [],
      cashIncomeEntries: [],
      cashCommitmentEntries: [],
    } as FinancialProfileCache;

    const months = ['2026-07', '2026-08', '2026-09'];
    const moneyCoachBreakdown = computeMoneyCoachBreakdown(
      profile,
      [],
      profile.incomeTxns,
      profile.accountSnapshots,
      'CAD',
      new Map(),
      months,
    );
    const savingsCard = moneyCoachBreakdown.buckets.find(b => b.bucket === 'savings');
    expect(savingsCard).toBeDefined();
    const cardValue = savingsCard!.monthlyAverage;

    const leftover = averageMonthlyCashFlow(
      getMonthlyCashFlowForMonths(
        {
          expenseTxns: profile.expenseTxns,
          incomeTxns: profile.incomeTxns,
          homeCurrency: 'CAD',
          accountSnapshots: profile.accountSnapshots,
          debtPaymentHistory: profile.debtPaymentHistory,
        },
        months,
      ),
    ).leftover;

    expect(cardValue).toBeCloseTo(leftover, 2);
    expect(cardValue).toBeCloseTo(
      moneyCoachBreakdown.incomeAmount - moneyCoachBreakdown.totalSpending,
      2,
    );
  });

  test('card value equals drawer total for empty savings bucket', () => {
    const expenseTxns: ExpenseTxnRecord[] = [
      // No savings transactions - only other categories
      { merchant: 'Walmart', description: 'Groceries', amount: 100.00, category: 'Groceries', date: '2026-07-15', txMonth: '2026-07', accountSlug: 'td-1234', accountLabel: 'TD Chequing', currency: 'CAD' },
    ];

    const profile = createTestProfile(expenseTxns);

    const months = ['2026-07', '2026-08', '2026-09'];
    const moneyCoachBreakdown = computeMoneyCoachBreakdown(
      profile,
      [],
      profile.incomeTxns,
      profile.accountSnapshots,
      'CAD',
      new Map(),
      months,
    );
    const savingsCard = moneyCoachBreakdown.buckets.find(b => b.bucket === 'savings');
    expect(savingsCard).toBeDefined();
    const cardValue = savingsCard!.monthlyAverage;
    expect(cardValue).toBeCloseTo(
      moneyCoachBreakdown.incomeAmount - moneyCoachBreakdown.totalSpending,
      2,
    );
  });
});
