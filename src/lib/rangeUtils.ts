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
  /** Account names missing from the anchor month (if any) */
  missingAccounts?: string[];
}

/**
 * Determine the latest complete month based on statement coverage.
 * 
 * A month is complete when every active checking and credit account has statement coverage.
 * An account is active if it had a statement in the prior month OR appears in the current month.
 * Loans, investments, mortgages don't block completeness.
 * 
 * @param accountSnapshots - All account snapshots with their statement months
 * @returns Latest complete month in YYYY-MM format, or undefined if no complete months exist
 */
export function getLatestCompleteMonth(
  accountSnapshots: Array<{ 
    accountType: string; 
    statementMonth: string; 
    accountName?: string;
    slug: string;
  }>
): { latestCompleteMonth: string | undefined; missingAccounts: string[] } {
  // Filter to transactional accounts (checking and credit)
  const transactionalAccounts = accountSnapshots.filter(a => {
    const type = a.accountType.toLowerCase();
    return type === 'checking' || type === 'chequing' || type === 'credit' || type === 'savings';
  });
  
  if (transactionalAccounts.length === 0) {
    // No transactional accounts - use latest statement month from any account
    const allMonths = accountSnapshots.map(a => a.statementMonth).sort();
    return {
      latestCompleteMonth: allMonths.length > 0 ? allMonths[allMonths.length - 1] : undefined,
      missingAccounts: [],
    };
  }
  
  // Group accounts by slug to get the latest statement month for each
  const latestByAccount = new Map<string, { month: string; name?: string; type: string }>();
  for (const acc of transactionalAccounts) {
    const existing = latestByAccount.get(acc.slug);
    if (!existing || acc.statementMonth > existing.month) {
      latestByAccount.set(acc.slug, {
        month: acc.statementMonth,
        name: acc.accountName,
        type: acc.accountType,
      });
    }
  }
  
  // Get all unique months across all accounts
  const allMonths = new Set(Array.from(latestByAccount.values()).map(a => a.month));
  const sortedMonths = Array.from(allMonths).sort();
  
  if (sortedMonths.length === 0) {
    return {
      latestCompleteMonth: undefined,
      missingAccounts: [],
    };
  }
  
  // Work backwards from the latest month to find the first complete one
  for (let i = sortedMonths.length - 1; i >= 0; i--) {
    const candidateMonth = sortedMonths[i];
    
    // Determine which accounts were active in the prior month
    const priorMonth = getPreviousMonth(candidateMonth);
    const accountsActiveInPriorOrCurrent = new Set<string>();
    
    // An account is relevant if it has a statement in the prior month OR in this month
    for (const [slug, info] of latestByAccount.entries()) {
      if (info.month === priorMonth || info.month === candidateMonth || info.month > candidateMonth) {
        accountsActiveInPriorOrCurrent.add(slug);
      }
    }
    
    // Check which of these active accounts have statements for this candidate month
    const accountsMissingThisMonth: string[] = [];
    for (const slug of accountsActiveInPriorOrCurrent) {
      const info = latestByAccount.get(slug)!;
      if (info.month < candidateMonth) {
        // This account doesn't have a statement for this month yet
        accountsMissingThisMonth.push(info.name || slug);
      }
    }
    
    // If no accounts are missing for this month, it's complete
    if (accountsMissingThisMonth.length === 0) {
      return {
        latestCompleteMonth: candidateMonth,
        missingAccounts: [],
      };
    }
    
    // If this is the latest month and it's incomplete, record which accounts are missing
    if (i === sortedMonths.length - 1) {
      // Continue to check earlier months
      continue;
    }
  }
  
  // No complete month found
  return {
    latestCompleteMonth: undefined,
    missingAccounts: [],
  };
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
  
  if (accountSnapshots && accountSnapshots.length > 0) {
    const { latestCompleteMonth, missingAccounts: missing } = getLatestCompleteMonth(accountSnapshots);
    
    if (latestCompleteMonth) {
      latestMonth = latestCompleteMonth;
      missingAccounts = missing;
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
  };
}
