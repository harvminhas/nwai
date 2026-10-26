/**
 * Unified review system types.
 * Supports debt payment anomalies, savings confirmations, and future review types.
 */

// Base review item (all review types extend this)
export interface BaseReviewItem {
  id: string; // Unique identifier (txFingerprint for debt, generated for savings)
  type: "debt_payment" | "savings_item";
  accountSlug?: string;
  accountName?: string;
  date: string;
  amount: number;
  txMonth: string;
}

// Debt payment anomaly review
export interface DebtPaymentReviewItem extends BaseReviewItem {
  type: "debt_payment";
  reason: "much_higher" | "much_lower" | "first_payment";
  regularAmount?: number;
  accountSlug: string;
}

// Savings confirmation review
export interface SavingsReviewItem extends BaseReviewItem {
  type: "savings_item";
  merchant: string;
  category: string;
  reason: string; // e.g., "life insurance ambiguous"
}

// Income classification review (is this income, transfer, or refund?)
export interface IncomeClassificationReviewItem extends BaseReviewItem {
  type: "income_classification";
  source: string;
  reason: "possible_transfer" | "possible_refund" | "ambiguous_category";
  suggestedCategory?: string;
}

// Union of all review types
export type ReviewItem = DebtPaymentReviewItem | SavingsReviewItem | IncomeClassificationReviewItem;

// Classification options per review type
export type DebtPaymentClassification = "extra_prepayment" | "new_regular_payment" | "ignore";
export type SavingsClassification = "is_savings" | "not_savings" | "ignore";
export type IncomeClassification = "is_income" | "is_transfer" | "is_refund" | "ignore";
export type ReviewClassification = DebtPaymentClassification | SavingsClassification | IncomeClassification;

// Persisted review record
export interface ReviewRecord {
  id: string; // Same as review item ID
  type: "debt_payment" | "savings_item";
  classification: ReviewClassification;
  accountSlug?: string;
  date: string;
  amount: number;
  reviewedAt: string; // ISO timestamp
}
