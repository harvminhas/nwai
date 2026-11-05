/**
 * Shared CSV → statement import logic.
 *
 * Both the /api/user/csv-import route and any script/debug path must use these
 * functions so the gap filter, dedupe and per-month balances are computed once.
 */

import type * as FirebaseFirestore from "firebase-admin/firestore";
import type { ExpenseTransaction, IncomeTransaction, ParsedStatementData } from "./types";
import { getAccountSlug } from "./accountSlug";
import { txFingerprint } from "./txFingerprint";
import { getYearMonth } from "./consolidate";
import type { CsvParseResult, ParsedRow } from "./csvParser";

export interface CsvAccountMeta {
  slug: string;
  bankName: string;
  accountId: string;
  accountType: string;
  lastMonth: string;
}

/** Year-month for a statement doc: statementDate, falling back to uploadedAt. */
export function statementDocYearMonth(d: FirebaseFirestore.DocumentData): string {
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

/**
 * Canonical slug for a statement doc.
 *
 * parsedData.accountSlug wins: it is the slug computed at parse time from the
 * unmasked account id and is what every other consumer keys on. The document's
 * own accountSlug field is next (older uploads stored it there, sometimes under
 * a bank-prefixed alias), then a recomputation from the masked id.
 */
export function statementDocSlug(d: FirebaseFirestore.DocumentData): string {
  const parsed = d.parsedData as ParsedStatementData | undefined;
  if (parsed?.accountSlug) return parsed.accountSlug;
  const stored = d.accountSlug as string | null | undefined;
  if (stored) return stored;
  return parsed ? getAccountSlug(parsed) : "";
}

/**
 * How far each account is already covered, in terms of the last transaction
 * date present in a PDF statement. CSV imports are excluded on purpose: they
 * are gap fills, not authoritative coverage.
 */
export function buildCsvCoverage(docs: FirebaseFirestore.QueryDocumentSnapshot[]): {
  coverageBySlug: Map<string, string>;
  knownAccounts: CsvAccountMeta[];
} {
  const coverageBySlug = new Map<string, string>();
  const knownAccounts: CsvAccountMeta[] = [];
  const seen = new Set<string>();

  for (const doc of docs) {
    const d = doc.data();
    if ((d.source as string | undefined) === "csv") continue;
    const p = d.parsedData as ParsedStatementData | undefined;
    if (!p) continue;
    const slug = statementDocSlug(d);
    if (!slug) continue;
    const ym = statementDocYearMonth(d);
    if (!ym) continue;

    const dates = [
      ...(p.expenses?.transactions ?? []).map((t) => t.date),
      ...(p.income?.transactions ?? []).map((t) => t.date),
    ].filter(Boolean) as string[];
    dates.sort();
    const lastTxDate = dates[dates.length - 1] ?? `${ym}-28`;

    const existing = coverageBySlug.get(slug);
    if (!existing || lastTxDate > existing) coverageBySlug.set(slug, lastTxDate);

    if (!seen.has(slug)) {
      seen.add(slug);
      knownAccounts.push({
        slug,
        bankName: p.bankName ?? "Unknown",
        accountId: p.accountId ?? "",
        accountType: p.accountType ?? "checking",
        lastMonth: ym,
      });
    }
  }

  return { coverageBySlug, knownAccounts };
}

export interface CsvMonthDoc {
  /** Calendar month this document covers, "YYYY-MM". */
  ym: string;
  parsedData: ParsedStatementData;
  dateFrom: string;
  dateTo: string;
  expenseCount: number;
  incomeCount: number;
}

export interface CsvImportPlan {
  /** Only the months that actually get written (empty months are dropped). */
  months: CsvMonthDoc[];
  skippedByGapFilter: number;
  skippedByDuplicate: number;
  gapCutoff: string | null;
  /** Rows left after the gap filter, before fingerprint dedupe. */
  gapRowCount: number;
}

/** The 16th of "YYYY-MM" — the first day the closing-day rule credits to that month. */
function midMonthDate(ym: string): string {
  return `${ym}-16`;
}

/**
 * Statement date for a CSV month document. The date exists only so the rest of the
 * app's closing-day rule assigns the document to the right month: anything on or
 * before the 15th is credited to the previous month. Use the last transaction's
 * date when that lands in the right month, otherwise the 16th, which always does.
 */
export function csvStatementDate(ym: string, dates: string[]): string {
  const last = dates.length > 0 ? dates.slice().sort()[dates.length - 1] : null;
  if (last && Number(last.slice(8, 10)) > 15 && last.slice(0, 7) === ym) return last;
  return midMonthDate(ym);
}

/**
 * Balance at the end of a calendar month, taken from the CSV's own running
 * balance column: the balance on the last row of that month. Rows arrive in
 * file order, so a latest-date row wins and, within one date, the later row
 * wins (two transactions on the same day leave the second one's balance).
 */
export function monthEndBalance(rows: ParsedRow[]): number | null {
  let best: ParsedRow | null = null;
  for (const r of rows) {
    if (typeof r.balance !== "number" || !Number.isFinite(r.balance)) continue;
    if (!best || r.date >= best.date) best = r;
  }
  return best ? (best.balance as number) : null;
}

/**
 * Work out exactly which statements a CSV import should create: rows after the
 * account's PDF coverage, deduped by fingerprint, grouped by calendar month,
 * each month carrying its own month-end balance when the CSV provides one.
 */
export function planCsvImport(args: {
  parsed: CsvParseResult;
  account: CsvAccountMeta;
  docs: FirebaseFirestore.QueryDocumentSnapshot[];
}): CsvImportPlan {
  const { parsed, account, docs } = args;

  const { coverageBySlug } = buildCsvCoverage(docs);
  const gapCutoff = coverageBySlug.get(account.slug) ?? null;
  const gapRows = gapCutoff ? parsed.rows.filter((r) => r.date > gapCutoff) : parsed.rows.slice();

  // Fingerprints of everything already stored for this account, so a re-run
  // (or an overlapping PDF) never doubles up.
  const accountId = account.accountId || account.slug;
  const existing = new Set<string>();
  for (const doc of docs) {
    const d = doc.data();
    const p = d.parsedData as ParsedStatementData | undefined;
    if (!p) continue;
    if (statementDocSlug(d) !== account.slug) continue;
    for (const t of p.expenses?.transactions ?? []) {
      if (t.date) existing.add(txFingerprint(accountId, t.date, t.amount, t.merchant ?? ""));
    }
    for (const t of p.income?.transactions ?? []) {
      if (t.date) existing.add(txFingerprint(accountId, t.date, t.amount, t.source ?? ""));
    }
  }

  const byMonth = new Map<string, ParsedRow[]>();
  for (const row of gapRows) {
    const ym = row.date.slice(0, 7);
    const bucket = byMonth.get(ym);
    if (bucket) bucket.push(row);
    else byMonth.set(ym, [row]);
  }

  const isDebtAccount = ["credit", "loan", "mortgage"].includes(account.accountType.toLowerCase());

  const months: CsvMonthDoc[] = [];
  let skippedByDuplicate = 0;
  let gapRowCount = 0;

  for (const [ym, rows] of Array.from(byMonth.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
    const expenseTxns: ExpenseTransaction[] = [];
    const incomeTxns: IncomeTransaction[] = [];
    let paymentsMade = 0;

    for (const r of rows) {
      const fp = txFingerprint(accountId, r.date, r.amount, r.description);
      if (existing.has(fp)) { skippedByDuplicate++; continue; }
      existing.add(fp);
      gapRowCount++;
      if (r.isExpense) {
        expenseTxns.push({ merchant: r.description, amount: r.amount, date: r.date, category: r.category ?? "Other" });
      } else if (isDebtAccount) {
        paymentsMade += r.amount;
      } else {
        incomeTxns.push({ source: r.description, amount: r.amount, date: r.date, category: "Other" });
      }
    }

    if (expenseTxns.length === 0 && incomeTxns.length === 0 && paymentsMade === 0) continue;

    // The balance on the last row of this month is this month's closing balance.
    // Older months therefore get their own real balance instead of borrowing the
    // previous PDF month's number.
    const closing = monthEndBalance(rows);
    const netWorth = closing != null
      ? (isDebtAccount ? -Math.abs(closing) : closing)
      : undefined;

    const expTotal = expenseTxns.reduce((s, t) => s + t.amount, 0);
    const incTotal = incomeTxns.reduce((s, t) => s + t.amount, 0);
    const dates = rows.map((r) => r.date).sort();

    const parsedData: ParsedStatementData = {
      ...(netWorth != null ? { netWorth } : {}),
      ...(paymentsMade > 0 ? { paymentsMade } : {}),
      // Date it so the closing-day rule lands it on the month it actually covers.
      // That rule files anything on or before the 15th into the previous month, so
      // dating a month document on the 1st credited its data to last month and left
      // the month itself still reported as missing.
      statementDate: csvStatementDate(ym, dates),
      bankName: account.bankName,
      accountId,
      accountType: account.accountType as ParsedStatementData["accountType"],
      accountSlug: account.slug,
      income: {
        total: incTotal,
        sources: incTotal > 0 ? [{ description: "Income", amount: incTotal }] : [],
        transactions: incomeTxns,
      },
      expenses: {
        total: expTotal,
        categories: expTotal > 0
          ? Object.entries(
              expenseTxns.reduce<Record<string, number>>((acc, t) => {
                acc[t.category ?? "Other"] = (acc[t.category ?? "Other"] ?? 0) + t.amount;
                return acc;
              }, {}),
            ).map(([name, amount]) => ({
              name,
              amount,
              percentage: Math.round((amount / expTotal) * 100),
            }))
          : [],
        transactions: expenseTxns,
      },
      subscriptions: [],
      savingsRate: 0,
      insights: [],
    };

    months.push({
      ym,
      parsedData,
      dateFrom: dates[0],
      dateTo: dates[dates.length - 1],
      expenseCount: expenseTxns.length,
      incomeCount: incomeTxns.length,
    });
  }

  return {
    months,
    skippedByGapFilter: parsed.rows.length - gapRows.length,
    skippedByDuplicate,
    gapCutoff,
    gapRowCount,
  };
}

/** Write a plan's month documents. Returns the created document ids. */
export async function writeCsvStatementDocs(args: {
  db: FirebaseFirestore.Firestore;
  uid: string;
  fileName: string;
  plan: CsvImportPlan;
}): Promise<string[]> {
  const { db, uid, fileName, plan } = args;
  const ids: string[] = [];
  for (const m of plan.months) {
    const ref = db.collection("statements").doc();
    await ref.set({
      userId: uid,
      accountSlug: m.parsedData.accountSlug ?? null,
      yearMonth: m.ym,
      source: "csv",
      fileName,
      fileUrl: "",
      status: "completed",
      uploadedAt: new Date(),
      csvDateRange: { from: m.dateFrom, to: m.dateTo },
      parsedData: m.parsedData,
    });
    ids.push(ref.id);
  }
  return ids;
}
