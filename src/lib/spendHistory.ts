/**
 * Canonical per-month spending history pipeline.
 *
 * Both the consolidated API and the insights route must use this exact function
 * to compute monthly expense totals. Any other approach will produce different
 * numbers because carryForwardStatements / consolidateStatements use specific
 * deduplication and carry-forward logic that raw transaction fetches don't replicate.
 */

import type * as FirebaseFirestore from "firebase-admin/firestore";
import type { ParsedStatementData } from "./types";
import { consolidateStatements, getYearMonth } from "./consolidate";
import { buildAccountSlug } from "./accountSlug";
import { isBalanceMarker } from "./balanceMarkers";
import { CORE_EXCLUDE_RE } from "./spendingMetrics";

export interface MonthSpend {
  yearMonth: string;
  /** All expenses (balance-markers removed, transaction-date filtered). */
  expensesTotal: number;
  /**
   * Core expenses — same as expensesTotal but also strips transfers, debt
   * payments, and investment transfers. This is what the Spending page shows
   * as "Typical Month" when the "excl. transfers" toggle is ON.
   */
  coreExpensesTotal: number;
}

// ── helpers ──────────────────────────────────────────────────────────────────

export function docYearMonth(d: FirebaseFirestore.DocumentData): string {
  const parsed = d.parsedData as ParsedStatementData | undefined;
  let ym = parsed?.statementDate ? getYearMonth(parsed.statementDate) : "";
  if (!ym) {
    const raw = d.uploadedAt?.toDate?.() ?? d.uploadedAt;
    if (raw) {
      const t =
        typeof raw === "object" && "toISOString" in raw
          ? (raw as Date).toISOString()
          : String(raw);
      ym = t.slice(0, 7);
    }
  }
  return ym;
}

function accountSlug(parsed: ParsedStatementData): string {
  return buildAccountSlug(parsed.bankName, parsed.accountId);
}

/**
 * For a given target month, pick the single best statement per account:
 * - The statement whose yearMonth is closest to (and not after) targetMonth.
 * - PDF preferred over CSV for the same month.
 * - When carrying forward to a different month, transactions are stripped so
 *   older data doesn't pollute a month the account has no statement for.
 */
export function carryForwardStatements(
  allDocs: FirebaseFirestore.QueryDocumentSnapshot[],
  targetMonth: string
): ParsedStatementData[] {
  const latestPerAccount = new Map<
    string,
    { ym: string; parsed: ParsedStatementData; isCSV: boolean; uploadedAt: number }
  >();

  for (const doc of allDocs) {
    const d = doc.data();
    const ym = docYearMonth(d);
    if (!ym || ym > targetMonth) continue;

    const parsed     = d.parsedData as ParsedStatementData;
    const isCSV      = (d.source as string | undefined) === "csv";
    const uploadedAt = d.uploadedAt?.toDate?.()?.getTime() ?? 0;
    const slug       = accountSlug(parsed);
    const existing   = latestPerAccount.get(slug);

    if (!existing || ym > existing.ym) {
      latestPerAccount.set(slug, { ym, parsed, isCSV, uploadedAt });
    } else if (ym === existing.ym) {
      const existingWins = existing.isCSV === false && isCSV === true;
      if (existingWins) continue;
      const thisWins = existing.isCSV === true && isCSV === false;
      if (thisWins) { latestPerAccount.set(slug, { ym, parsed, isCSV, uploadedAt }); continue; }
      const thisUpload = d.uploadedAt?.toDate?.()?.getTime() ?? 0;
      if (thisUpload > existing.uploadedAt) {
        latestPerAccount.set(slug, { ym, parsed, isCSV, uploadedAt: thisUpload });
      }
    }
  }

  // Patch CSV entries: inherit netWorth from the most recent PDF if CSV has none.
  const latestPdfNetWorth = new Map<string, { ym: string; netWorth: number }>();
  for (const doc of allDocs) {
    const d = doc.data();
    if ((d.source as string | undefined) === "csv") continue;
    const ym = docYearMonth(d);
    if (!ym || ym > targetMonth) continue;
    const parsed = d.parsedData as ParsedStatementData;
    const slug   = accountSlug(parsed);
    const cur    = latestPdfNetWorth.get(slug);
    if (!cur || ym >= cur.ym) latestPdfNetWorth.set(slug, { ym, netWorth: parsed.netWorth ?? 0 });
  }

  return Array.from(latestPerAccount.values()).map(({ ym, parsed, isCSV }) => {
    const patchedParsed = isCSV
      ? { ...parsed, netWorth: parsed.netWorth ?? latestPdfNetWorth.get(accountSlug(parsed))?.netWorth ?? 0 }
      : parsed;

    // Carrying forward: strip transactions so older data doesn't appear in this month.
    if (ym !== targetMonth) {
      return {
        ...patchedParsed,
        income:        { total: 0, sources: [], transactions: [] },
        expenses:      { total: 0, categories: [], transactions: [] },
        subscriptions: [],
        savingsRate:   0,
      };
    }
    return patchedParsed;
  });
}

/**
 * Build the canonical per-month spending history for a user.
 *
 * Uses the same carryForwardStatements → consolidateStatements pipeline as the
 * consolidated API, so the numbers here exactly match what the Spending page shows.
 */
export async function buildMonthlySpendHistory(
  uid: string,
  db: FirebaseFirestore.Firestore
): Promise<MonthSpend[]> {
  const snapshot = await db
    .collection("statements")
    .where("userId", "==", uid)
    .get();

  const allCompleted = snapshot.docs.filter((doc) => {
    const d = doc.data();
    return d.status === "completed" && !!d.parsedData;
  });

  const yearMonths = new Set<string>();
  for (const doc of allCompleted) {
    const ym = docYearMonth(doc.data());
    if (ym) yearMonths.add(ym);
  }

  const history: MonthSpend[] = [];

  for (const ym of Array.from(yearMonths).sort()) {
    const forMonth = carryForwardStatements(allCompleted, ym);
    if (forMonth.length === 0) continue;

    const c = consolidateStatements(forMonth, ym);

    // Use transaction dates to assign each expense to the correct calendar month —
    // this prevents billing-period overlap from double-counting across months.
    const monthTxns = (c.expenses?.transactions ?? [])
      .filter((t) => (t.date ?? `${ym}-15`).slice(0, 7) === ym)
      .filter((t) => !isBalanceMarker(t.merchant));

    const expensesTotal = monthTxns.reduce((s, t) => s + t.amount, 0);
    const coreExpensesTotal = monthTxns
      .filter((t) => !CORE_EXCLUDE_RE.test((t.category ?? "").trim()))
      .reduce((s, t) => s + t.amount, 0);

    history.push({ yearMonth: ym, expensesTotal, coreExpensesTotal });
  }

  return history;
}
