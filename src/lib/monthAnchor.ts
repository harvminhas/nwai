/**
 * Month Anchor — single source of truth for window anchoring.
 * 
 * Used by:
 * - Income page (typical month, last 3 complete months, Trends windows, YoY)
 * - Dashboard buckets and Money Coach (`getMonthsForWindow`)
 * - Savings calculations
 * 
 * Rule: Last complete month = previous calendar month.
 * Current month is always shown as "(in progress)".
 */

/**
 * Get the last complete month (simply the previous calendar month).
 * 
 * @param today - Optional date to use as "today" (defaults to now, useful for testing)
 * @returns Last complete month in YYYY-MM format (e.g. "2026-09" if today is Oct 2026)
 */
export function getLastCompleteMonth(today: Date = new Date()): string {
  const prevMonth = new Date(today);
  prevMonth.setMonth(prevMonth.getMonth() - 1);
  
  const year = prevMonth.getFullYear();
  const month = String(prevMonth.getMonth() + 1).padStart(2, "0");
  
  return `${year}-${month}`;
}

/**
 * Get the current month in YYYY-MM format.
 */
export function getCurrentMonth(today: Date = new Date()): string {
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

/**
 * Format a month with its status for display.
 * 
 * @param yearMonth - YYYY-MM format
 * @param isCurrentMonth - True if this is the current calendar month (shown as in progress)
 * @param today - Optional date to use as "today" (defaults to now)
 * @returns Formatted string like "Oct 2026" or "Oct 2026 (in progress)"
 */
export function formatMonthWithStatus(
  yearMonth: string,
  isCurrentMonth: boolean = false,
  today: Date = new Date()
): string {
  const [year, month] = yearMonth.split("-");
  const date = new Date(parseInt(year), parseInt(month) - 1, 1);
  const monthName = date.toLocaleString("en-US", { month: "short" });
  const displayMonth = `${monthName} ${year}`;
  
  if (isCurrentMonth) {
    return `${displayMonth} (in progress)`;
  }
  
  return displayMonth;
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
  window: number
): string[] {
  // Filter to months <= anchor (complete months only)
  const completeMonths = allAvailableMonths.filter(m => m <= lastCompleteMonth);
  
  // Return the last N complete months
  return completeMonths.slice(-window);
}
