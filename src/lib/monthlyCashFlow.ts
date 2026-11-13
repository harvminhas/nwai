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
import {
  mean,
  monthsForCashFlowAverage,
  type CashFlowAverageOptions,
} from "./cashFlowAverage";
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

export { mean, monthsForCashFlowAverage } from "./cashFlowAverage";
export type { CashFlowAverageOptions } from "./cashFlowAverage";

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

export type LeftoverMonthBreakdown = {
  month: string;
  moneyIn: number;
  moneyOut: number;
  leftover: number;
  buckets: MonthlyCashFlowBuckets;
};

export type AveragedCashFlowResult = AveragedCashFlow & {
  months: string[];
  monthly: MonthlyCashFlow[];
  monthlyBreakdown: LeftoverMonthBreakdown[];
};

/**
 * Build the shared cash-flow input from a financial profile plus reviews.
 * Used by dashboard, drawers, chat, and Income/Spending typicals.
 */
export function cashFlowInputFromProfile(
  profile: {
    expenseTxns: ExpenseTxnRecord[];
    incomeTxns: IncomeTxnRecord[];
    homeCurrency?: string;
    fxRates?: Record<string, number>;
    accountSnapshots?: MonthlyCashFlowInput["accountSnapshots"];
    debtPaymentHistory?: DebtPaymentHistoryEntry[];
  },
  reviews?: {
    debtPaymentReviews?: DebtPaymentReview[];
    incomeDepositReviews?: Map<string, string>;
  },
): MonthlyCashFlowInput {
  return {
    expenseTxns: profile.expenseTxns,
    incomeTxns: profile.incomeTxns,
    homeCurrency: profile.homeCurrency || "CAD",
    fxRates: profile.fxRates,
    accountSnapshots: profile.accountSnapshots,
    debtPaymentHistory: profile.debtPaymentHistory,
    userReviews: reviews?.debtPaymentReviews,
    incomeDepositReviews: reviews?.incomeDepositReviews,
  };
}

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
  const moneyIn = mean(months.map((m) => m.moneyIn));
  const moneyOut = mean(months.map((m) => m.moneyOut));
  const leftover = mean(months.map((m) => m.leftover));
  return {
    moneyIn,
    moneyOut,
    leftover,
    savingsRate: computeSavingsRate(moneyIn, moneyOut),
    buckets: {
      fixed: mean(months.map((m) => m.buckets.fixed)),
      essentials: mean(months.map((m) => m.buckets.essentials)),
      flexible: mean(months.map((m) => m.buckets.flexible)),
    },
  };
}

function toBreakdown(month: MonthlyCashFlow): LeftoverMonthBreakdown {
  return {
    month: month.yearMonth,
    moneyIn: month.moneyIn,
    moneyOut: month.moneyOut,
    leftover: month.leftover,
    buckets: month.buckets,
  };
}

/**
 * Shared multi-month cash-flow average.
 *
 * Month set comes from {@link monthsForCashFlowAverage}: current unfinished
 * month excluded by default, $0-income months included, no rounding.
 * When `rangeMonths` is omitted, last 3 complete months that have income
 * or spending (not `profile.incomeTotal > 0`).
 */
export function averageCashFlow(
  input: MonthlyCashFlowInput,
  options: CashFlowAverageOptions = {},
): AveragedCashFlowResult {
  const rangeMonths = options.rangeMonths?.length ? options.rangeMonths : undefined;
  const available = rangeMonths
    ? rangeMonths
    : computeMonthlyCashFlowSeries(input).map((m) => m.yearMonth);
  const months = monthsForCashFlowAverage(available, {
    ...options,
    rangeMonths,
    lastNComplete: options.lastNComplete ?? 3,
  });
  const monthly = getMonthlyCashFlowForMonths(input, months);
  return {
    ...averageMonthlyCashFlow(monthly),
    months,
    monthly,
    monthlyBreakdown: monthly.map(toBreakdown),
  };
}
