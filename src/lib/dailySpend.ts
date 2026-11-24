/**
 * Daily spend — four-theme mapping and daily-rate math.
 *
 * Theme totals use the same counted rows as {@link computeMonthSpending}
 * (dashboard headline, Spending, cash flow). Subtypes roll up via
 * getParentCategory. Averages use monthsForCashFlowAverage (finished
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
import {
  computeMonthSpending,
  monthSpendingAmount,
  type MonthSpending,
  type MonthSpendingOptions,
  type SpendingTxnLike,
} from "./spendingMetrics";
import { spendingHrefForCategories } from "./spendingMultiCategory";
import {
  buildMerchantAliasResolver,
  merchantDisplayNamesFromRecords,
  resolveSpendingMerchant,
  type MerchantAliasResolver,
} from "./merchantAliases";

export type DailySpendRange = "3m" | "6m" | "12m";

export type DailySpendThemeId =
  | "food"
  | "housing"
  | "getting-around"
  | "fun";

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
export const TOP_MERCHANTS_HEADING = "Top 5 merchants";
export const TOP_GROCERY_STORES_HEADING = "Top grocery stores";
export const TOP_EAT_OUT_PLACES_HEADING = "Top places you eat out";

export const DAILY_SPEND_THEMES: ReadonlyArray<{
  id: DailySpendThemeId;
  label: string;
  color: string;
}> = [
  { id: "food", label: "Eating", color: "#22c55e" },
  { id: "housing", label: "Housing", color: "#3b82f6" },
  { id: "getting-around", label: "Getting around", color: "#f59e0b" },
  { id: "fun", label: "Fun & entertainment", color: "#ec4899" },
];

/** Every Spending-page parent a theme spans, for the “See {theme} in Spending” link. */
export const THEME_SPENDING_CATEGORIES: Record<DailySpendThemeId, string[]> = {
  food: ["Groceries", "Dining"],
  housing: ["Housing"],
  "getting-around": ["Transportation"],
  fun: ["Entertainment"],
};

/** Where Daily spend counts more than the linked Spending view shows. */
export const THEME_SPENDING_NOTE: Partial<Record<DailySpendThemeId, string>> = {
  housing:
    "Also counted here: Property Tax, Tenant Insurance and mortgage payments filed under Debt, which Spending's Housing view lists elsewhere.",
};

/** Plain-language list of what Daily spend includes (replaces the old “bills left out” note). */
export const DAILY_SPEND_INCLUDED_NOTE =
  "Eating (groceries and restaurants), housing bills (rent, utilities, home insurance), getting around, and fun & entertainment (including streaming).";

export interface ThemeMonthAmounts {
  food: number;
  groceries: number;
  eatingOut: number;
  housing: number;
  "getting-around": number;
  fun: number;
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
    groceryMerchants: DailySpendMerchantRow[];
    eatingOutMerchants: DailySpendMerchantRow[];
  };
  merchants: DailySpendMerchantRow[];
  series: DailySpendSeriesPoint[];
  spendingHref: string;
  spendingNote?: string;
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
  /** users/{uid}/merchantDisplayNames — same saved renames Spending merchant detail uses. */
  merchantDisplayNames?: Array<{ slug: string; displayName: string }>;
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
    housing: 0,
    "getting-around": 0,
    fun: 0,
    total: 0,
    subcategories: {},
  };
}

function taxonomySubtypeMatch(parent: keyof typeof CATEGORY_TAXONOMY, category: string): string | null {
  const lower = category.trim().toLowerCase();
  return (CATEGORY_TAXONOMY[parent] ?? []).find((s) => s.toLowerCase() === lower) ?? null;
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
  return spendingHrefForCategories(THEME_SPENDING_CATEGORIES[themeId]);
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

export type ThemeCategoryOpts = {
  /** Structured debt type from the statement — not a merchant name. */
  debtType?: string;
};

/**
 * Map a Spending-page category (parent or subtype) to a Daily spend theme.
 * Uses {@link getParentCategory} and taxonomy subtypes — no merchant matching.
 * Only rows that {@link computeMonthSpending} counts should be passed in.
 */
export function themeIdForCategory(
  category: string,
  opts?: ThemeCategoryOpts,
): DailySpendThemeId | null {
  const parent = getParentCategory(category);
  const lower = category.trim().toLowerCase();

  if (parent === "Groceries" || parent === "Dining") return "food";
  if (parent === "Housing") return "housing";
  if (parent === "Transportation") return "getting-around";
  if (parent === "Entertainment") return "fun";

  if (parent === "Taxes" && taxonomySubtypeMatch("Taxes", category) === "Property Tax") {
    return "housing";
  }
  if (parent === "Insurance" && taxonomySubtypeMatch("Insurance", category) === "Tenant Insurance") {
    return "housing";
  }
  // Mortgage payments the parser tagged as Debt (alias "Mortgage Payment") —
  // not auto/student installment servicing.
  if (parent === "Debt" && lower.includes("mortgage")) return "housing";
  if (parent === "Debt" && (opts?.debtType ?? "").toLowerCase().replace(/-/g, "_") === "mortgage") {
    return "housing";
  }

  return null;
}

export function foodSplitForCategory(category: string): FoodSplit | null {
  if (themeIdForCategory(category) !== "food") return null;
  return getParentCategory(category) === "Groceries" ? "groceries" : "eating-out";
}

/**
 * Display label for a theme leaf: taxonomy subtype, Groceries, or the parent
 * residual (e.g. untyped "Dining" or "Transportation").
 */
export function subcategoryLabelForCategory(
  category: string,
  opts?: ThemeCategoryOpts,
): string | null {
  if (!themeIdForCategory(category, opts)) return null;
  const parent = getParentCategory(category);
  const lower = category.trim().toLowerCase();
  const subtypes = CATEGORY_TAXONOMY[parent] ?? [];
  const match = subtypes.find((s) => s.toLowerCase() === lower);
  if (match) return match;
  if (parent === "Groceries") return "Groceries";
  if (themeIdForCategory(category, opts) === "housing" && parent === "Debt") {
    return "Mortgage";
  }
  return parent;
}

function taxonomyLabelsForTheme(themeId: DailySpendThemeId): string[] {
  switch (themeId) {
    case "food":
      return ["Groceries", ...CATEGORY_TAXONOMY.Dining];
    case "housing":
      return [
        ...CATEGORY_TAXONOMY.Housing,
        ...CATEGORY_TAXONOMY.Taxes.filter((s) => s === "Property Tax"),
        ...CATEGORY_TAXONOMY.Insurance.filter((s) => s === "Tenant Insurance"),
      ];
    case "getting-around":
      return [...CATEGORY_TAXONOMY.Transportation];
    case "fun":
      return [...CATEGORY_TAXONOMY.Entertainment];
  }
}

function residualParentForTheme(themeId: DailySpendThemeId): string | null {
  switch (themeId) {
    case "food":
      return "Dining";
    case "housing":
      return "Housing";
    case "getting-around":
      return "Transportation";
    case "fun":
      return "Entertainment";
  }
}

function themeLabel(themeId: DailySpendThemeId): string {
  return DAILY_SPEND_THEMES.find((t) => t.id === themeId)?.label ?? themeId;
}

/**
 * Parent-only leftover (txns tagged with the parent, no subtype) folds into
 * this subtype when one is a generic catch-all. Dining's first leaf is
 * Restaurants; other theme parents have no generic sibling.
 */
export function genericSubtypeForResidual(residualParent: string): string | null {
  if (residualParent !== "Dining") return null;
  return CATEGORY_TAXONOMY.Dining[0] ?? null;
}

/** Display label for a folded generic subtype, or "Other {theme}" leftover. */
export function leftoverRowLabel(
  themeId: DailySpendThemeId,
  residualParent: string,
  genericSubtype: string | null,
): string {
  if (genericSubtype) return `${genericSubtype} & ${residualParent.toLowerCase()}`;
  return `Other ${themeLabel(themeId)}`;
}

/**
 * Display-only: merge the parent residual bar into the generic subtype, or
 * relabel it "Other {theme}". Does not change stored categories.
 */
function foldParentLeftoverIntoGeneric(
  bars: DailySpendBar[],
  residualLabel: string,
  themeId: DailySpendThemeId,
  shareOf: number,
): DailySpendBar[] {
  if (!residualLabel) return bars;
  const generic = genericSubtypeForResidual(residualLabel);
  const leftover = bars.find((b) => b.label === residualLabel);
  const without = bars.filter((b) => b.label !== residualLabel);
  const extra = leftover?.dailyRate ?? 0;

  if (generic) {
    const mergedLabel = leftoverRowLabel(themeId, residualLabel, generic);
    const targetIdx = without.findIndex((b) => b.label === generic);
    if (targetIdx >= 0) {
      const target = without[targetIdx];
      const dailyRate = target.dailyRate + extra;
      const merged: DailySpendBar = {
        id: barId(mergedLabel),
        label: mergedLabel,
        dailyRate,
        share: shareOf > 0 ? dailyRate / shareOf : 0,
      };
      return [...without.slice(0, targetIdx), merged, ...without.slice(targetIdx + 1)];
    }
    if (extra > 0) {
      return [
        {
          id: barId(mergedLabel),
          label: mergedLabel,
          dailyRate: extra,
          share: shareOf > 0 ? extra / shareOf : 0,
        },
        ...without,
      ];
    }
    return without;
  }

  if (!leftover || leftover.dailyRate <= 0) return without;
  const otherLabel = leftoverRowLabel(themeId, residualLabel, null);
  return [
    ...without,
    {
      id: barId(otherLabel),
      label: otherLabel,
      dailyRate: leftover.dailyRate,
      share: shareOf > 0 ? leftover.dailyRate / shareOf : 0,
    },
  ];
}

function addThemeAmount(
  amounts: ThemeMonthAmounts,
  category: string,
  amount: number,
  opts?: ThemeCategoryOpts,
): void {
  const theme = themeIdForCategory(category, opts);
  if (!theme) return;
  amounts[theme] += amount;
  amounts.total += amount;
  const sub = subcategoryLabelForCategory(category, opts);
  if (sub) {
    amounts.subcategories[sub] = (amounts.subcategories[sub] ?? 0) + amount;
  }
  if (theme === "food") {
    const split = foodSplitForCategory(category);
    if (split === "groceries") amounts.groceries += amount;
    else amounts.eatingOut += amount;
  }
}

export function themeAmountsFromCategories(
  categories: Array<{ category: string; amount: number }>,
): ThemeMonthAmounts {
  const amounts = emptyThemeAmounts();
  for (const cat of categories) {
    addThemeAmount(amounts, cat.category, cat.amount);
  }
  return amounts;
}

/** Theme totals from the same counted rows {@link computeMonthSpending} returns. */
export function themeAmountsFromSpending(
  spending: MonthSpending,
  options?: MonthSpendingOptions,
): ThemeMonthAmounts {
  const amounts = emptyThemeAmounts();
  for (const line of spending.lines) {
    if (line.transactions.length > 0) {
      for (const txn of line.transactions) {
        addThemeAmount(amounts, txn.category ?? line.category, monthSpendingAmount(txn, options), {
          debtType: txn.debtType,
        });
      }
    } else {
      addThemeAmount(amounts, line.category, line.amount);
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

function topMerchants(
  expenseTxns: ExpenseTxnRecord[],
  windowMonths: string[],
  calendarDays: number,
  aliasResolver: MerchantAliasResolver | null,
  displayNames: ReadonlyMap<string, string> | null,
  matches: (txn: ExpenseTxnRecord) => boolean,
): DailySpendMerchantRow[] {
  const monthSet = new Set(windowMonths);
  const map = new Map<string, { name: string; renamed: boolean; total: number; count: number }>();
  for (const txn of expenseTxns) {
    if (!monthSet.has(txn.txMonth)) continue;
    if (!matches(txn)) continue;
    const { slug, name } = resolveSpendingMerchant(txn.merchant, aliasResolver, displayNames);
    // Several statement slugs can share one canonical row (amazon-ca, amazon-com → amazon).
    // A rename saved on any of them wins, whatever order the transactions arrive in.
    const renamed =
      displayNames != null && name !== resolveSpendingMerchant(txn.merchant, aliasResolver).name;
    const cur = map.get(slug) ?? { name, renamed, total: 0, count: 0 };
    if (renamed && !cur.renamed) {
      cur.name = name;
      cur.renamed = true;
    }
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

function countedThemeTxns(
  spendingFor: (yearMonth: string) => MonthSpending,
  windowMonths: string[],
  matches: (txn: SpendingTxnLike) => boolean,
): ExpenseTxnRecord[] {
  const rows: ExpenseTxnRecord[] = [];
  for (const ym of windowMonths) {
    for (const line of spendingFor(ym).lines) {
      for (const txn of line.transactions) {
        if (matches(txn)) rows.push(txn as ExpenseTxnRecord);
      }
    }
  }
  return rows;
}

function merchantsForTheme(
  themeId: DailySpendThemeId,
  spendingFor: (yearMonth: string) => MonthSpending,
  windowMonths: string[],
  calendarDays: number,
  aliasResolver: MerchantAliasResolver | null,
  displayNames: ReadonlyMap<string, string> | null,
): DailySpendMerchantRow[] {
  const txns = countedThemeTxns(
    spendingFor,
    windowMonths,
    (txn) => themeIdForCategory(txn.category ?? "", { debtType: txn.debtType }) === themeId,
  );
  return topMerchants(
    txns,
    windowMonths,
    calendarDays,
    aliasResolver,
    displayNames,
    () => true,
  );
}

function merchantsForFoodSplit(
  split: FoodSplit,
  spendingFor: (yearMonth: string) => MonthSpending,
  windowMonths: string[],
  calendarDays: number,
  aliasResolver: MerchantAliasResolver | null,
  displayNames: ReadonlyMap<string, string> | null,
): DailySpendMerchantRow[] {
  const txns = countedThemeTxns(
    spendingFor,
    windowMonths,
    (txn) => foodSplitForCategory(txn.category ?? "") === split,
  );
  return topMerchants(
    txns,
    windowMonths,
    calendarDays,
    aliasResolver,
    displayNames,
    () => true,
  );
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
  spendingFor: (yearMonth: string) => MonthSpending,
  amountsFor: (yearMonth: string) => ThemeMonthAmounts,
  currentYm: string,
  daysElapsed: number,
  aliasResolver: MerchantAliasResolver | null,
  displayNames: ReadonlyMap<string, string> | null,
  firstDataMonth: string | null,
): DailySpendThemeDetail {
  const residual = residualParentForTheme(themeId);
  const labels = [...taxonomyLabelsForTheme(themeId)];
  if (residual && !labels.includes(residual)) labels.push(residual);

  const subcategories = foldParentLeftoverIntoGeneric(
    barsFromLabels(
      labels,
      windowAmounts,
      windowMonths,
      dailyRate,
      { keepZero: false },
    ),
    residual ?? "",
    themeId,
    dailyRate,
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
      eatingOutSubcategories: foldParentLeftoverIntoGeneric(
        barsFromLabels(
          eatingOutLabels,
          windowAmounts,
          windowMonths,
          eatingOut,
          { keepZero: true },
        ),
        residual ?? "Dining",
        themeId,
        eatingOut,
      ),
      groceryMerchants: merchantsForFoodSplit(
        "groceries",
        spendingFor,
        windowMonths,
        calendarDays,
        aliasResolver,
        displayNames,
      ),
      eatingOutMerchants: merchantsForFoodSplit(
        "eating-out",
        spendingFor,
        windowMonths,
        calendarDays,
        aliasResolver,
        displayNames,
      ),
    };
  }

  return {
    subcategories,
    foodSplit,
    merchants: merchantsForTheme(
      themeId,
      spendingFor,
      windowMonths,
      calendarDays,
      aliasResolver,
      displayNames,
    ),
    series: seriesForTheme(themeId, amountsFor, currentYm, daysElapsed, firstDataMonth),
    spendingHref: spendingHrefForTheme(themeId),
    ...(THEME_SPENDING_NOTE[themeId] ? { spendingNote: THEME_SPENDING_NOTE[themeId] } : {}),
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
  const displayNames =
    input.merchantDisplayNames && input.merchantDisplayNames.length > 0
      ? merchantDisplayNamesFromRecords(
          input.merchantDisplayNames.map((d) => ({ id: d.slug, displayName: d.displayName })),
        )
      : null;

  const allMonths = availableYearMonths(input.expenseTxns);
  const completeMonths = completeMonthsWithData(allMonths, { currentMonth: currentYm });
  const windowMonths = monthsForCashFlowAverage(allMonths, {
    lastNComplete: lastN,
    currentMonth: currentYm,
  });
  const priorMonths = priorWindowMonths(completeMonths, windowMonths);

  const monthCache = new Map<string, MonthSpending>();
  const spendingFor = (yearMonth: string): MonthSpending => {
    const cached = monthCache.get(yearMonth);
    if (cached) return cached;
    const summary = computeMonthSpending(yearMonth, input.expenseTxns, {
      homeCurrency: currency,
      fxRates: input.fxRates,
    });
    monthCache.set(yearMonth, summary);
    return summary;
  };

  const amountsFor = (yearMonth: string): ThemeMonthAmounts =>
    themeAmountsFromSpending(spendingFor(yearMonth), {
      homeCurrency: currency,
      fxRates: input.fxRates,
    });

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
        spendingFor,
        amountsFor,
        currentYm,
        daysElapsed,
        aliasResolver,
        displayNames,
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
