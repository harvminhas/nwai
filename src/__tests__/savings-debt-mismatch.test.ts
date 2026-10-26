/**
 * Test to reproduce and fix the Savings & Debt card vs drawer mismatch.
 * 
 * User reports:
 * - Dashboard card ("Savings & debt"): CA$5,219/mo (23% of take-home)
 * - Drawer (when clicked): CA$332/mo
 * - Expected: Both should show the same value from one data source
 * 
 * Root cause investigation:
 * - Card value comes from computeMoneyCoachBreakdown -> buckets.savings
 * - Drawer value comes from computeBucketBreakdown("savings", ...)
 * - Need to verify they use the same data and produce the same result
 */

import { describe, test, expect } from "vitest";
import { computeMoneyCoachBreakdown } from "../lib/moneyCoach";
import { computeBucketBreakdown } from "../lib/bucketBreakdown";
import type { FinancialProfileCache } from "../lib/financialProfile";
import type { ExpenseTxnRecord, AccountSnapshot, DebtPaymentHistoryEntry } from "../lib/extractTransactions";
import type { MonthlyHistoryEntry } from "../lib/financialProfile";

describe("Savings & Debt card vs drawer consistency", () => {
  // Real user data scenario:
  // - Scheduled debt payments: CA$4,480/mo (Scotia CA$1,142 + FlexLine CA$3,292)
  // - Savings category transactions: CA$332/mo
  // - Take-home income: ~CA$22,700/mo (so 5,219 is 23%)
  
  const accountSnapshots: AccountSnapshot[] = [
    {
      slug: "scotiabank-7780",
      bankName: "Scotiabank",
      accountId: "7780",
      accountName: "Scotia Plan Loan",
      accountType: "loan",
      balance: -46957,
      statementMonth: "2026-08",
      interestRate: null,
      currency: "CAD",
    },
    {
      slug: "td-flexline-0085",
      bankName: "TD Bank",
      accountId: "0085",
      accountName: "TD FlexLine",
      accountType: "line_of_credit",
      balance: -508000,
      statementMonth: "2026-09",
      interestRate: 4.65,
      currency: "CAD",
    },
  ];

  const debtPaymentHistory: DebtPaymentHistoryEntry[] = [
    { accountSlug: "scotiabank-7780", statementMonth: "2026-07", paymentsMade: 1142, currency: "CAD" },
    { accountSlug: "scotiabank-7780", statementMonth: "2026-08", paymentsMade: 1142, currency: "CAD" },
    { accountSlug: "scotiabank-7780", statementMonth: "2026-09", paymentsMade: 1142, currency: "CAD" },
    { accountSlug: "td-flexline-0085", statementMonth: "2026-07", paymentsMade: 3292, currency: "CAD" },
    { accountSlug: "td-flexline-0085", statementMonth: "2026-08", paymentsMade: 3292, currency: "CAD" },
    { accountSlug: "td-flexline-0085", statementMonth: "2026-09", paymentsMade: 3292, currency: "CAD" },
  ];

  // Savings category transactions: CA$332/mo average
  const expenseTxns: ExpenseTxnRecord[] = [
    // RRSP contributions (Investments & Savings category)
    { date: "2026-07-15", txMonth: "2026-07", amount: -300, merchant: "Wealthsimple RRSP", category: "Investments & Savings", accountSlug: "td-checking", accountLabel: "TD ••••1234", currency: "CAD" },
    { date: "2026-08-15", txMonth: "2026-08", amount: -350, merchant: "Wealthsimple RRSP", category: "Investments & Savings", accountSlug: "td-checking", accountLabel: "TD ••••1234", currency: "CAD" },
    { date: "2026-09-15", txMonth: "2026-09", amount: -350, merchant: "Wealthsimple RRSP", category: "Investments & Savings", accountSlug: "td-checking", accountLabel: "TD ••••1234", currency: "CAD" },
    
    // Debt payments FROM checking account (should NOT be in savings bucket)
    { date: "2026-07-01", txMonth: "2026-07", amount: -1142, merchant: "SCOTIA LOAN PAYMENT", category: "Debt Payments", accountSlug: "td-checking", accountLabel: "TD ••••1234", currency: "CAD" },
    { date: "2026-08-01", txMonth: "2026-08", amount: -1142, merchant: "SCOTIA LOAN PAYMENT", category: "Debt Payments", accountSlug: "td-checking", accountLabel: "TD ••••1234", currency: "CAD" },
    { date: "2026-09-01", txMonth: "2026-09", amount: -1142, merchant: "SCOTIA LOAN PAYMENT", category: "Debt Payments", accountSlug: "td-checking", accountLabel: "TD ••••1234", currency: "CAD" },
    { date: "2026-07-01", txMonth: "2026-07", amount: -3292, merchant: "TD FLEXLINE PAYMENT", category: "Debt Payments", accountSlug: "td-checking", accountLabel: "TD ••••1234", currency: "CAD" },
    { date: "2026-08-01", txMonth: "2026-08", amount: -3292, merchant: "TD FLEXLINE PAYMENT", category: "Debt Payments", accountSlug: "td-checking", accountLabel: "TD ••••1234", currency: "CAD" },
    { date: "2026-09-01", txMonth: "2026-09", amount: -3292, merchant: "TD FLEXLINE PAYMENT", category: "Debt Payments", accountSlug: "td-checking", accountLabel: "TD ••••1234", currency: "CAD" },
  ];

  const monthlyHistory: MonthlyHistoryEntry[] = [
    { 
      yearMonth: "2026-07", 
      incomeTotal: 22700, 
      expensesTotal: 8000,
      coreExpensesTotal: 8000,
      incomeTotalAllCredits: 22700,
      debtPaymentsTotal: 4434,
      cardServicingPaymentsTotal: 0,
      investmentAndSavingsTotal: 300,
      transfersTotal: 0,
      feesTotal: 0,
    },
    { 
      yearMonth: "2026-08", 
      incomeTotal: 22700, 
      expensesTotal: 8000,
      coreExpensesTotal: 8000,
      incomeTotalAllCredits: 22700,
      debtPaymentsTotal: 4434,
      cardServicingPaymentsTotal: 0,
      investmentAndSavingsTotal: 350,
      transfersTotal: 0,
      feesTotal: 0,
    },
    { 
      yearMonth: "2026-09", 
      incomeTotal: 22700, 
      expensesTotal: 8000,
      coreExpensesTotal: 8000,
      incomeTotalAllCredits: 22700,
      debtPaymentsTotal: 4434,
      cardServicingPaymentsTotal: 0,
      investmentAndSavingsTotal: 350,
      transfersTotal: 0,
      feesTotal: 0,
    },
  ];

  const profile: FinancialProfileCache = {
    uid: "test-user",
    updatedAt: new Date().toISOString(),
    sourceVersion: "test",
    schemaVersion: "56",
    expenseTxns,
    incomeTxns: [],
    accountSnapshots,
    debtPaymentHistory,
    subscriptions: [],
    monthlyHistory,
    accountBalanceHistory: [], // Empty for this test (no NET savings calculation needed)
    typicalMonthly: {
      income: 22700,
      coreExpenses: 8000,
      savingsRate: 0.1,
      coreExpensesExclTransfers: 8000,
      investmentAndSavings: 333,
      debtPayments: 4434,
      cardServicingPayments: 0,
      allExpenses: 8000,
    },
    coverage: {
      monthsCovered: 3,
      monthsSpan: 3,
      coveragePct: 100,
      missingMonths: [],
    },
    homeCurrency: "CAD",
    fxRates: {},
    manualAssets: [],
    balanceSnapshots: [],
    cashCommitmentEntries: [],
  };

  test("money coach breakdown should only include savings category + extra paydown in savings bucket", () => {
    const breakdown = computeMoneyCoachBreakdown(profile, []);
    
    const savingsBucket = breakdown.buckets.find(b => b.bucket === "savings");
    expect(savingsBucket).toBeDefined();
    
    // Expected: average of (300 + 350 + 350) / 3 = 333.33
    // Should NOT include scheduled debt payments (4434)
    expect(savingsBucket!.monthlyAverage).toBeCloseTo(333, 0);
    expect(savingsBucket!.monthlyAverage).toBeLessThan(1000);  // Definitely not 5,219
  });

  test("bucket breakdown should return same value as money coach for savings", () => {
    const months = ["2026-07", "2026-08", "2026-09"];
    
    const bucketDetail = computeBucketBreakdown(
      "savings",
      expenseTxns,
      accountSnapshots,
      debtPaymentHistory,
      months,
      "CAD",
      [],
      {},
      undefined,
      undefined
    );

    const moneyCoach = computeMoneyCoachBreakdown(profile, []);
    const savingsBucket = moneyCoach.buckets.find(b => b.bucket === "savings");

    // Both should show ~CA$333 (savings category only)
    expect(bucketDetail.monthlyAverage).toBeCloseTo(savingsBucket!.monthlyAverage, 0);
    expect(bucketDetail.monthlyAverage).toBeCloseTo(333, 0);
  });

  test("scheduled debt payments should be in fixed bucket, not savings", () => {
    const breakdown = computeMoneyCoachBreakdown(profile, []);
    
    const fixedBucket = breakdown.buckets.find(b => b.bucket === "fixed");
    const savingsBucket = breakdown.buckets.find(b => b.bucket === "savings");
    
    expect(fixedBucket).toBeDefined();
    expect(savingsBucket).toBeDefined();
    
    // Fixed should include scheduled debt payments (~4434)
    expect(fixedBucket!.monthlyAverage).toBeGreaterThan(4000);
    
    // Savings should NOT include scheduled debt payments
    expect(savingsBucket!.monthlyAverage).toBeLessThan(1000);
  });
});
