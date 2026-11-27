/**
 * Net savings for a time range — balances only, from
 * {@link computeWindowSavings} (change in bank/cash/savings, card, and debt
 * balances; investments and assets excluded).
 *
 * Same number as the dashboard Net savings card, savings drawer, and chat
 * `get_savings_summary`. Months follow the cash-flow average rule
 * ({@link monthsForCashFlowAverage}), the same months the card uses.
 */

import type { FinancialProfileCache } from "./financialProfile";
import type { UserReviewContext } from "./userReviewContext";
import { monthsForCashFlowAverage } from "./cashFlowAverage";
import { resolveWindowMonths, type TimeRange } from "./rangeUtils";
import { computeWindowSavings, type WindowSavingsResult } from "./savingsCalculations";

function accountStatusMap(profile: FinancialProfileCache) {
  return new Map(
    (profile.accountStatusRecords ?? []).map((r) => [
      r.accountSlug,
      { status: r.status, statusDate: r.statusDate },
    ]),
  );
}

/**
 * Net savings for exactly these months (per month, per account, and the
 * average over measured months), in the profile's home currency.
 */
export function netSavingsWindow(
  profile: Pick<
    FinancialProfileCache,
    "monthlyHistory" | "accountBalanceHistory" | "expenseTxns" | "homeCurrency" | "fxRates"
  >,
  months: string[],
): WindowSavingsResult {
  return computeWindowSavings(
    profile.monthlyHistory ?? [],
    profile.accountBalanceHistory ?? [],
    profile.expenseTxns ?? [],
    months,
    new Map(),
    { homeCurrency: profile.homeCurrency, fxRates: profile.fxRates ?? {} },
  );
}

/**
 * Average monthly Net savings for a time range.
 *
 * `reviewContext` is accepted for older callers; savings confirmations no
 * longer change Net savings.
 */
export function computeSavingsForRange(
  profile: FinancialProfileCache,
  _reviewContext: UserReviewContext,
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

  const averaged = monthsForCashFlowAverage(months, { rangeMonths: months });
  return netSavingsWindow(profile, averaged).monthlyAverage.total;
}
