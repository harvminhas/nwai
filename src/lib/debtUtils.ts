/**
 * Shared utilities for classifying and computing debt payment totals.
 *
 * Single source of truth for the min/extra split used by:
 *  - Spending page debt card
 *  - Financial profile cache (monthlyHistory.minDebtPaymentsTotal)
 *  - Savings rate calculation
 *  - Any future feature that needs minimum debt payments
 */

import type { ExpenseTransaction } from "./types";

// ── Constants ─────────────────────────────────────────────────────────────────

/** Debt types where every payment is a "scheduled" fixed instalment, never "extra". */
export const SCHEDULED_DEBT_TYPES = new Set([
  "mortgage",
  "auto_loan",
  "personal_loan",
]);

// ── Key & tag helpers ─────────────────────────────────────────────────────────

/**
 * Deterministic string key for a debt transaction — used as the Firestore
 * storage key in `users/{uid}/prefs/debtPaymentTags`.
 */
export function debtTxKey(
  tx: Pick<ExpenseTransaction, "date" | "merchant" | "amount">,
  fallbackMonth: string,
): string {
  const date = tx.date ?? fallbackMonth;
  const slug = (tx.merchant ?? "").toLowerCase().replace(/[^a-z0-9]/g, "_");
  return `${date}_${slug}_${Math.round((tx.amount ?? 0) * 100)}`;
}

/**
 * AI-inferred default tag for a debt transaction.
 * Mortgage / auto / personal-loan payments are always "scheduled" (fixed).
 * Credit cards and lines of credit default to "minimum" (user can override).
 */
export function defaultDebtTag(
  debtType: string | undefined,
): "scheduled" | "minimum" {
  return SCHEDULED_DEBT_TYPES.has(debtType ?? "") ? "scheduled" : "minimum";
}

// ── Core computation ──────────────────────────────────────────────────────────

export interface DebtSplit {
  /** Sum of all minimum / scheduled debt payments (required cash outflow). */
  minPaymentsTotal: number;
  /** Sum of extra / full-balance payments beyond the minimum. */
  extraPaymentsTotal: number;
}

/**
 * Split a list of "Debt Payments" transactions into minimum vs extra using:
 *  1. `userTags` — explicit overrides saved by the user (from Firestore prefs)
 *  2. `defaultDebtTag` — AI-inferred fallback based on debtType
 *
 * @param debtTxns  Transactions already filtered to category "Debt Payments"
 * @param userTags  Map of `debtTxKey → tag` from `users/{uid}/prefs/debtPaymentTags`
 * @param yearMonth YYYY-MM fallback when tx.date is absent
 */
export function splitDebtPayments(
  debtTxns: (ExpenseTransaction & { debtType?: string })[],
  userTags: Record<string, string>,
  yearMonth: string,
): DebtSplit {
  let minPaymentsTotal  = 0;
  let extraPaymentsTotal = 0;

  for (const tx of debtTxns) {
    const key = debtTxKey(tx, yearMonth);
    const tag = userTags[key] ?? defaultDebtTag(tx.debtType);
    if (tag === "extra" || tag === "full_balance") {
      extraPaymentsTotal += tx.amount;
    } else {
      // "minimum" or "scheduled"
      minPaymentsTotal += tx.amount;
    }
  }

  return { minPaymentsTotal, extraPaymentsTotal };
}

/** Convenience: return only the minimum payments total. */
export function getMinDebtPayments(
  debtTxns: (ExpenseTransaction & { debtType?: string })[],
  userTags: Record<string, string>,
  yearMonth: string,
): number {
  return splitDebtPayments(debtTxns, userTags, yearMonth).minPaymentsTotal;
}
