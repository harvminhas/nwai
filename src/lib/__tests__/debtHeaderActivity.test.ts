import { describe, it, expect } from "vitest";
import { monthAbbrev, resolveDebtHeaderActivity } from "../debtHeaderActivity";

describe("monthAbbrev", () => {
  it("returns the short month matching the statement month (Oct from 2026-10)", () => {
    expect(monthAbbrev("2026-10")).toBe("Oct");
  });

  it("handles January and December", () => {
    expect(monthAbbrev("2026-01")).toBe("Jan");
    expect(monthAbbrev("2025-12")).toBe("Dec");
  });
});

describe("resolveDebtHeaderActivity", () => {
  it("uses paymentsMade for Paid, not expenses", () => {
    const result = resolveDebtHeaderActivity({
      paymentsMade: 1142.25,
      incomeTotal: 0,
      incomeTxnCount: 0,
      expensesTotal: 18540,
      expensesTxnCount: 4,
    });
    expect(result.paid).toEqual({ amount: 1142.25, count: 0 });
    expect(result.newCharges).toEqual({ amount: 18540, count: 4 });
  });

  it("falls back to income when paymentsMade is missing (legacy debt credits)", () => {
    const result = resolveDebtHeaderActivity({
      paymentsMade: 0,
      incomeTotal: 500,
      incomeTxnCount: 2,
      expensesTotal: 80,
      expensesTxnCount: 1,
    });
    expect(result.paid).toEqual({ amount: 500, count: 2 });
  });

  it("prefers paymentsMade over income when both exist", () => {
    const result = resolveDebtHeaderActivity({
      paymentsMade: 1000,
      incomeTotal: 400,
      incomeTxnCount: 1,
      expensesTotal: 0,
      expensesTxnCount: 0,
    });
    expect(result.paid).toEqual({ amount: 1000, count: 0 });
    expect(result.newCharges).toBeNull();
  });

  it("shows income txn count when income total matches paymentsMade", () => {
    const result = resolveDebtHeaderActivity({
      paymentsMade: 500,
      incomeTotal: 500,
      incomeTxnCount: 2,
      expensesTotal: 0,
      expensesTxnCount: 0,
    });
    expect(result.paid).toEqual({ amount: 500, count: 2 });
  });

  it("hides Paid when both paymentsMade and income are zero", () => {
    const result = resolveDebtHeaderActivity({
      paymentsMade: 0,
      incomeTotal: 0,
      incomeTxnCount: 0,
      expensesTotal: 200,
      expensesTxnCount: 3,
    });
    expect(result.paid).toBeNull();
    expect(result.newCharges).toEqual({ amount: 200, count: 3 });
  });

  it("hides New charges when expenses are zero", () => {
    const result = resolveDebtHeaderActivity({
      paymentsMade: 2000,
      incomeTotal: 0,
      incomeTxnCount: 0,
      expensesTotal: 0,
      expensesTxnCount: 0,
    });
    expect(result.paid).toEqual({ amount: 2000, count: 0 });
    expect(result.newCharges).toBeNull();
  });

  it("hides both when there is no activity", () => {
    const result = resolveDebtHeaderActivity({
      paymentsMade: 0,
      incomeTotal: 0,
      incomeTxnCount: 0,
      expensesTotal: 0,
      expensesTxnCount: 0,
    });
    expect(result.paid).toBeNull();
    expect(result.newCharges).toBeNull();
  });
});
