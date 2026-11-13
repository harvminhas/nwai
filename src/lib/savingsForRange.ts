/**
 * Net savings for a time range — leftover from {@link averageCashFlow}.
 *
 * Same number as the dashboard Net savings card, savings drawer, and
 * chat `get_savings_summary`.
 */

import type { FinancialProfileCache } from "./financialProfile";
import type { UserReviewContext } from "./userReviewContext";
import { averageCashFlow, cashFlowInputFromProfile } from "./monthlyCashFlow";
import { resolveWindowMonths, type TimeRange } from "./rangeUtils";

function accountStatusMap(profile: FinancialProfileCache) {
  return new Map(
    (profile.accountStatusRecords ?? []).map((r) => [
      r.accountSlug,
      { status: r.status, statusDate: r.statusDate },
    ]),
  );
}

/**
 * Average monthly leftover (money in − money out) for a time range.
 *
 * `reviewContext.savingsConfirmedItems` is ignored: leftover does not use
 * the balance-change confirmation path.
 */
export function computeSavingsForRange(
  profile: FinancialProfileCache,
  reviewContext: UserReviewContext,
  rangeOrMonths: TimeRange | string[],
): number {
  const months = Array.isArray(rangeOrMonths)
    ? rangeOrMonths
    : resolveWindowMonths(
        rangeOrMonths,
        profile.monthlyHistory,
        profile.statementHistory,
        accountStatusMap(profile),
      ).months;

  return averageCashFlow(
    cashFlowInputFromProfile(profile, reviewContext),
    { rangeMonths: months },
  ).leftover;
}
