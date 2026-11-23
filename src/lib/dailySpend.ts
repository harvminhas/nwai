/**
 * Daily spend — everyday-theme mapping and daily-rate math.
 *
 * Category amounts come from spendingForMonth / computeMonthlyBuckets /
 * buildSpendingSummary (same path as the Spending page). Subtypes roll up
 * via getParentCategory. Averages use monthsForCashFlowAverage (finished
 * months only) and mean() from cashFlowAverage.ts.
 *
 * Daily rate = sum of theme spending over the window / calendar days in
 * those months. The unfinished current month is never in the average.
 */

import type { AccountSnapshot, DebtPaymentHistoryEntry, ExpenseTxnRecord } from "./extractTransactions";
import type { DebtPaymentReview } from "./types";
import { mean, monthsForCashFlowAverage, completeMonthsWithData } from "./cashFlowAverage";
import { getParentCategory } from "./categoryTaxonomy";
import {
  getCurrentMonth,
  isMonthInProgress,
  listMonthsWithData,
  IN_PROGRESS_LABEL,
} from "./monthAnchor";
import { formatMonth } from "./dateFormatting";
import { spendingForMonth, type MonthlySpendingSummary } from "./spendingSummary";

export type DailySpendRange = "3m" | "6m" | "12m";

export type DailySpendThemeId =
  | "food"
  | "getting-around"
  | "shopping"
  | "fun"
  | "personal-care";

export type FoodSplit = "groceries" | "eating-out";

export type DailySpendDeltaKind = "up" | "down" | "even";

export const DAILY_SPEND_RANGES: DailySpendRange[] = ["3m", "6m", "12m"];

export const EVEN_DELTA_THRESHOLD = 0.5;
export const WHAT_IF_MIN_PCT = 0.4;
export const WHAT_IF_MAX_PCT = 1.2;
export const DAYS_PER_MONTH = 30.4;
export const DAYS_PER_YEAR = 365;

const STREAMING_EXCLUSIONS = new Set(["streaming", "streaming services"]);
const CAR_INSURANCE_EXCLUSIONS = new Set(["car insurance"]);

export const DAILY_SPEND_THEMES: ReadonlyArray<{
  id: DailySpendThemeId;
  label: string;
  color: string;
}> = [
  { id: "food", label: "Food", color: "#22c55e" },
  { id: "getting-around", label: "Getting around", color: "#f59e0b" },
  { id: "shopping", label: "Shopping", color: "#a855f7" },
  { id: "fun", label: "Fun & going out", color: "#ec4899" },
  { id: "personal-care", label: "Personal care", color: "#f472b6" },
];

export interface ThemeMonthAmounts {
  food: number;
  groceries: number;
  eatingOut: number;
  "getting-around": number;
  shopping: number;
  fun: number;
  "personal-care": number;
  total: number;
}

export interface DailySpendThemeRow {
  id: DailySpendThemeId;
  label: string;
  color: string;
  dailyRate: number;
  priorDailyRate: number | null;
  delta: number | null;
  deltaKind: DailySpendDeltaKind | null;
  share: number;
  groceriesDaily?: number;
  eatingOutDaily?: number;
}

export interface DailySpendCurrentMonth {
  yearMonth: string;
  isInProgress: true;
  inProgressLabel: string;
  dailyRate: number;
  themeTotal: number;
  daysElapsed: number;
  fromDay: number;
  toDay: number;
  rangeLabel: string;
}

export interface DailySpendResult {
  range: DailySpendRange;
  rangeLabel: string;
  currency: string;
  months: string[];
  priorMonths: string[];
  calendarDays: number;
  monthRangeLabel: string;
  everydayDailyRate: number;
  priorEverydayDailyRate: number | null;
  everydayDelta: number | null;
  everydayDeltaKind: DailySpendDeltaKind | null;
  themes: DailySpendThemeRow[];
  currentMonth: DailySpendCurrentMonth | null;
  hasAverage: boolean;
  hasData: boolean;
}

export interface DailySpendInput {
  expenseTxns: ExpenseTxnRecord[];
  accountSnapshots: AccountSnapshot[];
  debtPaymentHistory: DebtPaymentHistoryEntry[];
  userReviews: DebtPaymentReview[];
  fxRates: Record<string, number>;
  currency?: string;
  range?: DailySpendRange;
  today?: Date;
}

function nowDate(today?: Date): Date {
  if (today) return today;
  const injected = (globalThis as { __TEST_NOW__?: Date }).__TEST_NOW__;
  if (injected instanceof Date) return injected;
  return new Date();
}

function emptyThemeAmounts(): ThemeMonthAmounts {
  return {
    food: 0,
    groceries: 0,
    eatingOut: 0,
    "getting-around": 0,
    shopping: 0,
    fun: 0,
    "personal-care": 0,
    total: 0,
  };
}

export function parseDailySpendRange(raw: string | null | undefined): DailySpendRange {
  if (raw === "6m" || raw === "12m" || raw === "3m") return raw;
  return "3m";
}

export function lastNForRange(range: DailySpendRange): number {
  if (range === "12m") return 12;
  if (range === "6m") return 6;
  return 3;
}

export function rangeAverageLabel(range: DailySpendRange): string {
  if (range === "12m") return "12-MONTH AVERAGE";
  if (range === "6m") return "6-MONTH AVERAGE";
  return "3-MONTH AVERAGE";
}

/**
 * Map a Spending-page category (parent or subtype) to an everyday theme.
 * Exclusions: housing, subscriptions, insurance, taxes, debt/loan payments,
 * education, healthcare, travel, cash & ATM, fees, transfers, savings,
 * car insurance, streaming.
 */
export function themeIdForCategory(category: string): DailySpendThemeId | null {
  const parent = getParentCategory(category);
  const lower = category.trim().toLowerCase();

  if (parent === "Transportation" && CAR_INSURANCE_EXCLUSIONS.has(lower)) {
    return null;
  }
  if (parent === "Entertainment" && STREAMING_EXCLUSIONS.has(lower)) {
    return null;
  }

  switch (parent) {
    case "Groceries":
    case "Dining":
      return "food";
    case "Transportation":
      return "getting-around";
    case "Shopping":
      return "shopping";
    case "Entertainment":
      return "fun";
    case "Personal Care":
      return "personal-care";
    default:
      return null;
  }
}

export function foodSplitForCategory(category: string): FoodSplit | null {
  if (themeIdForCategory(category) !== "food") return null;
  return getParentCategory(category) === "Groceries" ? "groceries" : "eating-out";
}

export function themeAmountsFromCategories(
  categories: Array<{ category: string; amount: number }>,
): ThemeMonthAmounts {
  const amounts = emptyThemeAmounts();
  for (const cat of categories) {
    const theme = themeIdForCategory(cat.category);
    if (!theme) continue;
    amounts[theme] += cat.amount;
    amounts.total += cat.amount;
    if (theme === "food") {
      const split = foodSplitForCategory(cat.category);
      if (split === "groceries") amounts.groceries += cat.amount;
      else amounts.eatingOut += cat.amount;
    }
  }
  return amounts;
}

/** Calendar days in a YYYY-MM month. */
export function calendarDaysInMonth(yearMonth: string): number {
  const [yearStr, monthStr] = yearMonth.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  if (!year || !month) return 0;
  return new Date(year, month, 0).getDate();
}

export function calendarDaysInMonths(months: string[]): number {
  return months.reduce((sum, ym) => sum + calendarDaysInMonth(ym), 0);
}

/** Inclusive days from the 1st through today in the current calendar month. */
export function daysElapsedInMonth(today?: Date): number {
  return Math.max(1, nowDate(today).getDate());
}

/**
 * Daily rate over a window: mean(monthly totals) × month count / calendar days.
 * Equivalent to sum / calendar days; uses mean() from cashFlowAverage.ts.
 */
export function dailyRateFromMonthlyTotals(
  monthlyTotals: number[],
  months: string[],
): number {
  const days = calendarDaysInMonths(months);
  if (days <= 0 || monthlyTotals.length === 0) return 0;
  return (mean(monthlyTotals) * monthlyTotals.length) / days;
}

export function deltaKind(delta: number | null | undefined): DailySpendDeltaKind | null {
  if (delta == null || !Number.isFinite(delta)) return null;
  if (Math.abs(delta) <= EVEN_DELTA_THRESHOLD) return "even";
  return delta > 0 ? "up" : "down";
}

export function compactMonthRangeLabel(months: string[]): string {
  if (months.length === 0) return "";
  const first = months[0];
  const last = months[months.length - 1];
  const firstMonth = formatMonth(first);
  const lastMonth = formatMonth(last);
  const firstYear = first.slice(0, 4);
  const lastYear = last.slice(0, 4);
  if (months.length === 1) {
    return `${firstMonth} ${firstYear}`;
  }
  if (firstYear === lastYear) {
    return `${firstMonth}–${lastMonth} ${lastYear}`;
  }
  return `${firstMonth} ${firstYear}–${lastMonth} ${lastYear}`;
}

export function currentMonthRangeLabel(
  yearMonth: string,
  daysElapsed: number,
): string {
  const monthName = formatMonth(yearMonth);
  return `${monthName} 1–${daysElapsed}`;
}

/**
 * Preceding equal window of finished months immediately before `windowMonths`
 * in the complete-months list.
 */
export function priorWindowMonths(
  completeMonths: string[],
  windowMonths: string[],
): string[] {
  if (windowMonths.length === 0) return [];
  const start = completeMonths.indexOf(windowMonths[0]);
  if (start <= 0) return [];
  return completeMonths.slice(Math.max(0, start - windowMonths.length), start);
}

export function monthlyKeep(usualDaily: number, targetDaily: number): number {
  return (usualDaily - targetDaily) * DAYS_PER_MONTH;
}

export function yearlyKeep(usualDaily: number, targetDaily: number): number {
  return (usualDaily - targetDaily) * DAYS_PER_YEAR;
}

export function whatIfSliderBounds(usualDaily: number): { min: number; max: number } {
  return {
    min: usualDaily * WHAT_IF_MIN_PCT,
    max: usualDaily * WHAT_IF_MAX_PCT,
  };
}

/**
 * How many months sooner a plan is reached if extra monthly savings are
 * added to the existing set-aside. Null when the comparison is not meaningful.
 */
export function monthsSooner(
  remaining: number,
  setAsidePerMonth: number,
  extraMonthly: number,
): number | null {
  if (remaining <= 0 || setAsidePerMonth <= 0 || extraMonthly <= 0) return null;
  const without = remaining / setAsidePerMonth;
  const withExtra = remaining / (setAsidePerMonth + extraMonthly);
  const sooner = without - withExtra;
  if (sooner < 0.5) return null;
  return Math.round(sooner);
}

function availableYearMonths(expenseTxns: ExpenseTxnRecord[]): string[] {
  const monthSet = new Set<string>();
  for (const txn of expenseTxns) {
    if (txn.txMonth) monthSet.add(txn.txMonth);
  }
  return listMonthsWithData(Array.from(monthSet)).map((m) => m.yearMonth);
}

export function buildDailySpend(input: DailySpendInput): DailySpendResult {
  const today = nowDate(input.today);
  const range = input.range ?? "3m";
  const currency = input.currency ?? "CAD";
  const currentYm = getCurrentMonth(today);
  const lastN = lastNForRange(range);

  const allMonths = availableYearMonths(input.expenseTxns);
  const completeMonths = completeMonthsWithData(allMonths, { currentMonth: currentYm });
  const windowMonths = monthsForCashFlowAverage(allMonths, {
    lastNComplete: lastN,
    currentMonth: currentYm,
  });
  const priorMonths = priorWindowMonths(completeMonths, windowMonths);

  const monthCache = new Map<string, MonthlySpendingSummary>();
  const monthSummary = (yearMonth: string): MonthlySpendingSummary => {
    const cached = monthCache.get(yearMonth);
    if (cached) return cached;
    const summary = spendingForMonth(
      yearMonth,
      input.expenseTxns,
      input.accountSnapshots,
      input.debtPaymentHistory,
      input.userReviews,
      input.fxRates,
      currency,
    );
    monthCache.set(yearMonth, summary);
    return summary;
  };

  const amountsFor = (yearMonth: string): ThemeMonthAmounts =>
    themeAmountsFromCategories(monthSummary(yearMonth).categories);

  const windowAmounts = windowMonths.map(amountsFor);
  const priorAmounts = priorMonths.map(amountsFor);

  const calendarDays = calendarDaysInMonths(windowMonths);
  const everydayDailyRate = dailyRateFromMonthlyTotals(
    windowAmounts.map((a) => a.total),
    windowMonths,
  );
  const priorEverydayDailyRate =
    priorMonths.length > 0
      ? dailyRateFromMonthlyTotals(
          priorAmounts.map((a) => a.total),
          priorMonths,
        )
      : null;
  const everydayDelta =
    priorEverydayDailyRate == null ? null : everydayDailyRate - priorEverydayDailyRate;

  const themes: DailySpendThemeRow[] = DAILY_SPEND_THEMES.map((meta) => {
    const dailyRate = dailyRateFromMonthlyTotals(
      windowAmounts.map((a) => a[meta.id]),
      windowMonths,
    );
    const priorDailyRate =
      priorMonths.length > 0
        ? dailyRateFromMonthlyTotals(
            priorAmounts.map((a) => a[meta.id]),
            priorMonths,
          )
        : null;
    const delta = priorDailyRate == null ? null : dailyRate - priorDailyRate;
    const row: DailySpendThemeRow = {
      id: meta.id,
      label: meta.label,
      color: meta.color,
      dailyRate,
      priorDailyRate,
      delta,
      deltaKind: deltaKind(delta),
      share: everydayDailyRate > 0 ? dailyRate / everydayDailyRate : 0,
    };
    if (meta.id === "food") {
      row.groceriesDaily = dailyRateFromMonthlyTotals(
        windowAmounts.map((a) => a.groceries),
        windowMonths,
      );
      row.eatingOutDaily = dailyRateFromMonthlyTotals(
        windowAmounts.map((a) => a.eatingOut),
        windowMonths,
      );
    }
    return row;
  });

  const daysElapsed = daysElapsedInMonth(today);
  let currentMonth: DailySpendCurrentMonth | null = null;
  if (isMonthInProgress(currentYm, currentYm)) {
    const currentAmounts = amountsFor(currentYm);
    currentMonth = {
      yearMonth: currentYm,
      isInProgress: true,
      inProgressLabel: IN_PROGRESS_LABEL,
      themeTotal: currentAmounts.total,
      daysElapsed,
      fromDay: 1,
      toDay: daysElapsed,
      dailyRate: daysElapsed > 0 ? currentAmounts.total / daysElapsed : 0,
      rangeLabel: currentMonthRangeLabel(currentYm, daysElapsed),
    };
  }

  const hasAverage = windowMonths.length > 0;
  const hasData = allMonths.length > 0;

  return {
    range,
    rangeLabel: rangeAverageLabel(range),
    currency,
    months: windowMonths,
    priorMonths,
    calendarDays,
    monthRangeLabel: compactMonthRangeLabel(windowMonths),
    everydayDailyRate,
    priorEverydayDailyRate,
    everydayDelta,
    everydayDeltaKind: deltaKind(everydayDelta),
    themes,
    currentMonth,
    hasAverage,
    hasData,
  };
}
