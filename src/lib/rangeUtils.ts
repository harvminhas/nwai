/**
 * Time range utilities for dashboard, drawers, and pages.
 * 
 * All ranges use COMPLETE months only and exclude the current month.
 */

export type TimeRange = "3mo" | "12mo" | "ytd";

export interface RangeInfo {
  months: string[]; // YYYY-MM format, oldest first
  label: string; // e.g. "avg · This year"
  periodLabel: string; // e.g. "Last 3 months"
}

/**
 * Get the current month in YYYY-MM format.
 */
export function getCurrentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Get the last N complete months (excluding current month).
 */
export function getLastNCompleteMonths(n: number): string[] {
  const now = new Date();
  const months: string[] = [];
  
  for (let i = 1; i <= n; i++) {
    const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    months.unshift(month);
  }
  
  return months;
}

/**
 * Get months from January of current year through last complete month.
 */
export function getYearToDateMonths(): string[] {
  const now = new Date();
  const currentYear = now.getFullYear();
  const months: string[] = [];
  
  // Start from January of current year
  for (let month = 0; month < now.getMonth(); month++) {
    const monthStr = `${currentYear}-${String(month + 1).padStart(2, "0")}`;
    months.push(monthStr);
  }
  
  return months;
}

/**
 * Get months for a given range, filtered to only complete months with data.
 * @param range - The time range (3mo, 12mo, ytd)
 * @param availableMonths - All months with data (from monthlyHistory), sorted oldest first
 * @returns Months in the range that have data, oldest first
 */
export function getRangeMonths(range: TimeRange, availableMonths: string[]): string[] {
  const currentMonth = getCurrentMonth();
  
  // Filter out current month from available data
  const completeMonths = availableMonths.filter(m => m < currentMonth);
  
  let targetMonths: string[];
  
  switch (range) {
    case "3mo":
      targetMonths = getLastNCompleteMonths(3);
      break;
    case "12mo":
      targetMonths = getLastNCompleteMonths(12);
      break;
    case "ytd":
      targetMonths = getYearToDateMonths();
      break;
  }
  
  // Return only months that are in both target and available
  return targetMonths.filter(m => completeMonths.includes(m));
}

/**
 * Get range info including months, label, and period label.
 */
export function getRangeInfo(range: TimeRange, availableMonths: string[]): RangeInfo {
  const months = getRangeMonths(range, availableMonths);
  
  let label: string;
  let periodLabel: string;
  
  switch (range) {
    case "3mo":
      label = "avg · Last 3 months";
      periodLabel = "Last 3 months";
      break;
    case "12mo":
      label = "avg · 12-month";
      periodLabel = "12-month average";
      break;
    case "ytd":
      label = "avg · This year";
      periodLabel = "This year";
      break;
  }
  
  return { months, label, periodLabel };
}

/**
 * Format a month string (YYYY-MM) to display format.
 */
export function formatMonthName(month: string): string {
  const [year, monthNum] = month.split("-");
  const date = new Date(parseInt(year), parseInt(monthNum) - 1);
  return date.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}
