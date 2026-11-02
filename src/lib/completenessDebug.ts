/**
 * Diagnostic utilities for debugging month completeness issues.
 * 
 * Helps identify why months are showing as incomplete when they shouldn't be,
 * or vice versa. Shows per-account statement data with assigned months.
 */

import type { StatementHistoryEntry } from './financialProfile';

/**
 * Parse a statement date, handling various formats and fallbacks.
 * This is a copy of the logic from rangeUtils.ts for diagnostic purposes.
 */
function parseStatementDate(statementDate: string | undefined, statementMonth: string): Date {
  if (!statementDate) {
    // Fall back to last day of statement month
    const [year, month] = statementMonth.split('-').map(Number);
    return new Date(year, month, 0); // Last day of the month
  }
  
  // Try to parse the date
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
 * Determine which month a statement belongs to based on its closing day.
 * ≤15 = previous month, ≥16 = current month
 */
function getAssignedMonth(closingDate: Date): string {
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

interface StatementDebugInfo {
  statementMonth: string;           // Label from Firestore
  statementDate: string | undefined; // Explicit closing date if available
  parsedDate: string;                // What we actually parsed
  closingDay: number;                // Day of month (1-31)
  assignedMonth: string;             // Which month it's assigned to
  usedFallback: boolean;             // Whether we fell back to month-end
}

interface AccountDebugInfo {
  accountName: string;
  accountSlug: string;
  accountType: string;
  statements: StatementDebugInfo[];
  assignedMonths: string[];          // Unique list of assigned months
}

/**
 * Get diagnostic information about statement assignments for all accounts.
 * Shows which statements exist, their closing dates, and which months they're assigned to.
 */
export function getCompletenessDebugInfo(statementHistory: StatementHistoryEntry[]): AccountDebugInfo[] {
  // Group by account slug
  const bySlug = new Map<string, StatementHistoryEntry[]>();
  for (const stmt of statementHistory) {
    if (!bySlug.has(stmt.slug)) {
      bySlug.set(stmt.slug, []);
    }
    bySlug.get(stmt.slug)!.push(stmt);
  }
  
  const result: AccountDebugInfo[] = [];
  
  for (const [slug, statements] of bySlug) {
    const firstStmt = statements[0];
    const statementDebugInfo: StatementDebugInfo[] = [];
    const assignedMonths = new Set<string>();
    
    for (const stmt of statements) {
      const parsedDate = parseStatementDate(stmt.statementDate, stmt.statementMonth);
      const assignedMonth = getAssignedMonth(parsedDate);
      assignedMonths.add(assignedMonth);
      
      statementDebugInfo.push({
        statementMonth: stmt.statementMonth,
        statementDate: stmt.statementDate,
        parsedDate: parsedDate.toISOString().split('T')[0],
        closingDay: parsedDate.getDate(),
        assignedMonth,
        usedFallback: false, // statementDate is always present in StatementHistoryEntry
      });
    }
    
    // Sort by parsed date, newest first
    statementDebugInfo.sort((a, b) => b.parsedDate.localeCompare(a.parsedDate));
    
    result.push({
      accountName: slug,  // Use slug as account name (StatementHistoryEntry doesn't have accountName)
      accountSlug: slug,
      accountType: firstStmt.accountType,
      statements: statementDebugInfo,
      assignedMonths: Array.from(assignedMonths).sort().reverse(),
    });
  }
  
  // Sort by account name
  result.sort((a, b) => a.accountName.localeCompare(b.accountName));
  
  return result;
}
