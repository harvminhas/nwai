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
 * Format a list of months for display, handling cross-year cases.
 * Examples:
 * - ["2026-02", "2026-03", "2026-08"] → "Feb, Mar and Aug 2026"
 * - ["2025-12", "2026-01", "2026-02"] → "Dec 2025, Jan and Feb 2026"
 * - ["2026-08"] → "Aug 2026"
 */
export function formatMonthList(months: string[]): string {
  if (months.length === 0) return "";
  if (months.length === 1) {
    const [year, month] = months[0].split('-');
    const date = new Date(parseInt(year), parseInt(month) - 1);
    return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  }
  
  // Group by year
  const byYear = new Map<string, string[]>();
  for (const ym of months) {
    const [year, month] = ym.split('-');
    if (!byYear.has(year)) byYear.set(year, []);
    byYear.get(year)!.push(month);
  }
  
  // Format each year group
  const yearGroups: string[] = [];
  for (const [year, monthNums] of Array.from(byYear.entries()).sort()) {
    const monthNames = monthNums.map(m => {
      const date = new Date(parseInt(year), parseInt(m) - 1);
      return date.toLocaleDateString('en-US', { month: 'short' });
    });
    
    if (monthNames.length === 1) {
      yearGroups.push(`${monthNames[0]} ${year}`);
    } else {
      const lastMonth = monthNames.pop();
      yearGroups.push(`${monthNames.join(', ')} and ${lastMonth} ${year}`);
    }
  }
  
  if (yearGroups.length === 1) {
    return yearGroups[0];
  }
  
  // Join year groups
  const lastGroup = yearGroups.pop();
  return `${yearGroups.join(', ')}, ${lastGroup}`;
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
  /** Missing months within the window (YYYY-MM format) */
  missingMonths?: string[];
  /** Account names missing with their coverage details */
  missingAccounts?: string[];
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
    statementDate?: string;
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
    const accDate = parseStatementDate(acc.statementDate, acc.statementMonth);
    const existingDate = existing ? parseStatementDate(existing.statementDate, existing.statementMonth) : null;
    
    if (!existing || (existingDate && accDate > existingDate)) {
      latestBySlug.set(acc.slug, acc);
    }
  }
  
  const latestStatements = Array.from(latestBySlug.values());
  
  // Find the newest statement date across all accounts
  const newestDate = latestStatements
    .map(a => parseStatementDate(a.statementDate, a.statementMonth).getTime())
    .reduce((max, d) => Math.max(max, d), 0);
  
  const cutoffDate = newestDate - (ACTIVE_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  
  // Filter to active accounts (have statement within last 60 days of newest)
  const activeAccounts = latestStatements
    .filter(a => parseStatementDate(a.statementDate, a.statementMonth).getTime() >= cutoffDate)
    .map(a => {
      const coverageEnd = parseStatementDate(a.statementDate, a.statementMonth);
      // Format coverage end as YYYY-MM-DD for display
      const coverageEndStr = coverageEnd.toISOString().split('T')[0];
      return {
        slug: a.slug,
        name: a.accountName,
        type: a.accountType,
        coverageEnd,
        coverageEndStr,
      };
    });
  
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
 * Parse a statement date string robustly, handling various formats.
 * Falls back to end of statementMonth if date is invalid.
 */
function parseStatementDate(statementDate: string | undefined, statementMonth: string): Date {
  if (!statementDate) {
    // Fall back to last day of statement month
    const [year, month] = statementMonth.split('-').map(Number);
    return new Date(year, month, 0); // Last day of the month
  }
  
  // Try to parse the date
  // Handle formats: "YYYY-MM-DD", "YYYY-MM-DDTHH:MM:SS", or full ISO timestamp
  let dateStr = statementDate;
  
  // If it's already an ISO timestamp with time, extract just the date part
  if (dateStr.includes('T')) {
    dateStr = dateStr.split('T')[0];
  }
  
  // Parse as YYYY-MM-DD
  const parsed = new Date(dateStr + 'T00:00:00');
  
  // Check if valid
  if (isNaN(parsed.getTime())) {
    // Invalid date, fall back to end of statement month
    const [year, month] = statementMonth.split('-').map(Number);
    return new Date(year, month, 0);
  }
  
  return parsed;
}

/**
 * Helper to check if a month is complete based on account coverage.
 */
function isMonthComplete(
  month: string,
  accountSnapshots: Array<{ 
    accountType: string;
    statementMonth: string;
    statementDate?: string;
    slug: string;
  }>
): boolean {
  const GRACE_DAYS = 7;
  const ACTIVE_WINDOW_DAYS = 60;
  
  // Filter to transactional accounts (checking and credit only)
  const transactionalAccounts = accountSnapshots.filter(a => {
    const type = a.accountType.toLowerCase();
    return type === 'checking' || type === 'chequing' || type === 'credit';
  });

  if (transactionalAccounts.length === 0) return true;
  
  // Group by slug and take latest statement per account
  const latestBySlug = new Map<string, typeof transactionalAccounts[0]>();
  for (const acc of transactionalAccounts) {
    const existing = latestBySlug.get(acc.slug);
    const accDate = parseStatementDate(acc.statementDate, acc.statementMonth);
    const existingDate = existing ? parseStatementDate(existing.statementDate, existing.statementMonth) : null;
    
    if (!existing || (existingDate && accDate > existingDate)) {
      latestBySlug.set(acc.slug, acc);
    }
  }
  
  const latestStatements = Array.from(latestBySlug.values());
  
  // Find newest statement date
  const newestDate = latestStatements
    .map(a => parseStatementDate(a.statementDate, a.statementMonth).getTime())
    .reduce((max, d) => Math.max(max, d), 0);
  
  const cutoffDate = newestDate - (ACTIVE_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  
  // Filter to active accounts
  const activeAccounts = latestStatements
    .filter(a => parseStatementDate(a.statementDate, a.statementMonth).getTime() >= cutoffDate);
  
  if (activeAccounts.length === 0) return false;
  
  // Check if all active accounts cover this month
  const [year, mon] = month.split('-').map(Number);
  const lastDayOfMonth = new Date(year, mon, 0).getDate();
  const monthEnd = new Date(year, mon - 1, lastDayOfMonth);
  const graceDate = new Date(monthEnd.getTime() - (GRACE_DAYS * 24 * 60 * 60 * 1000));
  
  return activeAccounts.every(acc => parseStatementDate(acc.statementDate, acc.statementMonth) >= graceDate);
}

/**
 * Resolve window months for a given time range.
 * 
 * Returns the last N COMPLETE months that have data, even if non-consecutive.
 * A month is complete when all active checking and credit accounts have coverage.
 * 
 * Behavior:
 * - 3mo: last 3 complete months with data
 * - 12mo: last 12 complete months with data
 * - ytd: all complete months with data from Jan through latest complete month in current year
 * 
 * @param range - Time range to resolve
 * @param monthlyHistory - Monthly history entries with data
 * @param accountSnapshots - Account snapshots to determine completeness
 * @returns Resolved months with missing month details
 */
export function resolveWindowMonths(
  range: TimeRange,
  monthlyHistory: Array<{ yearMonth: string }>,
  accountSnapshots?: Array<{ 
    accountType: string; 
    statementMonth: string;
    statementDate?: string; 
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
  
  // Find all complete months with data
  let completeMonths: string[];
  let hasAccountSnapshots = accountSnapshots && accountSnapshots.length > 0;
  
  if (hasAccountSnapshots) {
    completeMonths = availableMonths.filter(month => 
      isMonthComplete(month, accountSnapshots!)
    );
  } else {
    // No account snapshots - all months with data are considered complete
    completeMonths = availableMonths;
  }
  
  // If no complete months, fall back to available months to avoid showing $0
  // We'll still compute and return missing info
  const monthsToUse = completeMonths.length > 0 ? completeMonths : availableMonths;
  
  if (monthsToUse.length === 0) {
    return {
      months: [],
      actualCount: 0,
      requestedCount: 0,
    };
  }
  
  // Select months based on range
  let selectedMonths: string[];
  let requestedCount: number;
  let windowStart: string | undefined;
  let windowEnd: string;
  
  switch (range) {
    case "3mo": {
      requestedCount = 3;
      selectedMonths = monthsToUse.slice(-3);
      windowEnd = monthsToUse[monthsToUse.length - 1];
      // Window starts 3 months before the latest month
      const [year, month] = windowEnd.split('-').map(Number);
      const startDate = new Date(year, month - 4, 1); // -3 months + current = -4 for start
      windowStart = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}`;
      break;
    }
    
    case "12mo": {
      requestedCount = 12;
      selectedMonths = monthsToUse.slice(-12);
      windowEnd = monthsToUse[monthsToUse.length - 1];
      // Window starts 12 months before
      const [year, month] = windowEnd.split('-').map(Number);
      const startDate = new Date(year, month - 13, 1);
      windowStart = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}`;
      break;
    }
    
    case "ytd": {
      // All months from January of the latest year through latest month
      const latestMonth = monthsToUse[monthsToUse.length - 1];
      const [latestYear, latestMonthNum] = latestMonth.split("-").map(Number);
      const janOfYear = `${latestYear}-01`;
      
      selectedMonths = monthsToUse.filter(m => m >= janOfYear && m <= latestMonth);
      // requestedCount is total months from Jan to latest (e.g. Jan-Jun = 6)
      requestedCount = latestMonthNum; // Month number is the count (June = 6)
      windowStart = janOfYear;
      windowEnd = latestMonth;
      break;
    }
    
    default:
      return {
        months: [],
        actualCount: 0,
        requestedCount: 0,
      };
  }
  
  const actualCount = selectedMonths.length;
  
  // Find missing months AFTER the newest complete month and get missing account details
  const missingMonthsInWindow: string[] = [];
  let missingAccountDetails: string[] = [];
  
  if (hasAccountSnapshots) {
    // Get current calendar month (allow injection for testing via global)
    const now = (globalThis as any).__TEST_NOW__ || new Date();
    const currentYearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const lastFinishedMonth = getPreviousMonth(currentYearMonth);
    
    // Find missing months AFTER the newest complete month up to latest finished month
    const newestCompleteMonth = completeMonths.length > 0 
      ? completeMonths[completeMonths.length - 1] 
      : undefined;
    
    if (newestCompleteMonth && newestCompleteMonth < lastFinishedMonth) {
      // List all finished months after the newest complete month
      let currentCheck = getNextMonth(newestCompleteMonth);
      while (currentCheck <= lastFinishedMonth) {
        missingMonthsInWindow.push(currentCheck);
        currentCheck = getNextMonth(currentCheck);
      }
      
      // Get missing account details for these months
      const { latestCompleteMonth, missingAccounts } = getLatestCompleteMonth(accountSnapshots!);
      missingAccountDetails = missingAccounts;
    }
  }
  
  // Generate note if we have fewer months than requested
  let note: string | undefined;
  if (actualCount < requestedCount && actualCount > 0) {
    note = `${actualCount} of ${requestedCount} months`;
  }

  return {
    months: selectedMonths,
    actualCount,
    requestedCount,
    note,
    anchorMonth: monthsToUse[monthsToUse.length - 1],
    missingMonths: missingMonthsInWindow.length > 0 ? missingMonthsInWindow : undefined,
    missingAccounts: missingAccountDetails.length > 0 ? missingAccountDetails : undefined,
  };
}
