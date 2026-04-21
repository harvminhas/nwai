export type LiabilityCategory =
  | "mortgage"
  | "auto_loan"
  | "student_loan"
  | "personal_loan"
  | "credit_card"
  | "line_of_credit"
  | "other";

export interface ManualLiability {
  id: string;
  label: string;
  category: LiabilityCategory;
  balance: number;
  interestRate?: number; // annual % e.g. 5.5
  updatedAt: string; // ISO date string
}

export type AssetCategory =
  | "property"
  | "vehicle"
  | "retirement"
  | "investment"
  | "business"
  | "other";

export interface ManualAsset {
  id: string;
  label: string;
  category: AssetCategory;
  value: number;
  /** Optional slug of a linked statement account (mortgage/loan) */
  linkedAccountSlug?: string;
  updatedAt: string; // ISO date string
}

// Parsed statement data from Claude API
export interface IncomeSource {
  description: string;
  amount: number;
}

export interface IncomeTransaction {
  /** Payee / description as it appears on the statement (e.g. "MAM Pay", "CRA Deposit"). Mirrors `merchant` on ExpenseTransaction. */
  source: string;
  amount: number;
  date?: string; // ISO YYYY-MM-DD
  /** Income type: "Salary" | "Government" | "Transfer In" | "Other" */
  category?: string;
  /** Human-readable account label e.g. "TD ••••7780". Populated at API aggregation time. */
  accountLabel?: string;
  /** ISO 4217 currency of the source account (e.g. "CAD", "USD"). Populated at API aggregation time. */
  currency?: string;
}

export interface Income {
  total: number;
  sources: IncomeSource[];
  transactions?: IncomeTransaction[];
}

export interface ExpenseCategory {
  name: string;
  amount: number;
  percentage: number;
}

export type DebtType = "mortgage" | "auto_loan" | "personal_loan" | "credit_card" | "line_of_credit" | "other_debt";

export interface ExpenseTransaction {
  merchant: string;
  amount: number;
  category: string;
  date?: string; // ISO date YYYY-MM-DD
  /** Sub-type for Debt Payments category — detected by AI from merchant name */
  debtType?: DebtType;
  /**
   * AI-detected recurrence frequency for this specific transaction.
   * One of: "weekly" | "biweekly" | "monthly" | "quarterly" | "annual"
   * Omitted / undefined when the AI cannot determine recurrence with confidence.
   */
  recurring?: string;
  /** Human-readable account label e.g. "TD ••••7780". Populated at API aggregation time. */
  accountLabel?: string;
  /** ISO 4217 currency of the source account (e.g. "CAD", "USD"). Populated at API aggregation time. */
  currency?: string;
  /** Firestore statement document ID — populated at API aggregation time. */
  stmtId?: string;
  /**
   * Stable account identifier (`buildAccountSlug(bankName, accountId)`) — populated at API
   * aggregation time. Used as the account portion of txnKey so overrides survive statement
   * re-uploads (which produce a new stmtId but the same accountSlug).
   */
  accountSlug?: string;
}

export interface Expenses {
  total: number;
  categories: ExpenseCategory[];
  transactions?: ExpenseTransaction[];
}

export interface Subscription {
  name: string;
  amount: number;
  frequency: string;
}

export interface Insight {
  type: string;
  title: string;
  message: string;
  cta: string;
  ctaUrl?: string;
  priority: "high" | "medium" | "low";
}

export type AccountType =
  | "checking"
  | "savings"
  | "credit"
  | "mortgage"
  | "investment"
  | "loan"
  | "other";

/**
 * A single segment of a multi-part statement (e.g. revolving HELOC + term
 * mortgage portions inside one TD FlexLine PDF).
 */
export interface SubAccount {
  /** Sub-account number / ID as printed on the statement */
  id: string;
  /** Human-readable label from the statement, e.g. "Revolving Portion", "Term Portion 1" */
  label: string;
  /** Account sub-type */
  type: "heloc" | "mortgage" | "loan" | "credit";
  /** Outstanding balance (positive number) */
  balance: number;
  /** Annual interest rate %; null if not stated */
  apr: number | null;
  /** Maturity / renewal date for fixed-term segments (YYYY-MM-DD) */
  maturityDate?: string;
}

export type HoldingType =
  | "stock"
  | "etf"
  | "mutual_fund"
  | "bond"
  | "gic"
  | "cash"
  | "other";

export interface InvestmentHolding {
  /** Ticker / fund symbol as printed (e.g. "AAPL", "FXAIX", "VFV"). Omit if not on statement. */
  symbol?: string;
  /** Full name as printed on the statement. */
  name: string;
  /** Asset class — exactly one of the HoldingType values. */
  type: HoldingType;
  /** Current market value in dollars. */
  value: number;
  /** Number of shares / units held. Omit if not stated. */
  units?: number;
  /** Portfolio weight 0–100. Omit if not stated; derived from value/total when available. */
  percentOfPortfolio?: number;
}

export interface ParsedStatementData {
  netWorth?: number;
  /** When statement shows breakdown; else derived from netWorth (positive = assets, negative = debts). */
  assets?: number;
  /** When statement shows breakdown; else derived from netWorth. */
  debts?: number;
  statementDate: string;
  bankName: string;
  /** Masked account number e.g. "••••1234" or full if not sensitive */
  accountId?: string;
  /** Human-readable account nickname e.g. "Chase Sapphire Reserve" */
  accountName?: string;
  /** Type of account */
  accountType?: AccountType;
  /**
   * Annual interest / return rate as a percentage (e.g. 4.25 means 4.25%).
   * For debt accounts: the interest rate charged (APR).
   * For savings/investment: the yield / expected annual return.
   * Null if not present on the statement.
   */
  interestRate?: number | null;
  income: Income;
  expenses: Expenses;
  /**
   * Total payments made toward this account's balance this period.
   * Populated for credit/loan/mortgage accounts only — represents money
   * received (e.g. a monthly credit card payment or mortgage payment).
   * This is NOT income; it is debt repayment tracked separately so the
   * consolidated view can offset the matching outgoing transfer in the
   * checking/savings statement and avoid double-counting.
   */
  paymentsMade?: number;
  subscriptions: Subscription[];
  savingsRate: number;
  /** @deprecated Insights are now generated from history, not per-statement. Kept for backward compat with older stored documents. */
  insights?: Insight[];
  /**
   * For multi-segment statements (e.g. HELOC + mortgage term portions in one PDF).
   * Each segment gets its own balance, APR, and type so the liabilities view
   * can show accurate per-tranche breakdowns and payoff calculations.
   */
  subAccounts?: SubAccount[];
  /**
   * ISO 4217 currency code as printed on the statement (e.g. "CAD", "USD").
   * Defaults to "CAD" if not stated (most Canadian bank statements don't print it).
   */
  currency?: string;
  /**
   * Investment holdings extracted from the statement (investment accounts only).
   * Each entry represents one fund, stock, ETF, bond, or other position.
   */
  holdings?: InvestmentHolding[];
}

// Firestore document types (timestamps as Date or Firestore Timestamp depending on context)
export interface UserDocument {
  uid: string;
  email: string;
  displayName: string;
  createdAt: Date | { toDate(): Date };
  plan: "free" | "premium";
  uploadsThisMonth: number;
}

export interface StatementDocument {
  id: string;
  userId: string | null;
  uploadedAt: Date | { toDate(): Date };
  fileName: string;
  fileUrl: string;
  parsedData?: ParsedStatementData;
  status: "processing" | "completed" | "error";
  errorMessage?: string;
  /** How the data was ingested: "pdf" (default) or "csv" */
  source?: "pdf" | "csv";
  /** For CSV imports: the date range of transactions in the file */
  csvDateRange?: { from: string; to: string };
}

// API response types
export interface StatementApiResponse {
  status: "processing" | "completed" | "error";
  parsedData?: ParsedStatementData;
  errorMessage?: string;
  statementId?: string;
}

export interface UploadApiResponse {
  statementId: string;
}

export interface UserStatementSummary {
  id: string;
  uploadedAt: string;
  fileName: string;
  netWorth?: number;
  statementDate?: string;
  bankName?: string;
  accountId?: string;
  accountName?: string;
  accountType?: string;
  status: string;
  superseded?: boolean;
  supersededBy?: string;
  fileHash?: string;
  source?: "pdf" | "csv";
  csvDateRange?: { from: string; to: string };
  txCount?: number;
  interestRate?: number | null;
  subAccounts?: SubAccount[];
}
