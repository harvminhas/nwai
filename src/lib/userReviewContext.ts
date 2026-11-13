/**
 * Shared user review context loader.
 * 
 * Loads all user review/classification data needed by financial calculations:
 * - Income deposit reviews (income_deposit type) → Map<txId, classification>
 * - Debt payment reviews (debtPaymentReviews collection) → DebtPaymentReview[]
 * - Savings item confirmations (savings_item type) → Map<txId, boolean>
 * 
 * Used by:
 * - Chat API route (loads once per request, passes to executeTool)
 * - Dashboard drawers route
 * - Money coach route
 * - Income summary route
 * - Regression tests
 */

import type { Firestore } from "firebase-admin/firestore";
import type { DebtPaymentReview } from "./types";

export interface UserReviewContext {
  /** Income deposit classifications: txId → "income" | "not_income" | "bonus" | "unusual_amount" */
  incomeDepositReviews: Map<string, string>;
  /** Debt payment classifications for spending bucket assignment */
  debtPaymentReviews: DebtPaymentReview[];
  /**
   * Savings item confirmations: txId → is_savings (true) or excluded (false).
   *
   * These used to decide whether ambiguous Investments & Savings merchants
   * (life insurance, etc.) counted as "outside contributions" in the
   * balance-change savings formula (computeMonthlySavings).
   *
   * Net savings is now leftover (money in − money out) from
   * getMonthlyCashFlow, so these reviews do not change the Net savings
   * card, drawer, or chat answer. Still loaded so existing reviews are
   * not dropped from Firestore; they only matter if the balance-change
   * path is used by inspect-savings / regression-report.
   */
  savingsConfirmedItems: Map<string, boolean>;
}

/**
 * Load all user review context from Firestore.
 * Call once per request and pass to all tools that need classifications.
 */
export async function loadUserReviewContext(
  uid: string,
  db: Firestore
): Promise<UserReviewContext> {
  // Load income deposit reviews
  const incomeReviewsSnap = await db
    .collection(`users/${uid}/reviews`)
    .where("type", "==", "income_deposit")
    .get();
  
  const incomeDepositReviews = new Map<string, string>();
  incomeReviewsSnap.docs.forEach(doc => {
    incomeDepositReviews.set(doc.id, doc.get("classification"));
  });

  // Load debt payment reviews
  const debtReviewsSnap = await db
    .collection(`users/${uid}/debtPaymentReviews`)
    .get();
  
  const debtPaymentReviews: DebtPaymentReview[] = debtReviewsSnap.docs.map((doc) => ({
    txFingerprint: doc.id,
    accountSlug: doc.get("accountSlug"),
    classification: doc.get("classification"),
    date: doc.get("date"),
    amount: doc.get("amount"),
    reviewedAt: doc.get("reviewedAt"),
  }));

  // Load savings confirmations
  const savingsReviewsSnap = await db
    .collection(`users/${uid}/reviews`)
    .where("type", "==", "savings_item")
    .get();
  
  const savingsConfirmedItems = new Map<string, boolean>();
  savingsReviewsSnap.docs.forEach(doc => {
    const classification = doc.get("classification");
    // "is_savings" → true (count it), anything else → false (exclude it)
    savingsConfirmedItems.set(doc.id, classification === "is_savings");
  });

  return {
    incomeDepositReviews,
    debtPaymentReviews,
    savingsConfirmedItems,
  };
}
