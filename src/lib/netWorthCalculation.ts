/**
 * Single authoritative data-layer function for net worth calculation.
 * 
 * All consumers (header, detail, API, history) use this shared implementation.
 * No duplicate formulas, no client recomputation, no divergent sources.
 */

import type { Firestore } from "firebase-admin/firestore";
import { getFinancialProfile } from "./financialProfile";

export interface NetWorthResult {
  netWorth: number;
  yearMonth: string;
  currency: string;
  totalAssets: number;
  totalDebts: number;
  monthlyChange: number | null;
  previousMonth: { yearMonth: string; netWorth: number } | null;
  // Include full monthlyHistory for API consumers (from same profile snapshot)
  monthlyHistory: Array<{
    yearMonth: string;
    netWorth: number;
    byAccount: Array<{ slug: string; label: string; type: string; value: number }>;
  }>;
}

/**
 * Calculate net worth for a specific month/year or latest available.
 * 
 * @param uid - User ID
 * @param db - Firestore instance
 * @param options.month - Optional 1-12 month number
 * @param options.year - Optional 4-digit year
 * 
 * When month/year omitted: returns LATEST AVAILABLE data month (explicit max comparison)
 * When month/year explicit but unavailable: returns null (not silently substituted)
 * 
 * Assets: manual car + account balances counted once
 * Debts: counted once, no double-subtraction of linked financing
 * Preserves: historical valuation, FX, account activation rules from financialProfile
 */
export async function getNetWorthForMonth(
  uid: string,
  db: Firestore,
  options?: { month?: number; year?: number }
): Promise<NetWorthResult | null> {
  const profile = await getFinancialProfile(uid, db);
  
  if (profile.monthlyHistory.length === 0) {
    return null; // No data available
  }
  
  // Get home currency from profile's user doc (already fetched by getFinancialProfile)
  const userDoc = await db.collection("users").doc(uid).get();
  const userData = userDoc.exists ? userDoc.data() ?? {} : {};
  const currency: string = userData.homeCurrency ?? userData.currency ?? "CAD";

  let targetMonth: typeof profile.monthlyHistory[0] | null = null;

  if (options?.month !== undefined && options?.year !== undefined) {
    // Explicit month/year requested
    const targetYearMonth = `${options.year}-${String(options.month).padStart(2, "0")}`;
    targetMonth = profile.monthlyHistory.find(h => h.yearMonth === targetYearMonth) ?? null;
    
    if (!targetMonth) {
      // Explicit month not available - return null, don't substitute
      return null;
    }
  } else {
    // No month/year specified - find LATEST AVAILABLE (explicit max comparison)
    targetMonth = profile.monthlyHistory.reduce((latest, current) => 
      current.yearMonth > latest.yearMonth ? current : latest
    );
  }

  // Find previous month for change calculation
  const allMonths = [...profile.monthlyHistory].sort((a, b) => 
    a.yearMonth.localeCompare(b.yearMonth)
  );
  const currentIndex = allMonths.findIndex(h => h.yearMonth === targetMonth!.yearMonth);
  const previousMonth = currentIndex > 0 ? allMonths[currentIndex - 1] : null;

  const monthlyChange = previousMonth 
    ? targetMonth.netWorth - previousMonth.netWorth 
    : null;

  // Include full monthlyHistory from same profile snapshot for API consumers
  const sortedHistory = [...profile.monthlyHistory].sort((a, b) => 
    b.yearMonth.localeCompare(a.yearMonth)
  );
  const last12Months = sortedHistory.slice(0, 12).reverse().map(m => ({
    yearMonth: m.yearMonth,
    netWorth: m.netWorth,
    byAccount: m.byAccount || [],
  }));

  return {
    netWorth: targetMonth.netWorth,
    yearMonth: targetMonth.yearMonth,
    currency,
    totalAssets: targetMonth.totalAssets,
    totalDebts: targetMonth.totalDebts,
    monthlyChange,
    previousMonth: previousMonth ? {
      yearMonth: previousMonth.yearMonth,
      netWorth: previousMonth.netWorth,
    } : null,
    monthlyHistory: last12Months,
  };
}
