/**
 * Monthly cash flow — one function for money in, money out, leftover, savings rate.
 *
 * Built on the same helpers as the Income page, Spending page, and dashboard
 * "Where Your Money Goes" cards:
 *   Money in  = buildIncomeSummary monthly total
 *   Money out = spendingForMonth / computeMonthlyBuckets (Fixed + Essentials + Flexible)
 *   Leftover  = money in − money out
 *   Savings rate = leftover / money in
 *
 * Income and spending use the same month, including the current unfinished
 * month and months older than the last 12 complete months.
 *
 * Multi-month averages are averages of these per-month results.
 */

import { displayNameFromProfileAccount } from "./accountListLabel";
import { categoryColor } from "./categoryTaxonomy";
import type {
  AccountSnapshot,
  DebtPaymentHistoryEntry,
  ExpenseTxnRecord,
  IncomeTxnRecord,
} from "./extractTransactions";
import { buildIncomeSummary, type MonthlyIncomeSummary } from "./incomeSummary";
import { spendingForMonth, type MonthlySpendingSummary } from "./spendingSummary";
import type { DebtPaymentReview } from "./types";

export type MonthlyCashFlowInput = {
  expenseTxns: ExpenseTxnRecord[];
  incomeTxns: IncomeTxnRecord[];
  homeCurrency: string;
  fxRates?: Record<string, number>;
  accountSnapshots?: Array<{
    slug: string;
    accountName?: string | null;
    bankName?: string | null;
  }>;
  debtPaymentHistory?: DebtPaymentHistoryEntry[];
  userReviews?: DebtPaymentReview[];
  incomeDepositReviews?: Map<string, string>;
};

export type MonthlyCashFlowBuckets = {
  fixed: number;
  essentials: number;
  flexible: number;
};

export type MonthlyCashFlowCategory = {
  name: string;
  amount: number;
  color: string;
};

export type MonthlyCashFlowSource = {
  name: string;
  amount: number;
  accountLabel?: string;
};

export type MonthlyCashFlow = {
  yearMonth: string;
  moneyIn: number;
  moneyOut: number;
  leftover: number;
  savingsRate: number | null;
  buckets: MonthlyCashFlowBuckets;
  categories: MonthlyCashFlowCategory[];
  sources: MonthlyCashFlowSource[];
};

export type AveragedCashFlow = {
  moneyIn: number;
  moneyOut: number;
  leftover: number;
  savingsRate: number | null;
  buckets: MonthlyCashFlowBuckets;
};

/**
 * Leftover ÷ money in. Null when income is zero or negative so we never
 * divide by zero or invent a rate from a refund-only month.
 */
export function computeSavingsRate(moneyIn: number, moneyOut: number): number | null {
  if (!Number.isFinite(moneyIn) || !Number.isFinite(moneyOut)) return null;
  if (moneyIn <= 0) return null;
  return (moneyIn - moneyOut) / moneyIn;
}

function emptyMonth(yearMonth: string): MonthlyCashFlow {
  return {
    yearMonth,
    moneyIn: 0,
    moneyOut: 0,
    leftover: 0,
    savingsRate: null,
    buckets: { fixed: 0, essentials: 0, flexible: 0 },
    categories: [],
    sources: [],
  };
}

function sourcesFromIncome(
  month: MonthlyIncomeSummary | undefined,
  incomeTxns: IncomeTxnRecord[],
  accountSnapshots: MonthlyCashFlowInput["accountSnapshots"],
): MonthlyCashFlowSource[] {
  if (!month) return [];
  return (month.sources ?? [])
    .filter((s) => Math.abs(s.amount) >= 0.005)
    .map((s) => {
      const monthTxns = incomeTxns.filter(
        (t) =>
          t.date.startsWith(month.yearMonth) &&
          (t.source === s.source || t.description === s.source),
      );
      const slugs = new Set(monthTxns.map((t) => t.accountSlug).filter(Boolean));
      let accountLabel: string | undefined;
      if (slugs.size === 1) {
        const slug = [...slugs][0];
        accountLabel = displayNameFromProfileAccount(
          slug,
          { accountSnapshots: accountSnapshots ?? [] },
          undefined,
        );
      }
      return { name: s.source, amount: s.amount, accountLabel };
    });
}

function categoriesFromSpending(
  month: MonthlySpendingSummary | undefined,
): MonthlyCashFlowCategory[] {
  if (!month) return [];
  return (month.categories ?? [])
    .filter((c) => Math.abs(c.amount) >= 0.005)
    .map((c) => ({
      name: c.category,
      amount: c.amount,
      color: categoryColor(c.category),
    }));
}

function composeMonth(
  yearMonth: string,
  income: MonthlyIncomeSummary | undefined,
  spending: MonthlySpendingSummary,
  incomeTxns: IncomeTxnRecord[],
  accountSnapshots: MonthlyCashFlowInput["accountSnapshots"],
): MonthlyCashFlow {
  const moneyIn = income?.total ?? 0;
  const moneyOut = spending.total;
  return {
    yearMonth,
    moneyIn,
    moneyOut,
    leftover: moneyIn - moneyOut,
    savingsRate: computeSavingsRate(moneyIn, moneyOut),
    buckets: {
      fixed: spending.fixed,
      essentials: spending.essentials,
      flexible: spending.flexible,
    },
    categories: categoriesFromSpending(spending),
    sources: sourcesFromIncome(income, incomeTxns, accountSnapshots),
  };
}

function monthsWithData(input: MonthlyCashFlowInput, incomeMonths: string[]): string[] {
  const months = new Set<string>(incomeMonths);
  for (const t of input.incomeTxns) {
    if (t.txMonth) months.add(t.txMonth);
    else if (t.date) months.add(t.date.slice(0, 7));
  }
  for (const t of input.expenseTxns) {
    if (t.txMonth) months.add(t.txMonth);
    else if (t.date) months.add(t.date.slice(0, 7));
  }
  return [...months].sort();
}

function spendingMonth(input: MonthlyCashFlowInput, yearMonth: string): MonthlySpendingSummary {
  return spendingForMonth(
    yearMonth,
    input.expenseTxns,
    (input.accountSnapshots ?? []) as AccountSnapshot[],
    input.debtPaymentHistory ?? [],
    input.userReviews ?? [],
    input.fxRates ?? {},
    input.homeCurrency,
  );
}

function cashFlowForMonths(input: MonthlyCashFlowInput, months: string[]): MonthlyCashFlow[] {
  const incomeSummary = buildIncomeSummary(
    input.incomeTxns,
    (input.accountSnapshots ?? []) as AccountSnapshot[],
    input.homeCurrency,
    input.incomeDepositReviews ?? new Map(),
  );
  return months.map((yearMonth) =>
    composeMonth(
      yearMonth,
      incomeSummary.monthlyHistory.find((m) => m.yearMonth === yearMonth),
      spendingMonth(input, yearMonth),
      input.incomeTxns,
      input.accountSnapshots,
    ),
  );
}

/**
 * Cash flow for every month that has income or spending data.
 * Includes the current unfinished month when it has data.
 */
export function computeMonthlyCashFlowSeries(input: MonthlyCashFlowInput): MonthlyCashFlow[] {
  const seedMonths = monthsWithData(input, []);
  const series = cashFlowForMonths(input, seedMonths);
  return series;
}

/**
 * Cash flow for the given calendar months, in that order.
 * Months with no transactions still include scheduled loan payments.
 */
export function getMonthlyCashFlowForMonths(
  input: MonthlyCashFlowInput,
  months: string[],
): MonthlyCashFlow[] {
  return cashFlowForMonths(input, months);
}

/**
 * Cash flow for one calendar month. Income and spending both include that
 * month, even if it is the current unfinished month or older than 12 months.
 */
export function getMonthlyCashFlow(
  input: MonthlyCashFlowInput,
  month: string,
): MonthlyCashFlow {
  if (!month) return emptyMonth(month);
  return cashFlowForMonths(input, [month])[0];
}

/** Average of per-month cash flow. Leftover = average money in − average money out. */
export function averageMonthlyCashFlow(months: MonthlyCashFlow[]): AveragedCashFlow {
  if (months.length === 0) {
    return {
      moneyIn: 0,
      moneyOut: 0,
      leftover: 0,
      savingsRate: null,
      buckets: { fixed: 0, essentials: 0, flexible: 0 },
    };
  }
  const n = months.length;
  const moneyIn = months.reduce((s, m) => s + m.moneyIn, 0) / n;
  const moneyOut = months.reduce((s, m) => s + m.moneyOut, 0) / n;
  const leftover = months.reduce((s, m) => s + m.leftover, 0) / n;
  return {
    moneyIn,
    moneyOut,
    leftover,
    savingsRate: computeSavingsRate(moneyIn, moneyOut),
    buckets: {
      fixed: months.reduce((s, m) => s + m.buckets.fixed, 0) / n,
      essentials: months.reduce((s, m) => s + m.buckets.essentials, 0) / n,
      flexible: months.reduce((s, m) => s + m.buckets.flexible, 0) / n,
    },
  };
}
