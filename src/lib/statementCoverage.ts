/**
 * Statement Coverage — grid data for the statements page.
 * 
 * Computes per-account coverage across the last N months, showing which months
 * have uploaded statements and which are missing.
 */

import type { UserStatementSummary } from "./types";
import { buildAccountSlug } from "./accountSlug";

export interface CoverageMonth {
  yearMonth: string;
  label: string;
  shortLabel: string;
}

export type CellState = "uploaded" | "missing" | "not_yet_due" | "blank";

export interface CoverageCell {
  yearMonth: string;
  state: CellState;
}

export interface AccountCoverageRow {
  accountSlug: string;
  bankName: string;
  accountName: string;
  accountType: string;
  accountId: string;
  cells: CoverageCell[];
  missingCount: number;
  firstMonth: string | null;
  lastMonth: string | null;
}

export interface InstitutionGroup {
  bankName: string;
  accounts: AccountCoverageRow[];
}

export interface StatementCoverageGrid {
  months: CoverageMonth[];
  groups: InstitutionGroup[];
  totalMissing: number;
  accountsWithGaps: number;
}

/**
 * Generate the last N months, ending with current month.
 */
function generateMonthColumns(count: number): CoverageMonth[] {
  const now = new Date();
  const months: CoverageMonth[] = [];
  
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const yearMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
    const shortLabel = d.toLocaleDateString("en-US", { month: "short" });
    months.push({ yearMonth, label, shortLabel });
  }
  
  return months;
}

/**
 * Clean an account name by removing trademark symbols and extra whitespace.
 */
function cleanAccountName(name: string): string {
  return name
    .replace(/[®™]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Pick the best account name from multiple statements of the same account.
 * Prefers: 1) cleaned names, 2) most recent statement, 3) longest name.
 */
function pickBestAccountName(names: string[], uploadDates: string[]): string {
  if (names.length === 0) return "";
  if (names.length === 1) return cleanAccountName(names[0]);
  
  // Pair names with their upload dates
  const pairs = names.map((name, i) => ({
    name,
    cleanName: cleanAccountName(name),
    uploadDate: uploadDates[i],
  }));
  
  // Sort by: cleanest name first, then most recent, then longest
  pairs.sort((a, b) => {
    const aHasSymbols = /[®™]/.test(a.name);
    const bHasSymbols = /[®™]/.test(b.name);
    if (aHasSymbols !== bHasSymbols) {
      return aHasSymbols ? 1 : -1; // no symbols preferred
    }
    if (a.uploadDate !== b.uploadDate) {
      return b.uploadDate.localeCompare(a.uploadDate); // most recent first
    }
    return b.cleanName.length - a.cleanName.length; // longest first
  });
  
  return pairs[0].cleanName;
}

/**
 * Compute coverage grid data from statements.
 * 
 * Uses the canonical account slug from accountSlug.ts to deduplicate accounts
 * that may have name variations (e.g. with/without ®/™ symbols).
 * 
 * @param statements - All user statements (must have parsedData fields)
 * @param monthCount - Number of months to show (default 13)
 * @returns Coverage grid data ready for rendering
 */
export function computeStatementCoverage(
  statements: UserStatementSummary[],
  monthCount = 13
): StatementCoverageGrid {
  const months = generateMonthColumns(monthCount);
  const currentMonth = months[months.length - 1].yearMonth;
  
  // Group statements by canonical account slug
  const accountMap = new Map<string, {
    bankName: string;
    accountNames: string[];
    uploadDates: string[];
    accountType: string;
    accountId: string;
    months: Set<string>;
  }>();
  
  for (const stmt of statements) {
    if (stmt.status !== "completed" || !stmt.statementDate || !stmt.bankName || !stmt.accountId) {
      continue;
    }
    
    // Use canonical slug from accountSlug.ts (primarily last 4 digits)
    const slug = buildAccountSlug(stmt.bankName, stmt.accountId, stmt.accountName, stmt.accountType);
    const yearMonth = stmt.statementDate.slice(0, 7);
    
    if (!accountMap.has(slug)) {
      accountMap.set(slug, {
        bankName: stmt.bankName,
        accountNames: [],
        uploadDates: [],
        accountType: stmt.accountType || "other",
        accountId: stmt.accountId,
        months: new Set(),
      });
    }
    
    const account = accountMap.get(slug)!;
    account.months.add(yearMonth);
    
    // Collect all name variants to pick the best one
    if (stmt.accountName) {
      account.accountNames.push(stmt.accountName);
      account.uploadDates.push(stmt.uploadedAt);
    }
  }
  
  // Build rows for each account
  const rows: AccountCoverageRow[] = [];
  
  for (const [slug, data] of accountMap.entries()) {
    const uploadedMonths = Array.from(data.months).sort();
    const firstMonth = uploadedMonths[0] || null;
    const lastMonth = uploadedMonths[uploadedMonths.length - 1] || null;
    
    // Pick the best account name from all variants
    const bestName = pickBestAccountName(data.accountNames, data.uploadDates);
    
    const cells: CoverageCell[] = months.map((m) => {
      const yearMonth = m.yearMonth;
      
      // Not yet due if it's the current month
      if (yearMonth === currentMonth) {
        return { yearMonth, state: "not_yet_due" as CellState };
      }
      
      // Blank if before first statement or after last statement (account closed)
      if (firstMonth && yearMonth < firstMonth) {
        return { yearMonth, state: "blank" as CellState };
      }
      if (lastMonth && yearMonth > lastMonth && yearMonth < currentMonth) {
        // Account was closed before current month
        return { yearMonth, state: "blank" as CellState };
      }
      
      // Uploaded if we have a statement for this month
      if (data.months.has(yearMonth)) {
        return { yearMonth, state: "uploaded" as CellState };
      }
      
      // Missing otherwise (between first and current, not uploaded)
      if (firstMonth && yearMonth >= firstMonth && yearMonth < currentMonth) {
        return { yearMonth, state: "missing" as CellState };
      }
      
      // Blank otherwise (shouldn't happen, but fallback)
      return { yearMonth, state: "blank" as CellState };
    });
    
    const missingCount = cells.filter(c => c.state === "missing").length;
    
    rows.push({
      accountSlug: slug,
      bankName: data.bankName,
      accountName: bestName || "Unnamed Account",
      accountType: data.accountType,
      accountId: data.accountId,
      cells,
      missingCount,
      firstMonth,
      lastMonth,
    });
  }
  
  // Sort: accounts with gaps first, then by bank name, then by account name
  rows.sort((a, b) => {
    if (a.missingCount !== b.missingCount) {
      return b.missingCount - a.missingCount; // descending (most gaps first)
    }
    if (a.bankName !== b.bankName) {
      return a.bankName.localeCompare(b.bankName);
    }
    return a.accountName.localeCompare(b.accountName);
  });
  
  // Group by institution
  const groups: InstitutionGroup[] = [];
  const bankMap = new Map<string, AccountCoverageRow[]>();
  
  for (const row of rows) {
    if (!bankMap.has(row.bankName)) {
      bankMap.set(row.bankName, []);
    }
    bankMap.get(row.bankName)!.push(row);
  }
  
  // Sort banks: those with any gaps first, then alphabetically
  const sortedBanks = Array.from(bankMap.entries()).sort(([bankA, accountsA], [bankB, accountsB]) => {
    const hasGapsA = accountsA.some(a => a.missingCount > 0);
    const hasGapsB = accountsB.some(a => a.missingCount > 0);
    if (hasGapsA !== hasGapsB) {
      return hasGapsB ? 1 : -1; // banks with gaps first
    }
    return bankA.localeCompare(bankB);
  });
  
  for (const [bankName, accounts] of sortedBanks) {
    groups.push({ bankName, accounts });
  }
  
  const totalMissing = rows.reduce((sum, row) => sum + row.missingCount, 0);
  const accountsWithGaps = rows.filter(row => row.missingCount > 0).length;
  
  return {
    months,
    groups,
    totalMissing,
    accountsWithGaps,
  };
}
