/**
 * Unit test: Spending summary matches dashboard bucket computation
 * 
 * Ensures buildSpendingSummary produces identical results to dashboard cards/drawers
 * by using the same shared computeMonthlyBuckets() function.
 */

import { describe, it, expect } from "vitest";
import { buildSpendingSummary } from "@/lib/spendingSummary";
import { computeMoneyCoachBreakdown } from "@/lib/moneyCoach";
import type { ExpenseTxnRecord, AccountSnapshot, DebtPaymentHistoryEntry } from "@/lib/extractTransactions";
import type { FinancialProfileCache } from "@/lib/financialProfile";

describe("Spending summary matches dashboard", () => {
  // Fixture with a Debt-category payment and a scheduled loan
  const accountSnapshots: AccountSnapshot[] = [
    {
      slug: "scotiabank-plan-1234",
      bankName: "Scotiabank",
      accountId: "1234",
      accountName: "Scotia Plan",
      accountType: "loan",
      balance: -10000,
      currency: "CAD",
      parsedAssets: null,
      parsedDebts: 10000,
      statementMonth: "2026-09",
      interestRate: 5.5,
    },
  ];

  const debtPaymentHistory: DebtPaymentHistoryEntry[] = [
    {
      accountSlug: "scotiabank-plan-1234",
      yearMonth: "2026-07",
      payment: 350,
      principalPaid: 300,
      balanceAfter: -10000,
    },
    {
      accountSlug: "scotiabank-plan-1234",
      yearMonth: "2026-08",
      payment: 350,
      principalPaid: 300,
      balanceAfter: -9700,
    },
    {
      accountSlug: "scotiabank-plan-1234",
      yearMonth: "2026-09",
      payment: 350,
      principalPaid: 300,
      balanceAfter: -9400,
    },
  ];

  const expenseTxns: ExpenseTxnRecord[] = [
    // Debt category payment (should be excluded, replaced by scheduled payment)
    {
      date: "2026-09-15",
      merchant: "LOAN PAYMENT",
      category: "Debt Payments",
      amount: -350,
      accountLabel: "TD Chequing",
      accountSlug: "td-chequing-5678",
      txMonth: "2026-09",
      txFingerprint: "debt-1",
      accountType: "checking",
    },
    // Regular spending
    {
      date: "2026-09-10",
      merchant: "Loblaws",
      category: "Groceries",
      amount: -150,
      accountLabel: "TD Chequing",
      accountSlug: "td-chequing-5678",
      txMonth: "2026-09",
      txFingerprint: "grocery-1",
      accountType: "checking",
    },
    {
      date: "2026-09-05",
      merchant: "Netflix",
      category: "Subscriptions",
      amount: -20,
      accountLabel: "TD Chequing",
      accountSlug: "td-chequing-5678",
      txMonth: "2026-09",
      txFingerprint: "sub-1",
      accountType: "checking",
    },
    // Non-spending categories (should be excluded from total)
    {
      date: "2026-09-20",
      merchant: "RRSP CONTRIBUTION",
      category: "Investments & Savings",
      amount: -100,
      accountLabel: "TD Chequing",
      accountSlug: "td-chequing-5678",
      txMonth: "2026-09",
      txFingerprint: "savings-1",
      accountType: "checking",
    },
    {
      date: "2026-09-22",
      merchant: "UNKNOWN MERCHANT",
      category: "Other",
      amount: -50,
      accountLabel: "TD Chequing",
      accountSlug: "td-chequing-5678",
      txMonth: "2026-09",
      txFingerprint: "other-1",
      accountType: "checking",
    },
    // Same for Aug
    {
      date: "2026-08-15",
      merchant: "LOAN PAYMENT",
      category: "Debt Payments",
      amount: -350,
      accountLabel: "TD Chequing",
      accountSlug: "td-chequing-5678",
      txMonth: "2026-08",
      txFingerprint: "debt-2",
      accountType: "checking",
    },
    {
      date: "2026-08-10",
      merchant: "Loblaws",
      category: "Groceries",
      amount: -150,
      accountLabel: "TD Chequing",
      accountSlug: "td-chequing-5678",
      txMonth: "2026-08",
      txFingerprint: "grocery-2",
      accountType: "checking",
    },
    {
      date: "2026-08-05",
      merchant: "Netflix",
      category: "Subscriptions",
      amount: -20,
      accountLabel: "TD Chequing",
      accountSlug: "td-chequing-5678",
      txMonth: "2026-08",
      txFingerprint: "sub-2",
      accountType: "checking",
    },
    {
      date: "2026-08-20",
      merchant: "TFSA CONTRIBUTION",
      category: "Investments & Savings",
      amount: -100,
      accountLabel: "TD Chequing",
      accountSlug: "td-chequing-5678",
      txMonth: "2026-08",
      txFingerprint: "savings-2",
      accountType: "checking",
    },
    {
      date: "2026-08-22",
      merchant: "UNKNOWN MERCHANT",
      category: "Other",
      amount: -50,
      accountLabel: "TD Chequing",
      accountSlug: "td-chequing-5678",
      txMonth: "2026-08",
      txFingerprint: "other-2",
      accountType: "checking",
    },
    // Same for Jul
    {
      date: "2026-07-15",
      merchant: "LOAN PAYMENT",
      category: "Debt Payments",
      amount: -350,
      accountLabel: "TD Chequing",
      accountSlug: "td-chequing-5678",
      txMonth: "2026-07",
      txFingerprint: "debt-3",
      accountType: "checking",
    },
    {
      date: "2026-07-10",
      merchant: "Loblaws",
      category: "Groceries",
      amount: -150,
      accountLabel: "TD Chequing",
      accountSlug: "td-chequing-5678",
      txMonth: "2026-07",
      txFingerprint: "grocery-3",
      accountType: "checking",
    },
    {
      date: "2026-07-05",
      merchant: "Netflix",
      category: "Subscriptions",
      amount: -20,
      accountLabel: "TD Chequing",
      accountSlug: "td-chequing-5678",
      txMonth: "2026-07",
      txFingerprint: "sub-3",
      accountType: "checking",
    },
    {
      date: "2026-07-20",
      merchant: "RRSP CONTRIBUTION",
      category: "Investments & Savings",
      amount: -100,
      accountLabel: "TD Chequing",
      accountSlug: "td-chequing-5678",
      txMonth: "2026-07",
      txFingerprint: "savings-3",
      accountType: "checking",
    },
    {
      date: "2026-07-22",
      merchant: "UNKNOWN MERCHANT",
      category: "Other",
      amount: -50,
      accountLabel: "TD Chequing",
      accountSlug: "td-chequing-5678",
      txMonth: "2026-07",
      txFingerprint: "other-3",
      accountType: "checking",
    },
  ];

  const monthlyHistory = [
    { yearMonth: "2026-07", incomeTotal: 5000, expensesTotal: 520, netWorth: 50000 },
    { yearMonth: "2026-08", incomeTotal: 5000, expensesTotal: 520, netWorth: 50000 },
    { yearMonth: "2026-09", incomeTotal: 5000, expensesTotal: 520, netWorth: 50000 },
  ];

  const profile: FinancialProfileCache = {
    uid: "test-user",
    expenseTxns,
    incomeTxns: [],
    accountSnapshots,
    debtPaymentHistory,
    accountBalanceHistory: [],
    monthlyHistory,
    userReviews: [],
    fxRates: {},
    homeCurrency: "CAD",
    coverage: { monthsCovered: 3, monthsSpan: 3, coveragePct: 100, missingMonths: [] },
  };

  it("bucket averages match dashboard cards", () => {
    // Dashboard computation
    const dashboardBreakdown = computeMoneyCoachBreakdown(profile, []);
    
    // Spending summary computation
    const spendingSummary = buildSpendingSummary(
      expenseTxns,
      accountSnapshots,
      debtPaymentHistory,
      [],
      {},
      "CAD"
    );

    // Compare 3-month averages
    const dashboardFixed = dashboardBreakdown.buckets.find(b => b.bucket === "fixed")?.monthlyAverage || 0;
    const dashboardEssentials = dashboardBreakdown.buckets.find(b => b.bucket === "essentials")?.monthlyAverage || 0;
    const dashboardFlexible = dashboardBreakdown.buckets.find(b => b.bucket === "flexible")?.monthlyAverage || 0;

    const spendingFixed = spendingSummary.buckets.find(b => b.bucket === "fixed")?.total || 0;
    const spendingEssentials = spendingSummary.buckets.find(b => b.bucket === "essentials")?.total || 0;
    const spendingFlexible = spendingSummary.buckets.find(b => b.bucket === "flexible")?.total || 0;

    console.log("\nDashboard vs Spending:");
    console.log(`  Fixed:      ${dashboardFixed.toFixed(2)} vs ${spendingFixed.toFixed(2)}`);
    console.log(`  Essentials: ${dashboardEssentials.toFixed(2)} vs ${spendingEssentials.toFixed(2)}`);
    console.log(`  Flexible:   ${dashboardFlexible.toFixed(2)} vs ${spendingFlexible.toFixed(2)}`);

    // Within $1 tolerance
    expect(Math.abs(spendingFixed - dashboardFixed)).toBeLessThan(1);
    expect(Math.abs(spendingEssentials - dashboardEssentials)).toBeLessThan(1);
    expect(Math.abs(spendingFlexible - dashboardFlexible)).toBeLessThan(1);
  });

  it("categories sum equals total for each month", () => {
    const spendingSummary = buildSpendingSummary(
      expenseTxns,
      accountSnapshots,
      debtPaymentHistory,
      [],
      {},
      "CAD"
    );

    for (const month of spendingSummary.monthlyHistory) {
      const categorySum = month.categories.reduce((s, c) => s + c.amount, 0);
      const bucketSum = month.fixed + month.essentials + month.flexible;
      
      console.log(`\n${month.yearMonth}:`);
      console.log(`  Total:      ${month.total.toFixed(2)}`);
      console.log(`  Buckets:    ${bucketSum.toFixed(2)}`);
      console.log(`  Categories: ${categorySum.toFixed(2)}`);
      console.log(`  Categories: ${month.categories.map(c => `${c.category}=${c.amount.toFixed(2)}`).join(", ")}`);

      // Within 1¢ tolerance
      expect(Math.abs(month.total - bucketSum)).toBeLessThan(0.01);
      expect(Math.abs(month.total - categorySum)).toBeLessThan(0.01);
    }
  });

  it("excludes Debt category transactions (handled by scheduled payments)", () => {
    const spendingSummary = buildSpendingSummary(
      expenseTxns,
      accountSnapshots,
      debtPaymentHistory,
      [],
      {},
      "CAD"
    );

    // "Debt Payments" category should NOT appear (it's excluded)
    const debtPaymentsCategory = spendingSummary.categories.find(c => c.category === "Debt Payments");
    expect(debtPaymentsCategory).toBeUndefined();
    
    // Only Groceries and Subscriptions should appear (spending buckets)
    expect(spendingSummary.categories.length).toBe(2);
    expect(spendingSummary.categories.some(c => c.category === "Groceries")).toBe(true);
    expect(spendingSummary.categories.some(c => c.category === "Subscriptions")).toBe(true);
    
    // Non-spending categories (savings, uncategorized) should NOT appear
    expect(spendingSummary.categories.some(c => c.category === "Investments & Savings")).toBe(false);
    expect(spendingSummary.categories.some(c => c.category === "Other")).toBe(false);
  });
});
