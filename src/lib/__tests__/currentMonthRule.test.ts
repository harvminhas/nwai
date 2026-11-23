/**
 * Harvinder's current-month rule:
 * - Single-area histories include the current month flagged in progress
 * - Averages / combined income+spending use complete months only
 * - Same complete month → same in / out / leftover everywhere
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ExpenseTxnRecord, IncomeTxnRecord } from "../extractTransactions";
import { completeMonthsWithData, monthsForCashFlowAverage } from "../cashFlowAverage";
import {
  averageCashFlow,
  cashFlowInputFromProfile,
  computeMonthlyCashFlowSeries,
  computeSavingsRate,
  getMonthlyCashFlow,
} from "../monthlyCashFlow";
import { buildCashFlowSummary } from "../cashFlowSummary";
import { buildIncomeSummary } from "../incomeSummary";
import { buildSpendingSummary } from "../spendingSummary";
import { computeMoneyCoachBreakdown } from "../moneyCoach";
import { getCurrentMonth } from "../monthAnchor";
import { getSavingsRate } from "../profileMetrics";
import { executeGetSavingsSummary } from "../chat/executor";
import type { FinancialProfileCache } from "../financialProfile";
import type { UserReviewContext } from "../userReviewContext";

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

const completeYm = "2026-10";
const currentYm = "2026-11";
const expenseTxns = [
  expense({ category: "Groceries", amount: 1000, txMonth: "2026-08" }),
  expense({ category: "Groceries", amount: 1100, txMonth: "2026-09" }),
  expense({ category: "Groceries", amount: 1200, txMonth: completeYm }),
  expense({ category: "Groceries", amount: 50, txMonth: currentYm }),
];
const incomeTxns = [
  income({ amount: 5000, txMonth: "2026-08" }),
  income({ amount: 5000, txMonth: "2026-09" }),
  income({ amount: 5000, txMonth: completeYm }),
  income({ amount: 200, txMonth: currentYm }),
];
const accountSnapshots = [
  { slug: "checking_1234", accountName: "Chequing", bankName: "TD" },
];

function historyRow(yearMonth: string, moneyIn: number, moneyOut: number) {
  return {
    yearMonth,
    incomeTotal: moneyIn,
    incomeTotalAllCredits: moneyIn,
    expensesTotal: moneyOut,
    coreExpensesTotal: moneyOut,
    debtPaymentsTotal: 0,
    cardServicingPaymentsTotal: 0,
    minDebtPaymentsTotal: 0,
    totalAssets: 0,
    totalDebts: 0,
    netWorth: 0,
  };
}

function profileFor(): FinancialProfileCache {
  return {
    monthlyHistory: [
      historyRow("2026-08", 5000, 1000),
      historyRow("2026-09", 5000, 1100),
      historyRow(completeYm, 5000, 1200),
      historyRow(currentYm, 200, 50),
    ],
    allTxMonths: ["2026-08", "2026-09", completeYm, currentYm],
    latestTxMonth: currentYm,
    expenseTxns,
    incomeTxns,
    coverage: {
      monthsCovered: 4,
      monthsSpan: 4,
      coveragePct: 100,
      missingMonths: [],
    },
    debtPaymentHistory: [],
    accountBalanceHistory: [],
    fxRates: {},
    accountSnapshots,
    homeCurrency: "CAD",
    accountStatusRecords: [],
    statementHistory: [],
  } as unknown as FinancialProfileCache;
}

const emptyReviews: UserReviewContext = {
  incomeDepositReviews: new Map(),
  debtPaymentReviews: [],
  savingsConfirmedItems: new Map(),
};

beforeEach(() => {
  (globalThis as { __TEST_NOW__?: Date }).__TEST_NOW__ = new Date("2026-11-15T12:00:00");
});

afterEach(() => {
  delete (globalThis as { __TEST_NOW__?: Date }).__TEST_NOW__;
});

describe("current-month rule — complete-month consistency", () => {
  it("gives identical in/out/leftover for a complete month across coach, cash flow, drawer, chat, and profileMetrics", () => {
    const input = cashFlowInputFromProfile({
      expenseTxns,
      incomeTxns,
      homeCurrency: "CAD",
      accountSnapshots,
      debtPaymentHistory: [],
    });
    const month = getMonthlyCashFlow(input, completeYm);
    const cash = buildCashFlowSummary(input).months.find((m) => m.yearMonth === completeYm)!;
    const profile = profileFor();
    const coach = computeMoneyCoachBreakdown(
      profile,
      [],
      incomeTxns,
      accountSnapshots as never,
      "CAD",
      new Map(),
      [completeYm],
    );
    const drawer = averageCashFlow(input, { rangeMonths: [completeYm] });
    const chat = executeGetSavingsSummary(profile, { range: `month:${completeYm}` }, emptyReviews);
    const rate = getSavingsRate(profile, completeYm);

    expect(cash.moneyIn).toBe(month.moneyIn);
    expect(cash.moneyOut).toBe(month.moneyOut);
    expect(cash.leftover).toBe(month.leftover);
    expect(coach.incomeAmount).toBe(month.moneyIn);
    expect(coach.totalSpending).toBe(month.moneyOut);
    expect(coach.buckets.find((b) => b.bucket === "savings")!.monthlyAverage).toBe(month.leftover);
    expect(drawer.moneyIn).toBe(month.moneyIn);
    expect(drawer.moneyOut).toBe(month.moneyOut);
    expect(drawer.leftover).toBe(month.leftover);
    expect(chat.ok).toBe(true);
    const chatData = chat.data as {
      money_in: number;
      money_out: number;
      leftover: number;
      savings_rate: number | null;
    };
    expect(chatData.money_in).toBe(month.moneyIn);
    expect(chatData.money_out).toBe(month.moneyOut);
    expect(chatData.leftover).toBe(month.leftover);
    expect(chatData.savings_rate).toBe(month.savingsRate);
    expect(rate).toBe(Math.round((computeSavingsRate(month.moneyIn, month.moneyOut) ?? 0) * 100));
    expect(month.moneyIn).toBe(5000);
    expect(month.moneyOut).toBe(1200);
    expect(month.leftover).toBe(3800);
  });
});

describe("current-month rule — averages exclude the current month", () => {
  it("drops the unfinished current month from monthsForCashFlowAverage and averageCashFlow", () => {
    const current = getCurrentMonth();
    expect(current).toBe(currentYm);
    const available = ["2026-08", "2026-09", completeYm, currentYm];
    expect(monthsForCashFlowAverage(available, { lastNComplete: 3 })).toEqual([
      "2026-08",
      "2026-09",
      completeYm,
    ]);
    expect(completeMonthsWithData(available)).not.toContain(currentYm);

    const avg = averageCashFlow(
      cashFlowInputFromProfile({
        expenseTxns,
        incomeTxns,
        homeCurrency: "CAD",
        accountSnapshots,
      }),
      { lastNComplete: 3 },
    );
    expect(avg.months).not.toContain(currentYm);
    expect(avg.moneyIn).toBeCloseTo((5000 + 5000 + 5000) / 3);
    expect(avg.moneyOut).toBeCloseTo((1000 + 1100 + 1200) / 3);
  });

  it("keeps the current month out of Cash Flow series and categoryVsAvg months", () => {
    const input = cashFlowInputFromProfile({
      expenseTxns,
      incomeTxns,
      homeCurrency: "CAD",
      accountSnapshots,
    });
    const series = computeMonthlyCashFlowSeries(input, { completeOnly: true });
    expect(series.map((m) => m.yearMonth)).not.toContain(currentYm);
    expect(buildCashFlowSummary(input).months.map((m) => m.yearMonth)).not.toContain(currentYm);
  });
});

describe("current-month rule — single-area histories include current month", () => {
  it("flags the current month in progress on Spending history", () => {
    const spending = buildSpendingSummary(
      expenseTxns,
      accountSnapshots as never,
      [],
      [],
      {},
      "CAD",
    );
    const currentRow = spending.monthlyHistory.find((m) => m.yearMonth === currentYm);
    expect(currentRow).toBeDefined();
    expect(currentRow!.isInProgress).toBe(true);
    expect(currentRow!.total).toBe(50);
    expect(spending.typicalMonthly).toBeCloseTo((1000 + 1100 + 1200) / 3);
  });

  it("flags the current month in progress on Income history", () => {
    const incomeSummary = buildIncomeSummary(incomeTxns, accountSnapshots as never, "CAD");
    const currentRow = incomeSummary.monthlyHistory.find((m) => m.yearMonth === currentYm);
    expect(currentRow).toBeDefined();
    expect(currentRow!.isInProgress).toBe(true);
    expect(currentRow!.total).toBe(200);
    expect(incomeSummary.typicalMonthly).toBeCloseTo((5000 + 5000 + 5000) / 3);
  });
});
