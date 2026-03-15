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

export interface Income {
  total: number;
  sources: IncomeSource[];
}

export interface ExpenseCategory {
  name: string;
  amount: number;
  percentage: number;
}

export interface ExpenseTransaction {
  merchant: string;
  amount: number;
  category: string;
  date?: string; // ISO date YYYY-MM-DD
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

export interface ParsedStatementData {
  netWorth: number;
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
  income: Income;
  expenses: Expenses;
  subscriptions: Subscription[];
  savingsRate: number;
  insights: Insight[];
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
}
