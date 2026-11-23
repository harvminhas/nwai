import type { AccountType, ParsedStatementData, UploadedDocumentType } from "./types";

export type ClassifyUploadedDocumentOk = { ok: true };
export type ClassifyUploadedDocumentReject = {
  ok: false;
  reason: string;
  message: string;
};
export type ClassifyUploadedDocumentResult =
  | ClassifyUploadedDocumentOk
  | ClassifyUploadedDocumentReject;

const NON_STATEMENT_TYPES = new Set<string>([
  "bill",
  "invoice",
  "receipt",
  "pay_stub",
  "tax_form",
]);

const DOCUMENT_NOUN: Record<string, string> = {
  bill: "bill",
  invoice: "invoice",
  receipt: "receipt",
  pay_stub: "pay stub",
  tax_form: "tax form",
  other: "document",
  unrecognized: "document",
};

const CREDIT_TYPES = new Set<string>(["credit", "credit_card", "line_of_credit"]);
const LOAN_TYPES = new Set<string>(["loan", "mortgage"]);
const DEPOSIT_TYPES = new Set<string>(["checking", "savings"]);

export function isRejectedStatementStatus(status: string | undefined): boolean {
  return status === "rejected";
}

/** Rejected records are omitted from accounts, net worth, cash flow, and admin counts. */
export function isCountableStatementStatus(status: string | undefined): boolean {
  return !isRejectedStatementStatus(status);
}

/**
 * True when this statement already has a completed parse we must not wipe
 * (status still "completed", or reparse reset to processing while keeping slug + data).
 */
export function wasPreviouslyCompletedStatement(
  data: {
    status?: string;
    parsedData?: unknown;
    accountSlug?: string | null;
  } | null | undefined
): boolean {
  if (!data) return false;
  if (isRejectedStatementStatus(data.status)) return false;
  if (data.status === "completed") return true;
  return Boolean(data.parsedData) && Boolean(data.accountSlug);
}

const RESTORE_ON_REJECT_STATUSES = new Set(["completed", "needs_review", "error"]);

/**
 * Status to put back when a reparse's extraction looks like a non-statement.
 * Prefers `statusBeforeReparse` (written by the reparse route) so a
 * needs_review/error record is not promoted to completed.
 */
export function statusToRestoreOnClassifierReject(
  data: {
    status?: string;
    statusBeforeReparse?: string | null;
    parsedData?: unknown;
    accountSlug?: string | null;
  } | null | undefined
): string | null {
  if (!data) return null;
  const recorded = data.statusBeforeReparse;
  if (typeof recorded === "string" && RESTORE_ON_REJECT_STATUSES.has(recorded)) {
    return recorded;
  }
  if (typeof data.status === "string" && RESTORE_ON_REJECT_STATUSES.has(data.status)) {
    return data.status;
  }
  if (wasPreviouslyCompletedStatement(data)) return "completed";
  return null;
}

export function rejectionMessageForDocumentType(documentType: string): string {
  const noun = DOCUMENT_NOUN[documentType] ?? "document";
  return `This looks like a ${noun}, not an account statement. Upload a bank, credit card, loan or investment statement.`;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function transactionCount(parsed: Partial<ParsedStatementData>): number {
  return (
    (parsed.expenses?.transactions?.length ?? 0) +
    (parsed.income?.transactions?.length ?? 0)
  );
}

function hasPeriodStart(parsed: Partial<ParsedStatementData>): boolean {
  return typeof parsed.periodStart === "string" && parsed.periodStart.trim().length > 0;
}

function hasHoldings(parsed: Partial<ParsedStatementData>): boolean {
  return Array.isArray(parsed.holdings) && parsed.holdings.length > 0;
}

function hasParts(parsed: Partial<ParsedStatementData>): boolean {
  return Array.isArray(parsed.subAccounts) && parsed.subAccounts.length > 0;
}

function hasPayments(parsed: Partial<ParsedStatementData>): boolean {
  return isFiniteNumber(parsed.paymentsMade) && parsed.paymentsMade !== 0;
}

function hasPreviousOrNewBalance(parsed: Partial<ParsedStatementData>): boolean {
  return isFiniteNumber(parsed.previousBalance) || isFiniteNumber(parsed.newBalance);
}

function hasPrincipalBalance(parsed: Partial<ParsedStatementData>): boolean {
  return isFiniteNumber(parsed.debts) || isFiniteNumber(parsed.netWorth);
}

function hasRate(parsed: Partial<ParsedStatementData>): boolean {
  return isFiniteNumber(parsed.interestRate);
}

function hasDepositBalance(parsed: Partial<ParsedStatementData>): boolean {
  return (
    isFiniteNumber(parsed.netWorth) ||
    isFiniteNumber(parsed.assets) ||
    hasPreviousOrNewBalance(parsed)
  );
}

function accountTypeOf(parsed: Partial<ParsedStatementData>): string {
  return (parsed.accountType ?? "other").toLowerCase();
}

/**
 * Strong account-statement evidence. Beats a wrong documentType label
 * (e.g. a credit-card statement the model tagged as a bill).
 *
 * Amount due / minimum payment are never evidence.
 */
export function hasStrongAccountEvidence(
  parsed: Partial<ParsedStatementData> | null | undefined
): boolean {
  const p = parsed ?? {};
  const accountType = accountTypeOf(p);
  const hasTxns = transactionCount(p) > 0;

  if (CREDIT_TYPES.has(accountType) && (hasTxns || hasPreviousOrNewBalance(p))) {
    return true;
  }
  if (LOAN_TYPES.has(accountType) && hasPrincipalBalance(p) && (hasRate(p) || hasParts(p))) {
    return true;
  }
  if (accountType === "investment" && hasHoldings(p)) {
    return true;
  }
  if (DEPOSIT_TYPES.has(accountType) && hasDepositBalance(p) && hasTxns) {
    return true;
  }
  return false;
}

/**
 * Decide whether extracted data is an account statement we can keep.
 *
 * Amount due and minimum payment are ignored — they never cause a reject
 * and they are never enough on their own to accept a document.
 */
export function classifyUploadedDocument(
  parsed: Partial<ParsedStatementData> | null | undefined
): ClassifyUploadedDocumentResult {
  const p = parsed ?? {};
  const documentType = p.documentType;
  const accountType = accountTypeOf(p);
  const hasTxns = transactionCount(p) > 0;

  // Evidence beats the label: a mis-tagged statement with real account
  // structure is kept. Reject on the label only when that evidence is absent.
  if (hasStrongAccountEvidence(p)) {
    return { ok: true };
  }

  if (documentType && NON_STATEMENT_TYPES.has(documentType)) {
    return {
      ok: false,
      reason: documentType,
      message: rejectionMessageForDocumentType(documentType),
    };
  }

  if (documentType === "account_statement") {
    return { ok: true };
  }

  if (CREDIT_TYPES.has(accountType) && (hasTxns || hasPreviousOrNewBalance(p))) {
    return { ok: true };
  }
  if (LOAN_TYPES.has(accountType) && (hasPrincipalBalance(p) || hasRate(p) || hasParts(p))) {
    return { ok: true };
  }
  if (accountType === "investment" && hasHoldings(p)) {
    return { ok: true };
  }
  if (DEPOSIT_TYPES.has(accountType) && (hasDepositBalance(p) || hasTxns)) {
    return { ok: true };
  }

  const missingOrOtherDoc = !documentType || documentType === "other";
  const otherAccount = accountType === "other" || accountType === "";
  if (
    missingOrOtherDoc &&
    otherAccount &&
    !hasPeriodStart(p) &&
    !hasTxns &&
    !hasHoldings(p) &&
    !hasParts(p) &&
    !hasPayments(p)
  ) {
    const reason = documentType === "other" ? "other" : "unrecognized";
    return {
      ok: false,
      reason,
      message: rejectionMessageForDocumentType(reason),
    };
  }

  return { ok: true };
}

/** Map a CSV parse result into the shape classifyUploadedDocument expects. */
export function csvParseResultToClassifiable(
  csv: {
    rows: { date: string; description: string; amount: number; isExpense: boolean }[];
    dateRange: { from: string; to: string } | null;
    closingBalance: number | null;
    documentType?: UploadedDocumentType;
  },
  accountType?: string
): Partial<ParsedStatementData> {
  const expenseTxns = csv.rows
    .filter((r) => r.isExpense)
    .map((r) => ({
      merchant: r.description,
      amount: r.amount,
      date: r.date,
      category: "Other",
    }));
  const incomeTxns = csv.rows
    .filter((r) => !r.isExpense)
    .map((r) => ({
      source: r.description,
      amount: r.amount,
      date: r.date,
      category: "Other",
    }));
  const closing = csv.closingBalance;
  return {
    documentType: csv.documentType,
    accountType: (accountType as AccountType | undefined) ?? "other",
    periodStart: csv.dateRange?.from,
    periodEnd: csv.dateRange?.to,
    netWorth: closing ?? undefined,
    assets: closing ?? undefined,
    income: { total: 0, sources: [], transactions: incomeTxns },
    expenses: { total: 0, categories: [], transactions: expenseTxns },
  };
}
