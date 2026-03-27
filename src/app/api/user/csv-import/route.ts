/**
 * POST /api/user/csv-import
 *
 * Two actions:
 *   action=preview  — parse CSV + apply gap filter, return preview without saving
 *   action=import   — parse CSV + apply gap filter + save, return result
 *
 * FormData fields:
 *   file          — the CSV file
 *   action        — "preview" | "import"
 *   accountSlug   — (optional) which account this CSV belongs to
 *                   Required for import; optional for preview (returned as candidates)
 */

import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { parseCSV } from "@/lib/csvParser";
import { txFingerprint } from "@/lib/txFingerprint";
import { buildAccountSlug } from "@/lib/accountSlug";
import { getYearMonth } from "@/lib/consolidate";
import type { ParsedStatementData, ExpenseTransaction, IncomeTransaction } from "@/lib/types";

async function getUid(request: NextRequest): Promise<string | null> {
  const token = request.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) return null;
  try {
    const { auth } = getFirebaseAdmin();
    const { uid } = await auth.verifyIdToken(token);
    return uid;
  } catch { return null; }
}

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

export async function POST(request: NextRequest) {
  const uid = await getUid(request);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const formData = await request.formData().catch(() => null);
  if (!formData) return NextResponse.json({ error: "Invalid form data" }, { status: 400 });

  const file   = formData.get("file") as File | null;
  const action = (formData.get("action") as string | null) ?? "preview";
  const accountSlug = (formData.get("accountSlug") as string | null) ?? null;

  if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 });

  const csvText = await file.text();

  const { db } = getFirebaseAdmin();

  // ── Load existing statements for this user ──────────────────────────────
  // Do this BEFORE parsing so we know the account type and can pass it to the AI parser.
  const stmtSnap = await db
    .collection("statements")
    .where("userId", "==", uid)
    .where("status", "==", "completed")
    .get();

  // Build map: accountSlug → latest statement end-date (last transaction date or statementDate)
  const coverageBySlug = new Map<string, string>(); // slug → "YYYY-MM-DD" (last covered date)
  const knownAccounts: { slug: string; bankName: string; accountId: string; accountType: string; lastMonth: string }[] = [];
  const seenSlugs = new Set<string>();

  for (const doc of stmtSnap.docs) {
    const d = doc.data();
    if ((d.source as string | undefined) === "csv") continue; // only PDF statements define coverage
    const p = d.parsedData as ParsedStatementData | undefined;
    if (!p) continue;
    const slug = buildAccountSlug(p.bankName, p.accountId);
    const ym   = docYearMonth(d);
    if (!ym) continue;

    // Last covered date = last transaction date in the statement, or last day of the statement month
    const txDates = (p.expenses?.transactions ?? []).map((t) => t.date).filter(Boolean) as string[];
    const incomeDates = (p.income?.transactions ?? []).map((t) => t.date).filter(Boolean) as string[];
    const allDates = [...txDates, ...incomeDates].sort();
    const lastTxDate = allDates[allDates.length - 1] ?? `${ym}-28`;

    const existing = coverageBySlug.get(slug);
    if (!existing || lastTxDate > existing) {
      coverageBySlug.set(slug, lastTxDate);
    }

    if (!seenSlugs.has(slug)) {
      seenSlugs.add(slug);
      knownAccounts.push({
        slug, bankName: p.bankName ?? "Unknown", accountId: p.accountId ?? "",
        accountType: p.accountType ?? "checking", lastMonth: ym,
      });
    }
  }

  // Resolve account type before calling the AI parser so it can apply the correct
  // sign convention (credit card charges are positive = expense, not positive = income).
  const preselectedAccount = accountSlug ? knownAccounts.find((a) => a.slug === accountSlug) : null;
  const preselectedAccountType = preselectedAccount?.accountType ?? undefined;

  const parsed = await parseCSV(csvText, preselectedAccountType);

  if (parsed.rows.length === 0) {
    return NextResponse.json({
      error: parsed.errors[0] ?? "No transactions found in CSV",
      parseErrors: parsed.errors,
    }, { status: 422 });
  }

  // ── Apply gap filter ────────────────────────────────────────────────────
  const selectedCoverage = accountSlug ? (coverageBySlug.get(accountSlug) ?? null) : null;
  const gapCutoff = selectedCoverage; // only import rows AFTER this date

  const gapRows  = gapCutoff
    ? parsed.rows.filter((r) => r.date > gapCutoff)
    : parsed.rows;
  const skipped  = parsed.rows.length - gapRows.length;

  // ── Build fingerprints of existing transactions to catch any remaining overlap ──
  const existingFingerprints = new Set<string>();
  if (accountSlug) {
    const selectedAccount = knownAccounts.find((a) => a.slug === accountSlug);
    const accountId = selectedAccount?.accountId ?? accountSlug;
    for (const doc of stmtSnap.docs) {
      const d = doc.data();
      const p = d.parsedData as ParsedStatementData | undefined;
      if (!p || buildAccountSlug(p.bankName, p.accountId) !== accountSlug) continue;
      for (const txn of p.expenses?.transactions ?? []) {
        if (!txn.date) continue;
        existingFingerprints.add(txFingerprint(accountId, txn.date, txn.amount, txn.merchant ?? ""));
      }
      for (const txn of p.income?.transactions ?? []) {
        if (!txn.date) continue;
        existingFingerprints.add(txFingerprint(accountId, txn.date, txn.amount, txn.description ?? ""));
      }
    }
  }

  // Classify rows into expenses and income
  const expenseRows  = gapRows.filter((r) => r.isExpense);
  const incomeRows   = gapRows.filter((r) => !r.isExpense);

  // Group by calendar month for multi-month CSVs
  const monthGroups = new Map<string, typeof gapRows>();
  for (const row of gapRows) {
    const ym = row.date.slice(0, 7);
    if (!monthGroups.has(ym)) monthGroups.set(ym, []);
    monthGroups.get(ym)!.push(row);
  }

  const preview = {
    totalRows: parsed.rows.length,
    gapFilteredRows: gapRows.length,
    skippedByGapFilter: skipped,
    expenseCount: expenseRows.length,
    incomeCount: incomeRows.length,
    dateRange: parsed.dateRange,
    gapDateRange: gapRows.length > 0
      ? { from: gapRows.map((r) => r.date).sort()[0], to: gapRows.map((r) => r.date).sort().reverse()[0] }
      : null,
    monthsAffected: Array.from(monthGroups.keys()).sort(),
    gapCutoff,
    knownAccounts,
    detectedFormat: parsed.detectedFormat,
    parseErrors: parsed.errors,
    sampleTransactions: gapRows.slice(0, 8).map((r) => ({
      date: r.date, description: r.description, amount: r.amount, isExpense: r.isExpense,
    })),
  };

  if (action === "preview") {
    return NextResponse.json({ preview });
  }

  // ── Import: create one Firestore document per calendar month ────────────
  if (!accountSlug) {
    return NextResponse.json({ error: "accountSlug is required for import" }, { status: 400 });
  }
  const selectedAccount = knownAccounts.find((a) => a.slug === accountSlug);
  const bankName    = selectedAccount?.bankName    ?? "Unknown Bank";
  const accountId   = selectedAccount?.accountId   ?? "";
  const accountType = selectedAccount?.accountType ?? "checking";

  const createdIds: string[] = [];
  let totalAdded = 0;
  let totalDuplicates = 0;

  // Debt accounts (credit cards, loans, mortgages) store netWorth as a negative value
  // so consolidate.ts correctly counts them as debts rather than assets.
  const isDebtAccount = ["credit", "loan", "mortgage"].includes(accountType.toLowerCase());

  // The CSV closing balance (last running-balance value) applies to the most recent month only
  const sortedMonthEntries = Array.from(monthGroups.entries()).sort();
  const lastYm = sortedMonthEntries[sortedMonthEntries.length - 1]?.[0];

  for (const [ym, rows] of sortedMonthEntries) {
    const expRows = rows.filter((r) => r.isExpense);
    const incRows = rows.filter((r) => !r.isExpense);

    // Final fingerprint dedup against existing transactions
    const expTxns: ExpenseTransaction[] = [];
    for (const r of expRows) {
      const fp = txFingerprint(accountId, r.date, r.amount, r.description);
      if (existingFingerprints.has(fp)) { totalDuplicates++; continue; }
      expTxns.push({ merchant: r.description, amount: r.amount, date: r.date, category: r.category ?? "Other" });
    }

    // For asset accounts (checking / savings): incoming transactions are regular income.
    // For debt accounts (CC / loan / mortgage): incoming transactions are payments towards
    // the debt — stored in paymentsMade, NOT as income.
    const incTxns: IncomeTransaction[] = [];
    let paymentsMade = 0;
    for (const r of incRows) {
      const fp = txFingerprint(accountId, r.date, r.amount, r.description);
      if (existingFingerprints.has(fp)) { totalDuplicates++; continue; }
      if (isDebtAccount) {
        paymentsMade += r.amount;
      } else {
        incTxns.push({ description: r.description, amount: r.amount, date: r.date, source: "Income" });
      }
    }

    totalAdded += expTxns.length + incTxns.length + (paymentsMade > 0 ? 1 : 0);

    if (expTxns.length === 0 && incTxns.length === 0 && paymentsMade === 0) continue;

    const expTotal = expTxns.reduce((s, t) => s + t.amount, 0);
    const incTotal = incTxns.reduce((s, t) => s + t.amount, 0);

    // Use the CSV's closing balance as netWorth for the most recent month.
    // For earlier months in a multi-month CSV, leave netWorth undefined so
    // the consolidated route carries forward the PDF statement balance instead.
    // Debt accounts (credit/loan/mortgage) must store netWorth as a negative value
    // so consolidate.ts counts them as debts, not assets.
    const csvNetWorth = (ym === lastYm && parsed.closingBalance != null)
      ? (isDebtAccount ? -Math.abs(parsed.closingBalance) : parsed.closingBalance)
      : undefined;

    const parsedData: ParsedStatementData = {
      ...(csvNetWorth != null ? { netWorth: csvNetWorth } : {}),
      ...(paymentsMade > 0 ? { paymentsMade } : {}),
      statementDate: `${ym}-01`,
      bankName,
      accountId,
      accountType: accountType as ParsedStatementData["accountType"],
      income: {
        total: incTotal,
        sources: incTotal > 0 ? [{ description: "Income", amount: incTotal }] : [],
        transactions: incTxns,
      },
      expenses: {
        total: expTotal,
        categories: expTotal > 0
          ? Object.entries(
              expTxns.reduce<Record<string, number>>((acc, t) => {
                acc[t.category ?? "Other"] = (acc[t.category ?? "Other"] ?? 0) + t.amount;
                return acc;
              }, {})
            ).map(([name, amount]) => ({
              name,
              amount,
              percentage: Math.round((amount / expTotal) * 100),
            }))
          : [],
        transactions: expTxns,
      },
      subscriptions: [],
      savingsRate: 0,
      insights: [],
    };

    const docRef = await db.collection("statements").add({
      userId: uid,
      source: "csv",
      fileName: file.name,
      fileUrl: "",
      status: "completed",
      uploadedAt: new Date(),
      csvDateRange: {
        from: rows.map((r) => r.date).sort()[0],
        to:   rows.map((r) => r.date).sort().reverse()[0],
      },
      parsedData,
    });
    createdIds.push(docRef.id);
  }

  return NextResponse.json({
    ok: true,
    imported: totalAdded,
    skippedByGapFilter: skipped,
    skippedByDuplicate: totalDuplicates,
    totalSkipped: skipped + totalDuplicates,
    statementIds: createdIds,
    monthsCreated: createdIds.length,
  });
}
