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
  /** Stable account slug (bankName+accountId) used as part of the per-transaction key. "cash" for synthetic cash-income entries. */
  accountSlug?: string;
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

export type DebtType =
  | "mortgage"
  | "auto_loan"
  | "personal_loan"
  | "student_loan"
  | "credit_card"
  | "line_of_credit"
  | "other_debt";

/** User classification for a debt payment anomaly */
export type DebtPaymentClassification = 
  | "extra_prepayment"    // Only excess above regular payment goes to Savings & debt
  | "new_regular_payment" // Update account's regular payment from this date
  | "ignore";             // Excluded (refinance/transfer)

/** User review record for a debt payment transaction */
export interface DebtPaymentReview {
  /** Transaction fingerprint (SHA-256 hash) */
  txFingerprint: string;
  /** Account slug this review applies to */
  accountSlug: string;
  /** User's classification */
  classification: DebtPaymentClassification;
  /** Date of the transaction (YYYY-MM-DD) */
  date: string;
  /** Amount of the transaction */
  amount: number;
  /** When the user made this classification */
  reviewedAt: Date | { toDate(): Date };
}

export interface ExpenseTransaction {
  merchant: string;
  amount: number;
  category: string;
  date?: string; // ISO date YYYY-MM-DD
  /** Sub-type for Debt → Installment Servicing / Card Servicing — detected by AI from merchant name */
  debtType?: DebtType;
  /**
   * When the statement breaks out installment payment (optional). Interest is true expense;
   * principal is balance-sheet neutral (cash ↓, liability ↓). Omitted when unknown.
   */
  installmentInterestAmount?: number;
  installmentPrincipalAmount?: number;
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
  | "line_of_credit"
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

/**
 * Shared validation function for multi-month balance reconstruction.
 * Used by both production (financialProfile.ts) and regression test.
 * 
 * Verifies that derived balances reconcile with statement data by walking
 * backward from closing balance using ONLY that statement's own transactions.
 */
export function validateDerivedBalances(
  statementMonth: string,
  closingBalance: number,
  parsed: ParsedStatementData,
  derivedBalances: Map<string, number>,
  isDebtAccount: boolean
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  // Get statement's own transactions
  const stmtExpenses = parsed.expenses?.transactions ?? [];
  const stmtIncome = parsed.income?.transactions ?? [];
  
  // Build transaction net flows by month
  const txnsByMonth = new Map<string, number>();
  
  for (const exp of stmtExpenses) {
    if (!exp.date) continue;
    const month = exp.date.slice(0, 7);
    const current = txnsByMonth.get(month) || 0;
    txnsByMonth.set(month, current - exp.amount); // Expenses = outflow
  }
  
  for (const inc of stmtIncome) {
    if (!inc.date) continue;
    const month = inc.date.slice(0, 7);
    const current = txnsByMonth.get(month) || 0;
    txnsByMonth.set(month, current + inc.amount); // Income = inflow
  }
  
  const txnMonths = Array.from(txnsByMonth.keys()).sort();
  if (txnMonths.length === 0) {
    return { valid: true, errors: [] }; // No transactions, nothing to validate
  }
  
  const firstTxnMonth = txnMonths[0];
  const lastTxnMonth = txnMonths[txnMonths.length - 1];
  
  // Validate each derived balance
  for (const [month, balance] of derivedBalances.entries()) {
    // Check 1: Within statement's transaction range
    if (month < firstTxnMonth || month > lastTxnMonth) {
      errors.push(`${month}: outside txn range [${firstTxnMonth}, ${lastTxnMonth}]`);
      continue;
    }
    
    // Check 2: Savings/checking must be >= 0
    if (!isDebtAccount && balance < 0) {
      errors.push(`${month}: negative balance ${balance.toFixed(2)} for asset account`);
      continue;
    }
    
    // Check 3: Reconcile by walking backward from closing balance
    // Sum all transaction months AFTER this derived month
    let txnChangeAfter = 0;
    for (const [txnMonth, netFlow] of txnsByMonth.entries()) {
      if (txnMonth > month && txnMonth <= statementMonth) {
        txnChangeAfter += netFlow;
      }
    }
    
    const recomputed = closingBalance - txnChangeAfter;
    const diff = Math.abs(recomputed - balance);
    
    if (diff > 1) {
      errors.push(`${month}: derived ${balance.toFixed(2)} vs recomputed ${recomputed.toFixed(2)} (diff ${diff.toFixed(2)})`);
    }
  }
  
  return { valid: errors.length === 0, errors };
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
  /**
   * Stable account slug computed from unmasked accountId at parse time.
   * Consumers should prefer this field over recomputing from accountId,
   * since accountId is masked to last 4 digits in Firestore.
   */
  accountSlug?: string;
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
  status: "processing" | "completed" | "error" | "needs_review";
  errorMessage?: string;
  /** Partial data captured from a failed AI parse — pre-fills the review form */
  partialParsedData?: Partial<ParsedStatementData>;
  /** Human-readable description of why review is needed */
  parseError?: string;
  /** How the data was ingested: "pdf" (default) or "csv" */
  source?: "pdf" | "csv";
  /** For CSV imports: the date range of transactions in the file */
  csvDateRange?: { from: string; to: string };
}

// API response types
export interface StatementApiResponse {
  status: "processing" | "completed" | "error" | "needs_review";
  parsedData?: ParsedStatementData;
  partialParsedData?: Partial<ParsedStatementData>;
  parseError?: string;
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
  /** Parsed OK but excluded from dashboard until /account/setup is completed */
  needsAccountSetup?: boolean;
  interestRate?: number | null;
  subAccounts?: SubAccount[];
  uploadedBy?: string;      // actorUid — present only when a partner uploaded on owner's behalf
  uploadedByEmail?: string; // display-friendly version of uploadedBy
}
