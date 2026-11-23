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
import { CATEGORY_TAXONOMY, getParentCategory } from "./categoryTaxonomy";
import {
  getCurrentMonth,
  isMonthInProgress,
  listMonthsWithData,
  IN_PROGRESS_LABEL,
} from "./monthAnchor";
import { formatMonth } from "./dateFormatting";
import { spendingForMonth, type MonthlySpendingSummary } from "./spendingSummary";
import {
  buildMerchantAliasResolver,
  resolveSpendingMerchant,
  type MerchantAliasResolver,
} from "./merchantAliases";

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
export const THEME_SERIES_MONTHS = 6;
export const TOP_MERCHANT_COUNT = 5;

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

/** Spending-page parent for the “See {theme} in Spending” footer link. */
export const THEME_SPENDING_CATEGORY: Record<DailySpendThemeId, string> = {
  food: "Dining",
  "getting-around": "Transportation",
  shopping: "Shopping",
  fun: "Entertainment",
  "personal-care": "Personal Care",
};

export interface ThemeMonthAmounts {
  food: number;
  groceries: number;
  eatingOut: number;
  "getting-around": number;
  shopping: number;
  fun: number;
  "personal-care": number;
  total: number;
  /** Leaf / residual subcategory totals keyed by display label. */
  subcategories: Record<string, number>;
}

export interface DailySpendBar {
  id: string;
  label: string;
  dailyRate: number;
  share: number;
}

export interface DailySpendMerchantRow {
  slug: string;
  name: string;
  dailyRate: number;
  total: number;
  count: number;
  visitsPerMonth: number;
}

export interface DailySpendSeriesPoint {
  yearMonth: string;
  dailyRate: number;
  isInProgress: boolean;
}

export interface DailySpendThemeDetail {
  subcategories: DailySpendBar[];
  foodSplit?: {
    groceries: DailySpendBar;
    eatingOut: DailySpendBar;
    eatingOutSubcategories: DailySpendBar[];
  };
  merchants: DailySpendMerchantRow[];
  series: DailySpendSeriesPoint[];
  spendingHref: string;
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
  detail: DailySpendThemeDetail;
}

export interface DailySpendCurrentMonth {
  yearMonth: string;
  isInProgress: true;
  inProgressLabel: string;
  dailyRate: number;
  themeTotal: number;
  /** False when this month has transactions but no everyday-theme spend yet. */
  hasEverydaySpend: boolean;
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
  /** Confirmed users/{uid}/sourceMappings — same input Spending drilldown uses. */
  sourceMappings?: Array<{ canonical: string; alias: string; status?: string; type?: string }>;
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
    subcategories: {},
  };
}

export function parseDailySpendRange(raw: string | null | undefined): DailySpendRange {
  if (raw === "6m" || raw === "12m" || raw === "3m") return raw;
  return "3m";
}

export function parseDailySpendTheme(raw: string | null | undefined): DailySpendThemeId | null {
  if (!raw) return null;
  return DAILY_SPEND_THEMES.some((t) => t.id === raw) ? (raw as DailySpendThemeId) : null;
}

export function spendingHrefForTheme(themeId: DailySpendThemeId): string {
  return `/account/spending?category=${encodeURIComponent(THEME_SPENDING_CATEGORY[themeId])}`;
}

export function seeInSpendingLabel(themeLabel: string): string {
  return `See ${themeLabel} in Spending →`;
}

export function windowAverageLabel(monthRangeLabel: string): string {
  return monthRangeLabel ? `${monthRangeLabel} average` : "Average";
}

/** Transaction count over the window ÷ number of months, rounded. */
export function visitsPerMonth(count: number, monthCount: number): number {
  if (monthCount <= 0) return 0;
  return Math.round(count / monthCount);
}

export function visitsPerMonthLabel(visits: number): string {
  // A top merchant always has at least one visit; under 0.5/mo rounds to 0.
  if (visits <= 0) return "<1 visit/mo";
  return visits === 1 ? "1 visit/mo" : `${visits} visits/mo`;
}

function barId(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function shiftYearMonth(yearMonth: string, deltaMonths: number): string {
  const [yearStr, monthStr] = yearMonth.split("-");
  const date = new Date(Number(yearStr), Number(monthStr) - 1 + deltaMonths, 1);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

/** Inclusive calendar months ending at `endingYm` (oldest first). */
export function lastNCalendarMonths(n: number, endingYm: string): string[] {
  if (n <= 0) return [];
  const months: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    months.push(shiftYearMonth(endingYm, -i));
  }
  return months;
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

/**
 * Display label for a theme leaf: taxonomy subtype, Groceries, or the parent
 * residual (e.g. untyped "Dining" or "Transportation").
 */
export function subcategoryLabelForCategory(category: string): string | null {
  if (!themeIdForCategory(category)) return null;
  const parent = getParentCategory(category);
  const lower = category.trim().toLowerCase();
  const subtypes = CATEGORY_TAXONOMY[parent] ?? [];
  const match = subtypes.find((s) => s.toLowerCase() === lower);
  if (match) return match;
  if (parent === "Groceries") return "Groceries";
  return parent;
}

function taxonomyLabelsForTheme(themeId: DailySpendThemeId): string[] {
  switch (themeId) {
    case "food":
      return ["Groceries", ...CATEGORY_TAXONOMY.Dining];
    case "getting-around":
      return CATEGORY_TAXONOMY.Transportation.filter(
        (s) => !CAR_INSURANCE_EXCLUSIONS.has(s.toLowerCase()),
      );
    case "shopping":
      return [...CATEGORY_TAXONOMY.Shopping];
    case "fun":
      return CATEGORY_TAXONOMY.Entertainment.filter(
        (s) => !STREAMING_EXCLUSIONS.has(s.toLowerCase()),
      );
    case "personal-care":
      return [...CATEGORY_TAXONOMY["Personal Care"]];
  }
}

function residualParentForTheme(themeId: DailySpendThemeId): string | null {
  switch (themeId) {
    case "food":
      return "Dining";
    case "getting-around":
      return "Transportation";
    case "shopping":
      return "Shopping";
    case "fun":
      return "Entertainment";
    case "personal-care":
      return "Personal Care";
  }
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
    const sub = subcategoryLabelForCategory(cat.category);
    if (sub) {
      amounts.subcategories[sub] = (amounts.subcategories[sub] ?? 0) + cat.amount;
    }
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

export const NO_SPEND_THIS_MONTH_MESSAGE = "No spending recorded yet this month";

/** "Fully saved 1 month sooner" / "Fully saved 3 months sooner". */
export function fullySavedSoonerLabel(months: number): string {
  return `Fully saved ${months} ${months === 1 ? "month" : "months"} sooner`;
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

function dailyRateForKey(
  windowAmounts: ThemeMonthAmounts[],
  windowMonths: string[],
  key: string,
): number {
  return dailyRateFromMonthlyTotals(
    windowAmounts.map((a) => a.subcategories[key] ?? 0),
    windowMonths,
  );
}

function barsFromLabels(
  labels: string[],
  windowAmounts: ThemeMonthAmounts[],
  windowMonths: string[],
  shareOf: number,
  opts?: { keepZero?: boolean },
): DailySpendBar[] {
  const bars: DailySpendBar[] = [];
  for (const label of labels) {
    const dailyRate = dailyRateForKey(windowAmounts, windowMonths, label);
    if (!opts?.keepZero && dailyRate <= 0) continue;
    bars.push({
      id: barId(label),
      label,
      dailyRate,
      share: shareOf > 0 ? dailyRate / shareOf : 0,
    });
  }
  return bars;
}

function merchantsForTheme(
  themeId: DailySpendThemeId,
  expenseTxns: ExpenseTxnRecord[],
  windowMonths: string[],
  calendarDays: number,
  aliasResolver: MerchantAliasResolver | null,
): DailySpendMerchantRow[] {
  const monthSet = new Set(windowMonths);
  const map = new Map<string, { name: string; total: number; count: number }>();
  for (const txn of expenseTxns) {
    if (!monthSet.has(txn.txMonth)) continue;
    if (themeIdForCategory(txn.category) !== themeId) continue;
    const { slug, name } = resolveSpendingMerchant(txn.merchant, aliasResolver);
    const cur = map.get(slug) ?? { name, total: 0, count: 0 };
    cur.total += Math.abs(txn.amount);
    cur.count += 1;
    map.set(slug, cur);
  }
  const monthCount = windowMonths.length;
  return Array.from(map.entries())
    .map(([slug, row]) => ({
      slug,
      name: row.name,
      total: row.total,
      dailyRate: calendarDays > 0 ? row.total / calendarDays : 0,
      count: row.count,
      visitsPerMonth: visitsPerMonth(row.count, monthCount),
    }))
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))
    .slice(0, TOP_MERCHANT_COUNT);
}

function seriesForTheme(
  themeId: DailySpendThemeId,
  amountsFor: (yearMonth: string) => ThemeMonthAmounts,
  currentYm: string,
  daysElapsed: number,
  firstDataMonth: string | null,
): DailySpendSeriesPoint[] {
  // Months before the user's first data are unknown, not $0 ? leave them off.
  if (!firstDataMonth) return [];
  return lastNCalendarMonths(THEME_SERIES_MONTHS, currentYm)
    .filter((yearMonth) => yearMonth >= firstDataMonth)
    .map((yearMonth) => {
    const inProgress = isMonthInProgress(yearMonth, currentYm);
    const days = inProgress ? daysElapsed : calendarDaysInMonth(yearMonth);
    const total = amountsFor(yearMonth)[themeId];
    return {
      yearMonth,
      dailyRate: days > 0 ? total / days : 0,
      isInProgress: inProgress,
    };
  });
}

function buildThemeDetail(
  themeId: DailySpendThemeId,
  windowAmounts: ThemeMonthAmounts[],
  windowMonths: string[],
  calendarDays: number,
  dailyRate: number,
  groceriesDaily: number | undefined,
  eatingOutDaily: number | undefined,
  expenseTxns: ExpenseTxnRecord[],
  amountsFor: (yearMonth: string) => ThemeMonthAmounts,
  currentYm: string,
  daysElapsed: number,
  aliasResolver: MerchantAliasResolver | null,
  firstDataMonth: string | null,
): DailySpendThemeDetail {
  const residual = residualParentForTheme(themeId);
  const labels = [...taxonomyLabelsForTheme(themeId)];
  if (residual && !labels.includes(residual)) labels.push(residual);

  const subcategories = barsFromLabels(
    labels,
    windowAmounts,
    windowMonths,
    dailyRate,
    { keepZero: false },
  );

  let foodSplit: DailySpendThemeDetail["foodSplit"];
  if (themeId === "food") {
    const groceries = groceriesDaily ?? 0;
    const eatingOut = eatingOutDaily ?? 0;
    const eatingOutLabels = [...CATEGORY_TAXONOMY.Dining];
    if (residual && !eatingOutLabels.includes(residual)) eatingOutLabels.push(residual);
    foodSplit = {
      groceries: {
        id: "groceries",
        label: "Groceries",
        dailyRate: groceries,
        share: dailyRate > 0 ? groceries / dailyRate : 0,
      },
      eatingOut: {
        id: "eating-out",
        label: "Eating out",
        dailyRate: eatingOut,
        share: dailyRate > 0 ? eatingOut / dailyRate : 0,
      },
      eatingOutSubcategories: barsFromLabels(
        eatingOutLabels,
        windowAmounts,
        windowMonths,
        eatingOut,
        { keepZero: true },
      ).filter((bar) => bar.id !== barId("Dining") || bar.dailyRate > 0),
    };
  }

  return {
    subcategories,
    foodSplit,
    merchants: merchantsForTheme(
      themeId,
      expenseTxns,
      windowMonths,
      calendarDays,
      aliasResolver,
    ),
    series: seriesForTheme(themeId, amountsFor, currentYm, daysElapsed, firstDataMonth),
    spendingHref: spendingHrefForTheme(themeId),
  };
}

export function buildDailySpend(input: DailySpendInput): DailySpendResult {
  const today = nowDate(input.today);
  const range = input.range ?? "3m";
  const currency = input.currency ?? "CAD";
  const currentYm = getCurrentMonth(today);
  const lastN = lastNForRange(range);
  const aliasResolver =
    input.sourceMappings && input.sourceMappings.length > 0
      ? buildMerchantAliasResolver(input.sourceMappings)
      : null;

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

  const daysElapsed = daysElapsedInMonth(today);

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
    const groceriesDaily =
      meta.id === "food"
        ? dailyRateFromMonthlyTotals(
            windowAmounts.map((a) => a.groceries),
            windowMonths,
          )
        : undefined;
    const eatingOutDaily =
      meta.id === "food"
        ? dailyRateFromMonthlyTotals(
            windowAmounts.map((a) => a.eatingOut),
            windowMonths,
          )
        : undefined;
    const row: DailySpendThemeRow = {
      id: meta.id,
      label: meta.label,
      color: meta.color,
      dailyRate,
      priorDailyRate,
      delta,
      deltaKind: deltaKind(delta),
      share: everydayDailyRate > 0 ? dailyRate / everydayDailyRate : 0,
      groceriesDaily,
      eatingOutDaily,
      detail: buildThemeDetail(
        meta.id,
        windowAmounts,
        windowMonths,
        calendarDays,
        dailyRate,
        groceriesDaily,
        eatingOutDaily,
        input.expenseTxns,
        amountsFor,
        currentYm,
        daysElapsed,
        aliasResolver,
        allMonths[0] ?? null,
      ),
    };
    return row;
  });
  let currentMonth: DailySpendCurrentMonth | null = null;
  // No strip at all when nothing has been recorded for the current month.
  const hasCurrentMonthTxns = input.expenseTxns.some((t) => t.txMonth === currentYm);
  if (hasCurrentMonthTxns && isMonthInProgress(currentYm, currentYm)) {
    const currentAmounts = amountsFor(currentYm);
    currentMonth = {
      yearMonth: currentYm,
      isInProgress: true,
      inProgressLabel: IN_PROGRESS_LABEL,
      themeTotal: currentAmounts.total,
      hasEverydaySpend: currentAmounts.total > 0,
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
