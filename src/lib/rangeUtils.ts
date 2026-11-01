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

/**
 * Resolved window months result.
 */
export interface ResolvedWindowMonths {
  /** Months included in the window (YYYY-MM format, oldest first) */
  months: string[];
  /** Number of months actually used (may be less than requested if data is sparse) */
  actualCount: number;
  /** Number of months requested */
  requestedCount: number;
  /** Display note for UI (e.g., "2 of 3 months") */
  note?: string;
}

/**
 * Resolve window months for a given time range, using the latest uploaded statement month as the anchor.
 * 
 * Behavior:
 * - 3-month window: latest 3 calendar months ending at the most recent statement month
 * - 12-month window: latest 12 calendar months ending at the most recent statement month
 * - YTD: January through the most recent statement month in the current year
 * 
 * If a month in the window has no data, we skip it and average over only the months present.
 * Returns the actual months used and metadata for displaying a note like "2 of 3 months".
 * 
 * @param range - Time range to resolve
 * @param monthlyHistory - Monthly history entries with data
 * @returns Resolved months with actual count and optional UI note
 */
export function resolveWindowMonths(
  range: TimeRange,
  monthlyHistory: Array<{ yearMonth: string }>
): ResolvedWindowMonths {
  // Get all available months sorted
  const availableMonths = monthlyHistory.map(m => m.yearMonth).sort();
  
  if (availableMonths.length === 0) {
    return {
      months: [],
      actualCount: 0,
      requestedCount: 0,
    };
  }
  
  // Latest uploaded statement month is the anchor
  const latestMonth = availableMonths[availableMonths.length - 1];
  const [latestYear, latestMonthNum] = latestMonth.split("-").map(Number);
  
  // Generate target calendar months based on the range
  let targetMonths: string[];
  let requestedCount: number;
  
  switch (range) {
    case "3mo": {
      requestedCount = 3;
      targetMonths = [];
      for (let i = 2; i >= 0; i--) {
        const date = new Date(latestYear, latestMonthNum - 1 - i, 1);
        const ym = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
        targetMonths.push(ym);
      }
      break;
    }
    
    case "12mo": {
      requestedCount = 12;
      targetMonths = [];
      for (let i = 11; i >= 0; i--) {
        const date = new Date(latestYear, latestMonthNum - 1 - i, 1);
        const ym = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
        targetMonths.push(ym);
      }
      break;
    }
    
    case "ytd": {
      // YTD uses the year of the latest uploaded statement
      const [latestYearNum] = latestMonth.split("-").map(Number);
      const startMonth = `${latestYearNum}-01`;
      
      targetMonths = [];
      let year = latestYearNum;
      let month = 1;
      
      while (true) {
        const ym = `${year}-${String(month).padStart(2, "0")}`;
        if (ym > latestMonth) break;
        targetMonths.push(ym);
        
        month++;
        if (month > 12) {
          break; // YTD never crosses year boundary
        }
      }
      
      requestedCount = targetMonths.length;
      break;
    }
    
    default:
      return {
        months: [],
        actualCount: 0,
        requestedCount: 0,
      };
  }
  
  // Filter to only months that have data
  const monthsWithData = targetMonths.filter(m => availableMonths.includes(m));
  const actualCount = monthsWithData.length;
  
  // Generate note if we're missing months
  let note: string | undefined;
  if (actualCount < requestedCount && actualCount > 0) {
    note = `${actualCount} of ${requestedCount} months`;
  }
  
  return {
    months: monthsWithData,
    actualCount,
    requestedCount,
    note,
  };
}
