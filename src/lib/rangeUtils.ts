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
  /** Latest complete month used as anchor */
  anchorMonth?: string;
  /** Account names missing from a newer month (if any) */
  missingAccounts?: string[];
  /** The YYYY-MM month that is missing (if missingAccounts is populated) */
  missingMonth?: string;
}

/**
 * Format account name as "Bank Type •••1234"
 */
function formatAccountName(acc: { name?: string; slug: string; type: string }): string {
  if (!acc.name) return acc.slug;
  
  // Extract bank name and last 4 digits from slug (format: bank-type-id)
  const parts = acc.slug.split('-');
  const last4 = parts[parts.length - 1].slice(-4);
  const bank = acc.name.split(' ')[0]; // First word is typically the bank
  
  return `${bank} ${acc.type} •••${last4}`;
}

/**
 * Format statement coverage as "through Mon D"
 */
function formatCoverageThrough(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00');
  return `through ${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
}

/**
 * Determine the latest complete month based on actual statement coverage dates.
 * 
 * A month M is complete when every active checking/credit account's coverage end date
 * is >= the last day of M minus 7 days grace (since card cycles close mid-month).
 * Only months fully in the past qualify.
 * 
 * An account is active if it has a statement within ~60 days of the newest statement.
 * 
 * @param accountSnapshots - All account snapshots with their coverage dates
 * @returns Latest complete month, missing accounts with their coverage, and missing month
 */
export function getLatestCompleteMonth(
  accountSnapshots: Array<{ 
    accountType: string; 
    statementMonth: string;
    statementDate: string;
    accountName?: string;
    slug: string;
  }>
): { latestCompleteMonth: string | undefined; missingAccounts: string[]; missingMonth?: string } {
  const GRACE_DAYS = 7; // Credit cards can close mid-month
  const ACTIVE_WINDOW_DAYS = 60; // Account is active if statement within last 60 days
  
  // Filter to transactional accounts (checking and credit only)
  const transactionalAccounts = accountSnapshots.filter(a => {
    const type = a.accountType.toLowerCase();
    return type === 'checking' || type === 'chequing' || type === 'credit';
  });

  if (transactionalAccounts.length === 0) {
    // No transactional accounts - use latest statement month from any account
    const allMonths = accountSnapshots.map(a => a.statementMonth).sort();
    return {
      latestCompleteMonth: allMonths.length > 0 ? allMonths[allMonths.length - 1] : undefined,
      missingAccounts: [],
      missingMonth: undefined,
    };
  }
  
  // Group by slug and take latest statement per account
  const latestBySlug = new Map<string, typeof transactionalAccounts[0]>();
  for (const acc of transactionalAccounts) {
    const existing = latestBySlug.get(acc.slug);
    if (!existing || acc.statementDate > existing.statementDate) {
      latestBySlug.set(acc.slug, acc);
    }
  }
  
  const latestStatements = Array.from(latestBySlug.values());
  
  // Find the newest statement date across all accounts
  const newestDate = latestStatements
    .map(a => new Date(a.statementDate + 'T00:00:00').getTime())
    .reduce((max, d) => Math.max(max, d), 0);
  
  const cutoffDate = newestDate - (ACTIVE_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  
  // Filter to active accounts (have statement within last 60 days of newest)
  const activeAccounts = latestStatements
    .filter(a => new Date(a.statementDate + 'T00:00:00').getTime() >= cutoffDate)
    .map(a => ({
      slug: a.slug,
      name: a.accountName,
      type: a.accountType,
      coverageEnd: new Date(a.statementDate + 'T00:00:00'),
      coverageEndStr: a.statementDate,
    }));
  
  if (activeAccounts.length === 0) {
    return {
      latestCompleteMonth: undefined,
      missingAccounts: [],
      missingMonth: undefined,
    };
  }
  
  // Start from the earliest coverage end, work forward to find the latest complete month
  const now = new Date();
  const currentYearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  
  // Generate candidate months from earliest coverage to last full calendar month
  const earliestCoverage = Math.min(...activeAccounts.map(a => a.coverageEnd.getTime()));
  const earliestDate = new Date(earliestCoverage);
  const startYear = earliestDate.getFullYear();
  const startMonth = earliestDate.getMonth() + 1;
  
  const lastFullCalendarMonth = getPreviousMonth(currentYearMonth);
  const [endYear, endMonth] = lastFullCalendarMonth.split('-').map(Number);
  
  const candidateMonths: string[] = [];
  for (let y = startYear; y <= endYear; y++) {
    const mStart = (y === startYear) ? startMonth : 1;
    const mEnd = (y === endYear) ? endMonth : 12;
    for (let m = mStart; m <= mEnd; m++) {
      candidateMonths.push(`${y}-${String(m).padStart(2, '0')}`);
    }
  }
  
  // Work backwards to find the latest complete month
  let latestCompleteMonth: string | undefined;
  for (let i = candidateMonths.length - 1; i >= 0; i--) {
    const month = candidateMonths[i];
    const [year, mon] = month.split('-').map(Number);
    const lastDayOfMonth = new Date(year, mon, 0).getDate();
    const monthEnd = new Date(year, mon - 1, lastDayOfMonth);
    const graceDate = new Date(monthEnd.getTime() - (GRACE_DAYS * 24 * 60 * 60 * 1000));
    
    // Check if every active account covers this month (within grace period)
    const allCovered = activeAccounts.every(acc => acc.coverageEnd >= graceDate);
    
    if (allCovered) {
      latestCompleteMonth = month;
      break;
    }
  }
  
  if (!latestCompleteMonth) {
    return {
      latestCompleteMonth: undefined,
      missingAccounts: [],
      missingMonth: undefined,
    };
  }
  
  // Check if there's a month after the anchor that's past but incomplete
  const nextMonth = getNextMonth(latestCompleteMonth);
  if (nextMonth > lastFullCalendarMonth) {
    // No past month after anchor to nudge for
    return {
      latestCompleteMonth,
      missingAccounts: [],
      missingMonth: undefined,
    };
  }
  
  // Check which active accounts are missing the next month
  const [nextYear, nextMon] = nextMonth.split('-').map(Number);
  const nextMonthEnd = new Date(nextYear, nextMon, 0);
  const nextGraceDate = new Date(nextMonthEnd.getTime() - (GRACE_DAYS * 24 * 60 * 60 * 1000));
  
  const missingAccounts = activeAccounts
    .filter(acc => acc.coverageEnd < nextGraceDate)
    .map(acc => `${formatAccountName(acc)} (statements ${formatCoverageThrough(acc.coverageEndStr)})`);
  
  if (missingAccounts.length === 0) {
    return {
      latestCompleteMonth,
      missingAccounts: [],
      missingMonth: undefined,
    };
  }
  
  return {
    latestCompleteMonth,
    missingAccounts,
    missingMonth: nextMonth,
  };
}

/**
 * Get the next month in YYYY-MM format.
 */
function getNextMonth(yearMonth: string): string {
  const [year, month] = yearMonth.split('-').map(Number);
  const nextDate = new Date(year, month, 1); // month is 0-indexed, so this is actually next month
  return `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Get the previous month in YYYY-MM format.
 */
function getPreviousMonth(yearMonth: string): string {
  const [year, month] = yearMonth.split('-').map(Number);
  const prevDate = new Date(year, month - 2, 1); // month - 2 because JS months are 0-indexed and we want previous
  return `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Resolve window months for a given time range, using the latest COMPLETE month as the anchor.
 * 
 * A month is complete when all active checking and credit accounts have statement coverage.
 * Partial months are excluded from all calculations.
 * 
 * Behavior:
 * - 3-month window: latest 3 calendar months ending at the latest complete month
 * - 12-month window: latest 12 calendar months ending at the latest complete month
 * - YTD: January through the latest complete month in the current year
 * 
 * If a month in the window has no data, we skip it and average over only the months present.
 * Returns the actual months used and metadata for displaying a note like "2 of 3 months".
 * 
 * @param range - Time range to resolve
 * @param monthlyHistory - Monthly history entries with data
 * @param accountSnapshots - Account snapshots to determine completeness (optional for backwards compatibility)
 * @returns Resolved months with actual count and optional UI note
 */
export function resolveWindowMonths(
  range: TimeRange,
  monthlyHistory: Array<{ yearMonth: string }>,
  accountSnapshots?: Array<{ 
    accountType: string; 
    statementMonth: string; 
    accountName?: string;
    slug: string;
  }>
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
  
  // Determine the anchor month (latest complete month)
  let latestMonth: string;
  let missingAccounts: string[] = [];
  let missingMonth: string | undefined;
  
  if (accountSnapshots && accountSnapshots.length > 0) {
    const { latestCompleteMonth, missingAccounts: missing, missingMonth: missingMo } = getLatestCompleteMonth(accountSnapshots);
    
    if (latestCompleteMonth) {
      latestMonth = latestCompleteMonth;
      missingAccounts = missing;
      missingMonth = missingMo;
    } else {
      // No complete month found - fall back to latest available month
      latestMonth = availableMonths[availableMonths.length - 1];
    }
  } else {
    // No account snapshots provided - use latest available month
    latestMonth = availableMonths[availableMonths.length - 1];
  }
  
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
  
  // Filter to only months that have data AND are <= anchor month (exclude partial future months)
  const monthsWithData = targetMonths.filter(m => availableMonths.includes(m) && m <= latestMonth);
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
    anchorMonth: latestMonth,
    missingAccounts: missingAccounts.length > 0 ? missingAccounts : undefined,
    missingMonth,
  };
}
