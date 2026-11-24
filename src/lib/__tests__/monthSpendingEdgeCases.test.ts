import { describe, expect, it } from "vitest";
import { computeMonthSpending, isNotSpending } from "../spendingMetrics";

const MONTH = "2026-10";
const row = (o: Record<string, unknown>) => ({
  txMonth: MONTH,
  date: `${MONTH}-15`,
  accountSlug: "chequing",
  amount: 0,
  ...o,
});

describe("computeMonthSpending edge cases", () => {
  it("keeps card payments and own-account transfers left in Other out of spending", () => {
    for (const merchant of ["AMEX CARDS", "SCOTIALN VSA", "TFR-TO C/C", "TD VISA", "TFR-TO 4002808"]) {
      expect(isNotSpending("Other", { merchant })).toBe(true);
    }
    for (const merchant of ["Mystery shop", "SEND E-TFR landlord", "VISA DEBIT STARBUCKS"]) {
      expect(isNotSpending("Other", { merchant })).toBe(false);
    }
    const m = computeMonthSpending(MONTH, [
      row({ category: "Other", merchant: "AMEX CARDS", amount: 900 }),
      row({ category: "Other", merchant: "Mystery shop", amount: 40 }),
    ]);
    expect(m.total).toBe(40);
  });

  it("counts a loan payment once when it shows on chequing and on the loan statement", () => {
    const m = computeMonthSpending(MONTH, [
      row({ category: "Installment Servicing", debtType: "auto_loan", merchant: "HONDA FINANCE", amount: 450, date: `${MONTH}-03` }),
      row({ category: "Installment Servicing", debtType: "auto_loan", merchant: "Payment received", amount: 450, date: `${MONTH}-05`, accountSlug: "honda-loan" }),
    ]);
    expect(m.total).toBe(450);
    expect(m.lines).toHaveLength(1);
    expect(m.lines[0].transactions).toHaveLength(1);
  });

  it("still counts a payment seen only on the loan statement, and two equal payments from one account", () => {
    expect(
      computeMonthSpending(MONTH, [
        row({ category: "Installment Servicing", debtType: "personal_loan", merchant: "Pyt", amount: 1142.25, accountSlug: "scotia-plan" }),
      ]).total,
    ).toBeCloseTo(1142.25);
    expect(
      computeMonthSpending(MONTH, [
        row({ category: "Installment Servicing", debtType: "auto_loan", merchant: "Loan A", amount: 300, date: `${MONTH}-01` }),
        row({ category: "Installment Servicing", debtType: "auto_loan", merchant: "Loan A", amount: 300, date: `${MONTH}-15` }),
      ]).total,
    ).toBe(600);
  });
});
