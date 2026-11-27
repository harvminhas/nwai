/**
 * Net savings card, drawer, and chat must each equal independently
 * computed balance changes (bank + card/debt, month-end vs prior month-end)
 * — not each other by copying the same helper result into both sides.
 */

import { describe, expect, test } from "vitest";
import { executeGetSavingsSummary } from "../lib/chat/executor";
import type { ExpenseTxnRecord, IncomeTxnRecord } from "../lib/extractTransactions";
import type { FinancialProfileCache } from "../lib/financialProfile";
import { computeMoneyCoachBreakdown } from "../lib/moneyCoach";
import { monthsForCashFlowAverage } from "../lib/cashFlowAverage";
import { netSavingsWindow } from "../lib/savingsForRange";
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
    accountBalanceHistory: [
      {
        slug: "td-1234",
        label: "TD Chequing",
        accountType: "checking",
        currency: "CAD",
        entries: [
          { yearMonth: "2026-06", balance: 10000 },
          { yearMonth: "2026-07", balance: 12000 },
          { yearMonth: "2026-08", balance: 11500 },
          { yearMonth: "2026-09", balance: 14000 },
        ],
      },
      {
        slug: "td-visa",
        label: "TD Visa",
        accountType: "credit",
        currency: "CAD",
        entries: [
          { yearMonth: "2026-06", balance: -3000 },
          { yearMonth: "2026-07", balance: -2500 },
          { yearMonth: "2026-08", balance: -2800 },
          { yearMonth: "2026-09", balance: -2000 },
        ],
      },
    ],
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

  // Independent: chequing change + card paid down, per month.
  // Jul: +2000 + 500 = 2500; Aug: −500 − 300 = −800; Sep: +2500 + 800 = 3300
  const independent = [2500, -800, 3300];
  const expected = independent.reduce((s, v) => s + v, 0) / independent.length;

  test("card, drawer, and chat each equal independently computed balance changes", () => {
    const card = computeMoneyCoachBreakdown(
      profile,
      [],
      profile.incomeTxns,
      profile.accountSnapshots,
      "CAD",
      new Map(),
      months,
    );
    const savingsCard = card.buckets.find((b) => b.bucket === "savings")!.monthlyAverage;

    const drawer = netSavingsWindow(
      profile,
      monthsForCashFlowAverage(months, { rangeMonths: months }),
    );

    const chat = executeGetSavingsSummary(profile, { range: months.join(",") }, emptyReviews);
    expect(chat.ok).toBe(true);

    expect(savingsCard).toBeCloseTo(expected, 5);
    expect(drawer.monthlyAverage.total).toBeCloseTo(expected, 5);
    expect(drawer.monthlyBreakdown.map((m) => m.total)).toEqual(independent);
    expect(chat.data.net_savings).toBeCloseTo(expected, 5);
    // Savings rate is Net savings / income, not leftover / income.
    expect(card.savingsRate).toBeCloseTo(expected / 5000, 8);
    expect(chat.data.savings_rate).toBeCloseTo(expected / 5000, 8);
  });

  test("drawer month rows sum to the card", () => {
    const drawer = netSavingsWindow(profile, months);
    const rows = drawer.monthlyBreakdown.filter((m) => m.measured);
    const mean = rows.reduce((s, m) => s + m.total, 0) / rows.length;
    expect(mean).toBeCloseTo(drawer.monthlyAverage.total, 8);
    for (const month of drawer.monthlyBreakdown) {
      const accounts = [...month.accounts.cashAccounts, ...month.accounts.debtAccounts];
      expect(accounts.reduce((s, a) => s + a.change, 0)).toBeCloseTo(month.total, 8);
    }
  });

  test("savingsConfirmedItems does not change Net savings", () => {
    const withConfirm: UserReviewContext = {
      ...emptyReviews,
      savingsConfirmedItems: new Map([["life-insurance", true]]),
    };
    const chatWith = executeGetSavingsSummary(profile, { range: months.join(",") }, withConfirm);
    const chatWithout = executeGetSavingsSummary(profile, { range: months.join(",") }, emptyReviews);
    expect(chatWith.data.net_savings).toBe(chatWithout.data.net_savings);
  });
});
