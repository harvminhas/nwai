/**
 * Pure personalization function for central bank rate signals.
 *
 * Input:  FinancialProfileCache + ExternalDataPoint
 * Output: personalized context used to build the insight card body
 *
 * No DB calls. No side effects.
 */

import type { FinancialProfileCache } from "@/lib/financialProfile";
import type { ExternalDataPoint } from "../types";

export interface RateAccountBreakdown {
  label: string;
  balance: number;
  /** Estimated change in monthly interest cost from this rate move */
  monthlyImpact: number;
}

export interface RateSignalContext {
  delta: number;
  direction: "up" | "down" | "unchanged";
  /** Total balance across variable-rate debt accounts (mortgage, HELOC, LOC) */
  variableBalanceTotal: number;
  accountCount: number;
  /** Estimated total change in monthly interest cost from this rate move */
  monthlyImpact: number;
  /** Per-account breakdown for rich card rendering */
  accounts: RateAccountBreakdown[];
  /** true = rate actually moved; false = no change */
  rateChanged: boolean;
}

export function personalizeRateSignal(
  profile: FinancialProfileCache,
  point: ExternalDataPoint,
): RateSignalContext {
  const variableAccounts = profile.accountSnapshots.filter((a) =>
    /mortgage|heloc|loc|line.of.credit/i.test(a.accountType ?? ""),
  );

  const delta =
    point.previousValue !== null
      ? +(point.value - point.previousValue).toFixed(2)
      : 0;

  const direction: "up" | "down" | "unchanged" =
    delta > 0 ? "up" : delta < 0 ? "down" : "unchanged";

  const accounts: RateAccountBreakdown[] = variableAccounts.map((a) => {
    const balance = Math.abs(a.parsedDebts ?? 0);
    const monthlyImpact =
      balance > 0 && delta !== 0
        ? Math.round((balance * Math.abs(delta)) / 100 / 12)
        : 0;
    return {
      label: a.accountName ?? a.bankName ?? "Variable account",
      balance,
      monthlyImpact,
    };
  });

  const variableBalanceTotal = accounts.reduce((s, a) => s + a.balance, 0);
  const monthlyImpact        = accounts.reduce((s, a) => s + a.monthlyImpact, 0);

  return {
    delta,
    direction,
    variableBalanceTotal,
    accountCount: variableAccounts.length,
    monthlyImpact,
    accounts,
    rateChanged: delta !== 0,
  };
}
