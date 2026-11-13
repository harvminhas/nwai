import { describe, expect, it } from "vitest";
import type { MonthlyHistoryEntry } from "../financialProfile";
import {
  computeMonthGrowth,
  computeNetWorthGrowth,
  describeCashChange,
  describeDebtChange,
  describeInvestmentChange,
  describeInvestmentPutIn,
  formatGrowthChartTitle,
  growthBucket,
  isDebtAccountType,
  sumGrowthBreakdowns,
  type NetWorthGrowthInput,
} from "../netWorthGrowth";

function month(partial: Partial<MonthlyHistoryEntry> & { yearMonth: string; netWorth: number }): MonthlyHistoryEntry {
  return {
    expensesTotal: 0,
    coreExpensesTotal: 0,
    incomeTotal: 0,
    incomeTotalAllCredits: 0,
    debtPaymentsTotal: 0,
    cardServicingPaymentsTotal: 0,
    minDebtPaymentsTotal: 0,
    totalAssets: Math.max(0, partial.netWorth),
    totalDebts: 0,
    byAccount: [],
    ...partial,
  };
}

describe("account grouping (matches Assets / Debts pages)", () => {
  it("puts chequing and everyday savings in cash, TFSA/brokerage in investments, cards/mortgages in debts", () => {
    expect(growthBucket("checking", "Chequing")).toBe("cash");
    expect(growthBucket("savings", "Everyday Savings")).toBe("cash");
    expect(growthBucket("savings", "TD TFSA")).toBe("cash");
    expect(growthBucket("tfsa", "TD TFSA")).toBe("investments");
    expect(growthBucket("investment", "Brokerage")).toBe("investments");
    expect(growthBucket("credit", "Visa")).toBe("debts");
    expect(growthBucket("mortgage", "Home")).toBe("debts");
    expect(isDebtAccountType("checking")).toBe(false);
  });

  it("leaves manual assets like cars out of all three buckets", () => {
    expect(growthBucket("manual-vehicle", "Honda Civic")).toBeNull();
    expect(growthBucket("manual-property", "House")).toBeNull();
  });
});

describe("this month start vs end", () => {
  const previous = month({
    yearMonth: "2026-09",
    netWorth: 40000,
    byAccount: [
      { slug: "chk", label: "Chequing", type: "checking", value: 5000 },
      { slug: "sav", label: "Everyday Savings", type: "savings", value: 3000 },
      { slug: "tfsa", label: "TFSA", type: "investment", value: 20000 },
      { slug: "visa", label: "Visa", type: "credit", value: -2000 },
      { slug: "mtg", label: "Mortgage", type: "mortgage", value: -210000 },
    ],
  });

  it("totals cash, investments, and debts for accounts present at both ends", () => {
    const current = month({
      yearMonth: "2026-10",
      netWorth: 43000,
      byAccount: [
        { slug: "chk", label: "Chequing", type: "checking", value: 6200 },
        { slug: "sav", label: "Everyday Savings", type: "savings", value: 3100 },
        { slug: "tfsa", label: "TFSA", type: "investment", value: 22100 },
        { slug: "visa", label: "Visa", type: "credit", value: -1800 },
        { slug: "mtg", label: "Mortgage", type: "mortgage", value: -209400 },
      ],
    });
    const result = computeMonthGrowth(current, previous, { expenseTxns: [], incomeTxns: [] });
    expect(result.hasPrevious).toBe(true);
    expect(result.cash.start).toBe(8000);
    expect(result.cash.end).toBe(9300);
    expect(result.cash.change).toBe(1300);
    expect(result.investments.start).toBe(20000);
    expect(result.investments.end).toBe(22100);
    expect(result.investments.change).toBe(2100);
    expect(result.debts.start).toBe(212000);
    expect(result.debts.end).toBe(211200);
    expect(result.debts.change).toBe(-800);
    expect(describeCashChange(result.cash, "CAD")).toMatch(/went up/);
    expect(describeInvestmentChange(result.investments, "CAD")).toMatch(/grew/);
    expect(describeDebtChange(result.debts, "CAD")).toMatch(/paid down/);
    expect(result.cash.accounts.map((a) => a.slug)).toEqual(["chk", "sav"]);
    expect(result.cash.accounts[0].change).toBe(1200);
  });

  it("excludes new accounts from growth and lists cash/investment/debt names in the note", () => {
    const current = month({
      yearMonth: "2026-10",
      netWorth: 50000,
      byAccount: [
        { slug: "chk", label: "Chequing", type: "checking", value: 5000 },
        { slug: "sav", label: "Everyday Savings", type: "savings", value: 3000 },
        { slug: "tfsa", label: "TFSA", type: "investment", value: 20000 },
        { slug: "visa", label: "Visa", type: "credit", value: -2000 },
        { slug: "mtg", label: "Mortgage", type: "mortgage", value: -210000 },
        { slug: "eq", label: "EQ Bank Savings", type: "savings", value: 4000 },
        { slug: "manual-civic", label: "Honda Civic", type: "manual-vehicle", value: 18000 },
      ],
    });
    const result = computeMonthGrowth(current, previous, { expenseTxns: [], incomeTxns: [] });
    expect(result.cash.change).toBe(0);
    expect(result.cash.accounts.some((a) => a.slug === "eq")).toBe(false);
    expect(result.newAccounts.map((a) => a.slug)).toEqual(["eq"]);
    expect(result.newAccounts.some((a) => a.slug === "manual-civic")).toBe(false);
  });

  it("does not split investments when some accounts have no deposit or withdrawal lines", () => {
    const current = month({
      yearMonth: "2026-10",
      netWorth: 42100,
      byAccount: [
        { slug: "chk", label: "Chequing", type: "checking", value: 5000 },
        { slug: "tfsa", label: "TFSA", type: "investment", value: 22100 },
        { slug: "visa", label: "Visa", type: "credit", value: -2000 },
      ],
    });
    const prior = month({
      yearMonth: "2026-09",
      netWorth: 40000,
      byAccount: [
        { slug: "chk", label: "Chequing", type: "checking", value: 5000 },
        { slug: "tfsa", label: "TFSA", type: "investment", value: 20000 },
        { slug: "visa", label: "Visa", type: "credit", value: -2000 },
      ],
    });
    const result = computeMonthGrowth(current, prior, { expenseTxns: [], incomeTxns: [] });
    expect(result.investments.change).toBe(2100);
    expect(result.investments.putIn).toBeNull();
    expect(result.investments.marketChange).toBeNull();
    expect(describeInvestmentPutIn(result.investments, "CAD")).toBeNull();
  });

  it("shows you put in vs markets when every investment account has deposit or withdrawal lines", () => {
    const current = month({
      yearMonth: "2026-10",
      netWorth: 42100,
      byAccount: [
        { slug: "chk", label: "Chequing", type: "checking", value: 5000 },
        { slug: "tfsa", label: "TFSA", type: "investment", value: 22100 },
        { slug: "visa", label: "Visa", type: "credit", value: -2000 },
      ],
    });
    const prior = month({
      yearMonth: "2026-09",
      netWorth: 40000,
      byAccount: [
        { slug: "chk", label: "Chequing", type: "checking", value: 5000 },
        { slug: "tfsa", label: "TFSA", type: "investment", value: 20000 },
        { slug: "visa", label: "Visa", type: "credit", value: -2000 },
      ],
    });
    const result = computeMonthGrowth(current, prior, {
      expenseTxns: [],
      incomeTxns: [{ txMonth: "2026-10", amount: 1500, accountSlug: "tfsa" }],
    });
    expect(result.investments.putIn).toBe(1500);
    expect(result.investments.marketChange).toBe(600);
    expect(describeInvestmentPutIn(result.investments, "CAD")).toMatch(/put in/);
    expect(describeInvestmentPutIn(result.investments, "CAD")).toMatch(/markets added/);
  });

  it("counts a paid-off debt as going to zero, not as a new account", () => {
    const current = month({
      yearMonth: "2026-10",
      netWorth: 5000,
      byAccount: [
        { slug: "chk", label: "Chequing", type: "checking", value: 5000 },
      ],
    });
    const prior = month({
      yearMonth: "2026-09",
      netWorth: 3000,
      byAccount: [
        { slug: "chk", label: "Chequing", type: "checking", value: 5000 },
        { slug: "visa", label: "Visa", type: "credit", value: -2000 },
      ],
    });
    const result = computeMonthGrowth(current, prior, { expenseTxns: [], incomeTxns: [] });
    expect(result.debts.start).toBe(2000);
    expect(result.debts.end).toBe(0);
    expect(result.debts.change).toBe(-2000);
    expect(result.newAccounts).toEqual([]);
    expect(describeDebtChange(result.debts, "CAD")).toMatch(/paid down/);
  });

  it("says debt grew when balances go up", () => {
    const current = month({
      yearMonth: "2026-10",
      netWorth: 39000,
      byAccount: [
        { slug: "chk", label: "Chequing", type: "checking", value: 5000 },
        { slug: "visa", label: "Visa", type: "credit", value: -2800 },
      ],
    });
    const prior = month({
      yearMonth: "2026-09",
      netWorth: 40000,
      byAccount: [
        { slug: "chk", label: "Chequing", type: "checking", value: 5000 },
        { slug: "visa", label: "Visa", type: "credit", value: -2000 },
      ],
    });
    const result = computeMonthGrowth(current, prior, { expenseTxns: [], incomeTxns: [] });
    expect(result.debts.change).toBe(800);
    expect(describeDebtChange(result.debts, "CAD")).toMatch(/grew by/);
  });
});

describe("this month vs chart range", () => {
  it("computes the first visible month from the month before the window, and range from first start to last end", () => {
    const history: MonthlyHistoryEntry[] = [];
    for (let i = 0; i < 15; i++) {
      const d = new Date(2025, i, 1);
      const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      history.push(month({
        yearMonth: ym,
        netWorth: 10000 + i * 500,
        byAccount: [
          { slug: "chk", label: "Chequing", type: "checking", value: 10000 + i * 500 },
        ],
      }));
    }
    const months = computeNetWorthGrowth(
      { monthlyHistory: history, expenseTxns: [], incomeTxns: [] },
      { windowMonths: 12 },
    );
    expect(months).toHaveLength(12);
    expect(months[0].yearMonth).toBe("2025-04");
    expect(months[0].hasPrevious).toBe(true);
    expect(months[0].cash.change).toBe(500);

    const range = sumGrowthBreakdowns(months, months.map((m) => m.yearMonth));
    expect(range!.cash.start).toBe(10000 + 2 * 500);
    expect(range!.cash.end).toBe(10000 + 14 * 500);
    expect(range!.cash.change).toBe(12 * 500);
  });

  it("sums this-month rows independently of the chart-range total", () => {
    const history: MonthlyHistoryEntry[] = [
      month({
        yearMonth: "2026-08",
        netWorth: 10000,
        byAccount: [{ slug: "chk", label: "Chequing", type: "checking", value: 10000 }],
      }),
      month({
        yearMonth: "2026-09",
        netWorth: 11000,
        byAccount: [{ slug: "chk", label: "Chequing", type: "checking", value: 11000 }],
      }),
      month({
        yearMonth: "2026-10",
        netWorth: 13000,
        byAccount: [{ slug: "chk", label: "Chequing", type: "checking", value: 13000 }],
      }),
    ];
    const input: NetWorthGrowthInput = {
      monthlyHistory: history,
      expenseTxns: [],
      incomeTxns: [],
    };
    const months = computeNetWorthGrowth(input);
    expect(months[2].cash.change).toBe(2000);
    const range = sumGrowthBreakdowns(months, ["2026-09", "2026-10"]);
    expect(range!.cash.start).toBe(10000);
    expect(range!.cash.end).toBe(13000);
    expect(range!.cash.change).toBe(3000);
  });
});

describe("chart title", () => {
  it("reflects the selected 3M/6M/All range", () => {
    expect(formatGrowthChartTitle(3)).toBe("3-Month Trend");
    expect(formatGrowthChartTitle(6)).toBe("6-Month Trend");
    expect(formatGrowthChartTitle(0)).toBe("All-time Trend");
  });
});
