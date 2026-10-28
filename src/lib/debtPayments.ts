/**
 * Debt Payment Calculation with Anomaly Detection
 * 
 * All loans/mortgages: learn regular payment from recurring patterns.
 * Anomalies (1.5× or 0.5× regular) are flagged for review.
 * Credit cards: estimated minimum when carrying balance.
 * 
 * CURRENCY: All amounts are converted to home currency using fxRates.
 * Balances, payments, and minimums must be in home currency before aggregation.
 */

import type { AccountSnapshot, ExpenseTxnRecord, DebtPaymentHistoryEntry } from "./extractTransactions";
import type { DebtPaymentReview } from "./types";
import { txFingerprint } from "./txFingerprint";

export interface ScheduledDebtPayment {
  accountSlug: string;
  accountName?: string;
  /** Regular/scheduled payment amount per month */
  amount: number;
  /** True when amount is estimated (no payment history) */
  isEstimated: boolean;
  /** Type: "loan" for installment debt, "credit" for revolving credit */
  debtType: "loan" | "credit";
  /** Method label: "usual payment" | "est. 3% of balance" | "set by you" */
  method: string;
  /** Unreviewed anomalies for this account (excluded from both Fixed and Savings) */
  unreviewedAnomalies?: DebtAnomaly[];
}

export interface DebtAnomaly {
  txMonth: string;
  date: string;
  amount: number;
  description: string;
  /** Why flagged: "much_higher" | "much_lower" | "extra_in_month" */
  reason: string;
  /** Account slug */
  accountSlug: string;
  /** Transaction fingerprint for linking to reviews */
  txFingerprint: string;
  /** Account name for display (e.g. "TD Home Equity FlexLine") */
  accountName?: string;
  /** Regular/usual payment amount for this account (for comparison) */
  regularAmount?: number;
}

// ── Constants ──────────────────────────────────────────────────────────────

/** Credit cards: 3% of balance or $10 floor */
const CREDIT_CARD_MIN_PCT = 0.03;
const CREDIT_CARD_MIN_FLOOR = 10;

/** Anomaly thresholds */
const ANOMALY_HIGH_THRESHOLD = 1.5;  // Payment > 1.5× median
const ANOMALY_LOW_THRESHOLD = 0.5;   // Payment < 0.5× median

/**
 * Detect recurring payment amount and flag anomalies.
 * Returns median of regular payments (all non-zero paymentsMade history), plus list of anomalies.
 * All amounts are converted to home currency.
 * 
 * For loan/mortgage accounts, payment history comes from all paymentsMade across ALL statements.
 */
function detectRecurringPayment(
  accountSlug: string,
  debtPaymentHistory: DebtPaymentHistoryEntry[],
  userReviews: Map<string, DebtPaymentReview>,
  toHome: (amount: number, currency?: string) => number
): { 
  regularAmount: number | null; 
  anomalies: DebtAnomaly[];
  paymentCount: number;
  reviewedAnomalies: DebtAnomaly[];
} {
  // Get all non-zero payments for this account
  const payments = debtPaymentHistory
    .filter(entry => entry.accountSlug === accountSlug && entry.paymentsMade > 0)
    .map(entry => {
      const date = `${entry.statementMonth}-15`; // Use mid-month for statement date
      const amount = toHome(entry.paymentsMade, entry.currency);
      const fingerprint = txFingerprint(accountSlug, date, amount, "Payment");
      return {
        date,
        txMonth: entry.statementMonth,
        amount,
        description: `Payment ${entry.statementMonth}`,
        fingerprint,
        currency: entry.currency,
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  if (payments.length === 0) {
    return { regularAmount: null, anomalies: [], paymentCount: 0, reviewedAnomalies: [] };
  }

  if (payments.length === 1) {
    // Single payment: can't detect pattern yet
    return { 
      regularAmount: payments[0].amount, 
      anomalies: [], 
      paymentCount: 1,
      reviewedAnomalies: []
    };
  }

  // Calculate initial median to identify outliers
  const amounts = payments.map(p => p.amount).sort((a, b) => a - b);
  const medianIdx = Math.floor(amounts.length / 2);
  const rawMedian = amounts.length % 2 === 0
    ? (amounts[medianIdx - 1] + amounts[medianIdx]) / 2
    : amounts[medianIdx];

  // Separate regular payments from anomalies
  const unreviewedAnomalies: DebtAnomaly[] = [];
  const reviewedAnomalies: DebtAnomaly[] = [];
  const regularPayments: number[] = [];

  // Track payments by month to detect multiple payments
  const paymentsByMonth = new Map<string, typeof payments>();
  for (const p of payments) {
    const existing = paymentsByMonth.get(p.txMonth) || [];
    existing.push(p);
    paymentsByMonth.set(p.txMonth, existing);
  }

  for (const payment of payments) {
    const monthPayments = paymentsByMonth.get(payment.txMonth)!;
    const review = userReviews.get(payment.fingerprint);
    
    // Check if user has classified this as "ignore"
    if (review?.classification === "ignore") {
      // Excluded entirely (refinance/transfer) - don't count anywhere
      continue;
    }

    // Check if user has classified this as "new_regular_payment"
    if (review?.classification === "new_regular_payment") {
      // Treat as a regular payment
      regularPayments.push(payment.amount);
      continue;
    }

    // Check if this is an anomaly
    let isAnomaly = false;
    let reason = "";

    // Anomaly type 1: Much higher or lower than median
    if (payment.amount > rawMedian * ANOMALY_HIGH_THRESHOLD) {
      isAnomaly = true;
      reason = "much_higher";
    } else if (payment.amount < rawMedian * ANOMALY_LOW_THRESHOLD && rawMedian > 100) {
      isAnomaly = true;
      reason = "much_lower";
    } 
    // Anomaly type 2: Extra payment in same month
    // Only flag if there's another payment AND this one is within normal range
    else if (monthPayments.length > 1) {
      // Find which payment(s) in this month are in normal range
      const normalPayments = monthPayments.filter(p => 
        p.amount <= rawMedian * ANOMALY_HIGH_THRESHOLD && 
        p.amount >= rawMedian * ANOMALY_LOW_THRESHOLD
      );
      
      // If there's more than one normal payment, or this is normal and there's an abnormal one
      if (normalPayments.length > 1 || (normalPayments.length === 1 && normalPayments[0] === payment && monthPayments.length > 1)) {
        // Only flag the smaller extra payment(s), not the main recurring one
        const sortedNormal = [...normalPayments].sort((a, b) => b.amount - a.amount);
        if (sortedNormal.length > 1 && sortedNormal[0] !== payment) {
          isAnomaly = true;
          reason = "extra_in_month";
        }
      }
    }

    if (isAnomaly) {
      const anomaly: DebtAnomaly = {
        txMonth: payment.txMonth,
        date: payment.date,
        amount: payment.amount,
        description: payment.description,
        reason,
        accountSlug,
        txFingerprint: payment.fingerprint,
      };

      if (review?.classification === "extra_prepayment") {
        // Reviewed as prepayment - include in reviewed list
        reviewedAnomalies.push(anomaly);
      } else {
        // Unreviewed - exclude from both Fixed and Savings
        unreviewedAnomalies.push(anomaly);
      }
    } else {
      regularPayments.push(payment.amount);
    }
  }

  if (regularPayments.length === 0) {
    // All payments were anomalies - use raw median but flag concern
    return { 
      regularAmount: rawMedian, 
      anomalies: unreviewedAnomalies, 
      paymentCount: payments.length,
      reviewedAnomalies
    };
  }

  // Return median of regular payments
  const sorted = regularPayments.sort((a, b) => a - b);
  const midIdx = Math.floor(sorted.length / 2);
  const regularAmount = sorted.length % 2 === 0
    ? (sorted[midIdx - 1] + sorted[midIdx]) / 2
    : sorted[midIdx];

  return { regularAmount, anomalies: unreviewedAnomalies, paymentCount: payments.length, reviewedAnomalies };
}

/**
 * Estimate minimum payment for a credit card.
 * 3% of balance or $10 floor.
 */
function estimateCreditMinPayment(balance: number): { amount: number; method: string } {
  const amount = Math.max(CREDIT_CARD_MIN_FLOOR, balance * CREDIT_CARD_MIN_PCT);
  return { 
    amount, 
    method: `est. ${CREDIT_CARD_MIN_PCT * 100}% of balance`
  };
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
 * Compute scheduled debt payments for all debt accounts.
 * 
 * Logic:
 * - Installment loans (mortgage, LOC, car loan, personal): learn regular payment from ALL payment history
 * - Anomalies (>1.5× or <0.5× median) are flagged for review
 * - Credit cards: estimate minimum when carrying balance
 * - A loan with even 1 known payment uses it (low confidence is acceptable)
 * 
 * @param debtPaymentHistory - All paymentsMade values from all debt account statements
 * @param fxRates - Currency conversion rates (e.g. { "CAD": 0.72 } means 1 CAD = 0.72 USD)
 * @param homeCurrency - The home currency to convert all amounts to (e.g. "USD" or "CAD")
 * @param userReviews - User classifications for anomalous transactions
 */
export function computeScheduledDebtPayments(
  accountSnapshots: AccountSnapshot[],
  debtPaymentHistory: DebtPaymentHistoryEntry[],
  userReviews: DebtPaymentReview[] = [],
  fxRates: Record<string, number> = {},
  homeCurrency: string = "CAD"
): ScheduledDebtPayment[] {
  // Currency conversion helper
  const home = homeCurrency.toUpperCase();
  function toHome(amount: number, currency?: string): number {
    const cur = (currency ?? home).toUpperCase();
    if (cur === home) return amount;
    const rate = fxRates[cur];
    return rate ? amount * rate : amount;
  }

  // Build a map of reviews by transaction fingerprint
  const reviewMap = new Map<string, DebtPaymentReview>();
  for (const review of userReviews) {
    reviewMap.set(review.txFingerprint, review);
  }
  const debtAccounts = accountSnapshots.filter(
    (a) =>
      a.accountType === "credit" ||
      a.accountType === "credit_card" ||
      a.accountType === "mortgage" ||
      a.accountType === "loan" ||
      a.accountType === "auto_loan" ||
      a.accountType === "student_loan" ||
      a.accountType === "personal_loan" ||
      a.accountType === "line_of_credit"
  );

  const scheduledPayments: ScheduledDebtPayment[] = [];

  for (const account of debtAccounts) {
    const balance = toHome(Math.abs(account.balance), account.currency);
    const paymentMade = toHome(account.paymentsMade ?? 0, account.currency);

    if (account.accountType === "credit" || account.accountType === "credit_card") {
      // Credit card: check if carrying balance
      if (isPaidInFull(balance, paymentMade)) {
        // Paid in full: no fixed cost
        continue;
      }

      // Carrying balance: estimate minimum (never use paymentsMade)
      const { amount, method } = estimateCreditMinPayment(balance);

      scheduledPayments.push({
        accountSlug: account.slug,
        accountName: account.accountName,
        amount,
        isEstimated: true,
        debtType: "credit",
        method,
        unreviewedAnomalies: [],
      });
    } else {
      // Installment loan/mortgage/LOC: detect recurring payment from ALL payment history
      const { regularAmount, anomalies, paymentCount, reviewedAnomalies } = detectRecurringPayment(
        account.slug,
        debtPaymentHistory,
        reviewMap,
        toHome
      );

      if (regularAmount !== null && paymentCount >= 1) {
        // Have payment history (even 1 payment is usable, though low confidence)
        scheduledPayments.push({
          accountSlug: account.slug,
          accountName: account.accountName,
          amount: regularAmount,
          isEstimated: paymentCount < 6, // Low confidence if < 6 payments
          debtType: "loan",
          method: paymentCount >= 6 ? "usual payment" : "usual payment (low confidence)",
          unreviewedAnomalies: anomalies,
        });
      } else {
        // No payment history: estimate from rate or skip
        // For now, skip accounts with no payment data
        // (Owner can add via "Set payment" override)
        continue;
      }
    }
  }

  return scheduledPayments;
}

/**
 * Compute extra debt paydown for a given month.
 * Extra = actual payments made - scheduled payments.
 * Excludes unreviewed anomalies (they go nowhere until reviewed).
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

/**
 * Get all unreviewed anomalies across all accounts.
 * Used by UI to show "N to review" badge and review list.
 */
export function getAllUnreviewedAnomalies(
  accountSnapshots: AccountSnapshot[],
  debtPaymentHistory: DebtPaymentHistoryEntry[],
  userReviews: DebtPaymentReview[] = [],
  fxRates: Record<string, number> = {},
  homeCurrency: string = "CAD"
): DebtAnomaly[] {
  const payments = computeScheduledDebtPayments(accountSnapshots, debtPaymentHistory, userReviews, fxRates, homeCurrency);
  const allAnomalies: DebtAnomaly[] = [];

  for (const payment of payments) {
    if (payment.unreviewedAnomalies && payment.unreviewedAnomalies.length > 0) {
      // Enrich anomalies with account name and regular amount from parent payment
      const enriched = payment.unreviewedAnomalies.map(anomaly => ({
        ...anomaly,
        accountName: payment.accountName,
        regularAmount: payment.amount,
      }));
      allAnomalies.push(...enriched);
    }
  }

  return allAnomalies;
}
