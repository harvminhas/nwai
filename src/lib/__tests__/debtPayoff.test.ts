import { describe, it, expect } from "vitest";
import { calculateDebtPayoff, calculateMinimumPayment, compareWithMinimumOnly, type DebtInput } from "../debtPayoff";

describe("debtPayoff", () => {
  const createDebt = (overrides: Partial<DebtInput> = {}): DebtInput => ({
    id: "test-1",
    name: "Test Debt",
    balance: 5000,
    interestRate: 18,
    monthlyPayment: 200,
    minPayment: null,
    accountType: "credit_card",
    included: true,
    ...overrides,
  });

  describe("calculateMinimumPayment", () => {
    it("should use statement minPayment if available", () => {
      const debt = createDebt({ minPayment: 150 });
      expect(calculateMinimumPayment(debt)).toBe(150);
    });

    it("should calculate credit card minimum (max of 3 formulas)", () => {
      const debt = createDebt({ balance: 1000, interestRate: 18, minPayment: null, accountType: "credit_card" });
      const monthlyInterest = 1000 * 0.18 / 12; // 15
      const option1 = monthlyInterest + 1000 * 0.01; // 15 + 10 = 25
      const option2 = 1000 * 0.03; // 30
      const option3 = 10;
      const expected = Math.max(option1, option2, option3); // 30
      expect(calculateMinimumPayment(debt)).toBe(expected);
    });

    it("should calculate line of credit minimum (interest + 1%)", () => {
      const debt = createDebt({ balance: 10000, interestRate: 6, minPayment: null, accountType: "line_of_credit" });
      const monthlyInterest = 10000 * 0.06 / 12; // 50
      const expected = monthlyInterest + 10000 * 0.01; // 50 + 100 = 150
      expect(calculateMinimumPayment(debt)).toBe(expected);
    });

    it("should use observed payment for loans if known", () => {
      const debt = createDebt({ balance: 50000, interestRate: 4, monthlyPayment: 800, minPayment: null, accountType: "mortgage" });
      expect(calculateMinimumPayment(debt)).toBe(800);
    });

    it("should calculate minimum for loans without observed payment", () => {
      const debt = createDebt({ balance: 50000, interestRate: 4, monthlyPayment: null, minPayment: null, accountType: "mortgage" });
      const monthlyInterest = 50000 * 0.04 / 12; // 166.67
      const expected = monthlyInterest + 50000 * 0.01; // 166.67 + 500 = 666.67
      expect(calculateMinimumPayment(debt)).toBeCloseTo(expected, 2);
    });

    it("should never return null or 0", () => {
      const debt = createDebt({ balance: 100, interestRate: 0, minPayment: null, monthlyPayment: null });
      const minimum = calculateMinimumPayment(debt);
      expect(minimum).toBeGreaterThan(0);
      expect(minimum).not.toBeNull();
    });
  });

  describe("calculateDebtPayoff", () => {
    it("should calculate payoff for a single debt", () => {
      const debts = [createDebt()];
      const minimums = calculateMinimumPayment(debts[0]);
      const result = calculateDebtPayoff(debts, minimums, "avalanche");
      
      expect(result.monthsToPayoff).toBeGreaterThan(0);
      expect(result.totalInterestPaid).toBeGreaterThan(0);
      expect(result.payoffOrder).toHaveLength(1);
      expect(result.debtFreeDate).not.toBeNull();
    });

    it("should handle zero-rate debt", () => {
      const debts = [createDebt({ interestRate: 0 })];
      const minimums = calculateMinimumPayment(debts[0]);
      const result = calculateDebtPayoff(debts, minimums, "avalanche");
      
      expect(result.monthsToPayoff).toBeGreaterThan(0);
      expect(result.totalInterestPaid).toBe(0);
      expect(result.debtFreeDate).not.toBeNull();
    });

    it("should enforce budget >= sum of minimums", () => {
      const debts = [createDebt()];
      const minimums = calculateMinimumPayment(debts[0]);
      const result = calculateDebtPayoff(debts, minimums - 50, "avalanche");
      
      // Should still succeed, just with warning
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings.some(w => w.includes("sum of minimums"))).toBe(true);
    });

    it("should exclude debts not included", () => {
      const debts = [
        createDebt({ id: "1", included: true }),
        createDebt({ id: "2", included: false }),
      ];
      const minimums = calculateMinimumPayment(debts[0]);
      const result = calculateDebtPayoff(debts, minimums, "avalanche");
      
      expect(result.payoffOrder).toHaveLength(1);
      expect(result.payoffOrder[0].debtId).toBe("1");
    });

    it("should rollover freed minimums to budget", () => {
      const debts = [
        createDebt({ id: "1", balance: 500, interestRate: 18 }),
        createDebt({ id: "2", balance: 5000, interestRate: 18 }),
      ];
      const min1 = calculateMinimumPayment(debts[0]);
      const min2 = calculateMinimumPayment(debts[1]);
      const totalMin = min1 + min2;
      
      const result = calculateDebtPayoff(debts, totalMin, "avalanche");
      
      // Both debts should pay off (first debt frees up its minimum for second)
      expect(result.payoffOrder).toHaveLength(2);
      expect(result.payoffOrder[0].debtId).toBe("1");
      expect(result.payoffOrder[1].debtId).toBe("2");
    });

    it("should prioritize highest rate for avalanche strategy", () => {
      const debts = [
        createDebt({ id: "low", balance: 2000, interestRate: 10 }),
        createDebt({ id: "high", balance: 3000, interestRate: 20 }),
      ];
      const totalMin = calculateMinimumPayment(debts[0]) + calculateMinimumPayment(debts[1]);
      const result = calculateDebtPayoff(debts, totalMin + 100, "avalanche");
      
      // High rate debt should pay off first
      expect(result.payoffOrder[0].debtId).toBe("high");
    });

    it("should prioritize smallest balance for snowball strategy", () => {
      const debts = [
        createDebt({ id: "small", balance: 1000, interestRate: 20 }),
        createDebt({ id: "large", balance: 5000, interestRate: 10 }),
      ];
      const totalMin = calculateMinimumPayment(debts[0]) + calculateMinimumPayment(debts[1]);
      const result = calculateDebtPayoff(debts, totalMin + 100, "snowball");
      
      // Small balance should pay off first
      expect(result.payoffOrder[0].debtId).toBe("small");
    });

    it("should warn about missing interest rate", () => {
      const debts = [createDebt({ interestRate: null })];
      const minimums = calculateMinimumPayment(debts[0]);
      const result = calculateDebtPayoff(debts, minimums, "avalanche");
      
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings.some(w => w.includes("missing interest rate"))).toBe(true);
    });

    it("should record total monthly balances", () => {
      const debts = [createDebt()];
      const minimums = calculateMinimumPayment(debts[0]);
      const result = calculateDebtPayoff(debts, minimums, "avalanche");
      
      expect(result.monthlyBalances.length).toBeGreaterThan(1);
      expect(result.monthlyBalances[0].month).toBe(0);
      expect(result.monthlyBalances[0].totalBalance).toBe(5000);
      
      // Balance should decrease over time
      const lastMonth = result.monthlyBalances[result.monthlyBalances.length - 1];
      expect(lastMonth.totalBalance).toBeLessThan(1);
    });
  });

  describe("compareWithMinimumOnly", () => {
    it("should show savings from extra payment", () => {
      const debts = [createDebt({ balance: 5000, interestRate: 18 })];
      const minimums = calculateMinimumPayment(debts[0]);
      const comparison = compareWithMinimumOnly(debts, minimums + 100, "avalanche");
      
      expect(comparison.monthsSaved).toBeGreaterThan(0);
      expect(comparison.interestSaved).toBeGreaterThan(0);
      expect(comparison.strategy.totalInterestPaid).toBeLessThan(comparison.minimumOnly.totalInterestPaid);
    });

    it("should show no savings when budget equals minimums", () => {
      const debts = [createDebt()];
      const minimums = calculateMinimumPayment(debts[0]);
      const comparison = compareWithMinimumOnly(debts, minimums, "avalanche");
      
      expect(comparison.monthsSaved).toBe(0);
      expect(comparison.interestSaved).toBe(0);
    });
  });
});
