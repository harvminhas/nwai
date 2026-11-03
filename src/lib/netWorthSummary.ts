/**
 * Net Worth Summary
 * 
 * Provides current net worth and recent trend for dashboard badge.
 */

import type { Firestore } from "firebase-admin/firestore";
import { getFinancialProfile } from "./financialProfile";
import { isAccountActive } from "./accountStatus";

export interface NetWorthSummary {
  /** Current net worth */
  current: number;
  /** Previous month net worth */
  previousMonth: number | null;
  /** Change from previous month */
  change: number | null;
  /** Change percentage */
  changePercent: number | null;
  /** Currency */
  currency: string;
  /** Latest month with data (YYYY-MM) */
  latestMonth: string | null;
  /** Trend direction: up, down, flat, or null if no previous month */
  trend: "up" | "down" | "flat" | null;
}

/**
 * Get net worth summary for dashboard badge.
 */
export async function getNetWorthSummary(
  uid: string,
  db: Firestore
): Promise<NetWorthSummary> {
  const profile = await getFinancialProfile(uid, db);

  // Build account status map
  const accountStatusMap = new Map(
    profile.accountStatusRecords.map(r => [r.accountSlug, r])
  );

  // Get all unique months from monthly history, sorted descending
  const allMonths = profile.monthlyHistory
    .map(h => h.yearMonth)
    .sort()
    .reverse();

  if (allMonths.length === 0) {
    return {
      current: 0,
      previousMonth: null,
      change: null,
      changePercent: null,
      currency: profile.homeCurrency || "CAD",
      latestMonth: null,
      trend: null,
    };
  }

  const latestMonth = allMonths[0];
  const previousMonthKey = allMonths[1] || null;

  // Calculate current net worth
  let currentNetWorth = 0;
  for (const snap of profile.accountSnapshots) {
    if (snap.statementMonth === latestMonth) {
      const isActive = isAccountActive(snap.slug, latestMonth, accountStatusMap);
      if (isActive) {
        currentNetWorth += snap.balance;
      }
    }
  }

  // Calculate previous month net worth
  let previousMonthNetWorth: number | null = null;
  if (previousMonthKey) {
    previousMonthNetWorth = 0;
    for (const snap of profile.accountSnapshots) {
      if (snap.statementMonth === previousMonthKey) {
        const isActive = isAccountActive(snap.slug, previousMonthKey, accountStatusMap);
        if (isActive) {
          previousMonthNetWorth += snap.balance;
        }
      }
    }
  }

  // Calculate change and trend
  let change: number | null = null;
  let changePercent: number | null = null;
  let trend: "up" | "down" | "flat" | null = null;

  if (previousMonthNetWorth !== null) {
    change = currentNetWorth - previousMonthNetWorth;
    
    if (previousMonthNetWorth !== 0) {
      changePercent = (change / Math.abs(previousMonthNetWorth)) * 100;
    }

    if (Math.abs(change) < 1) {
      trend = "flat";
    } else if (change > 0) {
      trend = "up";
    } else {
      trend = "down";
    }
  }

  return {
    current: currentNetWorth,
    previousMonth: previousMonthNetWorth,
    change,
    changePercent,
    currency: profile.homeCurrency || "CAD",
    latestMonth,
    trend,
  };
}
