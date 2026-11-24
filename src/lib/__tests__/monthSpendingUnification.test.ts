/**
 * One month, one spending number.
 *
 * Fixture mixes Other, Fees, Interest, an installment payment, a scheduled
 * loan amount that does not match the payment, a card payment, a transfer,
 * an investment, and an asset purchase. Every entry point must return the
 * same total (and the same line items).
 */

import { describe, expect, it } from "vitest";
import type { AccountSnapshot, DebtPaymentHistoryEntry, ExpenseTxnRecord, IncomeTxnRecord } from "../extractTransactions";
import {
  computeMonthSpending,
  computeTypicalSpend,
  isNotSpending,
} from "../spendingMetrics";
import { computeMonthlyBuckets } from "../monthlyBucketComputation";
import { getMonthlyCashFlow } from "../monthlyCashFlow";
import { buildSpendingSummary, spendingForMonth } from "../spendingSummary";
import { computeMoneyCoachBreakdown } from "../moneyCoach";
import { executeGetMonthlyBreakdown } from "../chat/executor";
import type { FinancialProfileCache } from "../financialProfile";
import { getCategoryBucket } from "../moneyCoachBuckets";
import { buildDailySpend } from "../dailySpend";
import type { UserReviewContext } from "../userReviewContext";

const MONTH = "2026-10";

function expense(
  overrides: Partial<ExpenseTxnRecord> & Pick<ExpenseTxnRecord, "category" | "amount">,
): ExpenseTxnRecord {
  return {
    date: `${MONTH}-15`,
    merchant: overrides.merchant ?? "Test merchant",
    accountSlug: overrides.accountSlug ?? "checking-1",
    accountLabel: overrides.accountLabel ?? "Chequing",
    txMonth: MONTH,
    currency: "CAD",
    ...overrides,
  };
}

const expenses: ExpenseTxnRecord[] = [
  expense({ merchant: "Grocery store", category: "Groceries", amount: 100 }),
  expense({ merchant: "Mystery shop", category: "Other", amount: 40 }),
  expense({ merchant: "Bank fee", category: "Fees", amount: 15 }),
  expense({ merchant: "Interest charge", category: "Interest", amount: 25 }),
  expense({
    merchant: "Auto loan payment",
    category: "Installment Servicing",
    amount: 200,
    debtType: "auto_loan",
    accountSlug: "checking-1",
  }),
  expense({
    merchant: "Visa payment",
    category: "Card Servicing",
    amount: 300,
    debtType: "credit_card",
  }),
  expense({ merchant: "E-transfer", category: "Transfers", amount: 80 }),
  expense({ merchant: "RRSP", category: "Investments & Savings", amount: 50 }),
  expense({ merchant: "Car dealer", category: "Asset purchase", amount: 5000 }),
];

const income: IncomeTxnRecord[] = [
  {
    date: `${MONTH}-01`,
    source: "Payroll",
    description: "Payroll",
    amount: 4000,
    category: "Salary",
    accountSlug: "checking-1",
    accountLabel: "Chequing",
    txMonth: MONTH,
    currency: "CAD",
  },
];

const accountSnapshots: AccountSnapshot[] = [
  {
    slug: "auto-loan-1",
    bankName: "Example Bank",
    accountId: "9999",
    accountName: "Auto loan",
    accountType: "auto_loan",
    balance: -8000,
    currency: "CAD",
    parsedDebts: 8000,
    statementMonth: MONTH,
    statementDate: `${MONTH}-31`,
    interestRate: 6,
  },
  {
    slug: "card-1",
    bankName: "Example Bank",
    accountId: "8888",
    accountName: "Credit card",
    accountType: "credit_card",
    balance: -1200,
    currency: "CAD",
    parsedDebts: 1200,
    statementMonth: MONTH,
    statementDate: `${MONTH}-31`,
    interestRate: 19.99,
    paymentsMade: 300,
  },
];

const debtPaymentHistory: DebtPaymentHistoryEntry[] = [
  {
    accountSlug: "auto-loan-1",
    statementMonth: "2026-08",
    paymentsMade: 250,
    currency: "CAD",
  },
  {
    accountSlug: "auto-loan-1",
    statementMonth: "2026-09",
    paymentsMade: 250,
    currency: "CAD",
  },
  {
    accountSlug: "auto-loan-1",
    statementMonth: MONTH,
    paymentsMade: 250,
    currency: "CAD",
  },
];

/** Groceries 100 + Other 40 + Fees 15 + installment payment 200 */
const EXPECTED = 355;

const emptyReviews: UserReviewContext = {
  incomeDepositReviews: new Map(),
  debtPaymentReviews: [],
  savingsConfirmedItems: new Map(),
};

function profileFor(): FinancialProfileCache {
  return {
    monthlyHistory: [
      {
        yearMonth: MONTH,
        incomeTotal: 4000,
        incomeTotalAllCredits: 4000,
        expensesTotal: 5810,
        coreExpensesTotal: EXPECTED,
        debtPaymentsTotal: 500,
        cardServicingPaymentsTotal: 300,
        minDebtPaymentsTotal: 200,
        totalAssets: 0,
        totalDebts: 0,
        netWorth: 0,
      },
    ],
    expenseTxns: expenses,
    incomeTxns: income,
    coverage: { monthsCovered: 1, monthsSpan: 1, coveragePct: 100, missingMonths: [] },
    debtPaymentHistory,
    accountBalanceHistory: [],
    fxRates: {},
    accountSnapshots,
    homeCurrency: "CAD",
    allTxMonths: [MONTH],
    latestTxMonth: MONTH,
    typicalMonthly: { median: EXPECTED, avg: EXPECTED, monthsTracked: 1 },
  } as unknown as FinancialProfileCache;
}

describe("spending inclusion rules", () => {
  it("counts Other, Fees, and installment payments; excludes interest, transfers, card payments, investments, and asset purchases", () => {
    expect(isNotSpending("Other")).toBe(false);
    expect(isNotSpending("Fees")).toBe(false);
    expect(isNotSpending("Bank Fees")).toBe(false);
    expect(isNotSpending("Installment Servicing")).toBe(false);
    expect(isNotSpending("Interest")).toBe(true);
    expect(isNotSpending("Transfers")).toBe(true);
    expect(isNotSpending("Card Servicing")).toBe(true);
    expect(isNotSpending("Credit Card Payment")).toBe(true);
    expect(isNotSpending("Investments & Savings")).toBe(true);
    expect(isNotSpending("Asset purchase")).toBe(true);
    expect(getCategoryBucket("Fees")).toBe("fixed");
    expect(getCategoryBucket("Other")).toBe("flexible");
  });
});

describe("same month = same number everywhere", () => {
  const monthSpend = computeMonthSpending(MONTH, expenses);
  const buckets = computeMonthlyBuckets(
    MONTH,
    expenses,
    accountSnapshots,
    debtPaymentHistory,
    [],
    {},
    "CAD",
  );
  const spendingMonth = spendingForMonth(
    MONTH,
    expenses,
    accountSnapshots,
    debtPaymentHistory,
    [],
    {},
    "CAD",
  );
  const cash = getMonthlyCashFlow(
    {
      expenseTxns: expenses,
      incomeTxns: income,
      homeCurrency: "CAD",
      accountSnapshots,
      debtPaymentHistory,
      userReviews: [],
    },
    MONTH,
  );
  const typical = computeTypicalSpend(expenses, "2026-11");
  const spending = buildSpendingSummary(
    expenses,
    accountSnapshots,
    debtPaymentHistory,
    [],
    {},
    "CAD",
    [MONTH],
  );
  const coach = computeMoneyCoachBreakdown(
    profileFor(),
    [],
    income,
    accountSnapshots,
    "CAD",
    new Map(),
    [MONTH],
  );
  const chat = executeGetMonthlyBreakdown(
    profileFor(),
    { from_month: MONTH, to_month: MONTH, by_category: true },
    emptyReviews,
  );

  it("computeMonthSpending is Groceries + Other + Fees + the actual loan payment", () => {
    expect(monthSpend.total).toBe(EXPECTED);
    expect(monthSpend.lines.map((l) => l.category).sort()).toEqual([
      "Fees",
      "Groceries",
      "Installment Servicing",
      "Other",
    ]);
    expect(monthSpend.lines.find((l) => l.category === "Installment Servicing")?.amount).toBe(200);
    expect(monthSpend.lines.some((l) => l.category === "Interest")).toBe(false);
    expect(monthSpend.lines.some((l) => l.category === "Card Servicing")).toBe(false);
    expect(monthSpend.lines.some((l) => l.category === "Transfers")).toBe(false);
    expect(monthSpend.lines.some((l) => l.category === "Investments & Savings")).toBe(false);
    expect(monthSpend.lines.some((l) => l.category === "Asset purchase")).toBe(false);
    expect(monthSpend.lines.some((l) => l.category === "Loan payments")).toBe(false);
  });

  it("does not use the scheduled 250 loan amount or the card minimum", () => {
    expect(monthSpend.total).not.toBe(EXPECTED - 200 + 250);
    expect(buckets.total).toBe(EXPECTED);
    expect(buckets.items.some((i) => i.category === "Loan payments")).toBe(false);
  });

  it("matches dashboard headline, typical month, Spending, cash flow, coach, and chat", () => {
    expect(buckets.total).toBe(EXPECTED);
    expect(spendingMonth.total).toBe(EXPECTED);
    expect(cash.moneyOut).toBe(EXPECTED);
    expect(typical.median).toBe(EXPECTED);
    expect(typical.avg).toBe(EXPECTED);
    expect(spending.typicalMonthly).toBe(EXPECTED);
    expect(spending.monthlyHistory.find((m) => m.yearMonth === MONTH)?.total).toBe(EXPECTED);
    expect(coach.totalSpending).toBe(EXPECTED);
    expect(chat.ok).toBe(true);
    const chatData = chat.data as { months: Array<{ expenses: string; by_category?: Array<{ category: string }> }> };
    expect(String(chatData.months[0].expenses)).toMatch(/355/);
    const cats = new Set(chatData.months[0].by_category?.map((c) => c.category) ?? []);
    expect(cats.has("Other")).toBe(true);
    expect(cats.has("Fees")).toBe(true);
    expect(cats.has("Installment Servicing")).toBe(true);
    expect(cats.has("Interest")).toBe(false);
    expect(cats.has("Transfers")).toBe(false);

    expect(buckets.total).toBe(spendingMonth.total);
    expect(buckets.total).toBe(cash.moneyOut);
    expect(buckets.total).toBe(typical.median);
    expect(buckets.total).toBe(spending.typicalMonthly);
    expect(buckets.total).toBe(coach.totalSpending);
    expect(buckets.total).toBe(monthSpend.total);
  });

  it("keeps leftover as income minus that same spending number", () => {
    expect(cash.leftover).toBe(4000 - EXPECTED);
    expect(cash.intoAssets).toBe(5050);
  });
});

describe("daily spend", () => {
  it("builds monthly category amounts from spendingForMonth / computeMonthSpending", () => {
    const daily = buildDailySpend({
      expenseTxns: expenses,
      accountSnapshots,
      debtPaymentHistory,
      userReviews: [],
      fxRates: {},
      currency: "CAD",
      range: "3m",
      today: new Date("2026-11-15T12:00:00"),
    });
    const spendingMonth = spendingForMonth(
      MONTH,
      expenses,
      accountSnapshots,
      debtPaymentHistory,
      [],
      {},
      "CAD",
    );
    expect(spendingMonth.total).toBe(EXPECTED);
    expect(daily.hasData).toBe(true);
  });
});
