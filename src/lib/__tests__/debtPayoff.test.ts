import { describe, it, expect } from "vitest";
import { calculateDebtPayoff, calculateMinimumPayment, solveForTargetDate, classifyPlanStatus, compareWithMinimumOnly, type DebtInput } from "../debtPayoff";

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

  describe("isHELOC detection", () => {
    it("should detect HELOC by account type 'loc'", () => {
      const debt = createDebt({ accountType: "loc", balance: 50000, interestRate: 6 });
      const minimum = calculateMinimumPayment(debt);
      const interestOnly = 50000 * 0.06 / 12; // 250
      expect(minimum).toBe(interestOnly);
    });

    it("should detect HELOC by account type 'line_of_credit'", () => {
      const debt = createDebt({ accountType: "line_of_credit", balance: 50000, interestRate: 6 });
      const minimum = calculateMinimumPayment(debt);
      const interestOnly = 50000 * 0.06 / 12;
      expect(minimum).toBe(interestOnly);
    });

    it("should detect HELOC by name 'FlexLine'", () => {
      const debt = createDebt({ name: "TD Home Equity FlexLine", accountType: "loan", balance: 50000, interestRate: 6 });
      const minimum = calculateMinimumPayment(debt);
      const interestOnly = 50000 * 0.06 / 12;
      expect(minimum).toBe(interestOnly);
    });

    it("should detect HELOC by name 'HELOC'", () => {
      const debt = createDebt({ name: "Bank HELOC", accountType: "loan", balance: 50000, interestRate: 6 });
      const minimum = calculateMinimumPayment(debt);
      const interestOnly = 50000 * 0.06 / 12;
      expect(minimum).toBe(interestOnly);
    });

    it("should NOT treat regular loans as HELOC", () => {
      const debt = createDebt({ name: "Car Loan", accountType: "loan", balance: 20000, interestRate: 5 });
      const minimum = calculateMinimumPayment(debt);
      const interestOnly = 20000 * 0.05 / 12; // 83.33
      const withPrincipal = interestOnly + 20000 * 0.01; // 83.33 + 200 = 283.33
      expect(minimum).toBeCloseTo(withPrincipal, 2);
      expect(minimum).toBeGreaterThan(interestOnly);
    });
  });

  describe("calculateMinimumPayment", () => {
    it("should calculate credit card minimum (max of 3 formulas)", () => {
      const debt = createDebt({ balance: 1000, interestRate: 18, accountType: "credit_card" });
      const monthlyInterest = 1000 * 0.18 / 12; // 15
      const option1 = monthlyInterest + 1000 * 0.01; // 15 + 10 = 25
      const option2 = 1000 * 0.03; // 30
      const option3 = 10;
      const expected = Math.max(option1, option2, option3); // 30
      expect(calculateMinimumPayment(debt)).toBe(expected);
    });

    it("should calculate HELOC minimum (interest-only)", () => {
      const debt = createDebt({ balance: 10000, interestRate: 6, name: "HELOC", accountType: "line_of_credit" });
      const monthlyInterest = 10000 * 0.06 / 12; // 50
      expect(calculateMinimumPayment(debt)).toBe(monthlyInterest);
    });

    it("should calculate minimum for loans (interest + 1%)", () => {
      const debt = createDebt({ balance: 50000, interestRate: 4, accountType: "mortgage" });
      const monthlyInterest = 50000 * 0.04 / 12; // 166.67
      const expected = monthlyInterest + 50000 * 0.01; // 166.67 + 500 = 666.67
      expect(calculateMinimumPayment(debt)).toBeCloseTo(expected, 2);
    });

    it("should return minimum < 10% of balance for normal balances", () => {
      const debt = createDebt({ balance: 10000, interestRate: 18, accountType: "credit_card" });
      const minimum = calculateMinimumPayment(debt);
      expect(minimum).toBeLessThan(debt.balance * 0.1);
    });
  });

  describe("solveForTargetDate", () => {
    it("should find required budget to hit target date", () => {
      const debts = [createDebt({ balance: 10000, interestRate: 18 })];
      const targetMonths = 36; // 3 years
      const result = solveForTargetDate(debts, targetMonths, "avalanche");
      
      expect(result).not.toBeNull();
      expect(result!.requiredBudget).toBeGreaterThan(0);
      expect(result!.result.monthsToPayoff).toBeLessThanOrEqual(targetMonths + 1);
      expect(result!.result.monthsToPayoff).toBeGreaterThanOrEqual(targetMonths - 1);
    });

    it("should return minimums if target is already achievable", () => {
      const debts = [createDebt({ balance: 1000, interestRate: 18 })];
      const minimums = calculateMinimumPayment(debts[0]);
      const targetMonths = 100; // Very generous target
      const result = solveForTargetDate(debts, targetMonths, "avalanche");
      
      expect(result).not.toBeNull();
      expect(result!.requiredBudget).toBeCloseTo(minimums, 1);
    });

    it("should return null if target is impossible", () => {
      const debts = [createDebt({ balance: 100000, interestRate: 24 })];
      const targetMonths = 1; // Impossible
      const result = solveForTargetDate(debts, targetMonths, "avalanche");
      
      expect(result).toBeNull();
    });

    it("should handle multiple debts", () => {
      const debts = [
        createDebt({ id: "1", balance: 5000, interestRate: 18 }),
        createDebt({ id: "2", balance: 3000, interestRate: 15 }),
      ];
      const targetMonths = 24;
      const result = solveForTargetDate(debts, targetMonths, "avalanche");
      
      expect(result).not.toBeNull();
      expect(result!.result.monthsToPayoff).toBeLessThanOrEqual(targetMonths + 1);
    });
  });

  describe("classifyPlanStatus", () => {
    it("should return on-track when within 5% threshold", () => {
      const debts = [createDebt({ balance: 10000 })];
      const current = 9500;
      const projected = 10000;
      const status = classifyPlanStatus(current, projected, 300, "avalanche", debts);
      
      expect(status.status).toBe("on-track");
    });

    it("should return ahead when significantly under projected", () => {
      const debts = [createDebt({ balance: 10000 })];
      const current = 8000;
      const projected = 10000;
      const status = classifyPlanStatus(current, projected, 300, "avalanche", debts);
      
      expect(status.status).toBe("ahead");
      expect(status.deltaAmount).toBeGreaterThan(0);
    });

    it("should return behind when significantly over projected", () => {
      const debts = [createDebt({ balance: 10000 })];
      const current = 12000;
      const projected = 10000;
      const status = classifyPlanStatus(current, projected, 300, "avalanche", debts);
      
      expect(status.status).toBe("behind");
      expect(status.deltaAmount).toBeGreaterThan(0);
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

    it("should prioritize highest rate for avalanche strategy", () => {
      const debts = [
        createDebt({ id: "low", balance: 2000, interestRate: 10 }),
        createDebt({ id: "high", balance: 3000, interestRate: 20 }),
      ];
      const totalMin = calculateMinimumPayment(debts[0]) + calculateMinimumPayment(debts[1]);
      const result = calculateDebtPayoff(debts, totalMin + 100, "avalanche");
      
      expect(result.payoffOrder[0].debtId).toBe("high");
    });

    it("should prioritize smallest balance for snowball strategy", () => {
      const debts = [
        createDebt({ id: "small", balance: 1000, interestRate: 20 }),
        createDebt({ id: "large", balance: 5000, interestRate: 10 }),
      ];
      const totalMin = calculateMinimumPayment(debts[0]) + calculateMinimumPayment(debts[1]);
      const result = calculateDebtPayoff(debts, totalMin + 100, "snowball");
      
      expect(result.payoffOrder[0].debtId).toBe("small");
    });

    it("should record total monthly balances", () => {
      const debts = [createDebt()];
      const minimums = calculateMinimumPayment(debts[0]);
      const result = calculateDebtPayoff(debts, minimums, "avalanche");
      
      expect(result.monthlyBalances.length).toBeGreaterThan(1);
      expect(result.monthlyBalances[0].month).toBe(0);
      expect(result.monthlyBalances[0].totalBalance).toBe(5000);
      
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
