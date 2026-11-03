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
  | "balance_decrease"
  | "income_change"
  | "spending_spike"
  | "new_recurring_charge";

export interface NetWorthChangeItem {
  /** Deterministic ID: month+type+accountSlug (or month+type+source for non-account items) */
  id: string;
  /** Month this change applies to (YYYY-MM) */
  month: string;
  /** Type of change */
  type: ChangeItemType;
  /** Account slug this change relates to (for account-based changes) */
  accountSlug?: string;
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
  /** Source tag (e.g., "Salary", "Netflix", "Groceries") */
  source?: string;
  /** Impact description (e.g., "~$500 over 6-month avg") */
  impactDescription?: string;
  /** When this change item was first created (preserved across regenerations) */
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
 * Check if a month is complete (has statements from all active accounts).
 * Only complete months are used for income/spending spike detection.
 */
function isMonthComplete(month: string, profile: FinancialProfileCache): boolean {
  // Get all active accounts in this month
  const activeAccountSlugs = new Set<string>();
  for (const snap of profile.accountSnapshots) {
    if (snap.statementMonth && snap.statementMonth <= month) {
      activeAccountSlugs.add(snap.slug);
    }
  }

  // Check if we have statements for all active accounts in this month
  const monthStatements = profile.statementHistory.filter(s => s.statementMonth === month);
  const monthAccountSlugs = new Set(monthStatements.map(s => s.slug));

  for (const slug of activeAccountSlugs) {
    if (!monthAccountSlugs.has(slug)) {
      return false; // Missing statement for an active account
    }
  }

  return activeAccountSlugs.size > 0; // Must have at least one account
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

  // Read existing items to preserve their generatedAt timestamps
  const existingItemsMap = new Map<string, string>(); // id -> generatedAt
  try {
    const existingSnap = await db.collection(`users/${uid}/netWorthChanges`).get();
    for (const doc of existingSnap.docs) {
      const summary = doc.data() as MonthNetWorthSummary;
      for (const item of summary.items || []) {
        if (item.id && item.generatedAt) {
          existingItemsMap.set(item.id, item.generatedAt);
        }
      }
    }
  } catch (err) {
    console.error("Failed to read existing items:", err);
  }

  // Helper to create item with preserved or new generatedAt
  const createItemId = (month: string, type: ChangeItemType, accountSlug: string): string => {
    return `${month}_${type}_${accountSlug}`;
  };

  const getGeneratedAt = (id: string): string => {
    return existingItemsMap.get(id) || new Date().toISOString();
  };

  // Generate change items for each month
  const summaries: MonthNetWorthSummary[] = [];
  let previousMonthAccounts: Map<string, { balance: number; label: string; type: string; currency: string }> | null = null;
  let previousNetWorth = 0;

  for (const month of allMonths) {
    const currentAccounts = accountsByMonth.get(month) || new Map();
    const items: NetWorthChangeItem[] = [];

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
          const id = createItemId(month, "account_added", slug);
          items.push({
            id,
            month,
            type: "account_added",
            accountSlug: slug,
            accountLabel: acc.label,
            accountType: acc.type,
            netWorthImpact: acc.balance,
            currency: acc.currency,
            currentBalance: acc.balance,
            generatedAt: getGeneratedAt(id),
          });
        }
      }

      // 2. Check for removed accounts (paid off or closed)
      for (const [slug, prevAcc] of previousMonthAccounts) {
        if (!currentAccounts.has(slug)) {
          const status = accountStatusMap.get(slug);
          const type: ChangeItemType = 
            status?.status === "paid_off" ? "account_paid_off" : "account_closed";
          
          const id = createItemId(month, type, slug);
          items.push({
            id,
            month,
            type,
            accountSlug: slug,
            accountLabel: prevAcc.label,
            accountType: prevAcc.type,
            netWorthImpact: -prevAcc.balance, // Removing a debt increases net worth
            currency: prevAcc.currency,
            previousBalance: prevAcc.balance,
            generatedAt: getGeneratedAt(id),
          });
        }
      }

      // 3. Check for balance changes on existing accounts
      for (const [slug, acc] of currentAccounts) {
        const prevAcc = previousMonthAccounts.get(slug);
        if (prevAcc && prevAcc.balance !== acc.balance) {
          const balanceChange = acc.balance - prevAcc.balance;
          const type: ChangeItemType = balanceChange > 0 ? "balance_increase" : "balance_decrease";
          const id = createItemId(month, type, slug);
          items.push({
            id,
            month,
            type,
            accountSlug: slug,
            accountLabel: acc.label,
            accountType: acc.type,
            netWorthImpact: balanceChange,
            currency: acc.currency,
            previousBalance: prevAcc.balance,
            currentBalance: acc.balance,
            generatedAt: getGeneratedAt(id),
          });
        }
      }
    }

    // 4. Detect income changes (complete months only)
    if (isMonthComplete(month, profile) && previousMonthAccounts) {
      const monthHistory = profile.monthlyHistory.find(h => h.yearMonth === month);
      if (monthHistory) {
        // Get prior 3 complete months' income
        const priorMonths = profile.monthlyHistory
          .filter(h => h.yearMonth < month && isMonthComplete(h.yearMonth, profile))
          .slice(-3);

        if (priorMonths.length >= 3) {
          const priorIncomeAvg = priorMonths.reduce((sum, h) => sum + h.incomeTotal, 0) / priorMonths.length;
          const incomeDiff = monthHistory.incomeTotal - priorIncomeAvg;
          const incomeChangePct = priorIncomeAvg > 0 ? (incomeDiff / priorIncomeAvg) * 100 : 0;

          if (Math.abs(incomeDiff) >= 300 && Math.abs(incomeChangePct) >= 15) {
            const id = createItemId(month, "income_change", "income");
            items.push({
              id,
              month,
              type: "income_change",
              accountLabel: incomeChangePct > 0 ? "Income Increase" : "Income Decrease",
              accountType: "income",
              netWorthImpact: incomeDiff,
              currency,
              source: "Income",
              impactDescription: `${incomeChangePct > 0 ? "+" : ""}${incomeChangePct.toFixed(0)}% vs 3-month avg`,
              generatedAt: getGeneratedAt(id),
            });
          }
        }
      }
    }

    // 5. Detect spending spikes (complete months only)
    if (isMonthComplete(month, profile) && previousMonthAccounts) {
      // Get this month's expenses
      const monthExpenses = profile.expenseTxns.filter(t => t.txMonth === month);
      
      // Group by category
      const categoryTotals = new Map<string, number>();
      for (const txn of monthExpenses) {
        const current = categoryTotals.get(txn.category) || 0;
        categoryTotals.set(txn.category, current + txn.amount);
      }

      // Get prior 6 complete months' expenses by category
      const priorMonths = profile.monthlyHistory
        .filter(h => h.yearMonth < month && isMonthComplete(h.yearMonth, profile))
        .slice(-6);

      if (priorMonths.length >= 6) {
        const priorMonthsList = priorMonths.map(h => h.yearMonth);
        const priorExpenses = profile.expenseTxns.filter(t => priorMonthsList.includes(t.txMonth));

        for (const [category, monthTotal] of categoryTotals) {
          // Calculate 6-month average for this category
          const priorCategoryTxns = priorExpenses.filter(t => t.category === category);
          const priorCategoryTotal = priorCategoryTxns.reduce((sum, t) => sum + t.amount, 0);
          const priorCategoryAvg = priorCategoryTotal / 6;

          const diff = monthTotal - priorCategoryAvg;
          const diffPct = priorCategoryAvg > 0 ? (diff / priorCategoryAvg) * 100 : 0;

          if (diff >= 300 && diffPct >= 30) {
            const id = createItemId(month, "spending_spike", category.toLowerCase().replace(/\s+/g, "_"));
            items.push({
              id,
              month,
              type: "spending_spike",
              accountLabel: `${category} Spike`,
              accountType: "spending",
              netWorthImpact: -diff, // Spending spike reduces net worth
              currency,
              source: category,
              impactDescription: `~$${Math.round(diff)} over 6-month avg`,
              generatedAt: getGeneratedAt(id),
            });
          }
        }
      }
    }

    // 6. Detect new recurring charges (complete months only)
    if (isMonthComplete(month, profile) && previousMonthAccounts) {
      // Check if any subscriptions started in this month
      for (const sub of profile.confirmedSubscriptions) {
        const firstDate = sub.firstSeenAt;
        if (firstDate && firstDate.startsWith(month)) {
          const id = createItemId(month, "new_recurring_charge", sub.merchantSlug);
          const subAmount = sub.amount ?? sub.suggestedAmount;
          const frequency = sub.frequency ?? sub.suggestedFrequency;
          items.push({
            id,
            month,
            type: "new_recurring_charge",
            accountLabel: `New: ${sub.name}`,
            accountType: "subscription",
            netWorthImpact: -subAmount, // New recurring charge reduces net worth
            currency,
            source: sub.name,
            impactDescription: `${frequency || "recurring"} charge`,
            generatedAt: getGeneratedAt(id),
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
      generatedAt: new Date().toISOString(),
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
