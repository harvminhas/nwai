/**
 * Shared savings computation for a time range.
 * Single source of truth used by:
 * - Money Coach route (dashboard card)
 * - Dashboard drawers route
 * - AI tools (get_savings_summary)
 * - Regression tests
 * 
 * Uses computeAverageSavings with user confirmations to determine what counts
 * as real savings vs transfers/refunds/other non-savings items.
 */

import type { FinancialProfileCache } from "./financialProfile";
import type { UserReviewContext } from "./userReviewContext";
import { computeAverageSavings } from "./savingsCalculations";
import { getRangeMonths, type TimeRange } from "./rangeUtils";

/**
 * Compute savings for a time range (3mo, 12mo, ytd, or custom months).
 * 
 * @param profile - Financial profile cache
 * @param reviewContext - User review context (must include savingsConfirmedItems)
 * @param rangeOrMonths - TimeRange ("3mo", "12mo", "ytd") or explicit month array
 * @returns Average monthly savings for the range
 */
export function computeSavingsForRange(
  profile: FinancialProfileCache,
  reviewContext: UserReviewContext,
  rangeOrMonths: TimeRange | string[]
): number {
  const months = Array.isArray(rangeOrMonths)
    ? rangeOrMonths
    : getRangeMonths(rangeOrMonths, profile.allTxMonths.sort());

  return computeAverageSavings(
    profile.monthlyHistory,
    profile.accountBalanceHistory ?? [],
    profile.expenseTxns,
    months,
    reviewContext.savingsConfirmedItems
  );
}
