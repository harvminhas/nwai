/**
 * Scheduled Debt Payment Calculation
 * 
 * Computes scheduled monthly payments for loans and minimum payments for credit cards
 * from account snapshots and transaction history. Used by money coach to correctly
 * attribute debt servicing to Fixed costs (scheduled amount) vs Savings & debt (extra paydown).
 * 
 * Key principle: NEVER use paymentsMade as scheduled payment proxy. That conflates
 * scheduled payments with extra paydowns, causing large paydowns to inflate Fixed costs.
 */

import type { AccountSnapshot, ExpenseTxnRecord } from "./extractTransactions";

export interface ScheduledDebtPayment {
  accountSlug: string;
  /** Account name for display (e.g. "TD Home Equity FlexLine") */
  accountName?: string;
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
 * Find recurring payment amount from transaction history.
 * Returns median of past regular payments (excluding outliers).
 */
function findRecurringPayment(
  accountSlug: string,
  expenseTxns: ExpenseTxnRecord[]
): number | null {
  // Get all debt payment transactions for this account
  const payments = expenseTxns
    .filter(t => 
      t.accountSlug === accountSlug && 
      t.category === "Debt Payments" &&
      t.amount < 0
    )
    .map(t => Math.abs(t.amount))
    .sort((a, b) => a - b);

  if (payments.length === 0) return null;
  if (payments.length === 1) return payments[0];

  // Filter outliers: remove payments > 2x the median (likely extra paydowns)
  const medianIdx = Math.floor(payments.length / 2);
  const rawMedian = payments.length % 2 === 0
    ? (payments[medianIdx - 1] + payments[medianIdx]) / 2
    : payments[medianIdx];

  const regularPayments = payments.filter(p => p <= rawMedian * 2);

  if (regularPayments.length === 0) return rawMedian;

  // Return median of regular payments
  const midIdx = Math.floor(regularPayments.length / 2);
  return regularPayments.length % 2 === 0
    ? (regularPayments[midIdx - 1] + regularPayments[midIdx]) / 2
    : regularPayments[midIdx];
}

/**
 * Calculate interest-based minimum payment for LOC/HELOC.
 * For revolving credit lines, minimum = interest charged + small principal %.
 */
function estimateLOCMinimum(
  accountSlug: string,
  balance: number,
  apr: number,
  expenseTxns: ExpenseTxnRecord[]
): number {
  // Try to find actual interest charged from transactions
  const interestTxns = expenseTxns
    .filter(t => 
      t.accountSlug === accountSlug && 
      t.category === "Interest" &&
      t.amount < 0
    )
    .map(t => Math.abs(t.amount));

  if (interestTxns.length > 0) {
    // Use median interest charged + 1% of balance (typical principal requirement)
    const sortedInterest = [...interestTxns].sort((a, b) => a - b);
    const midIdx = Math.floor(sortedInterest.length / 2);
    const medianInterest = sortedInterest.length % 2 === 0
      ? (sortedInterest[midIdx - 1] + sortedInterest[midIdx]) / 2
      : sortedInterest[midIdx];
    
    return medianInterest + (balance * 0.01);
  }

  // Fallback: estimate from APR
  if (apr > 0) {
    const monthlyInterest = (balance * apr / 100) / 12;
    return monthlyInterest + (balance * 0.01);
  }

  // Last resort: 2% of balance
  return balance * 0.02;
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
 * - Credit cards: if carried balance (payment < 95% of balance), estimate minimum (2-3% or $25).
 *   If paid in full, return 0 (no fixed cost).
 * - LOC/HELOC: use interest charged + 1% principal, NEVER paymentsMade (which includes extra paydowns).
 * - Installment loans (mortgage, auto, student, personal): find median of past regular payments.
 *   Cap at a plausible max (3% of balance) to catch data errors.
 */
export function computeScheduledDebtPayments(
  accountSnapshots: AccountSnapshot[],
  expenseTxns: ExpenseTxnRecord[] = []
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

      // Carrying balance: estimate minimum payment (never use paymentsMade)
      const minPayment = estimateCreditMinPayment(balance);

      scheduledPayments.push({
        accountSlug: account.slug,
        accountName: account.accountName,
        amount: minPayment,
        isEstimated: true,
        debtType: "credit",
      });
    } else if (account.accountType === "line_of_credit") {
      // LOC/HELOC: minimum = interest + small principal requirement
      const minPayment = estimateLOCMinimum(account.slug, balance, rate, expenseTxns);

      scheduledPayments.push({
        accountSlug: account.slug,
        accountName: account.accountName,
        amount: minPayment,
        isEstimated: true,
        debtType: "loan",
      });
    } else {
      // Installment loan (mortgage, auto, student, personal)
      let scheduledPayment = 0;
      let isEstimated = false;

      // Try to find recurring payment from transaction history
      const recurringPayment = findRecurringPayment(account.slug, expenseTxns);

      if (recurringPayment !== null) {
        // Use median of past payments, capped at 3% of balance
        scheduledPayment = Math.min(recurringPayment, balance * 0.03);
        isEstimated = false;
      } else {
        // No history: estimate from balance and rate
        scheduledPayment = estimateLoanPayment(balance, rate, account.accountType);
        isEstimated = true;
      }

      scheduledPayments.push({
        accountSlug: account.slug,
        accountName: account.accountName,
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
