/**
 * Unified review system types.
 * Supports debt payment anomalies, savings confirmations, income classification, and subscription confirmations.
 */

// Base review item (all review types extend this)
export interface BaseReviewItem {
  id: string; // Unique identifier (txFingerprint for debt, merchantSlug for subscription, txn id for income_deposit, accountSlug for stale_account, generated for savings/income)
  type: "debt_payment" | "savings_item" | "income_classification" | "subscription" | "income_deposit" | "stale_account";
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

// Income deposit review (unusual amount - is it regular, bonus, or not income?)
export interface IncomeDepositReviewItem extends BaseReviewItem {
  type: "income_deposit";
  source: string;
  usualAmount?: number;
  reason: "unusual_amount" | "large_refund"; // unusual_amount: >1.5x median; large_refund: refund/rebate/reversal >$1K
}

// Subscription confirmation review
export interface SubscriptionReviewItem extends BaseReviewItem {
  type: "subscription";
  merchant: string;
  merchantSlug: string;
  category: string;
  cadence: "monthly" | "yearly" | "ambiguous";
  chargeCount: number;
}

// Stale account review (no statement for >45 days)
export interface StaleAccountReviewItem extends BaseReviewItem {
  type: "stale_account";
  accountSlug: string;
  accountName: string;
  bankName: string;
  accountType: string;
  balance: number;
  daysOld: number;
  lastStatementMonth: string;
}

// Union of all review types
export type ReviewItem = DebtPaymentReviewItem | SavingsReviewItem | IncomeClassificationReviewItem | IncomeDepositReviewItem | SubscriptionReviewItem | StaleAccountReviewItem;

// Classification options per review type
export type DebtPaymentClassification = "extra_prepayment" | "new_regular_payment" | "ignore";
export type SavingsClassification = "is_savings" | "not_savings" | "ignore";
export type IncomeClassification = "is_income" | "is_transfer" | "is_refund" | "ignore";
export type IncomeDepositClassification = "regular_income" | "bonus" | "not_income";
export type SubscriptionClassification = "is_subscription" | "not_subscription" | "still_active" | "cancelled";
export type StaleAccountClassification = "still_open" | "closed" | "ignore";
export type ReviewClassification = DebtPaymentClassification | SavingsClassification | IncomeClassification | IncomeDepositClassification | SubscriptionClassification | StaleAccountClassification;

// Billing frequency options for subscriptions
export type BillingFrequency = "weekly" | "monthly" | "quarterly" | "yearly";

// Persisted review record
export interface ReviewRecord {
  id: string; // Same as review item ID
  type: "debt_payment" | "savings_item" | "subscription" | "income_deposit" | "stale_account";
  classification: ReviewClassification;
  accountSlug?: string;
  merchantSlug?: string;
  date: string;
  amount: number;
  reviewedAt: string; // ISO timestamp
  billingFrequency?: BillingFrequency; // User override for subscription billing frequency
}
