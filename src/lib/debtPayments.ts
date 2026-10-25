/**
 * Scheduled Debt Payment Calculation
 * 
 * Computes scheduled monthly payments for loans and minimum payments for credit cards
 * from account snapshots. Used by money coach to correctly attribute debt servicing
 * to Fixed costs (scheduled amount) vs Savings & debt (extra paydown).
 */

import type { AccountSnapshot } from "./extractTransactions";

export interface ScheduledDebtPayment {
  accountSlug: string;
  /** Scheduled/minimum payment amount per month */
  amount: number;
  /** True when amount is estimated vs actual from statement */
  isEstimated: boolean;
  /** Type: "loan" for installment debt, "credit" for revolving credit */
  debtType: "loan" | "credit";
}

/**
 * Estimate minimum payment for a credit card.
 * Industry standard: greater of $25 or 2-3% of balance.
 */
function estimateCreditMinPayment(balance: number): number {
  return Math.max(25, balance * 0.025);
}

/**
 * Estimate monthly payment for an installment loan using simple amortization.
 * Formula: P = L * [r(1+r)^n] / [(1+r)^n - 1]
 * where P = payment, L = loan amount, r = monthly rate, n = term in months
 * 
 * For unknown term, assume 5 years for auto/personal, 25 years for mortgage.
 */
function estimateLoanPayment(
  balance: number, 
  apr: number, 
  accountType: string
): number {
  if (apr <= 0) {
    // No interest rate: estimate based on balance only
    const assumedTermMonths = accountType === "mortgage" ? 300 : 60;
    return balance / assumedTermMonths;
  }

  const monthlyRate = apr / 100 / 12;
  const assumedTermMonths = accountType === "mortgage" ? 300 : 60; // 25yr or 5yr

  if (monthlyRate === 0) return balance / assumedTermMonths;

  const numerator = balance * monthlyRate * Math.pow(1 + monthlyRate, assumedTermMonths);
  const denominator = Math.pow(1 + monthlyRate, assumedTermMonths) - 1;

  return numerator / denominator;
}

/**
 * Determine if a credit card carries a balance vs paid in full.
 * Heuristic: if payment ≥ 95% of balance, treat as paid in full.
 */
function isPaidInFull(balance: number, paymentMade: number): boolean {
  if (balance <= 0) return true;
  return paymentMade >= balance * 0.95;
}

/**
 * Compute scheduled debt payments for all debt accounts in the profile.
 * Returns list of scheduled payments that should go to Fixed costs.
 * 
 * Logic:
 * - Installment loans (mortgage, auto, student, personal, LOC): use paymentsMade from statement
 *   as proxy for scheduled payment. If not available, estimate from balance + rate.
 * - Credit cards: if carried balance (payment < 95% of balance), use paymentsMade as minimum.
 *   If paid in full, return 0 (no fixed cost).
 */
export function computeScheduledDebtPayments(
  accountSnapshots: AccountSnapshot[]
): ScheduledDebtPayment[] {
  const debtAccounts = accountSnapshots.filter(
    (a) =>
      a.accountType === "credit" ||
      a.accountType === "mortgage" ||
      a.accountType === "loan" ||
      a.accountType === "line_of_credit"
  );

  const scheduledPayments: ScheduledDebtPayment[] = [];

  for (const account of debtAccounts) {
    const balance = Math.abs(account.balance);
    const paymentMade = account.paymentsMade ?? 0;
    const rate = account.interestRate ?? 0;

    if (account.accountType === "credit") {
      // Credit card: check if carrying balance
      if (isPaidInFull(balance, paymentMade)) {
        // Paid in full: no fixed cost
        continue;
      }

      // Carrying balance: minimum payment is fixed
      let minPayment = 0;
      let isEstimated = false;

      if (paymentMade > 0) {
        // Use actual payment from statement as minimum
        minPayment = paymentMade;
      } else {
        // Estimate minimum payment
        minPayment = estimateCreditMinPayment(balance);
        isEstimated = true;
      }

      scheduledPayments.push({
        accountSlug: account.slug,
        amount: minPayment,
        isEstimated,
        debtType: "credit",
      });
    } else {
      // Installment loan (mortgage, auto, student, personal, LOC)
      let scheduledPayment = 0;
      let isEstimated = false;

      if (paymentMade > 0) {
        // Use actual payment from statement
        scheduledPayment = paymentMade;
      } else {
        // Estimate from balance and rate
        scheduledPayment = estimateLoanPayment(balance, rate, account.accountType);
        isEstimated = true;
      }

      scheduledPayments.push({
        accountSlug: account.slug,
        amount: scheduledPayment,
        isEstimated,
        debtType: "loan",
      });
    }
  }

  return scheduledPayments;
}

/**
 * Compute extra debt paydown for a given month.
 * Extra = actual payments made - scheduled payments.
 * This goes to Savings & debt bucket.
 */
export function computeExtraDebtPaydown(
  debtTransactions: { accountSlug: string; amount: number }[],
  scheduledPayments: ScheduledDebtPayment[]
): number {
  const scheduledByAccount = new Map(
    scheduledPayments.map((p) => [p.accountSlug, p.amount])
  );

  let totalPaid = 0;
  let totalScheduled = 0;

  const accountPayments = new Map<string, number>();

  // Sum up actual payments by account
  for (const tx of debtTransactions) {
    const current = accountPayments.get(tx.accountSlug) ?? 0;
    accountPayments.set(tx.accountSlug, current + Math.abs(tx.amount));
  }

  // Calculate extra for each account
  for (const [accountSlug, paid] of accountPayments) {
    const scheduled = scheduledByAccount.get(accountSlug) ?? 0;
    totalPaid += paid;
    totalScheduled += scheduled;
  }

  return Math.max(0, totalPaid - totalScheduled);
}
