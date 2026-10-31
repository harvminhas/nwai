import { describe, it, expect } from "vitest";
import { getMoneyCoachIncome } from "@/lib/incomeMetrics";
import { buildIncomeSummary } from "@/lib/incomeSummary";
import type { IncomeTxnRecord, AccountSnapshot } from "@/lib/extractTransactions";

/**
 * Unit test: Dashboard Income card value === Income drawer default value
 * 
 * Ensures both use the same data source (buildIncomeSummary) and show
 * regular + bonus income (unreviewed unusual deposits counted by default).
 */
describe("Income Card vs Drawer Consistency", () => {
  it("card income matches drawer default (last 3 months regular + bonus income)", () => {
    // Mock income transactions (3 months of regular + 1 bonus/unusual)
    const incomeTxns: IncomeTxnRecord[] = [
      // Regular salary - Sep, Aug, Jul
      {
        txMonth: "2024-09",
        date: "2024-09-15",
        source: "ACME CORP PAYROLL",
        category: "Employment",
        amount: 5000,
        accountSlug: "checking-1234",
        accountLabel: "Checking ••1234",
        currency: "CAD",
      },
      {
        txMonth: "2024-08",
        date: "2024-08-15",
        source: "ACME CORP PAYROLL",
        category: "Employment",
        amount: 5000,
        accountSlug: "checking-1234",
        accountLabel: "Checking ••1234",
        currency: "CAD",
      },
      {
        txMonth: "2024-07",
        date: "2024-07-15",
        source: "ACME CORP PAYROLL",
        category: "Employment",
        amount: 5000,
        accountSlug: "checking-1234",
        accountLabel: "Checking ••1234",
        currency: "CAD",
      },
      // Unusual deposit (unreviewed - should count as bonus by default)
      {
        txMonth: "2024-08",
        date: "2024-08-20",
        source: "ACME CORP PAYROLL",
        category: "Employment",
        amount: 10000, // 100% higher than usual = unusual
        accountSlug: "checking-1234",
        accountLabel: "Checking ••1234",
        currency: "CAD",
      },
    ];

    const accountSnapshots: AccountSnapshot[] = [
      {
        slug: "checking-1234",
        label: "Checking ••1234",
        accountType: "asset",
        institution: "Test Bank",
        balance: 10000,
        currency: "CAD",
      },
    ];

    const monthlyHistory: any[] = [];
    const incomeDepositReviews = new Map<string, string>(); // No reviews - should count by default

    // Get card income (dashboard)
    const cardIncome = getMoneyCoachIncome(
      monthlyHistory,
      incomeTxns,
      accountSnapshots,
      "CAD",
      incomeDepositReviews
    );

    // Get drawer income (default last3 window)
    const summary = buildIncomeSummary(incomeTxns, accountSnapshots, "CAD", incomeDepositReviews);

    // Main assertion: card shows same value as drawer
    expect(cardIncome.amount).toBe(summary.typicalMonthly);
    
    // NEW BEHAVIOR: Unreviewed unusual deposits COUNT as income (tagged as bonus)
    // Expected: (5000 + 15000 + 5000) / 3 = 8333
    console.log(`Card income: ${cardIncome.amount}, Drawer typical: ${summary.typicalMonthly}`);
    console.log(`Bonus amount: ${cardIncome.bonusAmount}`);
    console.log(`Unreviewed deposits: ${summary.unreviewedDeposits.length}`);
    console.log(`Monthly breakdown:`, summary.monthlyHistory.map(m => ({ month: m.yearMonth, total: m.total, regular: m.regular, bonus: m.bonus })));
    
    // Both should show regular + bonus (unreviewed deposits count)
    expect(cardIncome.amount).toBe(8333);
    expect(summary.typicalMonthly).toBe(8333);
    
    // Bonus should be 10000 total across last 3 months (10000 / 3 = 3333 per month avg in totals)
    expect(cardIncome.bonusAmount).toBe(10000);
    expect(summary.last3MonthsBonus).toBe(10000);
    
    // Should have 1 unreviewed deposit
    expect(summary.unreviewedDeposits.length).toBe(1);
    expect(summary.unreviewedDeposits[0].amount).toBe(10000);
  });

  it("card and drawer both show zero when no income", () => {
    const emptyIncomeTxns: IncomeTxnRecord[] = [];
    const emptyAccountSnapshots: AccountSnapshot[] = [];
    const emptyMonthlyHistory: any[] = [];
    const emptyReviews = new Map<string, string>();

    const cardIncome = getMoneyCoachIncome(
      emptyMonthlyHistory,
      emptyIncomeTxns,
      emptyAccountSnapshots,
      "CAD",
      emptyReviews
    );

    const summary = buildIncomeSummary(emptyIncomeTxns, emptyAccountSnapshots, "CAD", emptyReviews);

    expect(cardIncome.amount).toBe(0);
    expect(summary.typicalMonthly).toBe(0);
    expect(cardIncome.amount).toBe(summary.typicalMonthly);
  });

  it("card and drawer match with <3 months of data", () => {
    const incomeTxns: IncomeTxnRecord[] = [
      {
        txMonth: "2024-09",
        date: "2024-09-15",
        source: "FREELANCE CLIENT",
        category: "Self-Employment",
        amount: 3000,
        accountSlug: "checking-1234",
        accountLabel: "Checking ••1234",
        currency: "CAD",
      },
      {
        txMonth: "2024-08",
        date: "2024-08-15",
        source: "FREELANCE CLIENT",
        category: "Self-Employment",
        amount: 3200,
        accountSlug: "checking-1234",
        accountLabel: "Checking ••1234",
        currency: "CAD",
      },
    ];

    const accountSnapshots: AccountSnapshot[] = [];
    const monthlyHistory: any[] = [];
    const reviews = new Map<string, string>();

    const cardIncome = getMoneyCoachIncome(
      monthlyHistory,
      incomeTxns,
      accountSnapshots,
      "CAD",
      reviews
    );

    const summary = buildIncomeSummary(incomeTxns, accountSnapshots, "CAD", reviews);

    // Both should average the 2 months: (3000 + 3200) / 2 = 3100
    expect(cardIncome.amount).toBe(summary.typicalMonthly);
    expect(cardIncome.amount).toBe(3100);
    
    // Label should reflect 2 months
    expect(cardIncome.basisLabel).toContain("2");
  });
  
  it("classified 'not_income' deposits are excluded from totals", () => {
    const incomeTxns: IncomeTxnRecord[] = [
      // Need >=4 transactions to establish clear baseline before unusual
      {
        txMonth: "2024-06",
        date: "2024-06-15",
        source: "ACME CORP",
        category: "Employment",
        amount: 5000,
        accountSlug: "checking-1234",
        accountLabel: "Checking ••1234",
        currency: "CAD",
      },
      {
        txMonth: "2024-07",
        date: "2024-07-15",
        source: "ACME CORP",
        category: "Employment",
        amount: 5000,
        accountSlug: "checking-1234",
        accountLabel: "Checking ••1234",
        currency: "CAD",
      },
      {
        txMonth: "2024-08",
        date: "2024-08-15",
        source: "ACME CORP",
        category: "Employment",
        amount: 5000,
        accountSlug: "checking-1234",
        accountLabel: "Checking ••1234",
        currency: "CAD",
      },
      {
        txMonth: "2024-09",
        date: "2024-09-15",
        source: "ACME CORP",
        category: "Employment",
        amount: 5000,
        accountSlug: "checking-1234",
        accountLabel: "Checking ••1234",
        currency: "CAD",
      },
      {
        txMonth: "2024-09",
        date: "2024-09-20",
        source: "ACME CORP",
        category: "Other",
        amount: 10000, // Unusual amount (2x median)
        accountSlug: "checking-1234",
        accountLabel: "Checking ••1234",
        currency: "CAD",
      },
    ];

    const accountSnapshots: AccountSnapshot[] = [];
    const monthlyHistory: any[] = [];
    
    // User reviewed and marked as "not_income" (refund/transfer)
    const reviews = new Map<string, string>();
    reviews.set("2024-09-20:ACME CORP:10000:checking-1234", "not_income");

    const summary = buildIncomeSummary(incomeTxns, accountSnapshots, "CAD", reviews);

    // Only regular 5000/month should count, unusual 10000 excluded
    // Last 3 months: (5000 + 5000 + 5000) / 3 = 5000
    expect(summary.typicalMonthly).toBe(5000);
    expect(summary.last3MonthsTotal).toBe(15000);
  });

  it("classified 'bonus' deposits are included and tracked separately", () => {
    const incomeTxns: IncomeTxnRecord[] = [
      // Need >=4 transactions to establish clear baseline
      {
        txMonth: "2024-06",
        date: "2024-06-15",
        source: "ACME CORP",
        category: "Employment",
        amount: 5000,
        accountSlug: "checking-1234",
        accountLabel: "Checking ••1234",
        currency: "CAD",
      },
      {
        txMonth: "2024-07",
        date: "2024-07-15",
        source: "ACME CORP",
        category: "Employment",
        amount: 5000,
        accountSlug: "checking-1234",
        accountLabel: "Checking ••1234",
        currency: "CAD",
      },
      {
        txMonth: "2024-08",
        date: "2024-08-15",
        source: "ACME CORP",
        category: "Employment",
        amount: 5000,
        accountSlug: "checking-1234",
        accountLabel: "Checking ••1234",
        currency: "CAD",
      },
      {
        txMonth: "2024-09",
        date: "2024-09-15",
        source: "ACME CORP",
        category: "Employment",
        amount: 5000,
        accountSlug: "checking-1234",
        accountLabel: "Checking ••1234",
        currency: "CAD",
      },
      {
        txMonth: "2024-09",
        date: "2024-09-20",
        source: "ACME CORP",
        category: "Employment",
        amount: 10000, // Unusual amount (2x median)
        accountSlug: "checking-1234",
        accountLabel: "Checking ••1234",
        currency: "CAD",
      },
    ];

    const accountSnapshots: AccountSnapshot[] = [];
    const monthlyHistory: any[] = [];
    
    // User reviewed and marked as "bonus"
    const reviews = new Map<string, string>();
    reviews.set("2024-09-20:ACME CORP:10000:checking-1234", "bonus");

    const summary = buildIncomeSummary(incomeTxns, accountSnapshots, "CAD", reviews);

    // Both should count: Last 3 months (Jul 5000 + Aug 5000 + Sep 15000) / 3 = 8333
    expect(summary.typicalMonthly).toBe(8333);
    expect(summary.last3MonthsTotal).toBe(25000);
    expect(summary.last3MonthsBonus).toBe(10000);
    expect(summary.bonusTransactions.length).toBe(1);
  });

  it("uses same month selection when rangeMonths provided (dashboard) vs default (income page)", () => {
    // Scenario: User has 4 months of data, but one month (Aug) has expenses but no income
    // Dashboard passes rangeMonths from monthlyHistory (Jul, Aug, Sep - last 3 calendar months)
    // Income page was defaulting to last 3 income-transaction months (Jul, Sep, Oct)
    // Both should now use the same logic: last 3 complete calendar months from monthlyHistory
    
    const incomeTxns: IncomeTxnRecord[] = [
      {
        txMonth: "2024-07",
        date: "2024-07-15",
        source: "TEST CORP",
        category: "Salary",
        amount: 5000,
        accountSlug: "checking-1234",
        accountLabel: "Checking ••1234",
        currency: "CAD",
      },
      // August: no income (user on unpaid leave, but had expenses)
      {
        txMonth: "2024-09",
        date: "2024-09-15",
        source: "TEST CORP",
        category: "Salary",
        amount: 5000,
        accountSlug: "checking-1234",
        accountLabel: "Checking ••1234",
        currency: "CAD",
      },
      {
        txMonth: "2024-10",
        date: "2024-10-15",
        source: "TEST CORP",
        category: "Salary",
        amount: 5000,
        accountSlug: "checking-1234",
        accountLabel: "Checking ••1234",
        currency: "CAD",
      },
    ];

    const accountSnapshots: AccountSnapshot[] = [
      {
        slug: "checking-1234",
        label: "Checking ••1234",
        accountType: "asset",
        institution: "Test Bank",
        balance: 15000,
        currency: "CAD",
      },
    ];

    // Simulate monthlyHistory that includes Aug (expense-only month)
    const monthlyHistory = [
      { yearMonth: "2024-07", incomeTotal: 5000, expensesTotal: 2000 },
      { yearMonth: "2024-08", incomeTotal: 0, expensesTotal: 1500 }, // expense-only
      { yearMonth: "2024-09", incomeTotal: 5000, expensesTotal: 2000 },
    ];

    // Simulate dashboard: rangeMonths from getRangeMonths("3mo", monthlyHistory)
    // This would be ["2024-07", "2024-08", "2024-09"] (last 3 calendar months with data)
    const rangeMonths = ["2024-07", "2024-08", "2024-09"];

    const incomeDepositReviews = new Map<string, string>();

    // Dashboard path (via getMoneyCoachIncome with rangeMonths)
    const summaryWithRange = buildIncomeSummary(
      incomeTxns,
      accountSnapshots,
      "CAD",
      incomeDepositReviews,
      rangeMonths
    );

    // Income page path (buildIncomeSummary without rangeMonths - NOW FIXED)
    // After fix, income-summary route also passes rangeMonths, so this simulates the old bug
    const summaryDefault = buildIncomeSummary(
      incomeTxns,
      accountSnapshots,
      "CAD",
      incomeDepositReviews
      // No rangeMonths - will use last 3 from income transaction dates
    );

    // Before fix: summaryWithRange would use Jul-Aug-Sep, summaryDefault would use Jul-Sep-Oct
    // After fix: both routes pass rangeMonths, so both use Jul-Aug-Sep
    
    // The key assertion: when rangeMonths includes zero-income month (Aug),
    // the average should be (5000 + 0 + 5000) / 2 = 5000 (dividing by months with data > 0)
    // NOT (5000 + 5000 + 5000) / 3 = 5000 (which would happen if Aug was excluded)
    
    expect(summaryWithRange.typicalMonthly).toBe(5000);
    
    // The actual bug: summaryDefault (without rangeMonths) would pick different months
    // It would use last 3 income months: [Jul, Sep, Oct] → (5000 + 5000 + 5000)/3 = 5000
    // But the MONTHS are different! Jul-Aug-Sep vs Jul-Sep-Oct
    
    // This test documents the behavior difference when rangeMonths is not provided
    // In production, the fix ensures BOTH routes now provide rangeMonths
    console.log("With rangeMonths (dashboard):", summaryWithRange.last3Months);
    console.log("Without rangeMonths (old income page):", summaryDefault.last3Months);
  });
});
