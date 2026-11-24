/**
 * Spending by-category uses computeMonthSpending (actual installment
 * transactions), not scheduled/estimated loan amounts.
 */

import { describe, it, expect } from "vitest";
import { aggregateSpendingByCategory } from "@/lib/spendingAggregation";
import type { AccountSnapshot, ExpenseTxnRecord } from "@/lib/extractTransactions";

describe("Spending aggregation: loan payments use actual transactions", () => {
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

  const scotiaPayments: ExpenseTxnRecord[] = [
    {
      date: "2026-07-15",
      merchant: "SCOTIA PLAN LOAN",
      amount: 1142,
      category: "Installment Servicing",
      debtType: "personal_loan",
      txMonth: "2026-07",
      accountSlug: "checking-1",
      accountLabel: "Chequing",
      currency: "CAD",
    },
    {
      date: "2026-08-15",
      merchant: "SCOTIA PLAN LOAN",
      amount: 1142,
      category: "Installment Servicing",
      debtType: "personal_loan",
      txMonth: "2026-08",
      accountSlug: "checking-1",
      accountLabel: "Chequing",
      currency: "CAD",
    },
  ];

  it("averages actual installment payments over the window (does not invent the missed month)", () => {
    const categories = aggregateSpendingByCategory(
      scotiaPayments,
      [scotiaLoan],
      [],
      3,
    );

    const debt = categories.find((c) => c.category === "Debt");
    expect(debt).toBeDefined();
    expect(debt!.isScheduled).toBe(false);
    expect(debt!.total).toBe(1142 * 2);
    expect(debt!.monthlyAmount).toBeCloseTo((1142 * 2) / 3);
  });
});
