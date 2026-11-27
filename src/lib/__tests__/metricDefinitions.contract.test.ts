/**
 * METRIC DEFINITION CONTRACT — what each headline number MEANS.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ Changing any expectation in this file changes a product definition.      │
 * │ It requires Harvinder's explicit sign-off (in the PR, before merge).     │
 * │ If a code change makes this file fail, fix the code — do not edit the    │
 * │ numbers here to match the new output.                                    │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Why this exists: other suites assert what the code currently computes, so
 * when a PR changed Net savings from "balance changes" to "income − spending"
 * those tests were updated along with it and nothing failed. This suite is
 * written from the definitions alone:
 *   - every expected number below is worked out by hand in a comment;
 *   - fixtures are built here, not from shared test helpers;
 *   - nothing here imports a helper to compute an expected value.
 *
 * Definitions pinned:
 *   1. Net savings = change in bank/cash/savings balances + change in card and
 *      debt balances (paid down adds, borrowed subtracts), month-end vs prior
 *      month-end. Investment accounts and assets (house, car) are excluded.
 *      Transaction categories never matter. An 8,000 Asset purchase paid from
 *      chequing lowers Net savings by 8,000.
 *   2. Cash Flow Leftover = money in − money out. It is not Net savings.
 *   3. Monthly spending excludes transfers, card payments, interest,
 *      Investments & Savings, and Asset purchase.
 *   4. Dashboard card, Net savings drawer, savingsForRange, and chat return the
 *      same Net savings (and savings rate = Net savings ÷ money in) for the
 *      same months.
 *   5. The Daily spend tracker counts only its tracked themes (Eating, Getting
 *      around, Fun & entertainment — or the subset picked); never Housing or
 *      other spending.
 *
 * Run alone: npm run test:contracts
 */

import { describe, expect, it } from "vitest";
import type { ExpenseTxnRecord, IncomeTxnRecord } from "../extractTransactions";
import type { FinancialProfileCache } from "../financialProfile";
import type { UserReviewContext } from "../userReviewContext";
import { computeWindowSavings } from "../savingsCalculations";
import { computeSavingsForRange, netSavingsWindow } from "../savingsForRange";
import { computeMoneyCoachBreakdown } from "../moneyCoach";
import { executeGetSavingsSummary } from "../chat/executor";
import {
  averageCashFlow,
  cashFlowInputFromProfile,
  getMonthlyCashFlow,
} from "../monthlyCashFlow";
import { computeMonthSpending } from "../spendingMetrics";
import { themeAmountsFromSpending } from "../dailySpend";
import {
  buildDailySpendTrackerView,
  createTrackerRecord,
  TRACKED_DAILY_SPEND_THEME_IDS,
  trackedThemeTotal,
} from "../dailySpendTracker";

// ── Hand-built fixture ──────────────────────────────────────────────────────

const MONTHS = ["2026-07", "2026-08", "2026-09"];

function expense(txMonth: string, category: string, amount: number, merchant: string): ExpenseTxnRecord {
  return {
    txMonth,
    date: `${txMonth}-10`,
    merchant,
    category,
    amount,
    accountSlug: "chq",
    accountLabel: "Chequing",
    currency: "CAD",
  } as ExpenseTxnRecord;
}

function income(txMonth: string, amount: number): IncomeTxnRecord {
  return {
    txMonth,
    date: `${txMonth}-01`,
    source: "ACME PAYROLL",
    description: "ACME PAYROLL",
    category: "Salary",
    amount,
    accountSlug: "chq",
    accountLabel: "Chequing",
    currency: "CAD",
  } as IncomeTxnRecord;
}

/** Counted spending each month: 600 + 200 + 150 + 50 + 1800 + 100 = 2,900. */
function countedSpending(m: string): ExpenseTxnRecord[] {
  return [
    expense(m, "Groceries", 600, "LOBLAWS"),
    expense(m, "Dining", 200, "PIZZA PLACE"),
    expense(m, "Transportation", 150, "PETRO-CANADA"),
    expense(m, "Entertainment", 50, "CINEPLEX"),
    expense(m, "Rent", 1800, "LANDLORD"),
    expense(m, "Shopping", 100, "WINNERS"),
  ];
}

/** Money that moves but is not spending. */
function notSpending(m: string): ExpenseTxnRecord[] {
  return [
    expense(m, "Transfer Out", 500, "TFR-TO SAVINGS"),
    expense(m, "Card Servicing", 1200, "VISA PAYMENT THANK YOU"),
    expense(m, "Interest", 40, "INTEREST CHARGE"),
    expense(m, "CA: TFSA", 500, "TFSA CONTRIBUTION"),
    expense(m, "Investments & Savings", 250, "WEALTHSIMPLE"),
  ];
}

const DOWN_PAYMENT = expense("2026-09", "Asset purchase", 8000, "HONDA DOWN PAYMENT");

const EXPENSES: ExpenseTxnRecord[] = [
  ...MONTHS.flatMap((m) => [...countedSpending(m), ...notSpending(m)]),
  DOWN_PAYMENT,
];
const INCOME: IncomeTxnRecord[] = MONTHS.map((m) => income(m, 6000));

/**
 * Month-end balances. Net savings by hand (cash: current − prior;
 * debt: |prior| − |current|):
 *   Jul: chq +1,000; visa 2,000 − 2,500 = −500; loc 0          →   +500
 *   Aug: chq   +800; visa 2,500 − 1,500 = +1,000; loc +200     → +2,000
 *   Sep: chq −7,500 (8,000 down payment); visa 0; loc 0        → −7,500
 *   Average = (500 + 2,000 − 7,500) / 3 = −5,000 / 3
 * TFSA, house and car move every month and must add nothing.
 */
const BALANCES = [
  { slug: "chq", label: "Chequing", accountType: "checking", currency: "CAD",
    entries: [["2026-06", 10000], ["2026-07", 11000], ["2026-08", 11800], ["2026-09", 4300]] },
  { slug: "visa", label: "Visa", accountType: "credit", currency: "CAD",
    entries: [["2026-06", -2000], ["2026-07", -2500], ["2026-08", -1500], ["2026-09", -1500]] },
  { slug: "loc", label: "Line of credit", accountType: "line_of_credit", currency: "CAD",
    entries: [["2026-06", 3000], ["2026-07", 3000], ["2026-08", 2800], ["2026-09", 2800]] },
  { slug: "tfsa", label: "TFSA", accountType: "investment", currency: "CAD",
    entries: [["2026-06", 5000], ["2026-07", 5750], ["2026-08", 6500], ["2026-09", 7250]] },
  { slug: "house", label: "House", accountType: "property", currency: "CAD",
    entries: [["2026-06", 800000], ["2026-07", 805000], ["2026-08", 810000], ["2026-09", 815000]] },
  { slug: "car", label: "Honda", accountType: "vehicle", currency: "CAD",
    entries: [["2026-06", 0], ["2026-07", 0], ["2026-08", 0], ["2026-09", 32000]] },
].map((a) => ({
  ...a,
  entries: (a.entries as Array<[string, number]>).map(([yearMonth, balance]) => ({ yearMonth, balance })),
}));

const NET_BY_MONTH = [500, 2000, -7500];
const NET_AVERAGE = -5000 / 3;
const MONEY_IN = 6000;
const MONEY_OUT = 2900;
const LEFTOVER = 3100; // 6,000 − 2,900

function makeProfile(expenseTxns: ExpenseTxnRecord[] = EXPENSES): FinancialProfileCache {
  return {
    updatedAt: "2026-10-01T00:00:00.000Z",
    sourceVersion: "contract",
    schemaVersion: "56",
    expenseTxns,
    incomeTxns: INCOME,
    accountSnapshots: [
      { slug: "chq", bankName: "Bank", accountName: "Chequing", accountType: "checking",
        balance: 4300, currency: "CAD", accountId: "0001", statementMonth: "2026-09" },
    ],
    allTxMonths: MONTHS,
    latestTxMonth: "2026-09",
    monthlyHistory: MONTHS.map((yearMonth) => ({
      yearMonth,
      expensesTotal: MONEY_OUT,
      coreExpensesTotal: MONEY_OUT,
      incomeTotal: MONEY_IN,
      incomeTotalAllCredits: MONEY_IN,
      debtPaymentsTotal: 0,
      cardServicingPaymentsTotal: 0,
      minDebtPaymentsTotal: 0,
    })),
    netWorth: 0,
    homeCurrency: "CAD",
    fxRates: {},
    accountBalanceHistory: BALANCES,
    debtPaymentHistory: [],
    cashIncomeEntries: [],
    cashCommitmentEntries: [],
    statementHistory: [],
    accountStatusRecords: [],
  } as unknown as FinancialProfileCache;
}

const NO_REVIEWS: UserReviewContext = {
  incomeDepositReviews: new Map(),
  debtPaymentReviews: [],
  savingsConfirmedItems: new Map(),
};

// ── 1. Net savings ──────────────────────────────────────────────────────────

describe("contract: Net savings = bank/cash + card/debt balance changes only", () => {
  const profile = makeProfile();

  it("each month is the balance change of cash, card and debt accounts", () => {
    const w = netSavingsWindow(profile, MONTHS);
    expect(w.monthlyBreakdown.map((m) => m.total)).toEqual(NET_BY_MONTH);
    expect(w.monthlyAverage.total).toBeCloseTo(NET_AVERAGE, 6);
  });

  it("excludes investment accounts and assets (house, car)", () => {
    const w = netSavingsWindow(profile, MONTHS);
    const slugs = new Set(
      w.monthlyBreakdown.flatMap((m) => [...m.accounts.cashAccounts, ...m.accounts.debtAccounts].map((a) => a.slug)),
    );
    expect([...slugs].sort()).toEqual(["chq", "loc", "visa"]);
    // Only the investment/asset accounts → nothing to measure, Net savings 0.
    const onlyAssets = computeWindowSavings(
      [], BALANCES.filter((a) => ["tfsa", "house", "car"].includes(a.slug)), [], MONTHS,
    );
    expect(onlyAssets.monthlyAverage.total).toBe(0);
  });

  it("an 8,000 Asset purchase paid from chequing lowers that month's Net savings", () => {
    const sep = netSavingsWindow(profile, ["2026-09"]).monthlyBreakdown[0];
    expect(sep.netCashChange).toBe(-7500);
    expect(sep.total).toBe(-7500);
  });

  it("categories are irrelevant: recategorising or dropping every transaction changes nothing", () => {
    const relabelled = EXPENSES.map((t) => ({ ...t, category: "Other" }) as ExpenseTxnRecord);
    const asCash = EXPENSES.map((t) =>
      t === DOWN_PAYMENT ? ({ ...t, category: "Cash & ATM" } as ExpenseTxnRecord) : t,
    );
    for (const txns of [relabelled, asCash, []]) {
      const w = netSavingsWindow(makeProfile(txns), MONTHS);
      expect(w.monthlyBreakdown.map((m) => m.total)).toEqual(NET_BY_MONTH);
    }
  });

  it("is not income − spending", () => {
    expect(netSavingsWindow(profile, MONTHS).monthlyAverage.total).not.toBeCloseTo(LEFTOVER, 0);
  });
});

// ── 2. Cash Flow Leftover ───────────────────────────────────────────────────

describe("contract: Cash Flow Leftover = money in − money out", () => {
  const input = cashFlowInputFromProfile(makeProfile());

  it("per month", () => {
    for (const m of MONTHS) {
      const cf = getMonthlyCashFlow(input, m);
      expect(cf.moneyIn).toBeCloseTo(MONEY_IN, 6);
      expect(cf.moneyOut).toBeCloseTo(MONEY_OUT, 6);
      expect(cf.leftover).toBeCloseTo(LEFTOVER, 6);
    }
  });

  it("3-month average", () => {
    const avg = averageCashFlow(input, { rangeMonths: MONTHS });
    expect(avg.months).toEqual(MONTHS);
    expect(avg.leftover).toBeCloseTo(LEFTOVER, 6);
    expect(avg.leftover).toBeCloseTo(avg.moneyIn - avg.moneyOut, 6);
  });
});

// ── 3. Monthly spending ─────────────────────────────────────────────────────

describe("contract: monthly spending excludes non-spending money movement", () => {
  it("counts only real spending (2,900), not transfers, card payments, interest, investments or asset purchases", () => {
    for (const m of MONTHS) {
      const s = computeMonthSpending(m, EXPENSES, { homeCurrency: "CAD", fxRates: {} });
      expect(s.total).toBeCloseTo(MONEY_OUT, 6);
      const cats = s.lines.map((l) => l.category);
      for (const excluded of ["Transfer Out", "Card Servicing", "Interest", "CA: TFSA", "Investments & Savings", "Asset purchase"]) {
        expect(cats).not.toContain(excluded);
      }
    }
  });

  it("a month with only excluded movement has zero spending", () => {
    const onlyMoves = [...notSpending("2026-07"), { ...DOWN_PAYMENT, txMonth: "2026-07", date: "2026-07-10" } as ExpenseTxnRecord];
    expect(computeMonthSpending("2026-07", onlyMoves, { homeCurrency: "CAD", fxRates: {} }).total).toBe(0);
  });
});

// ── 4. One number everywhere ────────────────────────────────────────────────

describe("contract: card, drawer, savingsForRange and chat agree for the same months", () => {
  const profile = makeProfile();

  it("all return the hand-computed Net savings and savings rate", () => {
    const card = computeMoneyCoachBreakdown(
      profile, [], profile.incomeTxns, profile.accountSnapshots, "CAD", new Map(), MONTHS,
    );
    const cardNet = card.buckets.find((b) => b.bucket === "savings")!.monthlyAverage;
    const drawer = netSavingsWindow(profile, MONTHS).monthlyAverage.total;
    const range = computeSavingsForRange(profile, NO_REVIEWS, MONTHS);
    const chat = executeGetSavingsSummary(profile, { range: MONTHS.join(",") }, NO_REVIEWS);
    expect(chat.ok).toBe(true);
    const chatData = (chat as { data: Record<string, number> }).data;

    for (const value of [cardNet, drawer, range, chatData.net_savings]) {
      expect(value).toBeCloseTo(NET_AVERAGE, 6);
    }
    expect(card.savingsRate).toBeCloseTo(NET_AVERAGE / MONEY_IN, 8);
    expect(chatData.savings_rate).toBeCloseTo(NET_AVERAGE / MONEY_IN, 8);
    // Chat reports Leftover separately and it is the Cash Flow number.
    expect(chatData.leftover).toBeCloseTo(LEFTOVER, 6);
    expect(chatData.money_out).toBeCloseTo(MONEY_OUT, 6);
  });
});

// ── 5. Daily spend tracker ──────────────────────────────────────────────────

describe("contract: Daily spend tracker covers its tracked themes only", () => {
  // Tracked themes each month: Eating 600 + 200, Getting around 150, Fun 50 = 1,000.
  // Housing (Rent 1,800) and Shopping (100) are never in the tracker.
  const TODAY = new Date(2026, 9, 15); // Oct 15, 2026
  const OCT = [expense("2026-10", "Groceries", 300, "LOBLAWS"), expense("2026-10", "Rent", 1800, "LANDLORD")];
  const txns = [...EXPENSES, ...OCT];

  it("tracked themes are Eating, Getting around, Fun & entertainment", () => {
    expect([...TRACKED_DAILY_SPEND_THEME_IDS].sort()).toEqual(["food", "fun", "getting-around"]);
  });

  it("tracked total excludes Housing and other spending", () => {
    const spend = computeMonthSpending("2026-08", EXPENSES, { homeCurrency: "CAD", fxRates: {} });
    expect(trackedThemeTotal(themeAmountsFromSpending(spend))).toBeCloseTo(1000, 6);
  });

  it("finished months and pace count all tracked themes, never Housing", () => {
    const record = createTrackerRecord({
      targetDaily: 25, usualDailyAtStart: 33, usualByThemeAtStart: {}, currentYm: "2026-07", today: TODAY,
    });
    const view = buildDailySpendTrackerView(record, { expenseTxns: txns, fxRates: {}, currency: "CAD", today: TODAY });
    expect(view.finishedMonths.map((r) => [r.yearMonth, r.actualMonth])).toEqual([
      ["2026-08", 1000],
      ["2026-09", 1000],
    ]);
    expect(view.pace?.actualSoFar).toBeCloseTo(300, 6);
  });

  it("a tracker on a subset (Eating only) counts only that theme", () => {
    const record = createTrackerRecord({
      targetDaily: 20, usualDailyAtStart: 26, usualByThemeAtStart: {}, currentYm: "2026-07",
      trackedThemes: ["food"], today: TODAY,
    });
    const view = buildDailySpendTrackerView(record, { expenseTxns: txns, fxRates: {}, currency: "CAD", today: TODAY });
    expect(view.finishedMonths.map((r) => r.actualMonth)).toEqual([800, 800]);
  });
});
