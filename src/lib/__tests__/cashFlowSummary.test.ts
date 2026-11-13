import { describe, expect, it } from "vitest";
import type { ExpenseTxnRecord, IncomeTxnRecord } from "../extractTransactions";
import {
  buildCashFlowSummary,
  buildCashFlowView,
  computeSavingsRate,
  formatCashFlowMonthLabel,
  formatCashFlowSummarySentence,
  formatSavingsRateSentence,
  getMonthlyCashFlow,
  selectCashFlowMonth,
} from "../cashFlowSummary";
import { buildIncomeSummary } from "../incomeSummary";
import { computeMoneyCoachBreakdown } from "../moneyCoach";
import { getCurrentMonth } from "../monthAnchor";
import { buildSpendingSummary } from "../spendingSummary";
import type { FinancialProfileCache } from "../financialProfile";

function sumAmounts(rows: Array<{ amount: number }>): number {
  return rows.reduce((s, r) => s + r.amount, 0);
}

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

describe("computeSavingsRate", () => {
  it("is leftover divided by money in", () => {
    expect(computeSavingsRate(10000, 8200)).toBeCloseTo(0.18);
  });

  it("returns null when income is zero", () => {
    expect(computeSavingsRate(0, 500)).toBeNull();
    expect(formatSavingsRateSentence(null)).toBeNull();
  });

  it("returns null when income is negative", () => {
    expect(computeSavingsRate(-200, 100)).toBeNull();
  });

  it("formats a kept-percent sentence and an overspend sentence", () => {
    expect(formatSavingsRateSentence(0.18)).toBe("You kept 18% of what you earned");
    expect(formatSavingsRateSentence(-0.12)).toBe("You spent 12% more than you earned");
  });
});

describe("selectCashFlowMonth", () => {
  const months = [
    { yearMonth: "2026-08" },
    { yearMonth: "2026-09" },
    { yearMonth: "2026-10" },
  ];

  it("defaults to the latest complete month", () => {
    expect(selectCashFlowMonth(months, null, "2026-11")).toBe("2026-10");
    expect(selectCashFlowMonth(months, undefined, "2026-11")).toBe("2026-10");
  });

  it("skips the unfinished current month when defaulting", () => {
    expect(
      selectCashFlowMonth(
        [{ yearMonth: "2026-09" }, { yearMonth: "2026-10" }, { yearMonth: "2026-11" }],
        null,
        "2026-11",
      ),
    ).toBe("2026-10");
  });

  it("keeps an explicit click on the current unfinished month", () => {
    expect(
      selectCashFlowMonth(
        [{ yearMonth: "2026-10" }, { yearMonth: "2026-11" }],
        "2026-11",
        "2026-11",
      ),
    ).toBe("2026-11");
  });

  it("keeps a click that is still in range", () => {
    expect(selectCashFlowMonth(months, "2026-08", "2026-11")).toBe("2026-08");
  });

  it("snaps to the latest complete month when the click falls out of range", () => {
    expect(selectCashFlowMonth(months, "2026-01", "2026-11")).toBe("2026-10");
  });

  it("returns null when there are no months", () => {
    expect(selectCashFlowMonth([], "2026-10", "2026-11")).toBeNull();
  });
});

describe("formatCashFlowMonthLabel", () => {
  it("labels the unfinished current month as so far", () => {
    expect(formatCashFlowMonthLabel("2026-11", { currentMonth: "2026-11" })).toBe(
      "Nov 2026 so far",
    );
    expect(
      formatCashFlowMonthLabel("2026-11", { short: true, currentMonth: "2026-11" }),
    ).toBe("Nov so far");
    expect(formatCashFlowMonthLabel("2026-10", { currentMonth: "2026-11" })).toBe(
      "Oct 2026",
    );
  });

  it("uses so far in the summary sentence for the current month", () => {
    expect(
      formatCashFlowSummarySentence("2026-11", 100, 40, 60, "CAD", "2026-11"),
    ).toMatch(/Nov 2026 so far/);
  });
});

describe("transfer exclusion", () => {
  it("drops inter-account transfers and card servicing from money-out categories", () => {
    const summary = buildCashFlowSummary({
      expenseTxns: [
        expense({ category: "Groceries", amount: 200, txMonth: "2026-10" }),
        expense({ category: "Transfers", amount: 800, txMonth: "2026-10" }),
        expense({ category: "Card Servicing", amount: 400, txMonth: "2026-10", merchant: "VISA PAYMENT" }),
      ],
      incomeTxns: [],
      homeCurrency: "CAD",
    });

    const month = summary.months.find((m) => m.yearMonth === "2026-10")!;
    expect(month.moneyOut).toBe(200);
    expect(month.categories.map((c) => c.name)).toEqual(["Groceries"]);
    expect(month.categories[0].amount).toBe(200);
  });

  it("drops transfer deposits from money-in and keeps Other-category credits", () => {
    const summary = buildCashFlowSummary({
      expenseTxns: [],
      incomeTxns: [
        income({ source: "Acme Corp", amount: 5000, txMonth: "2026-10", category: "Salary" }),
        income({ source: "Side gig", amount: 400, txMonth: "2026-10", category: "Other" }),
        income({ source: "TFR-TO SAVINGS", amount: 1200, txMonth: "2026-10", category: "Transfer In" }),
        income({ source: "SEND E-TFR", amount: 90, txMonth: "2026-10" }),
      ],
      homeCurrency: "CAD",
    });

    const month = summary.months.find((m) => m.yearMonth === "2026-10")!;
    expect(month.moneyIn).toBe(5400);
    expect(month.sources.map((s) => s.name).sort()).toEqual(["Acme Corp", "Side gig"]);
    expect(sumAmounts(month.sources)).toBe(5400);
  });

  it("does not let transfers inflate leftover", () => {
    const summary = buildCashFlowSummary({
      expenseTxns: [
        expense({ category: "Groceries", amount: 3000, txMonth: "2026-10" }),
        expense({ category: "Transfers", amount: 1500, txMonth: "2026-10" }),
      ],
      incomeTxns: [
        income({ source: "Acme Corp", amount: 5000, txMonth: "2026-10" }),
        income({ source: "TFR-FR SAVINGS", amount: 2000, txMonth: "2026-10", category: "Transfer In" }),
      ],
      homeCurrency: "CAD",
    });

    const month = summary.months.find((m) => m.yearMonth === "2026-10")!;
    expect(month.moneyIn).toBe(5000);
    expect(month.moneyOut).toBe(3000);
    expect(month.leftover).toBe(2000);
    expect(month.savingsRate).toBeCloseTo(0.4);
  });
});

describe("buildCashFlowView month selection and range", () => {
  const summary = buildCashFlowSummary({
    expenseTxns: [
      expense({ category: "Groceries", amount: 3500, txMonth: "2026-05" }),
      expense({ category: "Groceries", amount: 3600, txMonth: "2026-06" }),
      expense({ category: "Groceries", amount: 3000, txMonth: "2026-07" }),
      expense({ category: "Groceries", amount: 3200, txMonth: "2026-08" }),
      expense({ category: "Groceries", amount: 3100, txMonth: "2026-09" }),
      expense({ category: "Groceries", amount: 2800, txMonth: "2026-10" }),
    ],
    incomeTxns: [
      income({ source: "Acme Corp", amount: 4200, txMonth: "2026-10" }),
    ],
    homeCurrency: "CAD",
  });

  it("defaults the selected month to the latest in the range", () => {
    const view = buildCashFlowView(summary, "6M", null);
    expect(view.selected?.yearMonth).toBe("2026-10");
    expect(view.visibleMonths.map((m) => m.yearMonth)).toEqual([
      "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10",
    ]);
    expect(view.savingsRateSentence).toBe("You kept 33% of what you earned");
    expect(view.summarySentence).toContain("Oct 2026");
  });

  it("keeps a clicked month and snaps when the range hides it", () => {
    const kept = buildCashFlowView(summary, "6M", "2026-07");
    expect(kept.selected?.yearMonth).toBe("2026-07");

    const ytd = buildCashFlowView(summary, "YTD", "2026-07");
    expect(ytd.selected?.yearMonth).toBe("2026-07");
    expect(ytd.visibleMonths[0].yearMonth).toBe("2026-05");

    const snapped = buildCashFlowView(summary, "6M", "2025-12");
    expect(snapped.selected?.yearMonth).toBe("2026-10");
  });

  it("attaches a vs-average pill for a category that moved", () => {
    const view = buildCashFlowView(summary, "6M", "2026-10");
    const groceries = view.categories.find((c) => c.name === "Groceries");
    expect(groceries).toBeTruthy();
    expect(groceries!.vsAvgPct).not.toBeNull();
    expect(groceries!.vsAvgPct as number).toBeLessThan(0);
  });

  it("labels a single-account source with resolveAccountDisplayName", () => {
    const named = buildCashFlowSummary({
      expenseTxns: [],
      incomeTxns: [
        income({ source: "Acme Corp", amount: 5000, txMonth: "2026-10", accountSlug: "checking_1234" }),
      ],
      homeCurrency: "CAD",
      accountSnapshots: [
        { slug: "checking_1234", accountName: "Everyday Chequing", bankName: "TD" },
      ],
    });
    const month = named.months.find((m) => m.yearMonth === "2026-10")!;
    expect(month.sources[0].accountLabel).toContain("Everyday Chequing");
  });
});

describe("totals match dashboard helpers", () => {
  const expenseTxns = [
    expense({ category: "Groceries", amount: 1000, txMonth: "2026-10" }),
    expense({ category: "Taxes", amount: 500, txMonth: "2026-10" }),
    expense({ category: "Investments & Savings", amount: 300, txMonth: "2026-10" }),
    expense({ category: "Transfers", amount: 400, txMonth: "2026-10" }),
  ];
  const incomeTxns = [
    income({ source: "MAM", amount: 5000, txMonth: "2026-10", category: "Salary" }),
    income({ source: "CRA GST", amount: 2000, txMonth: "2026-10", category: "Other" }),
    income({ source: "TFR-TO CHEQUING", amount: 800, txMonth: "2026-10", category: "Transfer In" }),
  ];
  const accountSnapshots = [
    { slug: "checking_1234", accountName: "Chequing", bankName: "TD" },
  ];

  it("uses buildIncomeSummary and buildSpendingSummary so Other income counts and investments do not", () => {
    const cash = buildCashFlowSummary({
      expenseTxns,
      incomeTxns,
      homeCurrency: "CAD",
      accountSnapshots,
    });
    const income = buildIncomeSummary(incomeTxns, accountSnapshots as never, "CAD");
    const spending = buildSpendingSummary(
      expenseTxns,
      accountSnapshots as never,
      [],
      [],
      {},
      "CAD",
      ["2026-10"],
    );

    const month = cash.months.find((m) => m.yearMonth === "2026-10")!;
    const incomeMonth = income.monthlyHistory.find((m) => m.yearMonth === "2026-10")!;
    const spendingMonth = spending.monthlyHistory.find((m) => m.yearMonth === "2026-10")!;

    expect(month.moneyIn).toBe(incomeMonth.total);
    expect(month.moneyIn).toBe(7000);
    expect(month.moneyOut).toBe(spendingMonth.total);
    expect(month.moneyOut).toBe(1500);
    expect(month.leftover).toBe(5500);
    expect(sumAmounts(month.sources)).toBe(month.moneyIn);
    expect(sumAmounts(month.categories)).toBe(month.moneyOut);
    expect(month.sources.map((s) => s.name).sort()).toEqual(["CRA GST", "MAM"]);
    expect(month.categories.some((c) => c.name === "Investments & Savings")).toBe(false);
  });

  it("equals computeMoneyCoachBreakdown income, spending, leftover, and net savings for the same month", () => {
    const input = {
      expenseTxns,
      incomeTxns,
      homeCurrency: "CAD",
      accountSnapshots,
    };
    const month = getMonthlyCashFlow(input, "2026-10");
    const cash = buildCashFlowSummary(input);
    const fromSeries = cash.months.find((m) => m.yearMonth === "2026-10")!;

    const profile = {
      monthlyHistory: [
        {
          yearMonth: "2026-10",
          incomeTotal: 5000,
          incomeTotalAllCredits: 7000,
          expensesTotal: 2200,
          coreExpensesTotal: 1800,
          debtPaymentsTotal: 0,
          cardServicingPaymentsTotal: 0,
          minDebtPaymentsTotal: 0,
          totalAssets: 0,
          totalDebts: 0,
          netWorth: 0,
        },
      ],
      expenseTxns,
      incomeTxns,
      coverage: {
        monthsCovered: 1,
        monthsSpan: 1,
        coveragePct: 100,
        missingMonths: [],
      },
      debtPaymentHistory: [],
      accountBalanceHistory: [],
      fxRates: {},
      accountSnapshots,
    } as unknown as FinancialProfileCache;

    const coach = computeMoneyCoachBreakdown(
      profile,
      [],
      incomeTxns,
      accountSnapshots as never,
      "CAD",
      new Map(),
      ["2026-10"],
    );
    const netSavings = coach.buckets.find((b) => b.bucket === "savings")!.monthlyAverage;

    expect(fromSeries.moneyIn).toBe(month.moneyIn);
    expect(fromSeries.moneyOut).toBe(month.moneyOut);
    expect(fromSeries.leftover).toBe(month.leftover);
    expect(coach.incomeAmount).toBe(month.moneyIn);
    expect(coach.totalSpending).toBe(month.moneyOut);
    expect(netSavings).toBe(month.leftover);
    expect(netSavings).toBe(month.moneyIn - month.moneyOut);
    expect(month.leftover).toBe(5500);
  });

  it("matches Income typical, Spending typical, and dashboard averages for the same months", () => {
    const months = ["2026-08", "2026-09", "2026-10"];
    const income = buildIncomeSummary(
      incomeTxns,
      accountSnapshots as never,
      "CAD",
      new Map(),
      months,
    );
    const spending = buildSpendingSummary(
      expenseTxns,
      accountSnapshots as never,
      [],
      [],
      {},
      "CAD",
      months,
    );
    const coach = computeMoneyCoachBreakdown(
      {
        monthlyHistory: months.map((yearMonth) => ({
          yearMonth,
          incomeTotal: 0,
          incomeTotalAllCredits: 0,
          expensesTotal: 0,
          coreExpensesTotal: 0,
          debtPaymentsTotal: 0,
          cardServicingPaymentsTotal: 0,
          minDebtPaymentsTotal: 0,
          totalAssets: 0,
          totalDebts: 0,
          netWorth: 0,
        })),
        expenseTxns,
        incomeTxns,
        coverage: {
          monthsCovered: 3,
          monthsSpan: 3,
          coveragePct: 100,
          missingMonths: [],
        },
        debtPaymentHistory: [],
        accountBalanceHistory: [],
        fxRates: {},
        accountSnapshots,
      } as unknown as FinancialProfileCache,
      [],
      incomeTxns,
      accountSnapshots as never,
      "CAD",
      new Map(),
      months,
    );
    expect(income.typicalMonthly).toBeCloseTo(coach.incomeAmount, 5);
    expect(spending.typicalMonthly).toBeCloseTo(coach.totalSpending, 5);
    expect(coach.buckets.find((b) => b.bucket === "savings")!.monthlyAverage).toBeCloseTo(
      coach.incomeAmount - coach.totalSpending,
      5,
    );
    expect(coach.months).toEqual(months);
  });

  it("computes spending for the current unfinished month, not $0", () => {
    const current = getCurrentMonth();
    const month = getMonthlyCashFlow(
      {
        expenseTxns: [expense({ category: "Groceries", amount: 80, txMonth: current })],
        incomeTxns: [income({ amount: 900, txMonth: current })],
        homeCurrency: "CAD",
      },
      current,
    );
    expect(month.moneyIn).toBe(900);
    expect(month.moneyOut).toBe(80);
    expect(month.leftover).toBe(820);
  });

  it("computes spending for months older than the last 12 complete months", () => {
    const expenseTxns = [
      expense({ category: "Groceries", amount: 40, txMonth: "2023-01" }),
      ...Array.from({ length: 22 }, (_, i) => {
        const d = new Date(2025, 0 + i, 15);
        const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        return expense({ category: "Groceries", amount: 10, txMonth: ym });
      }),
    ];
    const month = getMonthlyCashFlow(
      {
        expenseTxns,
        incomeTxns: [income({ amount: 300, txMonth: "2023-01" })],
        homeCurrency: "CAD",
      },
      "2023-01",
    );
    expect(month.moneyIn).toBe(300);
    expect(month.moneyOut).toBe(40);
    expect(month.leftover).toBe(260);
    expect(
      buildSpendingSummary(expenseTxns, [] as never, [], [], {}, "CAD").monthlyHistory.find(
        (m) => m.yearMonth === "2023-01",
      ),
    ).toBeUndefined();
  });
});

describe("at-a-glance bar totals money in", () => {
  it("splits spending plus leftover so glance amounts equal money in", () => {
    const summary = buildCashFlowSummary({
      expenseTxns: [expense({ category: "Groceries", amount: 3000, txMonth: "2026-10" })],
      incomeTxns: [income({ source: "Acme Corp", amount: 5000, txMonth: "2026-10" })],
      homeCurrency: "CAD",
    });
    const view = buildCashFlowView(summary, "6M", "2026-10");
    expect(sumAmounts(view.categories)).toBe(view.selected!.moneyOut);
    expect(sumAmounts(view.sources)).toBe(view.selected!.moneyIn);
    expect(sumAmounts(view.glance)).toBeCloseTo(view.selected!.moneyIn);
    expect(view.glance.find((g) => g.isLeftover)?.amount).toBe(2000);
  });

  it("keeps glance totaling money in when spending exceeds earnings", () => {
    const summary = buildCashFlowSummary({
      expenseTxns: [expense({ category: "Groceries", amount: 1200, txMonth: "2026-10" })],
      incomeTxns: [income({ source: "Acme Corp", amount: 1000, txMonth: "2026-10" })],
      homeCurrency: "CAD",
    });
    const view = buildCashFlowView(summary, "6M", "2026-10");
    expect(sumAmounts(view.categories)).toBe(1200);
    expect(sumAmounts(view.glance)).toBeCloseTo(1000);
    expect(view.glance.find((g) => g.isLeftover)?.amount).toBe(-200);
    const barShare = view.glance
      .filter((g) => g.amount > 0)
      .reduce((s, g) => s + g.share, 0);
    expect(barShare).toBeCloseTo(1.2);
  });
});
