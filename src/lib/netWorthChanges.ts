/**
 * Net Worth Changes Feed
 * 
 * Tracks month-over-month net worth changes and what moved them.
 * Generated after statement processing; idempotent.
 */

import type { Firestore } from "firebase-admin/firestore";
import { getFinancialProfile, type FinancialProfileCache } from "./financialProfile";
import { isAccountActive } from "./accountStatus";

export type ChangeItemType =
  | "account_added"
  | "account_paid_off"
  | "account_closed"
  | "balance_increase"
  | "balance_decrease";

export interface NetWorthChangeItem {
  /** Month this change applies to (YYYY-MM) */
  month: string;
  /** Type of change */
  type: ChangeItemType;
  /** Account slug this change relates to */
  accountSlug: string;
  /** Human-readable account label */
  accountLabel: string;
  /** Account type (checking, credit_card, etc.) */
  accountType: string;
  /** Net worth impact (positive = increase, negative = decrease) */
  netWorthImpact: number;
  /** Currency */
  currency: string;
  /** Previous balance (for balance changes) */
  previousBalance?: number;
  /** Current balance (for balance changes) */
  currentBalance?: number;
  /** When this change item was generated */
  generatedAt: string;
}

export interface MonthNetWorthSummary {
  /** Month (YYYY-MM) */
  month: string;
  /** Total net worth at end of month */
  netWorth: number;
  /** Change from previous month */
  change: number;
  /** Change percentage */
  changePercent: number | null;
  /** Currency */
  currency: string;
  /** Change items for this month */
  items: NetWorthChangeItem[];
  /** When this summary was generated */
  generatedAt: string;
}

/**
 * Generate net worth change items for a user's complete financial history.
 * Idempotent: clears existing data and regenerates from scratch.
 */
export async function generateNetWorthChanges(
  uid: string,
  db: Firestore
): Promise<void> {
  const profile = await getFinancialProfile(uid, db);
  
  // Build account status map
  const accountStatusMap = new Map(
    profile.accountStatusRecords.map(r => [r.accountSlug, r])
  );

  // Get all unique months from monthly history, sorted
  const allMonths = profile.monthlyHistory
    .map(h => h.yearMonth)
    .sort();

  if (allMonths.length === 0) {
    return; // No data to process
  }

  // Track accounts seen each month and their balances
  const accountsByMonth = new Map<string, Map<string, {
    balance: number;
    label: string;
    type: string;
    currency: string;
  }>>();

  // Build account snapshots by month
  for (const snap of profile.accountSnapshots) {
    const month = snap.statementMonth;
    if (!month) continue;

    // Check if account was active in this month
    const isActive = isAccountActive(snap.slug, month, accountStatusMap);
    
    if (!accountsByMonth.has(month)) {
      accountsByMonth.set(month, new Map());
    }

    const monthAccounts = accountsByMonth.get(month)!;
    
    // Store or update if this is the latest snapshot for this account in this month
    const existing = monthAccounts.get(snap.slug);
    if (!existing || !snap.statementDate || 
        (existing && snap.statementDate > (accountsByMonth.get(month)?.get(snap.slug) as any)?.statementDate)) {
      monthAccounts.set(snap.slug, {
        balance: isActive ? snap.balance : 0, // Exclude inactive accounts
        label: snap.accountName || `${snap.bankName} ${snap.accountType}`,
        type: snap.accountType,
        currency: snap.currency || "CAD",
      });
    }
  }

  // Generate change items for each month
  const summaries: MonthNetWorthSummary[] = [];
  let previousMonthAccounts: Map<string, { balance: number; label: string; type: string; currency: string }> | null = null;
  let previousNetWorth = 0;

  for (const month of allMonths) {
    const currentAccounts = accountsByMonth.get(month) || new Map();
    const items: NetWorthChangeItem[] = [];
    const generatedAt = new Date().toISOString();

    // Calculate current net worth
    let currentNetWorth = 0;
    const currency = profile.homeCurrency || "CAD";

    for (const [slug, acc] of currentAccounts) {
      currentNetWorth += acc.balance;
    }

    if (previousMonthAccounts) {
      // Detect changes from previous month
      
      // 1. Check for new accounts
      for (const [slug, acc] of currentAccounts) {
        if (!previousMonthAccounts.has(slug)) {
          items.push({
            month,
            type: "account_added",
            accountSlug: slug,
            accountLabel: acc.label,
            accountType: acc.type,
            netWorthImpact: acc.balance,
            currency: acc.currency,
            currentBalance: acc.balance,
            generatedAt,
          });
        }
      }

      // 2. Check for removed accounts (paid off or closed)
      for (const [slug, prevAcc] of previousMonthAccounts) {
        if (!currentAccounts.has(slug)) {
          const status = accountStatusMap.get(slug);
          const type: ChangeItemType = 
            status?.status === "paid_off" ? "account_paid_off" : "account_closed";
          
          items.push({
            month,
            type,
            accountSlug: slug,
            accountLabel: prevAcc.label,
            accountType: prevAcc.type,
            netWorthImpact: -prevAcc.balance, // Removing a debt increases net worth
            currency: prevAcc.currency,
            previousBalance: prevAcc.balance,
            generatedAt,
          });
        }
      }

      // 3. Check for balance changes on existing accounts
      for (const [slug, acc] of currentAccounts) {
        const prevAcc = previousMonthAccounts.get(slug);
        if (prevAcc && prevAcc.balance !== acc.balance) {
          const balanceChange = acc.balance - prevAcc.balance;
          items.push({
            month,
            type: balanceChange > 0 ? "balance_increase" : "balance_decrease",
            accountSlug: slug,
            accountLabel: acc.label,
            accountType: acc.type,
            netWorthImpact: balanceChange,
            currency: acc.currency,
            previousBalance: prevAcc.balance,
            currentBalance: acc.balance,
            generatedAt,
          });
        }
      }
    }

    // Calculate change from previous month
    const change = currentNetWorth - previousNetWorth;
    const changePercent = previousNetWorth !== 0 
      ? (change / Math.abs(previousNetWorth)) * 100 
      : null;

    summaries.push({
      month,
      netWorth: currentNetWorth,
      change,
      changePercent,
      currency,
      items,
      generatedAt,
    });

    previousMonthAccounts = currentAccounts;
    previousNetWorth = currentNetWorth;
  }

  // Write to Firestore (idempotent: delete all and rewrite)
  const batch = db.batch();
  
  // Delete existing change items
  const existing = await db.collection(`users/${uid}/netWorthChanges`).listDocuments();
  for (const doc of existing) {
    batch.delete(doc);
  }

  // Write new summaries
  for (const summary of summaries) {
    const ref = db.doc(`users/${uid}/netWorthChanges/${summary.month}`);
    batch.set(ref, summary);
  }

  await batch.commit();
}

/**
 * Get net worth changes for a specific month or range.
 */
export async function getNetWorthChanges(
  uid: string,
  db: Firestore,
  options?: {
    month?: string; // Single month YYYY-MM
    startMonth?: string; // Range start
    endMonth?: string; // Range end
  }
): Promise<MonthNetWorthSummary[]> {
  let query = db.collection(`users/${uid}/netWorthChanges`);

  if (options?.month) {
    const doc = await query.doc(options.month).get();
    return doc.exists ? [doc.data() as MonthNetWorthSummary] : [];
  }

  if (options?.startMonth) {
    query = query.where("month", ">=", options.startMonth) as any;
  }

  if (options?.endMonth) {
    query = query.where("month", "<=", options.endMonth) as any;
  }

  const snap = await query.orderBy("month", "desc").get();
  return snap.docs.map(d => d.data() as MonthNetWorthSummary);
}
