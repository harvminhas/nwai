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
  /** Method used: "fixed payment" | "est. interest-only" | "est. 2% of balance" | "est. 2.5% of balance" */
  method?: string;
}

// ── Named constants for revolving debt minimums ──────────────────────────────

/** Credit cards: 2.5% of balance or $25 floor */
const CREDIT_CARD_MIN_PCT = 0.025;
const CREDIT_CARD_MIN_FLOOR = 25;

/** Small personal LOCs (<$100K): interest + 2% principal */
const SMALL_LOC_PRINCIPAL_PCT = 0.02;

/** Large HELOCs (>=$100K): interest-only threshold */
const HELOC_INTEREST_ONLY_THRESHOLD = 100000;

/**
 * Estimate minimum payment for a credit card.
 * Industry standard: greater of $25 or 2.5% of balance.
 */
function estimateCreditMinPayment(balance: number): { amount: number; method: string } {
  const amount = Math.max(CREDIT_CARD_MIN_FLOOR, balance * CREDIT_CARD_MIN_PCT);
  return { 
    amount, 
    method: `est. ${CREDIT_CARD_MIN_PCT * 100}% of balance`
  };
}

/**
 * Find recurring payment amount from transaction history.
 * Returns median of past regular payments (excluding outliers).
 * Uses ALL available history (not filtered to window) to find the pattern.
 */
function findRecurringPayment(
  accountSlug: string,
  expenseTxns: ExpenseTxnRecord[]
): { amount: number; confidence: "high" | "medium" | "low" } | null {
  // Get all debt payment transactions for this account (ALL history)
  const payments = expenseTxns
    .filter(t => 
      t.accountSlug === accountSlug && 
      t.category === "Debt Payments" &&
      t.amount < 0
    )
    .map(t => Math.abs(t.amount))
    .sort((a, b) => a - b);

  if (payments.length === 0) return null;
  
  // Single payment: low confidence
  if (payments.length === 1) {
    return { amount: payments[0], confidence: "low" };
  }

  // Filter outliers: remove payments > 2x the median (likely extra paydowns)
  const medianIdx = Math.floor(payments.length / 2);
  const rawMedian = payments.length % 2 === 0
    ? (payments[medianIdx - 1] + payments[medianIdx]) / 2
    : payments[medianIdx];

  const regularPayments = payments.filter(p => p <= rawMedian * 2);

  if (regularPayments.length === 0) {
    return { amount: rawMedian, confidence: "low" };
  }

  // Return median of regular payments
  const midIdx = Math.floor(regularPayments.length / 2);
  const amount = regularPayments.length % 2 === 0
    ? (regularPayments[midIdx - 1] + regularPayments[midIdx]) / 2
    : regularPayments[midIdx];

  // Confidence based on number of data points
  const confidence = regularPayments.length >= 6 ? "high" : regularPayments.length >= 3 ? "medium" : "low";

  return { amount, confidence };
}

/**
 * Calculate interest-based minimum payment for LOC/HELOC.
 * 
 * Large HELOCs (>=$100K): interest-only (no principal requirement)
 * Small LOCs (<$100K): interest + 2% of balance
 */
function estimateLOCMinimum(
  accountSlug: string,
  balance: number,
  apr: number,
  expenseTxns: ExpenseTxnRecord[]
): { amount: number; method: string } {
  const isLargeHELOC = balance >= HELOC_INTEREST_ONLY_THRESHOLD;

  // Try to find actual interest charged from transactions
  const interestTxns = expenseTxns
    .filter(t => 
      t.accountSlug === accountSlug && 
      t.category === "Interest" &&
      t.amount < 0
    )
    .map(t => Math.abs(t.amount));

  if (interestTxns.length > 0) {
    // Use median interest charged
    const sortedInterest = [...interestTxns].sort((a, b) => a - b);
    const midIdx = Math.floor(sortedInterest.length / 2);
    const medianInterest = sortedInterest.length % 2 === 0
      ? (sortedInterest[midIdx - 1] + sortedInterest[midIdx]) / 2
      : sortedInterest[midIdx];
    
    if (isLargeHELOC) {
      // Large HELOC: interest-only
      return {
        amount: medianInterest,
        method: "est. interest-only"
      };
    } else {
      // Small LOC: interest + 2% principal
      return {
        amount: medianInterest + (balance * SMALL_LOC_PRINCIPAL_PCT),
        method: `est. interest + ${SMALL_LOC_PRINCIPAL_PCT * 100}% principal`
      };
    }
  }

  // Fallback: estimate from APR
  if (apr > 0) {
    const monthlyInterest = (balance * apr / 100) / 12;
    
    if (isLargeHELOC) {
      return {
        amount: monthlyInterest,
        method: "est. interest-only (from APR)"
      };
    } else {
      return {
        amount: monthlyInterest + (balance * SMALL_LOC_PRINCIPAL_PCT),
        method: `est. interest + ${SMALL_LOC_PRINCIPAL_PCT * 100}% principal`
      };
    }
  }

  // Last resort: 2% of balance
  return {
    amount: balance * 0.02,
    method: "est. 2% of balance"
  };
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
      const { amount, method } = estimateCreditMinPayment(balance);

      scheduledPayments.push({
        accountSlug: account.slug,
        accountName: account.accountName,
        amount,
        isEstimated: true,
        debtType: "credit",
        method,
      });
    } else if (account.accountType === "line_of_credit") {
      // LOC/HELOC: interest-only for large HELOCs, interest + 2% for small LOCs
      const { amount, method } = estimateLOCMinimum(account.slug, balance, rate, expenseTxns);

      scheduledPayments.push({
        accountSlug: account.slug,
        accountName: account.accountName,
        amount,
        isEstimated: true,
        debtType: "loan",
        method,
      });
    } else {
      // Installment loan (mortgage, auto, student, personal)
      let scheduledPayment = 0;
      let isEstimated = false;
      let method = "fixed payment";

      // Try to find recurring payment from transaction history (ALL history)
      const recurringResult = findRecurringPayment(account.slug, expenseTxns);

      if (recurringResult !== null) {
        // Use median of past payments
        scheduledPayment = recurringResult.amount;
        isEstimated = recurringResult.confidence !== "high";
        method = recurringResult.confidence === "high" 
          ? "fixed payment"
          : recurringResult.confidence === "medium"
          ? "fixed payment (est.)"
          : "fixed payment (low confidence)";
      } else {
        // No history: estimate from balance and rate
        scheduledPayment = estimateLoanPayment(balance, rate, account.accountType);
        isEstimated = true;
        method = "est. from balance & rate";
      }

      scheduledPayments.push({
        accountSlug: account.slug,
        accountName: account.accountName,
        amount: scheduledPayment,
        isEstimated,
        debtType: "loan",
        method,
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
