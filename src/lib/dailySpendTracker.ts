/**
 * Daily spend target tracker — persist a daily target and score finished months.
 *
 * Actuals come only from {@link themeAmountsFromSpending} on
 * {@link computeMonthSpending} (same counted rows as Daily spend). Housing is
 * never in the target. The unfinished current month is pace only.
 */

import type { ExpenseTxnRecord } from "./extractTransactions";
import { completeMonthsWithData } from "./cashFlowAverage";
import {
  calendarDaysInMonth,
  DAILY_SPEND_THEMES,
  daysElapsedInMonth,
  themeAmountsFromSpending,
  type DailySpendResult,
  type DailySpendThemeId,
  type ThemeMonthAmounts,
} from "./dailySpend";
import { formatMonthYear } from "./dateFormatting";
import { getCurrentMonth, isMonthInProgress, listMonthsWithData } from "./monthAnchor";
import { computeMonthSpending, type MonthSpendingOptions } from "./spendingMetrics";

export const TRACKED_DAILY_SPEND_THEME_IDS: readonly DailySpendThemeId[] = [
  "food",
  "getting-around",
  "fun",
];

export const TRACKED_DAILY_SPEND_THEMES = DAILY_SPEND_THEMES.filter((t) =>
  TRACKED_DAILY_SPEND_THEME_IDS.includes(t.id),
);

export const HOUSING_EXCLUDED_FROM_TARGET_NOTE =
  "Housing is left out of the target — it's mostly a fixed bill.";

export const PACE_NOT_FINAL_LABEL = "so far, not final";

export const TRACKER_HISTORY_HREF = "/account/tools/daily-spend/history";

const TRACKED_THEME_ID_SET = new Set<string>(TRACKED_DAILY_SPEND_THEME_IDS);

/** "A", "A and B", "A, B, and C" from theme ids, in Daily spend theme order. */
export function joinThemeLabels(ids: Iterable<string>): string {
  const wanted = new Set<string>(ids);
  const labels = DAILY_SPEND_THEMES.filter((t) => wanted.has(t.id)).map((t) => t.label);
  if (labels.length === 0) return "";
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")}, and ${labels[labels.length - 1]}`;
}

/**
 * Themes a tracker can cover from a What-if chip selection: Housing and
 * unknown ids drop out; order follows {@link TRACKED_DAILY_SPEND_THEME_IDS}.
 * Empty when nothing trackable is selected.
 */
export function trackableThemeIds(ids: Iterable<unknown> | null | undefined): DailySpendThemeId[] {
  const wanted = new Set<string>();
  for (const id of ids ?? []) wanted.add(String(id));
  return TRACKED_DAILY_SPEND_THEME_IDS.filter((id) => wanted.has(id));
}

/** True when two theme selections hold the same ids. */
export function sameThemeSelection(a: Iterable<string>, b: Iterable<string>): boolean {
  const left = new Set<string>(a);
  const right = new Set<string>(b);
  if (left.size !== right.size) return false;
  for (const id of left) if (!right.has(id)) return false;
  return true;
}

function nowDate(today?: Date): Date {
  if (today) return today;
  const injected = (globalThis as { __TEST_NOW__?: Date }).__TEST_NOW__;
  if (injected instanceof Date) return injected;
  return new Date();
}

export function nextFullCalendarMonth(yearMonth: string): string {
  const [yearStr, monthStr] = yearMonth.split("-");
  const date = new Date(Number(yearStr), Number(monthStr), 1);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

export function isTrackedDailySpendTheme(
  id: string | null | undefined,
): id is DailySpendThemeId {
  return Boolean(id) && TRACKED_THEME_ID_SET.has(id as string);
}

export function trackedThemeTotal(
  amounts: ThemeMonthAmounts,
  themes: readonly DailySpendThemeId[] = TRACKED_DAILY_SPEND_THEME_IDS,
): number {
  return themes.reduce((sum, id) => sum + (amounts[id] ?? 0), 0);
}

export function usualFromDailySpend(
  result: DailySpendResult,
  themes: readonly DailySpendThemeId[] = TRACKED_DAILY_SPEND_THEME_IDS,
): { usualDaily: number; usualByTheme: Partial<Record<DailySpendThemeId, number>> } {
  const usualByTheme: Partial<Record<DailySpendThemeId, number>> = {};
  let usualDaily = 0;
  for (const id of themes) {
    const rate = result.themes.find((t) => t.id === id)?.dailyRate ?? 0;
    usualByTheme[id] = rate;
    usualDaily += rate;
  }
  return { usualDaily, usualByTheme };
}

/** Per-day actual for a finished month: theme total / calendar days. */
export function actualDailyFromThemeTotal(themeTotal: number, yearMonth: string): number {
  const days = calendarDaysInMonth(yearMonth);
  return days > 0 ? themeTotal / days : 0;
}

export function paceDailyFromThemeTotal(themeTotal: number, daysElapsed: number): number {
  return daysElapsed > 0 ? themeTotal / daysElapsed : 0;
}

export function monthPromise(usualDaily: number, targetDaily: number, yearMonth: string): number {
  return (usualDaily - targetDaily) * calendarDaysInMonth(yearMonth);
}

export function monthKept(usualDaily: number, actualDaily: number, yearMonth: string): number {
  return (usualDaily - actualDaily) * calendarDaysInMonth(yearMonth);
}

export function monthHit(actualDaily: number, targetDaily: number): boolean {
  return actualDaily <= targetDaily;
}

export interface DailySpendTrackerPeriod {
  targetDaily: number;
  startMonth: string;
}

export interface DailySpendTrackerRecord {
  targetDaily: number;
  usualDailyAtStart: number;
  usualByThemeAtStart: Partial<Record<DailySpendThemeId, number>>;
  startMonth: string;
  trackedThemes: DailySpendThemeId[];
  periods: DailySpendTrackerPeriod[];
  startedAt: string;
  updatedAt: string;
}

export interface DailySpendThemeVsUsual {
  id: DailySpendThemeId;
  label: string;
  actualDaily: number;
  usualDaily: number;
  over: boolean;
}

export interface DailySpendTrackerMonthResult {
  yearMonth: string;
  days: number;
  actualDaily: number;
  actualMonth: number;
  targetDaily: number;
  targetMonth: number;
  usualDaily: number;
  promised: number;
  kept: number;
  hit: boolean;
  themesOverUsual: DailySpendThemeVsUsual[];
}

export interface DailySpendTrackerPace {
  yearMonth: string;
  daysElapsed: number;
  actualDaily: number;
  actualSoFar: number;
  targetDaily: number;
  usualDaily: number;
  trackingHasStarted: boolean;
  hasEverydaySpend: boolean;
}

export interface DailySpendTrackerHitMiss {
  yearMonth: string;
  label: string;
  hit: boolean;
}

export interface DailySpendTrackerView {
  record: DailySpendTrackerRecord;
  pace: DailySpendTrackerPace | null;
  lastFinished: DailySpendTrackerMonthResult | null;
  finishedMonths: DailySpendTrackerMonthResult[];
  totalKept: number;
  hitMiss: DailySpendTrackerHitMiss[];
}

export interface DailySpendTrackerInput {
  expenseTxns: ExpenseTxnRecord[];
  fxRates: Record<string, number>;
  currency?: string;
  today?: Date;
}

function themeLabel(id: DailySpendThemeId): string {
  return DAILY_SPEND_THEMES.find((t) => t.id === id)?.label ?? id;
}

function parseTrackedThemes(raw: unknown): DailySpendThemeId[] {
  const fromList = Array.isArray(raw)
    ? raw.filter((id): id is DailySpendThemeId => isTrackedDailySpendTheme(String(id)))
    : [];
  return fromList.length > 0 ? fromList : [...TRACKED_DAILY_SPEND_THEME_IDS];
}

function parsePeriods(raw: unknown, fallback: DailySpendTrackerPeriod): DailySpendTrackerPeriod[] {
  if (!Array.isArray(raw) || raw.length === 0) return [fallback];
  const periods: DailySpendTrackerPeriod[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Partial<DailySpendTrackerPeriod>;
    const targetDaily = Number(row.targetDaily);
    const startMonth = typeof row.startMonth === "string" ? row.startMonth : "";
    if (!Number.isFinite(targetDaily) || !/^\d{4}-\d{2}$/.test(startMonth)) continue;
    periods.push({ targetDaily, startMonth });
  }
  if (periods.length === 0) return [fallback];
  periods.sort((a, b) => a.startMonth.localeCompare(b.startMonth));
  return periods;
}

function parseUsualByTheme(raw: unknown): Partial<Record<DailySpendThemeId, number>> {
  if (!raw || typeof raw !== "object") return {};
  const out: Partial<Record<DailySpendThemeId, number>> = {};
  for (const id of TRACKED_DAILY_SPEND_THEME_IDS) {
    const value = Number((raw as Record<string, unknown>)[id]);
    if (Number.isFinite(value)) out[id] = value;
  }
  return out;
}

export function parseTrackerRecord(raw: unknown): DailySpendTrackerRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const data = raw as Record<string, unknown>;
  const targetDaily = Number(data.targetDaily);
  const usualDailyAtStart = Number(data.usualDailyAtStart);
  const startMonth = typeof data.startMonth === "string" ? data.startMonth : "";
  if (!Number.isFinite(targetDaily) || !Number.isFinite(usualDailyAtStart)) return null;
  if (!/^\d{4}-\d{2}$/.test(startMonth)) return null;
  const trackedThemes = parseTrackedThemes(data.trackedThemes);
  const periods = parsePeriods(data.periods, { targetDaily, startMonth });
  const startedAt = typeof data.startedAt === "string" ? data.startedAt : "";
  const updatedAt = typeof data.updatedAt === "string" ? data.updatedAt : startedAt;
  return {
    targetDaily,
    usualDailyAtStart,
    usualByThemeAtStart: parseUsualByTheme(data.usualByThemeAtStart),
    startMonth,
    trackedThemes,
    periods,
    startedAt,
    updatedAt,
  };
}

export function createTrackerRecord(opts: {
  targetDaily: number;
  usualDailyAtStart: number;
  usualByThemeAtStart: Partial<Record<DailySpendThemeId, number>>;
  currentYm: string;
  /** Chips selected when tracking started; Housing is dropped. Defaults to all tracked themes. */
  trackedThemes?: readonly DailySpendThemeId[];
  today?: Date;
}): DailySpendTrackerRecord {
  const now = nowDate(opts.today).toISOString();
  const startMonth = nextFullCalendarMonth(opts.currentYm);
  const picked = trackableThemeIds(opts.trackedThemes ?? TRACKED_DAILY_SPEND_THEME_IDS);
  const trackedThemes = picked.length > 0 ? picked : [...TRACKED_DAILY_SPEND_THEME_IDS];
  const usualByThemeAtStart: Partial<Record<DailySpendThemeId, number>> = {};
  for (const id of trackedThemes) {
    usualByThemeAtStart[id] = opts.usualByThemeAtStart[id] ?? 0;
  }
  return {
    targetDaily: opts.targetDaily,
    usualDailyAtStart: opts.usualDailyAtStart,
    usualByThemeAtStart,
    startMonth,
    trackedThemes,
    periods: [{ targetDaily: opts.targetDaily, startMonth }],
    startedAt: now,
    updatedAt: now,
  };
}

/** Period in force for a YYYY-MM month, or null if before the first period. */
export function periodForMonth(
  periods: readonly DailySpendTrackerPeriod[],
  yearMonth: string,
): DailySpendTrackerPeriod | null {
  const applicable = periods
    .filter((p) => p.startMonth <= yearMonth)
    .sort((a, b) => a.startMonth.localeCompare(b.startMonth));
  return applicable[applicable.length - 1] ?? null;
}

/**
 * Editing the target starts a new period from the next calendar month.
 * If the latest period has not started yet, its target is updated in place.
 */
export function applyTargetEdit(
  record: DailySpendTrackerRecord,
  newTarget: number,
  currentYm: string,
  today?: Date,
): DailySpendTrackerRecord {
  if (newTarget === record.targetDaily) return record;
  const now = nowDate(today).toISOString();
  const periods = [...record.periods].sort((a, b) => a.startMonth.localeCompare(b.startMonth));
  const last = periods[periods.length - 1];
  if (last && last.startMonth > currentYm) {
    periods[periods.length - 1] = { ...last, targetDaily: newTarget };
  } else {
    const nextMonth = nextFullCalendarMonth(currentYm);
    if (last && last.startMonth === nextMonth) {
      periods[periods.length - 1] = { ...last, targetDaily: newTarget };
    } else {
      periods.push({ targetDaily: newTarget, startMonth: nextMonth });
    }
  }
  return {
    ...record,
    targetDaily: newTarget,
    periods,
    updatedAt: now,
  };
}

function availableYearMonths(expenseTxns: ExpenseTxnRecord[]): string[] {
  const monthSet = new Set<string>();
  for (const txn of expenseTxns) {
    if (txn.txMonth) monthSet.add(txn.txMonth);
  }
  return listMonthsWithData(Array.from(monthSet)).map((m) => m.yearMonth);
}

function themesOverUsual(
  amounts: ThemeMonthAmounts,
  days: number,
  usualByTheme: Partial<Record<DailySpendThemeId, number>>,
  themes: readonly DailySpendThemeId[],
): DailySpendThemeVsUsual[] {
  if (days <= 0) return [];
  const over: DailySpendThemeVsUsual[] = [];
  for (const id of themes) {
    const actualDaily = (amounts[id] ?? 0) / days;
    const usualDaily = usualByTheme[id] ?? 0;
    if (actualDaily > usualDaily) {
      over.push({
        id,
        label: themeLabel(id),
        actualDaily,
        usualDaily,
        over: true,
      });
    }
  }
  return over;
}

function monthResult(
  yearMonth: string,
  amounts: ThemeMonthAmounts,
  record: DailySpendTrackerRecord,
  days: number,
): DailySpendTrackerMonthResult | null {
  const period = periodForMonth(record.periods, yearMonth);
  if (!period) return null;
  const actualMonth = trackedThemeTotal(amounts, record.trackedThemes);
  const actualDaily = days > 0 ? actualMonth / days : 0;
  const targetDaily = period.targetDaily;
  const usualDaily = record.usualDailyAtStart;
  return {
    yearMonth,
    days,
    actualDaily,
    actualMonth,
    targetDaily,
    targetMonth: targetDaily * days,
    usualDaily,
    promised: (usualDaily - targetDaily) * days,
    kept: (usualDaily - actualDaily) * days,
    hit: monthHit(actualDaily, targetDaily),
    themesOverUsual: themesOverUsual(amounts, days, record.usualByThemeAtStart, record.trackedThemes),
  };
}

export function buildDailySpendTrackerView(
  record: DailySpendTrackerRecord,
  input: DailySpendTrackerInput,
): DailySpendTrackerView {
  const today = nowDate(input.today);
  const currency = input.currency ?? "CAD";
  const currentYm = getCurrentMonth(today);
  const spendOpts: MonthSpendingOptions = {
    homeCurrency: currency,
    fxRates: input.fxRates,
  };
  const monthCache = new Map<string, ThemeMonthAmounts>();
  const amountsFor = (yearMonth: string): ThemeMonthAmounts => {
    const cached = monthCache.get(yearMonth);
    if (cached) return cached;
    const amounts = themeAmountsFromSpending(
      computeMonthSpending(yearMonth, input.expenseTxns, spendOpts),
      spendOpts,
    );
    monthCache.set(yearMonth, amounts);
    return amounts;
  };

  const allMonths = availableYearMonths(input.expenseTxns);
  const completeMonths = completeMonthsWithData(allMonths, { currentMonth: currentYm });
  const finishedMonths = completeMonths
    .filter((ym) => ym >= record.startMonth && !isMonthInProgress(ym, currentYm))
    .map((ym) => monthResult(ym, amountsFor(ym), record, calendarDaysInMonth(ym)))
    .filter((row): row is DailySpendTrackerMonthResult => row != null);

  const lastFinished = finishedMonths.length > 0 ? finishedMonths[finishedMonths.length - 1] : null;
  const totalKept = finishedMonths.reduce((sum, row) => sum + row.kept, 0);
  const hitMiss: DailySpendTrackerHitMiss[] = finishedMonths.map((row) => ({
    yearMonth: row.yearMonth,
    label: formatMonthYear(row.yearMonth),
    hit: row.hit,
  }));

  const daysElapsed = daysElapsedInMonth(today);
  const currentAmounts = amountsFor(currentYm);
  const currentPeriod = periodForMonth(record.periods, currentYm);
  const paceTarget = currentPeriod?.targetDaily ?? record.targetDaily;
  const actualSoFar = trackedThemeTotal(currentAmounts, record.trackedThemes);
  const pace: DailySpendTrackerPace = {
    yearMonth: currentYm,
    daysElapsed,
    actualDaily: paceDailyFromThemeTotal(actualSoFar, daysElapsed),
    actualSoFar,
    targetDaily: paceTarget,
    usualDaily: record.usualDailyAtStart,
    trackingHasStarted: currentYm >= record.startMonth,
    hasEverydaySpend: actualSoFar > 0,
  };

  return {
    record,
    pace,
    lastFinished,
    finishedMonths,
    totalKept,
    hitMiss,
  };
}
