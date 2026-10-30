import { describe, it, expect } from "vitest";
import { calculateDebtPayoff, compareWithMinimumOnly, type DebtInput } from "../debtPayoff";

describe("debtPayoff", () => {
  const createDebt = (overrides: Partial<DebtInput> = {}): DebtInput => ({
    id: "test-1",
    name: "Test Debt",
    balance: 5000,
    interestRate: 18,
    monthlyPayment: 200,
    included: true,
    ...overrides,
  });

  describe("calculateDebtPayoff", () => {
    it("should calculate payoff for a single debt", () => {
      const debts = [createDebt()];
      const result = calculateDebtPayoff(debts, 0, "avalanche");
      
      expect(result.monthsToPayoff).toBeGreaterThan(0);
      expect(result.totalInterestPaid).toBeGreaterThan(0);
      expect(result.payoffOrder).toHaveLength(1);
      expect(result.debtFreeDate).not.toBeNull();
    });

    it("should handle zero-rate debt", () => {
      const debts = [createDebt({ interestRate: 0 })];
      const result = calculateDebtPayoff(debts, 0, "avalanche");
      
      expect(result.monthsToPayoff).toBe(25); // 5000 / 200 = 25 months
      expect(result.totalInterestPaid).toBe(0);
      expect(result.debtFreeDate).not.toBeNull();
    });

    it("should flag unpayable debt when payment <= interest", () => {
      const debts = [createDebt({ balance: 10000, interestRate: 24, monthlyPayment: 50 })];
      const result = calculateDebtPayoff(debts, 0, "avalanche");
      
      expect(result.monthsToPayoff).toBeNull();
      expect(result.debtFreeDate).toBeNull();
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings.some(w => w.includes("doesn't cover monthly interest"))).toBe(true);
    });

    it("should exclude debts not included", () => {
      const debts = [
        createDebt({ id: "1", included: true }),
        createDebt({ id: "2", included: false }),
      ];
      const result = calculateDebtPayoff(debts, 0, "avalanche");
      
      expect(result.payoffOrder).toHaveLength(1);
      expect(result.payoffOrder[0].debtId).toBe("1");
    });

    it("should rollover freed payments to extra payment pool", () => {
      const debts = [
        createDebt({ id: "1", balance: 1000, monthlyPayment: 200 }),
        createDebt({ id: "2", balance: 5000, monthlyPayment: 200 }),
      ];
      const result = calculateDebtPayoff(debts, 0, "avalanche");
      
      // First debt should pay off, then its payment rolls to second debt
      expect(result.payoffOrder).toHaveLength(2);
      expect(result.payoffOrder[0].debtId).toBe("1");
      expect(result.payoffOrder[1].debtId).toBe("2");
      
      // Second debt should pay off faster due to rollover
      const monthsToPayoffSecond = result.payoffOrder[1].payoffMonth - result.payoffOrder[0].payoffMonth;
      expect(monthsToPayoffSecond).toBeLessThan(25); // Would be 25 without rollover
    });

    it("should prioritize highest rate for avalanche strategy", () => {
      const debts = [
        createDebt({ id: "low", balance: 2000, interestRate: 10, monthlyPayment: 100 }),
        createDebt({ id: "high", balance: 3000, interestRate: 20, monthlyPayment: 100 }),
      ];
      const result = calculateDebtPayoff(debts, 100, "avalanche");
      
      // High rate debt should get extra payment and pay off first
      expect(result.payoffOrder[0].debtId).toBe("high");
    });

    it("should prioritize smallest balance for snowball strategy", () => {
      const debts = [
        createDebt({ id: "small", balance: 1000, interestRate: 20, monthlyPayment: 100 }),
        createDebt({ id: "large", balance: 5000, interestRate: 10, monthlyPayment: 100 }),
      ];
      const result = calculateDebtPayoff(debts, 100, "snowball");
      
      // Small balance should get extra payment and pay off first
      expect(result.payoffOrder[0].debtId).toBe("small");
    });

    it("should warn about missing monthly payment", () => {
      const debts = [createDebt({ monthlyPayment: null })];
      const result = calculateDebtPayoff(debts, 0, "avalanche");
      
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings.some(w => w.includes("missing monthly payment"))).toBe(true);
    });

    it("should warn about missing interest rate", () => {
      const debts = [createDebt({ interestRate: null })];
      const result = calculateDebtPayoff(debts, 0, "avalanche");
      
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings.some(w => w.includes("missing interest rate"))).toBe(true);
    });

    it("should record monthly balances", () => {
      const debts = [createDebt()];
      const result = calculateDebtPayoff(debts, 0, "avalanche");
      
      expect(result.monthlyBalances.length).toBeGreaterThan(1);
      expect(result.monthlyBalances[0].month).toBe(0);
      expect(result.monthlyBalances[0].debts[0].balance).toBe(5000);
      
      // Balance should decrease over time
      const lastMonth = result.monthlyBalances[result.monthlyBalances.length - 1];
      expect(lastMonth.debts[0].balance).toBeLessThan(1);
    });
  });

  describe("compareWithMinimumOnly", () => {
    it("should show savings from extra payment", () => {
      const debts = [createDebt({ balance: 5000, interestRate: 18, monthlyPayment: 200 })];
      const comparison = compareWithMinimumOnly(debts, 100, "avalanche");
      
      expect(comparison.monthsSaved).toBeGreaterThan(0);
      expect(comparison.interestSaved).toBeGreaterThan(0);
      expect(comparison.strategy.totalInterestPaid).toBeLessThan(comparison.minimumOnly.totalInterestPaid);
    });

    it("should show no savings when extra payment is 0", () => {
      const debts = [createDebt()];
      const comparison = compareWithMinimumOnly(debts, 0, "avalanche");
      
      expect(comparison.monthsSaved).toBe(0);
      expect(comparison.interestSaved).toBe(0);
    });
  });
});
