import { describe, expect, it } from "vitest";
import { mean, monthsForCashFlowAverage } from "../cashFlowAverage";
import {
  averageCashFlow,
  getMonthlyCashFlow,
} from "../monthlyCashFlow";
import type { ExpenseTxnRecord, IncomeTxnRecord } from "../extractTransactions";

function expense(
  overrides: Partial<ExpenseTxnRecord> & Pick<ExpenseTxnRecord, "category" | "amount" | "txMonth">,
): ExpenseTxnRecord {
  return {
    date: `${overrides.txMonth}-15`,
    merchant: overrides.merchant ?? "Store",
    accountSlug: "checking_1234",
    accountLabel: "Checking",
    ...overrides,
  };
}

function income(
  overrides: Partial<IncomeTxnRecord> & Pick<IncomeTxnRecord, "amount" | "txMonth">,
): IncomeTxnRecord {
  return {
    date: `${overrides.txMonth}-15`,
    source: overrides.source ?? "Acme Corp",
    description: overrides.description ?? overrides.source ?? "Acme Corp",
    accountSlug: "checking_1234",
    category: overrides.category ?? "Salary",
    ...overrides,
  };
}

describe("monthsForCashFlowAverage", () => {
  it("drops the unfinished current month by default", () => {
    expect(
      monthsForCashFlowAverage(["2026-08", "2026-09", "2026-10", "2026-11"], {
        currentMonth: "2026-11",
        lastNComplete: 3,
      }),
    ).toEqual(["2026-08", "2026-09", "2026-10"]);
  });

  it("keeps $0-income months that are in the requested range", () => {
    expect(
      monthsForCashFlowAverage(["2026-07", "2026-09"], {
        rangeMonths: ["2026-07", "2026-08", "2026-09"],
        currentMonth: "2026-11",
      }),
    ).toEqual(["2026-07", "2026-08", "2026-09"]);
  });

  it("includes the current month only when asked", () => {
    expect(
      monthsForCashFlowAverage(["2026-10", "2026-11"], {
        currentMonth: "2026-11",
        includeCurrentMonth: true,
        lastNComplete: 3,
      }),
    ).toEqual(["2026-10", "2026-11"]);
  });
});

describe("mean", () => {
  it("does not round", () => {
    expect(mean([5000, 15000, 5000])).toBeCloseTo(25000 / 3, 10);
  });

  it("returns 0 for an empty list", () => {
    expect(mean([])).toBe(0);
  });
});

describe("averageCashFlow", () => {
  it("includes a $0-income month so leftover stays money in minus money out", () => {
    const input = {
      expenseTxns: [
        expense({ category: "Groceries", amount: 100, txMonth: "2026-07" }),
        expense({ category: "Groceries", amount: 200, txMonth: "2026-08" }),
        expense({ category: "Groceries", amount: 100, txMonth: "2026-09" }),
      ],
      incomeTxns: [
        income({ amount: 1000, txMonth: "2026-07" }),
        income({ amount: 1000, txMonth: "2026-09" }),
      ],
      homeCurrency: "CAD",
    };
    const months = ["2026-07", "2026-08", "2026-09"];
    const avg = averageCashFlow(input, { rangeMonths: months, currentMonth: "2026-11" });
    const independent = months.map((m) => getMonthlyCashFlow(input, m));
    expect(avg.months).toEqual(months);
    expect(avg.moneyIn).toBeCloseTo((1000 + 0 + 1000) / 3);
    expect(avg.moneyOut).toBeCloseTo((100 + 200 + 100) / 3);
    expect(avg.leftover).toBeCloseTo(
      independent.reduce((s, m) => s + m.leftover, 0) / 3,
    );
    expect(avg.leftover).toBeCloseTo(avg.moneyIn - avg.moneyOut);
  });

  it("defaults to last 3 complete months with income or spending, not income-only", () => {
    const input = {
      expenseTxns: [
        expense({ category: "Groceries", amount: 50, txMonth: "2026-08" }),
        expense({ category: "Groceries", amount: 50, txMonth: "2026-09" }),
        expense({ category: "Groceries", amount: 50, txMonth: "2026-10" }),
      ],
      incomeTxns: [
        income({ amount: 400, txMonth: "2026-09" }),
        income({ amount: 400, txMonth: "2026-10" }),
      ],
      homeCurrency: "CAD",
    };
    const avg = averageCashFlow(input, { currentMonth: "2026-11", lastNComplete: 3 });
    expect(avg.months).toEqual(["2026-08", "2026-09", "2026-10"]);
    expect(avg.moneyIn).toBeCloseTo((0 + 400 + 400) / 3);
  });
});
