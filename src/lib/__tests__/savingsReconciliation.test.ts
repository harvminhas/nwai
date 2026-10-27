/**
 * Tests for Net Savings drawer reconciliation.
 * 
 * Requirements:
 * 1. Per-month: three components sum exactly to bar
 * 2. Account changes sum to components
 * 3. Header equals mean of bars
 * 4. Dashboard card equals header
 */

import { computeWindowSavings } from '../savingsCalculations';
import type { MonthlyHistoryEntry, AccountBalanceHistory } from '../financialProfile';
import type { ExpenseTxnRecord } from '../extractTransactions';

describe('Savings Reconciliation', () => {
  // Test fixture: 3 months with various balance changes
  const monthlyHistory: MonthlyHistoryEntry[] = [
    { yearMonth: '2026-06', totalIncome: 10000, totalExpenses: 8000, totalAssets: 50000 },
    { yearMonth: '2026-07', totalIncome: 10000, totalExpenses: 8000, totalAssets: 52000 },
    { yearMonth: '2026-08', totalIncome: 10000, totalExpenses: 8000, totalAssets: 54000 },
    { yearMonth: '2026-09', totalIncome: 10000, totalExpenses: 8000, totalAssets: 56000 },
  ];

  const accountBalanceHistory: AccountBalanceHistory[] = [
    {
      slug: 'td-checking',
      label: 'TD Checking',
      accountType: 'checking',
      entries: [
        { yearMonth: '2026-06', balance: 5000 },
        { yearMonth: '2026-07', balance: 4000 }, // -1000 cash spent
        { yearMonth: '2026-08', balance: 6000 }, // +2000 cash saved
        { yearMonth: '2026-09', balance: 7000 }, // +1000 cash saved
      ],
    },
    {
      slug: 'td-visa',
      label: 'TD Visa',
      accountType: 'credit',
      entries: [
        { yearMonth: '2026-06', balance: -2000 },
        { yearMonth: '2026-07', balance: -3000 }, // -1000 debt (new borrowing)
        { yearMonth: '2026-08', balance: -2500 }, // +500 debt (paid down)
        { yearMonth: '2026-09', balance: -2000 }, // +500 debt (paid down)
      ],
    },
  ];

  const expenseTxns: ExpenseTxnRecord[] = [
    // July: $200 RRSP contribution
    {
      txMonth: '2026-07',
      date: '2026-07-15',
      merchant: 'RRSP CONTRIBUTION',
      category: 'Investments & Savings',
      amount: 200,
      accountSlug: 'td-checking',
      currency: 'CAD',
    },
    // August: $300 TFSA contribution
    {
      txMonth: '2026-08',
      date: '2026-08-15',
      merchant: 'TFSA CONTRIBUTION',
      category: 'Investments & Savings',
      amount: 300,
      accountSlug: 'td-checking',
      currency: 'CAD',
    },
    // September: $400 RRSP contribution
    {
      txMonth: '2026-09',
      date: '2026-09-15',
      merchant: 'RRSP CONTRIBUTION',
      category: 'Investments & Savings',
      amount: 400,
      accountSlug: 'td-checking',
      currency: 'CAD',
    },
  ];

  const months = ['2026-07', '2026-08', '2026-09'];

  it('per-month: three components sum exactly to total', () => {
    const result = computeWindowSavings(
      monthlyHistory,
      accountBalanceHistory,
      expenseTxns,
      months
    );

    for (const month of result.monthlyBreakdown) {
      const sum = month.netCashChange + month.netDebtChange + month.contributionsToOutside;
      expect(sum).toBeCloseTo(month.total, 2);
    }
  });

  it('monthly average equals mean of per-month totals', () => {
    const result = computeWindowSavings(
      monthlyHistory,
      accountBalanceHistory,
      expenseTxns,
      months
    );

    const meanTotal = result.monthlyBreakdown.reduce((sum, m) => sum + m.total, 0) / months.length;
    const meanCash = result.monthlyBreakdown.reduce((sum, m) => sum + m.netCashChange, 0) / months.length;
    const meanDebt = result.monthlyBreakdown.reduce((sum, m) => sum + m.netDebtChange, 0) / months.length;
    const meanContrib = result.monthlyBreakdown.reduce((sum, m) => sum + m.contributionsToOutside, 0) / months.length;

    expect(result.monthlyAverage.total).toBeCloseTo(meanTotal, 2);
    expect(result.monthlyAverage.netCashChange).toBeCloseTo(meanCash, 2);
    expect(result.monthlyAverage.netDebtChange).toBeCloseTo(meanDebt, 2);
    expect(result.monthlyAverage.contributionsToOutside).toBeCloseTo(meanContrib, 2);
  });

  it('cash account changes sum to total cash column', () => {
    const result = computeWindowSavings(
      monthlyHistory,
      accountBalanceHistory,
      expenseTxns,
      months
    );

    // Sum of per-month cash changes
    const totalCashChangeFromMonths = result.monthlyBreakdown.reduce(
      (sum, m) => sum + m.netCashChange,
      0
    );

    // Sum of window-period account changes
    const totalCashChangeFromAccounts = result.windowPeriodAccounts.cashAccounts.reduce(
      (sum, acc) => sum + acc.change,
      0
    );

    expect(totalCashChangeFromAccounts).toBeCloseTo(totalCashChangeFromMonths, 2);
  });

  it('debt account changes sum to total debt column', () => {
    const result = computeWindowSavings(
      monthlyHistory,
      accountBalanceHistory,
      expenseTxns,
      months
    );

    // Sum of per-month debt changes
    const totalDebtChangeFromMonths = result.monthlyBreakdown.reduce(
      (sum, m) => sum + m.netDebtChange,
      0
    );

    // Sum of window-period account changes
    const totalDebtChangeFromAccounts = result.windowPeriodAccounts.debtAccounts.reduce(
      (sum, acc) => sum + acc.change,
      0
    );

    expect(totalDebtChangeFromAccounts).toBeCloseTo(totalDebtChangeFromMonths, 2);
  });

  it('correctly identifies driver for negative months', () => {
    const result = computeWindowSavings(
      monthlyHistory,
      accountBalanceHistory,
      expenseTxns,
      months
    );

    // July should be negative due to cash spent (-1000) + new borrowing (-1000) + contrib (200) = -1800
    const julyMonth = result.monthlyBreakdown.find(m => m.month === '2026-07');
    expect(julyMonth?.total).toBeLessThan(0);
    expect(julyMonth?.driver).toBeDefined();
    // Driver should identify either borrowing or cash spent (both contributed equally)
    expect(julyMonth?.driver).toMatch(/(borrowing|spent down)/);
  });

  it('expected calculation for fixture data', () => {
    const result = computeWindowSavings(
      monthlyHistory,
      accountBalanceHistory,
      expenseTxns,
      months
    );

    // July: cash -1000, debt -1000 (new borrowing), contrib +200 = -1800
    const july = result.monthlyBreakdown.find(m => m.month === '2026-07');
    expect(july?.netCashChange).toBeCloseTo(-1000, 2);
    expect(july?.netDebtChange).toBeCloseTo(-1000, 2); // New borrowing is negative
    expect(july?.contributionsToOutside).toBeCloseTo(200, 2);
    expect(july?.total).toBeCloseTo(-1800, 2);

    // August: cash +2000, debt +500 (paid down), contrib +300 = +2800
    const august = result.monthlyBreakdown.find(m => m.month === '2026-08');
    expect(august?.netCashChange).toBeCloseTo(2000, 2);
    expect(august?.netDebtChange).toBeCloseTo(500, 2); // Paydown is positive
    expect(august?.contributionsToOutside).toBeCloseTo(300, 2);
    expect(august?.total).toBeCloseTo(2800, 2);

    // September: cash +1000, debt +500 (paid down), contrib +400 = +1900
    const september = result.monthlyBreakdown.find(m => m.month === '2026-09');
    expect(september?.netCashChange).toBeCloseTo(1000, 2);
    expect(september?.netDebtChange).toBeCloseTo(500, 2);
    expect(september?.contributionsToOutside).toBeCloseTo(400, 2);
    expect(september?.total).toBeCloseTo(1900, 2);

    // Monthly average: (-1800 + 2800 + 1900) / 3 = 2900 / 3 ≈ 967
    expect(result.monthlyAverage.total).toBeCloseTo(967, 0);

    // Window-period account changes
    // Cash: 7000 (Sep end) - 5000 (Jun end) = +2000
    const cashAccount = result.windowPeriodAccounts.cashAccounts.find(a => a.slug === 'td-checking');
    expect(cashAccount?.change).toBeCloseTo(2000, 2);

    // Debt: abs(-2000) - abs(-2000) = 0 (started at -2000, ended at -2000, so no change)
    // Wait, let me recalculate: Jun -2000, Sep -2000, so debt stayed the same
    // But in between it went to -3000 (July) and -2500 (Aug)
    // Window calculation: start (Jun) = -2000, end (Sep) = -2000
    // Change = abs(-2000) - abs(-2000) = 0
    const debtAccount = result.windowPeriodAccounts.debtAccounts.find(a => a.slug === 'td-visa');
    expect(debtAccount?.change).toBeCloseTo(0, 2);
  });
});
