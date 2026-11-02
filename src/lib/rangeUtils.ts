/**
 * Time range utilities for dashboard, drawers, and pages.
 * 
 * All ranges use COMPLETE months only and exclude the current month.
 */

import { formatMonthYear } from './dateFormatting';

export type TimeRange = "3mo" | "12mo" | "ytd" | `month:${string}`;

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
    default:
      // Single month selection (e.g., "month:2026-08")
      if (range.startsWith("month:")) {
        targetMonths = [range.substring(6)];
      } else {
        targetMonths = [];
      }
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
    default:
      // Single month selection (e.g., "month:2026-08")
      if (range.startsWith("month:")) {
        const month = range.substring(6);
        label = formatMonthName(month);
        periodLabel = formatMonthName(month);
      } else {
        label = "Unknown range";
        periodLabel = "Unknown range";
      }
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
 * Format account name for display with last 4 digits.
 * Shared by missing statements modal, Assets page, and Liabilities page.
 * 
 * @param acc - Account with name (accountName), slug, and type
 * @returns Formatted label like "The Bank of Nova Scotia TFSA •••1009" or "TD credit •••1009"
 */
export function formatAccountName(acc: { name?: string; slug: string; type: string }): string {
  // Extract last 4 digits from slug (format: bank-type-id)
  const parts = acc.slug.split('-');
  const last4 = parts[parts.length - 1].slice(-4);
  
  if (acc.name) {
    // Use full account name if available (e.g., "The Bank of Nova Scotia TFSA")
    return `${acc.name} •••${last4}`;
  }
  
  // Fall back to bank name from slug + type + last 4
  const bankFromSlug = parts[0]; // First part of slug is normalized bank name
  const displayBank = bankFromSlug.charAt(0).toUpperCase() + bankFromSlug.slice(1); // Capitalize
  return `${displayBank} ${acc.type} •••${last4}`;
}

/**
 * Extract last 4 digits from account slug for display.
 * 
 * @param slug - Account slug (format: bank-type-id)
 * @returns Last 4 digits formatted as "•••1234"
 */
export function formatAccountLast4(slug: string): string {
  const parts = slug.split('-');
  const last4 = parts[parts.length - 1].slice(-4);
  return `•••${last4}`;
}

/**
 * Format statement coverage as "through Mon D"
 */
function formatCoverageThrough(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00');
  return `through ${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
}

/**
 * Format missing months as short list (e.g., "Sep and Oct", "Oct")
 */
function formatMissingMonthsShort(months: string[]): string {
  if (months.length === 0) return '';
  if (months.length === 1) {
    const [year, month] = months[0].split('-');
    const date = new Date(parseInt(year), parseInt(month) - 1);
    return date.toLocaleDateString('en-US', { month: 'short' });
  }
  
  // Multiple months: format as "Mon, Mon and Mon"
  const monthNames = months.map(ym => {
    const [year, month] = ym.split('-');
    const date = new Date(parseInt(year), parseInt(month) - 1);
    return date.toLocaleDateString('en-US', { month: 'short' });
  });
  
  const lastMonth = monthNames.pop();
  return `${monthNames.join(', ')} and ${lastMonth}`;
}

/**
 * Determine which month a statement belongs to based on its closing day.
 * 
 * Rule: If closing day is ≤15, statement counts for PREVIOUS month.
 *       If closing day is ≥16, statement counts for the month it closes in.
 * 
 * Examples:
 * - Oct 21 → October
 * - Nov 3 → October
 * - Oct 31 → October
 * - Oct 15 → September
 * - Oct 16 → October
 */
export function getAssignedMonth(closingDate: Date): string {
  const day = closingDate.getDate();
  
  if (day <= 15) {
    // Counts for previous month
    const prevMonth = new Date(closingDate.getFullYear(), closingDate.getMonth() - 1, 1);
    return `${prevMonth.getFullYear()}-${String(prevMonth.getMonth() + 1).padStart(2, '0')}`;
  } else {
    // Counts for current month
    return `${closingDate.getFullYear()}-${String(closingDate.getMonth() + 1).padStart(2, '0')}`;
  }
}

/**
 * Get the typical closing day for an account based on its past statements.
 * Returns the closing day from the most recent statement, or undefined if unknown.
 */
function getTypicalClosingDay(
  accountSlug: string,
  accountSnapshots: Array<{ slug: string; statementDate?: string; statementMonth: string }>
): number | undefined {
  // Find all statements for this account
  const accountStatements = accountSnapshots.filter(a => a.slug === accountSlug);
  if (accountStatements.length === 0) return undefined;
  
  // Get the most recent statement with a date
  const statementsWithDates = accountStatements
    .filter(a => a.statementDate)
    .sort((a, b) => (b.statementDate || '').localeCompare(a.statementDate || ''));
  
  if (statementsWithDates.length === 0) return undefined;
  
  const latestDate = parseStatementDate(statementsWithDates[0].statementDate, statementsWithDates[0].statementMonth);
  return latestDate.getDate();
}

/**
 * Determine the latest complete month based on statement month assignments.
 * 
 * A month M is complete when every active checking/credit account has a statement
 * that is assigned to month M (using the closing day rule: ≤15 = previous month, ≥16 = current month).
 * Only months fully in the past qualify.
 * 
 * An account is active if it has a statement within ~60 days of the newest statement.
 * 
 * @param accountSnapshots - All account snapshots with their statement dates
 * @returns Latest complete month, missing accounts with expected statement info, and missing month
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
  const ACTIVE_WINDOW_DAYS = 60; // Account is active if statement within last 60 days
  
  // Filter to transactional accounts (checking and credit only)
  const transactionalAccounts = (accountSnapshots ?? []).filter(a => {
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
  
  // Find the newest statement date across all accounts to determine active window
  const newestDate = transactionalAccounts
    .map(a => parseStatementDate(a.statementDate, a.statementMonth).getTime())
    .reduce((max, d) => Math.max(max, d), 0);
  
  const cutoffDate = newestDate - (ACTIVE_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  
  // Group by slug - keep ALL statements per account
  const statementsBySlug = new Map<string, typeof transactionalAccounts>();
  for (const acc of transactionalAccounts) {
    if (!statementsBySlug.has(acc.slug)) {
      statementsBySlug.set(acc.slug, []);
    }
    statementsBySlug.get(acc.slug)!.push(acc);
  }
  
  // Filter to active accounts (those with at least one statement within 60 days of newest)
  // and collect all statement assignments for each active account
  const activeAccounts: Array<{
    slug: string;
    name?: string;
    type: string;
    closingDate: Date;
    closingDay: number;
    assignedMonth: string;
  }> = [];
  
  for (const [slug, statements] of statementsBySlug) {
    const hasRecentStatement = statements.some(s => 
      parseStatementDate(s.statementDate, s.statementMonth).getTime() >= cutoffDate
    );
    
    if (hasRecentStatement) {
      // Add ALL statements from this active account with their assigned months
      for (const s of statements) {
        const closingDate = parseStatementDate(s.statementDate, s.statementMonth);
        const assignedMonth = getAssignedMonth(closingDate);
        const closingDay = closingDate.getDate();
        
        activeAccounts.push({
          slug: s.slug,
          name: s.accountName,
          type: s.accountType,
          closingDate,
          closingDay,
          assignedMonth,
        });
      }
    }
  }
  
  if (activeAccounts.length === 0) {
    return {
      latestCompleteMonth: undefined,
      missingAccounts: [],
      missingMonth: undefined,
    };
  }
  
  // Find the latest month that all active accounts have covered
  const now = new Date();
  const currentYearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const lastFullCalendarMonth = getPreviousMonth(currentYearMonth);
  
  // Get all assigned months from active accounts
  const assignedMonths = activeAccounts.map(a => a.assignedMonth);
  const earliestAssigned = assignedMonths.reduce((min, m) => m < min ? m : min, assignedMonths[0]);
  const [startYear, startMonth] = earliestAssigned.split('-').map(Number);
  const [endYear, endMonth] = lastFullCalendarMonth.split('-').map(Number);
  
  // Generate candidate months
  const candidateMonths: string[] = [];
  for (let y = startYear; y <= endYear; y++) {
    const mStart = (y === startYear) ? startMonth : 1;
    const mEnd = (y === endYear) ? endMonth : 12;
    for (let m = mStart; m <= mEnd; m++) {
      candidateMonths.push(`${y}-${String(m).padStart(2, '0')}`);
    }
  }
  
  // Work backwards to find the latest complete month
  // Build a map of which months each account has covered
  const accountMonthCoverage = new Map<string, Set<string>>();
  for (const acc of activeAccounts) {
    if (!accountMonthCoverage.has(acc.slug)) {
      accountMonthCoverage.set(acc.slug, new Set());
    }
    accountMonthCoverage.get(acc.slug)!.add(acc.assignedMonth);
  }
  
  // Find the latest month where ALL active accounts have a statement
  let latestCompleteMonth: string | undefined;
  for (let i = candidateMonths.length - 1; i >= 0; i--) {
    const month = candidateMonths[i];
    
    // Check if every active account has a statement assigned to exactly this month
    const allCovered = Array.from(new Set(activeAccounts.map(a => a.slug))).every(slug => {
      const months = accountMonthCoverage.get(slug);
      return months && months.has(month);
    });
    
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
  // Group active accounts by slug to check if each slug has a statement for nextMonth
  const missingCheckCoverage = new Map<string, Set<string>>();
  const accountLatestClosing = new Map<string, { closingDate: Date; name?: string; type: string }>();
  
  for (const acc of activeAccounts) {
    if (!missingCheckCoverage.has(acc.slug)) {
      missingCheckCoverage.set(acc.slug, new Set());
    }
    missingCheckCoverage.get(acc.slug)!.add(acc.assignedMonth);
    
    // Track the latest closing date for each account
    const existing = accountLatestClosing.get(acc.slug);
    if (!existing || acc.closingDate > existing.closingDate) {
      accountLatestClosing.set(acc.slug, {
        closingDate: acc.closingDate,
        name: acc.name,
        type: acc.type,
      });
    }
  }
  
  const missingAccounts: string[] = [];
  for (const [slug, months] of missingCheckCoverage) {
    if (!months.has(nextMonth)) {
      // This account doesn't have a statement for nextMonth
      const latest = accountLatestClosing.get(slug)!;
      const typicalDay = getTypicalClosingDay(slug, accountSnapshots);
      const expectedClosingDate = typicalDay 
        ? `around ${formatMonthName(nextMonth)} ${typicalDay}`
        : `in ${formatMonthName(nextMonth)}`;
      const lastClosed = `latest closed ${formatMonthYear(latest.closingDate.toISOString().split('T')[0])}`;
      const formatted = formatAccountName({ name: latest.name, slug, type: latest.type });
      missingAccounts.push(`${formatted}: statement closing ${expectedClosingDate} (${lastClosed})`);
    }
  }
  
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
export function parseStatementDate(statementDate: string | undefined, statementMonth: string): Date {
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
 * Helper to check if a month is complete based on statement assignments.
 * Uses the closing day rule: ≤15 = previous month, ≥16 = current month.
 * 
 * A month M is complete when every active account has at least one statement
 * assigned to month M, and M is strictly before the current month.
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
  // Never consider current or future months complete
  const now = (globalThis as any).__TEST_NOW__ || new Date();
  const currentYearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  if (month >= currentYearMonth) {
    return false;
  }
  
  const ACTIVE_WINDOW_DAYS = 60;
  
  // Filter to transactional accounts (checking and credit only)
  const transactionalAccounts = (accountSnapshots ?? []).filter(a => {
    const type = a.accountType.toLowerCase();
    return type === 'checking' || type === 'chequing' || type === 'credit';
  });

  if (transactionalAccounts.length === 0) return true;
  
  // Group by slug - keep ALL statements per account
  const statementsBySlug = new Map<string, typeof transactionalAccounts>();
  for (const acc of transactionalAccounts) {
    if (!statementsBySlug.has(acc.slug)) {
      statementsBySlug.set(acc.slug, []);
    }
    statementsBySlug.get(acc.slug)!.push(acc);
  }
  
  // Find the newest statement across all accounts to determine active window
  const allStatementDates = transactionalAccounts.map(a => 
    parseStatementDate(a.statementDate, a.statementMonth).getTime()
  );
  const newestDate = Math.max(...allStatementDates);
  const cutoffDate = newestDate - (ACTIVE_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  
  // Filter to active accounts (those with at least one statement within 60 days of newest)
  const activeSlugs = new Set<string>();
  for (const [slug, statements] of statementsBySlug) {
    const hasRecentStatement = statements.some(s => 
      parseStatementDate(s.statementDate, s.statementMonth).getTime() >= cutoffDate
    );
    if (hasRecentStatement) {
      activeSlugs.add(slug);
    }
  }
  
  if (activeSlugs.size === 0) return false;
  
  // Check if all active accounts have at least one statement assigned to exactly this month
  for (const slug of activeSlugs) {
    const statements = statementsBySlug.get(slug)!;
    const hasExactMonth = statements.some(s => {
      const closingDate = parseStatementDate(s.statementDate, s.statementMonth);
      const assignedMonth = getAssignedMonth(closingDate);
      return assignedMonth === month;
    });
    
    if (!hasExactMonth) {
      return false;
    }
  }
  
  return true;
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
  // Get current month - never include current or future months
  const now = (globalThis as any).__TEST_NOW__ || new Date();
  const currentYearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  
  // Get all available months sorted, excluding current and future months
  const availableMonths = monthlyHistory
    .map(m => m.yearMonth)
    .filter(m => m < currentYearMonth)  // Only past months
    .sort();
  
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
    
    default: {
      // Handle single-month selection (e.g., "month:2026-08")
      if (range.startsWith("month:")) {
        const selectedMonth = range.substring(6); // Remove "month:" prefix
        
        // Check if this month has data
        if (monthsToUse.includes(selectedMonth)) {
          selectedMonths = [selectedMonth];
          requestedCount = 1;
          windowStart = selectedMonth;
          windowEnd = selectedMonth;
        } else {
          // Month not in available data
          return {
            months: [],
            actualCount: 0,
            requestedCount: 1,
          };
        }
        break;
      }
      
      // Unknown range type
      return {
        months: [],
        actualCount: 0,
        requestedCount: 0,
      };
    }
  }
  
  const actualCount = selectedMonths.length;
  
  // Find missing months and get missing account details
  // Skip for single-month selections (disabled months already show what's missing)
  const missingMonthsInWindow: string[] = [];
  let missingAccountDetails: string[] = [];
  
  const isSingleMonth = range.startsWith("month:");
  
  if (hasAccountSnapshots && !isSingleMonth) {
    // Get current calendar month (allow injection for testing via global)
    const now = (globalThis as any).__TEST_NOW__ || new Date();
    const currentYearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const lastFinishedMonth = getPreviousMonth(currentYearMonth);
    
    // Determine which months to check for missing accounts
    const newestCompleteMonth = completeMonths.length > 0 
      ? completeMonths[completeMonths.length - 1] 
      : undefined;
    
    if (newestCompleteMonth && newestCompleteMonth < lastFinishedMonth) {
      // Case 1: We have complete months - check for gaps AFTER the newest complete
      let currentCheck = getNextMonth(newestCompleteMonth);
      while (currentCheck <= lastFinishedMonth) {
        missingMonthsInWindow.push(currentCheck);
        currentCheck = getNextMonth(currentCheck);
      }
    } else if (!newestCompleteMonth && monthsToUse.length > 0) {
      // Case 2: NO complete months, but we're using incomplete months (fallback)
      // Report which accounts are missing for the months we're actually showing
      // This ensures the dropdown and nudge agree on completeness
      for (const month of selectedMonths) {
        if (!isMonthComplete(month, accountSnapshots!)) {
          missingMonthsInWindow.push(month);
        }
      }
    }
    
    if (missingMonthsInWindow.length > 0) {
      
      // Compute missing account details using closing day assignment rule
      const ACTIVE_WINDOW_DAYS = 60;
      
      // Filter to transactional accounts (checking and credit only)
      const transactionalAccounts = (accountSnapshots ?? []).filter(a => {
        const type = a.accountType.toLowerCase();
        return type === 'checking' || type === 'chequing' || type === 'credit';
      });
      
      if (transactionalAccounts.length > 0) {
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
          .filter(a => parseStatementDate(a.statementDate, a.statementMonth).getTime() >= cutoffDate)
          .map(a => {
            const closingDate = parseStatementDate(a.statementDate, a.statementMonth);
            const closingDateStr = closingDate.toISOString().split('T')[0];
            const assignedMonth = getAssignedMonth(closingDate);
            return {
              slug: a.slug,
              name: a.accountName,
              type: a.accountType,
              closingDate,
              closingDateStr,
              assignedMonth,
            };
          });
        
        // Check each active account against the missing months using assignment rule
        for (const acc of activeAccounts) {
          // Determine which missing months this account doesn't cover
          const accountMissingMonths = missingMonthsInWindow.filter(month => acc.assignedMonth < month);
          
          if (accountMissingMonths.length > 0) {
            // Format: "Bank Type •••1234: Sep and Oct (statements through Mon DD)"
            const accountName = formatAccountName(acc);
            const coverageThrough = formatCoverageThrough(acc.closingDateStr);
            const monthsNeeded = formatMissingMonthsShort(accountMissingMonths);
            
            missingAccountDetails.push(`${accountName}: ${monthsNeeded} (${coverageThrough})`);
          }
        }
      }
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

/**
 * Information about a selectable month for the Month dropdown.
 */
export interface SelectableMonth {
  /** Month in YYYY-MM format */
  yearMonth: string;
  /** Display label (e.g., "Aug 2026") */
  label: string;
  /** True if all active checking/credit accounts have complete coverage for this month */
  isComplete: boolean;
  /** Names of accounts missing coverage (if incomplete) */
  missingAccounts: string[];
}

/**
 * Get list of last 12 finished months with completeness status.
 * Used by the Month dropdown to show which months are selectable.
 * 
 * @param accountSnapshots - Account snapshots to check completeness
 * @param nowOverride - Optional date override for testing
 * @returns Array of selectable months, newest first
 */
export function getSelectableMonths(
  accountSnapshots?: Array<{ 
    accountType: string; 
    statementMonth: string;
    statementDate?: string;
    accountName?: string;
    slug: string;
  }>,
  nowOverride?: Date
): SelectableMonth[] {
  const now = nowOverride || new Date();
  const currentYearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  
  // Generate last 12 finished months (excluding current month)
  const months: SelectableMonth[] = [];
  for (let i = 1; i <= 12; i++) {
    const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const yearMonth = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    const label = date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    
    // Check if this month is complete using closing day assignment rule
    let isComplete = true;
    const missingAccounts: string[] = [];
    
    if (accountSnapshots && accountSnapshots.length > 0) {
      const ACTIVE_WINDOW_DAYS = 60;
      
      // Filter to transactional accounts
      const transactionalAccounts = accountSnapshots.filter(a => {
        const type = a.accountType.toLowerCase();
        return type === 'checking' || type === 'chequing' || type === 'credit';
      });
      
      if (transactionalAccounts.length > 0) {
        // Group by slug - keep ALL statements per account
        const statementsBySlug = new Map<string, typeof transactionalAccounts>();
        for (const acc of transactionalAccounts) {
          if (!statementsBySlug.has(acc.slug)) {
            statementsBySlug.set(acc.slug, []);
          }
          statementsBySlug.get(acc.slug)!.push(acc);
        }
        
        // Find the newest statement across all accounts
        const allStatementDates = transactionalAccounts.map(a => 
          parseStatementDate(a.statementDate, a.statementMonth).getTime()
        );
        const newestDate = Math.max(...allStatementDates);
        const cutoffDate = newestDate - (ACTIVE_WINDOW_DAYS * 24 * 60 * 60 * 1000);
        
        // Determine active accounts and check completeness for this month
        for (const [slug, statements] of statementsBySlug) {
          // Check if this account is active (has statement within 60 days of newest)
          const hasRecentStatement = statements.some(s => 
            parseStatementDate(s.statementDate, s.statementMonth).getTime() >= cutoffDate
          );
          
          if (hasRecentStatement) {
            // Check if this account has a statement assigned to exactly this month
            const hasExactMonth = statements.some(s => {
              const closingDate = parseStatementDate(s.statementDate, s.statementMonth);
              const assignedMonth = getAssignedMonth(closingDate);
              return assignedMonth === yearMonth;
            });
            
            if (!hasExactMonth) {
              isComplete = false;
              // Find the account name from any statement (they should all have the same name)
              const acc = statements[0];
              const formatted = formatAccountName({ name: acc.accountName, slug: acc.slug, type: acc.accountType });
              missingAccounts.push(formatted);
            }
          }
        }
      }
    }
    
    months.push({
      yearMonth,
      label,
      isComplete,
      missingAccounts,
    });
  }
  
  return months;
}
