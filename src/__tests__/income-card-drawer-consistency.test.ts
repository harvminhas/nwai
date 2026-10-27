import { describe, it, expect } from "vitest";
import { getMoneyCoachIncome } from "@/lib/incomeMetrics";
import { buildIncomeSummary } from "@/lib/incomeSummary";
import type { IncomeTxnRecord, AccountSnapshot } from "@/lib/extractTransactions";

/**
 * Unit test: Dashboard Income card value === Income drawer default value
 * 
 * Ensures both use the same data source (buildIncomeSummary) and show
 * regular income only (excludes one-offs like bonuses).
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
      // Regular salary - need >=3 for detection
      {
        txMonth: "2024-07",
        date: "2024-07-15",
        source: "SALARY",
        category: "Employment",
        amount: 5000,
        accountSlug: "checking-1234",
        accountLabel: "Checking ••1234",
        currency: "CAD",
      },
      {
        txMonth: "2024-08",
        date: "2024-08-15",
        source: "SALARY",
        category: "Employment",
        amount: 5000,
        accountSlug: "checking-1234",
        accountLabel: "Checking ••1234",
        currency: "CAD",
      },
      {
        txMonth: "2024-09",
        date: "2024-09-15",
        source: "SALARY",
        category: "Employment",
        amount: 5000,
        accountSlug: "checking-1234",
        accountLabel: "Checking ••1234",
        currency: "CAD",
      },
      {
        txMonth: "2024-09",
        date: "2024-09-20",
        source: "SALARY",
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
    reviews.set("2024-09-20:SALARY:10000:checking-1234", "not_income");

    const summary = buildIncomeSummary(incomeTxns, accountSnapshots, "CAD", reviews);

    // Only regular 5000/month should count, unusual 10000 excluded
    // (5000 + 5000 + 5000) / 3 = 5000
    expect(summary.typicalMonthly).toBe(5000);
    expect(summary.last3MonthsTotal).toBe(15000);
  });

  it("classified 'bonus' deposits are included and tracked separately", () => {
    const incomeTxns: IncomeTxnRecord[] = [
      // Regular salary - need >=3 for detection
      {
        txMonth: "2024-07",
        date: "2024-07-15",
        source: "SALARY",
        category: "Employment",
        amount: 5000,
        accountSlug: "checking-1234",
        accountLabel: "Checking ••1234",
        currency: "CAD",
      },
      {
        txMonth: "2024-08",
        date: "2024-08-15",
        source: "SALARY",
        category: "Employment",
        amount: 5000,
        accountSlug: "checking-1234",
        accountLabel: "Checking ••1234",
        currency: "CAD",
      },
      {
        txMonth: "2024-09",
        date: "2024-09-15",
        source: "SALARY",
        category: "Employment",
        amount: 5000,
        accountSlug: "checking-1234",
        accountLabel: "Checking ••1234",
        currency: "CAD",
      },
      {
        txMonth: "2024-09",
        date: "2024-09-20",
        source: "SALARY",
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
    reviews.set("2024-09-20:SALARY:10000:checking-1234", "bonus");

    const summary = buildIncomeSummary(incomeTxns, accountSnapshots, "CAD", reviews);

    // Both should count: (5000 + 5000 + 15000) / 3 = 8333
    expect(summary.typicalMonthly).toBe(8333);
    expect(summary.last3MonthsTotal).toBe(25000);
    expect(summary.last3MonthsBonus).toBe(10000);
    expect(summary.bonusTransactions.length).toBe(1);
  });
});
