/**
 * Pure personalization function for food/grocery CPI signals.
 *
 * Links the external food-inflation data point to the user's own
 * "Groceries" spending category. Computes year-over-year change in the
 * user's grocery spend and compares it against the official food CPI.
 *
 * Input:  FinancialProfileCache + ExternalDataPoint (canada-food-cpi | us-food-cpi)
 * Output: personalized context used to build the insight card
 *
 * No DB calls. No side effects.
 */

import type { FinancialProfileCache } from "@/lib/financialProfile";
import type { ExternalDataPoint } from "../types";

export interface FoodCpiSignalContext {
  /** Official food CPI year-over-year % (from external data) */
  foodInflationPct: number | null;
  /** User's grocery spend change year-over-year % */
  userGroceryChangePct: number | null;
  /** userGroceryChangePct - foodInflationPct — positive = outpacing inflation */
  spendVsInflation: number | null;
  /** User's recent average monthly grocery spend (last 3 months) */
  recentMonthlyGroceries: number;
  /** Dollar gap: how much extra the user spends vs inflation baseline */
  monthlyGap: number | null;
  /** Enough history to compute a meaningful year-over-year comparison */
  hasYoyHistory: boolean;
}

export function personalizeFoodCpiSignal(
  profile: FinancialProfileCache,
  point: ExternalDataPoint,
): FoodCpiSignalContext {
  const foodInflationPct = point.value; // already the YoY % from the fetcher

  // Filter to grocery transactions only
  const groceryTxns = profile.expenseTxns.filter((t) => {
    const cat = (t.category ?? "").toLowerCase();
    return cat === "groceries" || cat.startsWith("groceries/");
  });

  if (groceryTxns.length === 0) {
    return {
      foodInflationPct,
      userGroceryChangePct: null,
      spendVsInflation: null,
      recentMonthlyGroceries: 0,
      monthlyGap: null,
      hasYoyHistory: false,
    };
  }

  // Group by month
  const byMonth: Record<string, number> = {};
  for (const t of groceryTxns) {
    byMonth[t.txMonth] = (byMonth[t.txMonth] ?? 0) + t.amount;
  }

  const allMonths = Object.keys(byMonth).sort();
  if (allMonths.length < 4) {
    const recentMonthlyGroceries = allMonths.length > 0
      ? Math.round(Object.values(byMonth).reduce((s, v) => s + v, 0) / allMonths.length)
      : 0;
    return {
      foodInflationPct,
      userGroceryChangePct: null,
      spendVsInflation: null,
      recentMonthlyGroceries,
      monthlyGap: null,
      hasYoyHistory: false,
    };
  }

  // Recent 3-month average vs year-ago 3-month average
  const now = new Date();
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const recentMonths = allMonths.filter((m) => m < thisMonth).slice(-3);
  const yearAgoMonths = recentMonths.map((m) => {
    const [y, mo] = m.split("-");
    return `${parseInt(y, 10) - 1}-${mo}`;
  });

  const recentAvg = recentMonths.length > 0
    ? recentMonths.reduce((s, m) => s + (byMonth[m] ?? 0), 0) / recentMonths.length
    : 0;

  const yearAgoAvg = yearAgoMonths.every((m) => byMonth[m] !== undefined)
    ? yearAgoMonths.reduce((s, m) => s + (byMonth[m] ?? 0), 0) / yearAgoMonths.length
    : null;

  const recentMonthlyGroceries = Math.round(recentAvg);

  if (yearAgoAvg === null || yearAgoAvg === 0) {
    return {
      foodInflationPct,
      userGroceryChangePct: null,
      spendVsInflation: null,
      recentMonthlyGroceries,
      monthlyGap: null,
      hasYoyHistory: false,
    };
  }

  const userGroceryChangePct = +(((recentAvg - yearAgoAvg) / yearAgoAvg) * 100).toFixed(1);
  const spendVsInflation     = +(userGroceryChangePct - foodInflationPct).toFixed(1);

  // Dollar gap: how much more per month vs if spending had only grown with inflation
  const inflationBaseline = yearAgoAvg * (1 + foodInflationPct / 100);
  const monthlyGap        = spendVsInflation > 0
    ? Math.round(recentAvg - inflationBaseline)
    : null;

  return {
    foodInflationPct,
    userGroceryChangePct,
    spendVsInflation,
    recentMonthlyGroceries,
    monthlyGap,
    hasYoyHistory: true,
  };
}
