/**
 * Net savings card, drawer, and chat must each equal independently
 * computed leftover from getMonthlyCashFlow — not each other by copying
 * the same helper result into both sides of the assertion.
 */

import { describe, expect, test } from "vitest";
import { executeGetSavingsSummary } from "../lib/chat/executor";
import type { ExpenseTxnRecord, IncomeTxnRecord } from "../lib/extractTransactions";
import type { FinancialProfileCache } from "../lib/financialProfile";
import { computeMoneyCoachBreakdown } from "../lib/moneyCoach";
import {
  averageCashFlow,
  cashFlowInputFromProfile,
  getMonthlyCashFlow,
} from "../lib/monthlyCashFlow";
import type { UserReviewContext } from "../lib/userReviewContext";

function makeProfile(
  incomeTxns: IncomeTxnRecord[],
  expenseTxns: ExpenseTxnRecord[],
): FinancialProfileCache {
  const months = ["2026-07", "2026-08", "2026-09"];
  return {
    updatedAt: new Date().toISOString(),
    sourceVersion: "test",
    schemaVersion: "56",
    expenseTxns,
    incomeTxns,
    accountSnapshots: [
      {
        slug: "td-1234",
        bankName: "TD",
        accountName: "TD Chequing",
        accountType: "checking",
        balance: 5000,
        currency: "CAD",
        accountId: "1234",
        statementMonth: "2026-09",
      },
    ],
    allTxMonths: months,
    latestTxMonth: "2026-09",
    monthlyHistory: months.map((yearMonth) => ({
      yearMonth,
      expensesTotal: 1000,
      coreExpensesTotal: 900,
      incomeTotal: 5000,
      incomeTotalAllCredits: 5000,
      debtPaymentsTotal: 0,
      cardServicingPaymentsTotal: 0,
      minDebtPaymentsTotal: 0,
    })),
    netWorth: 5000,
    homeCurrency: "CAD",
    accountBalanceHistory: [],
    debtPaymentHistory: [],
    cashIncomeEntries: [],
    cashCommitmentEntries: [],
    statementHistory: [],
    accountStatusRecords: [],
  } as unknown as FinancialProfileCache;
}

const emptyReviews: UserReviewContext = {
  incomeDepositReviews: new Map(),
  debtPaymentReviews: [],
  savingsConfirmedItems: new Map(),
};

describe("Net savings card vs drawer vs chat", () => {
  const months = ["2026-07", "2026-08", "2026-09"];
  const incomeTxns: IncomeTxnRecord[] = months.map((txMonth) => ({
    txMonth,
    date: `${txMonth}-01`,
    source: "ACME CORP",
    description: "ACME CORP",
    category: "Salary",
    amount: 5000,
    accountSlug: "td-1234",
    accountLabel: "TD Chequing",
    currency: "CAD",
  }));
  const expenseTxns: ExpenseTxnRecord[] = months.map((txMonth) => ({
    txMonth,
    date: `${txMonth}-15`,
    merchant: "Loblaws",
    category: "Groceries",
    amount: 1000,
    accountSlug: "td-1234",
    accountLabel: "TD Chequing",
    currency: "CAD",
  }));

  const profile = makeProfile(incomeTxns, expenseTxns);
  const input = cashFlowInputFromProfile(profile, emptyReviews);

  test("card, drawer, and chat each equal independently computed leftover", () => {
    const independent = months.map((m) => getMonthlyCashFlow(input, m).leftover);
    const expected = independent.reduce((s, v) => s + v, 0) / independent.length;
    expect(expected).toBeCloseTo(4000, 5);

    const card = computeMoneyCoachBreakdown(
      profile,
      [],
      profile.incomeTxns,
      profile.accountSnapshots,
      "CAD",
      new Map(),
      months,
    ).buckets.find((b) => b.bucket === "savings")!.monthlyAverage;

    const drawer = averageCashFlow(input, { rangeMonths: months }).leftover;

    const chat = executeGetSavingsSummary(profile, { range: months.join(",") }, emptyReviews);
    expect(chat.ok).toBe(true);

    expect(card).toBeCloseTo(expected, 5);
    expect(drawer).toBeCloseTo(expected, 5);
    expect(chat.data.leftover).toBeCloseTo(expected, 5);
  });

  test("savingsConfirmedItems does not change leftover Net savings", () => {
    const withConfirm: UserReviewContext = {
      ...emptyReviews,
      savingsConfirmedItems: new Map([["life-insurance", true]]),
    };
    const without = averageCashFlow(input, { rangeMonths: months }).leftover;
    const withItems = averageCashFlow(
      cashFlowInputFromProfile(profile, withConfirm),
      { rangeMonths: months },
    ).leftover;
    expect(withItems).toBe(without);

    const chatWith = executeGetSavingsSummary(profile, { range: months.join(",") }, withConfirm);
    const chatWithout = executeGetSavingsSummary(profile, { range: months.join(",") }, emptyReviews);
    expect(chatWith.data.leftover).toBe(chatWithout.data.leftover);
  });
});
