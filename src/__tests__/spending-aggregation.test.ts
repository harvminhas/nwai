/**
 * Test: Spending breakdown shows Scotia Plan = 1142 (learned regular payment)
 * not 858 (averaged over months).
 * 
 * Bug: Spending page was summing raw loan transactions, producing 858 for Scotia
 * while account page showed 1142 (from computeScheduledDebtPayments).
 * 
 * Fix: Use computeScheduledDebtPayments for all debt aggregations.
 */

import { describe, it, expect } from "@jest/globals";
import { aggregateSpendingByCategory } from "@/lib/spendingAggregation";
import { computeScheduledDebtPayments } from "@/lib/debtPayments";
import type { AccountSnapshot, ExpenseTxnRecord } from "@/lib/extractTransactions";

describe("Spending aggregation: loan payments use scheduled amounts", () => {
  // Scotia Plan Loan scenario from production
  const scotiaLoan: AccountSnapshot = {
    slug: "scotiabank-plan-1234",
    bankName: "Scotiabank",
    accountId: "1234",
    accountName: "Scotia Plan",
    accountType: "loan",
    balance: -15000,
    currency: "CAD",
    parsedAssets: null,
    parsedDebts: 15000,
    statementMonth: "2026-09",
    interestRate: 5.5,
  };

  // Three months of transactions: Jul 1142, Aug 1142, Sep 0 (missed)
  // Raw average = (1142 + 1142 + 0) / 3 = 761
  // But we saw 858 in production, so maybe 2 payments over 3 months?
  // Let's use (1142 + 1142) / 3 = 761 as the bug scenario
  // Actually, let me match the production numbers more closely
  const scotiaPayments: ExpenseTxnRecord[] = [
    {
      date: "2026-07-15",
      merchant: "SCOTIA PLAN LOAN",
      amount: 1142,
      category: "Debt",
      debtType: "personal_loan",
      txMonth: "2026-07",
      accountSlug: "scotiabank-plan-1234",
      accountLabel: "Scotia Plan",
      currency: "CAD",
    },
    {
      date: "2026-08-15",
      merchant: "SCOTIA PLAN LOAN",
      amount: 1142,
      category: "Debt",
      debtType: "personal_loan",
      txMonth: "2026-08",
      accountSlug: "scotiabank-plan-1234",
      accountLabel: "Scotia Plan",
      currency: "CAD",
    },
    // September: no payment (maybe missed or not yet uploaded)
  ];

  it("computeScheduledDebtPayments returns 1142 (learned from history)", () => {
    const scheduled = computeScheduledDebtPayments([scotiaLoan], scotiaPayments);
    const scotiaPlan = scheduled.find(p => p.accountSlug === "scotiabank-plan-1234");
    
    expect(scotiaPlan).toBeDefined();
    expect(scotiaPlan!.amount).toBe(1142);
    expect(scotiaPlan!.debtType).toBe("loan");
  });

  it("aggregateSpendingByCategory shows Scotia = 1142/month (not averaged)", () => {
    const categories = aggregateSpendingByCategory(
      scotiaPayments,
      [scotiaLoan],
      3 // 3 months window
    );
    
    const loanPayments = categories.find(c => c.category === "Loan payments");
    expect(loanPayments).toBeDefined();
    expect(loanPayments!.isScheduled).toBe(true);
    
    // Monthly amount should be 1142 (scheduled), not (1142+1142)/3 = 761
    expect(loanPayments!.monthlyAmount).toBe(1142);
    
    // Total over 3 months = 1142 × 3 = 3426
    expect(loanPayments!.total).toBe(1142 * 3);
    
    // Check merchant breakdown
    const scotia = loanPayments!.merchants?.find(m => 
      m.accountSlug === "scotiabank-plan-1234"
    );
    expect(scotia?.monthlyAmount).toBe(1142);
  });

  it("Raw transaction sum would give wrong number (demonstrates the bug)", () => {
    // This is what the OLD code did - sum raw transactions and average
    const rawSum = scotiaPayments.reduce((s, t) => s + t.amount, 0);
    const rawAvg = rawSum / 3; // 2284 / 3 = 761
    
    // The bug: showing 761 or similar instead of 1142
    expect(rawAvg).toBeLessThan(1142);
    expect(rawAvg).toBeCloseTo(761, 0);
  });

  it("Fixed bucket breakdown and spending breakdown show same Scotia amount", () => {
    // Simulate what Fixed bucket breakdown does
    const scheduled = computeScheduledDebtPayments([scotiaLoan], scotiaPayments);
    const scotiaFixed = scheduled.find(p => p.accountSlug === "scotiabank-plan-1234");
    
    // Simulate what spending breakdown does (after fix)
    const categories = aggregateSpendingByCategory(scotiaPayments, [scotiaLoan], 3);
    const scotiaSpending = categories
      .find(c => c.category === "Loan payments")
      ?.merchants?.find(m => m.accountSlug === "scotiabank-plan-1234");
    
    // Both should show 1142
    expect(scotiaFixed?.amount).toBe(1142);
    expect(scotiaSpending?.monthlyAmount).toBe(1142);
    expect(scotiaFixed?.amount).toBe(scotiaSpending?.monthlyAmount);
  });
});
