/**
 * Month Anchor — single source of truth for window anchoring and
 * single-area month lists.
 *
 * Two month sets:
 * - Complete months — unfinished current calendar month excluded.
 *   Use monthsForCashFlowAverage / completeMonthsWithData in cashFlowAverage.ts.
 * - Single-area months — every month with data, including the current
 *   month flagged isInProgress.
 *
 * Current month label is always {@link IN_PROGRESS_LABEL} ("In progress").
 */

/** Shared label for the unfinished current calendar month. */
export const IN_PROGRESS_LABEL = "In progress";

export type MonthWithProgress = {
  yearMonth: string;
  isInProgress: boolean;
};

function nowDate(today?: Date): Date {
  if (today) return today;
  const injected = (globalThis as { __TEST_NOW__?: Date }).__TEST_NOW__;
  if (injected instanceof Date) return injected;
  return new Date();
}

/**
 * Get the last complete month (simply the previous calendar month).
 *
 * @param today - Optional date to use as "today" (defaults to now, useful for testing)
 * @returns Last complete month in YYYY-MM format (e.g. "2026-09" if today is Oct 2026)
 */
export function getLastCompleteMonth(today?: Date): string {
  const prevMonth = new Date(nowDate(today));
  prevMonth.setMonth(prevMonth.getMonth() - 1);

  const year = prevMonth.getFullYear();
  const month = String(prevMonth.getMonth() + 1).padStart(2, "0");

  return `${year}-${month}`;
}

/**
 * Get the current month in YYYY-MM format.
 */
export function getCurrentMonth(today?: Date): string {
  const now = nowDate(today);
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

export function isMonthInProgress(
  yearMonth: string,
  currentMonth: string = getCurrentMonth(),
): boolean {
  return Boolean(yearMonth) && yearMonth === currentMonth;
}

/**
 * Format a month with its status for display.
 *
 * @param yearMonth - YYYY-MM format
 * @param isCurrentMonth - True if this is the current calendar month (shown as in progress)
 * @param today - Optional date to use as "today" (defaults to now)
 * @returns Formatted string like "Oct 2026" or "Oct 2026 (In progress)"
 */
export function formatMonthWithStatus(
  yearMonth: string,
  isCurrentMonth: boolean = false,
  _today: Date = new Date(),
  opts?: { short?: boolean },
): string {
  const [year, month] = yearMonth.split("-");
  const date = new Date(parseInt(year, 10), parseInt(month, 10) - 1, 1);
  const monthName = date.toLocaleString("en-US", { month: "short" });
  const displayMonth = opts?.short ? monthName : `${monthName} ${year}`;

  if (isCurrentMonth) {
    return `${displayMonth} (${IN_PROGRESS_LABEL})`;
  }

  return displayMonth;
}

/**
 * Months with data for single-area pages (Income, Spending, Assets, Debts,
 * Net Worth, account/category detail). Includes the current month when it
 * has data, flagged {@link MonthWithProgress.isInProgress}.
 */
export function listMonthsWithData(
  availableMonths: string[],
  options: { currentMonth?: string } = {},
): MonthWithProgress[] {
  const current = options.currentMonth ?? getCurrentMonth();
  const unique = [...new Set(availableMonths.filter(Boolean))].sort();
  return unique.map((yearMonth) => ({
    yearMonth,
    isInProgress: yearMonth === current,
  }));
}

/**
 * Get months for a time window anchored to the last complete month.
 *
 * @param lastCompleteMonth - Anchor month in YYYY-MM format
 * @param allAvailableMonths - All months with data (sorted ascending)
 * @param window - Number of months to include (e.g. 3 for last 3 complete months)
 * @returns Array of YYYY-MM months to use for calculations
 */
export function getMonthsFromAnchor(
  lastCompleteMonth: string,
  allAvailableMonths: string[],
  window: number,
): string[] {
  const completeMonths = allAvailableMonths.filter((m) => m <= lastCompleteMonth);
  return completeMonths.slice(-window);
}
