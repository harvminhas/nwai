/**
 * Shared date and month formatting helpers.
 * Use these everywhere in the UI instead of raw YYYY-MM strings.
 * 
 * Internal keys (data structures, API, DB) can stay YYYY-MM.
 */

const MONTH_NAMES_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_NAMES_FULL = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/**
 * Format a YYYY-MM string as short month name (e.g., "Jul").
 * For tight spaces like bar charts.
 */
export function formatMonth(yearMonth: string): string {
  const [year, month] = yearMonth.split("-");
  const monthIndex = parseInt(month, 10) - 1;
  return MONTH_NAMES_SHORT[monthIndex] || yearMonth;
}

/**
 * Format a YYYY-MM string as "MMM YYYY" (e.g., "Jul 2026").
 * For labels, headers, and axis labels.
 */
export function formatMonthYear(yearMonth: string): string {
  const [year, month] = yearMonth.split("-");
  const monthIndex = parseInt(month, 10) - 1;
  return `${MONTH_NAMES_SHORT[monthIndex]} ${year}`;
}

/**
 * Format a range of months as "MMM – MMM YYYY" (e.g., "Jul – Sep 2026").
 * If months span years, shows both years.
 */
export function formatMonthRange(startYearMonth: string, endYearMonth: string): string {
  const [startYear, startMonth] = startYearMonth.split("-");
  const [endYear, endMonth] = endYearMonth.split("-");
  
  const startMonthIndex = parseInt(startMonth, 10) - 1;
  const endMonthIndex = parseInt(endMonth, 10) - 1;
  
  if (startYear === endYear) {
    return `${MONTH_NAMES_SHORT[startMonthIndex]} – ${MONTH_NAMES_SHORT[endMonthIndex]} ${endYear}`;
  } else {
    return `${MONTH_NAMES_SHORT[startMonthIndex]} ${startYear} – ${MONTH_NAMES_SHORT[endMonthIndex]} ${endYear}`;
  }
}

/**
 * Format a date string as "MMM D, YYYY" (e.g., "Jul 5, 2026").
 * For transaction rows and date displays.
 */
export function formatDate(dateString: string): string {
  const date = new Date(dateString + "T00:00:00"); // Avoid timezone shifts
  const monthIndex = date.getMonth();
  const day = date.getDate();
  const year = date.getFullYear();
  
  return `${MONTH_NAMES_SHORT[monthIndex]} ${day}, ${year}`;
}

/**
 * Format a date string with full month name (e.g., "July 5, 2026").
 * For longer-form displays.
 */
export function formatDateFull(dateString: string): string {
  const date = new Date(dateString + "T00:00:00");
  const monthIndex = date.getMonth();
  const day = date.getDate();
  const year = date.getFullYear();
  
  return `${MONTH_NAMES_FULL[monthIndex]} ${day}, ${year}`;
}
