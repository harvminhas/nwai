/**
 * Transaction-date-based financial data extraction.
 *
 * Statements are only ingestion vehicles. Once parsed, all analysis is
 * based on the actual transaction dates inside each statement — not on the
 * statement period or upload date.
 *
 * This module is shared between the AI agent pipeline and the chat financial
 * brief so both work from the same source of truth.
 */

import type * as Firestore from "firebase-admin/firestore";
import type { ParsedStatementData } from "./types";
import { buildAccountSlug } from "./accountSlug";
import { inferCurrencyFromBankName } from "./currencyUtils";
import { getYearMonth } from "./consolidate";
import { txFingerprint } from "./txFingerprint";
import { isBalanceMarker } from "./balanceMarkers";

// ── types ─────────────────────────────────────────────────────────────────────

export interface ExpenseTxnRecord {
  date: string;       // YYYY-MM-DD (actual transaction date)
  txMonth: string;    // YYYY-MM derived from date
  amount: number;
  merchant: string;
  debtType?: string;  // sub-type for Debt Payments transactions (AI-detected)
  category: string;
  accountSlug: string;
  accountLabel: string; // e.g. "TD ••••7780" — for display in transaction lists
  /** ISO 4217 currency of the source account (e.g. "CAD", "USD"). */
  currency?: string;
  recurring?: string;
}

export interface IncomeTxnRecord {
  date: string;       // YYYY-MM-DD
  txMonth: string;    // YYYY-MM
  amount: number;
  source: string;
  description: string;
  accountSlug: string;
  /** ISO 4217 currency of the source account (e.g. "CAD", "USD"). */
  currency?: string;
}

export interface AccountSnapshot {
  slug: string;
  bankName: string;
  accountId: string;
  /** Human-readable account name from the statement (e.g. "TD TFSA", "RBC RRSP") */
  accountName?: string;
  accountType: string;
  /** = parsedData.netWorth — the signed balance (negative for liabilities) */
  balance: number;
  /**
   * Explicit asset portion as set by the AI parser (parsedData.assets).
   * Undefined when the AI didn't set it — fall back to max(0, balance).
   * Mirrors the `consolidateStatements` logic used by the Overview page.
   */
  parsedAssets?: number;
  /**
   * Explicit debt/liability portion as set by the AI parser (parsedData.debts).
   * Undefined when the AI didn't set it — fall back to max(0, -balance).
   */
  parsedDebts?: number;
  statementMonth: string; // YYYY-MM of the statement this balance came from
  interestRate: number | null;
  /**
   * ISO 4217 currency code from the statement (e.g. "CAD", "USD").
   * Defaults to "CAD" when not stated by the parser.
   */
  currency?: string;
}

export interface ExtractedFinancialData {
  /** All deduped expense transactions, sorted newest-first */
  expenseTxns: ExpenseTxnRecord[];
  /** All deduped income transactions, sorted newest-first */
  incomeTxns: IncomeTxnRecord[];
  /** Latest balance snapshot per account (carry-forward for balances only) */
  accountSnapshots: AccountSnapshot[];
  /** Subscriptions from current-month statements */
  subscriptions: { name: string; amount: number; frequency: string }[];
  /** Latest month that has at least one real expense or income transaction */
  latestTxMonth: string | null;
  /** All distinct transaction months, sorted ascending */
  allTxMonths: string[];
}

// ── helpers ───────────────────────────────────────────────────────────────────

function docYearMonth(d: FirebaseFirestore.DocumentData): string {
  const parsed = d.parsedData as ParsedStatementData | undefined;
  let ym = parsed?.statementDate ? getYearMonth(parsed.statementDate) : "";
  if (!ym) {
    const raw = d.uploadedAt?.toDate?.() ?? d.uploadedAt;
    if (raw) {
      const t = typeof raw === "object" && "toISOString" in raw
        ? (raw as Date).toISOString() : String(raw);
      ym = t.slice(0, 7);
    }
  }
  return ym;
}

// ── main extraction ───────────────────────────────────────────────────────────

export async function extractAllTransactions(
  uid: string,
  db: Firestore.Firestore
): Promise<ExtractedFinancialData> {
  const stmtSnap = await db
    .collection("statements")
    .where("userId", "==", uid)
    .where("status", "==", "completed")
    .orderBy("uploadedAt", "desc")
    .get();

  if (stmtSnap.empty) {
    return {
      expenseTxns: [], incomeTxns: [], accountSnapshots: [],
      subscriptions: [], latestTxMonth: null, allTxMonths: [],
    };
  }

  const allDocs = stmtSnap.docs;

  // ── 1. Deduplicate: best doc per account-slug × statement-month ──────────────
  // If the same statement was re-uploaded, keep only the most recent parse.
  const bestDocPerSlugYm = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>();
  for (const doc of allDocs) {
    const d = doc.data();
    const stmtYm = docYearMonth(d);
    if (!stmtYm) continue;
    const parsed = d.parsedData as ParsedStatementData;
    const slug = buildAccountSlug(parsed.bankName, parsed.accountId);
    const key = `${slug}|${stmtYm}`;
    const existing = bestDocPerSlugYm.get(key);
    if (!existing) {
      bestDocPerSlugYm.set(key, doc);
    } else {
      const existingTs = existing.data().uploadedAt?.toDate?.()?.getTime() ?? 0;
      const thisTs     = d.uploadedAt?.toDate?.()?.getTime() ?? 0;
      if (thisTs > existingTs) bestDocPerSlugYm.set(key, doc);
    }
  }

  // ── 2. Extract expense transactions using actual transaction dates ─────────
  // Two-pass: statements first (preferred source), then CSV.
  // Fingerprint dedup catches cross-source overlap (CSV vs stmt) AND cross-statement
  // overlap (two PDF statements whose billing periods overlap a shared transaction date).
  const expenseTxns: ExpenseTxnRecord[] = [];
  const expFingerprintsFromStmt = new Set<string>();

  for (const pass of ["stmt", "csv"] as const) {
    for (const doc of bestDocPerSlugYm.values()) {
      const d = doc.data();
      const isCSV = (d.source as string | undefined) === "csv";
      if (pass === "stmt" && isCSV) continue;
      if (pass === "csv" && !isCSV) continue;

      const stmtYm = docYearMonth(d);
      const parsed = d.parsedData as ParsedStatementData;
      const slug = buildAccountSlug(parsed.bankName, parsed.accountId);
      const bank  = (parsed.bankName ?? "").trim();
      const label = parsed.accountName
        ?? (slug === "unknown" ? bank || "Unknown Account" : [bank, `••••${slug}`].filter(Boolean).join(" "));

      // Investment accounts hold portfolio activity (stock buys/sells/dividends),
      // not personal expenses. Skip their expense transactions entirely — the account
      // still appears in accountSnapshots for balance tracking.
      const isInvestmentAccount = (parsed.accountType ?? "").toLowerCase() === "investment";
      if (!isInvestmentAccount) {
        for (const txn of parsed.expenses?.transactions ?? []) {
        const date = txn.date ?? `${stmtYm}-15`;
        const txMonth = date.slice(0, 7);
        const fp = txFingerprint(parsed.accountId ?? slug, date, txn.amount, txn.merchant ?? "");
        // Skip if this fingerprint was already added (handles both stmt-stmt overlap
        // and the stmt-before-CSV cross-source dedup in a single check)
        if (expFingerprintsFromStmt.has(fp)) continue;
        expFingerprintsFromStmt.add(fp);
        if (isBalanceMarker(txn.merchant ?? "")) continue; // skip AI-leaked balance rows
        if ((txn.amount ?? 0) <= 0) continue; // expense amounts must be positive (money out)
          expenseTxns.push({
            date,
            txMonth,
            amount: txn.amount,
            merchant: txn.merchant ?? "Unknown",
            category: txn.category ?? "Other",
            accountSlug: slug,
            accountLabel: label,
            currency: inferCurrencyFromBankName(parsed.bankName, parsed.currency),
            recurring: txn.recurring,
            ...(txn.debtType ? { debtType: txn.debtType } : {}),
          });
        }
      } // end !isInvestmentAccount
    }   // end for (const doc ...)
  }     // end for (const pass ...)
  expenseTxns.sort((a, b) => b.date.localeCompare(a.date));

  // ── 3. Extract income transactions using actual transaction dates ──────────
  const incomeTxns: IncomeTxnRecord[] = [];
  const incFingerprintsFromStmt = new Set<string>();

  for (const pass of ["stmt", "csv"] as const) {
    for (const doc of bestDocPerSlugYm.values()) {
      const d = doc.data();
      const isCSV = (d.source as string | undefined) === "csv";
      if (pass === "stmt" && isCSV) continue;
      if (pass === "csv" && !isCSV) continue;

      const stmtYm = docYearMonth(d);
      const parsed = d.parsedData as ParsedStatementData;
      const slug = buildAccountSlug(parsed.bankName, parsed.accountId);
      for (const txn of parsed.income?.transactions ?? []) {
        const date = txn.date ?? `${stmtYm}-01`;
        const txMonth = date.slice(0, 7);
        const fp = txFingerprint(parsed.accountId ?? slug, date, txn.amount, txn.source ?? txn.category ?? "");
        if (incFingerprintsFromStmt.has(fp)) continue;
        incFingerprintsFromStmt.add(fp);
        incomeTxns.push({
          date,
          txMonth,
          amount: txn.amount,
          source: txn.source ?? "Income",
          description: txn.source ?? txn.category ?? "Income",
          accountSlug: slug,
          currency: inferCurrencyFromBankName(parsed.bankName, parsed.currency),
        });
      }
    }
  }
  incomeTxns.sort((a, b) => b.date.localeCompare(a.date));

  // ── 4. Latest balance snapshot per account (carry-forward) ───────────────
  // For net worth / account balances only — NOT used for spending amounts.
  const latestStmtPerSlug = new Map<string, { parsed: ParsedStatementData; stmtYm: string }>();
  for (const doc of allDocs) {
    const d = doc.data();
    const stmtYm = docYearMonth(d);
    if (!stmtYm) continue;
    const parsed = d.parsedData as ParsedStatementData;
    const slug = buildAccountSlug(parsed.bankName, parsed.accountId);
    const existing = latestStmtPerSlug.get(slug);
    if (!existing || stmtYm > existing.stmtYm) {
      latestStmtPerSlug.set(slug, { parsed, stmtYm });
    }
  }
  const accountSnapshots: AccountSnapshot[] = Array.from(latestStmtPerSlug.entries()).map(
    ([slug, { parsed, stmtYm }]) => ({
      slug,
      bankName: parsed.bankName ?? "Bank",
      accountId: parsed.accountId ?? "",
      accountName: parsed.accountName ?? undefined,
      accountType: parsed.accountType ?? "other",
      balance: parsed.netWorth ?? 0,
      parsedAssets: parsed.assets,
      parsedDebts:  parsed.debts,
      statementMonth: stmtYm,
      interestRate: typeof parsed.interestRate === "number" ? parsed.interestRate : null,
      currency: inferCurrencyFromBankName(parsed.bankName, parsed.currency),
    })
  );

  // ── 5. Subscriptions from the latest statement per account ────────────────
  const subMap = new Map<string, { name: string; amount: number; frequency: string }>();
  for (const { parsed } of latestStmtPerSlug.values()) {
    for (const sub of parsed.subscriptions ?? []) {
      if (!subMap.has(sub.name)) subMap.set(sub.name, sub);
    }
  }
  const subscriptions = Array.from(subMap.values());

  // ── 6. Determine latest transaction month and all months ──────────────────
  const txMonthSet = new Set<string>();
  for (const t of expenseTxns) txMonthSet.add(t.txMonth);
  for (const t of incomeTxns)  txMonthSet.add(t.txMonth);
  const allTxMonths = Array.from(txMonthSet).sort();
  const latestTxMonth = allTxMonths.length > 0 ? allTxMonths[allTxMonths.length - 1] : null;

  return { expenseTxns, incomeTxns, accountSnapshots, subscriptions, latestTxMonth, allTxMonths };
}

// ── derived aggregations ──────────────────────────────────────────────────────

/** Sum expense amounts for a given month by category. */
export function categoryTotalsForMonth(
  expenseTxns: ExpenseTxnRecord[],
  month: string
): { name: string; amount: number }[] {
  const map = new Map<string, number>();
  for (const t of expenseTxns) {
    if (t.txMonth !== month) continue;
    map.set(t.category, (map.get(t.category) ?? 0) + t.amount);
  }
  return Array.from(map.entries())
    .map(([name, amount]) => ({ name, amount }))
    .sort((a, b) => b.amount - a.amount);
}

/** Sum income amounts for a given month. */
export function incomeTotalForMonth(incomeTxns: IncomeTxnRecord[], month: string): number {
  return incomeTxns.filter(t => t.txMonth === month).reduce((s, t) => s + t.amount, 0);
}

/** Sum expense amounts for a given month. */
export function expenseTotalForMonth(expenseTxns: ExpenseTxnRecord[], month: string): number {
  return expenseTxns.filter(t => t.txMonth === month).reduce((s, t) => s + t.amount, 0);
}

/** Build monthly trend (newest first). */
export function buildMonthlyTrend(
  expenseTxns: ExpenseTxnRecord[],
  incomeTxns: IncomeTxnRecord[],
  months: string[]
): { yearMonth: string; income: number; expenses: number }[] {
  return [...months].reverse().map((ym) => ({
    yearMonth: ym,
    income:   incomeTotalForMonth(incomeTxns, ym),
    expenses: expenseTotalForMonth(expenseTxns, ym),
  }));
}
