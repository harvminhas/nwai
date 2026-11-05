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
import { buildCsvCoverage, planCsvImport, writeCsvStatementDocs } from "@/lib/csvStatementImport";
import { runCsvQualityCheck } from "@/lib/csvQa";
import { invalidateFinancialProfileCache } from "@/lib/financialProfile";
import { fireInsightEvent } from "@/lib/insights/index";
import { FEATURE_FLAGS } from "@/lib/featureFlags";

async function getUid(request: NextRequest): Promise<string | null> {
  const token = request.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) return null;
  try {
    const { auth } = getFirebaseAdmin();
    const { uid } = await auth.verifyIdToken(token);
    return uid;
  } catch { return null; }
}

export async function POST(request: NextRequest) {
  if (!FEATURE_FLAGS.CSV_IMPORT_ENABLED) {
    return NextResponse.json(
      { error: "CSV import is temporarily disabled. Please upload PDF statements instead." },
      { status: 503 }
    );
  }

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

  // Coverage per account comes from PDF statements only (CSV imports are gap
  // fills, not authoritative coverage) — see buildCsvCoverage.
  const { coverageBySlug, knownAccounts } = buildCsvCoverage(stmtSnap.docs);

  // Resolve account type before calling the AI parser so it can apply the correct
  // sign convention (credit card charges are positive = expense, not positive = income).
  const preselectedAccount = accountSlug ? knownAccounts.find((a) => a.slug === accountSlug) : null;
  const preselectedAccountType = preselectedAccount?.accountType ?? undefined;

  const parsed = await parseCSV(csvText, preselectedAccountType);

  // ── Quality check, before anything is written ───────────────────────────
  // Block only on things that make the import meaningless (unreadable columns,
  // no transactions, an implausible file); warn on anything suspicious but
  // still importable.
  const qa = runCsvQualityCheck({ csvText, parsed });

  if (parsed.rows.length === 0) {
    return NextResponse.json({
      error: parsed.errors[0] ?? "No transactions found in CSV",
      parseErrors: parsed.errors,
      qa,
    }, { status: 422 });
  }
  if (qa.status === "block") {
    return NextResponse.json({
      error: qa.checks.find((c) => c.status === "block")?.detail
        ?? "This file didn't pass the import check.",
      qa,
    }, { status: 422 });
  }

  // ── Apply gap filter + dedupe + month grouping ───────────────────────────
  const gapCutoff = accountSlug ? (coverageBySlug.get(accountSlug) ?? null) : null;
  const gapRows = gapCutoff ? parsed.rows.filter((r) => r.date > gapCutoff) : parsed.rows;
  const skipped = parsed.rows.length - gapRows.length;
  const expenseRows = gapRows.filter((r) => r.isExpense);
  const incomeRows  = gapRows.filter((r) => !r.isExpense);
  const monthsAffected = Array.from(new Set(gapRows.map((r) => r.date.slice(0, 7)))).sort();

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
    monthsAffected,
    gapCutoff,
    knownAccounts,
    detectedFormat: parsed.detectedFormat,
    parseErrors: parsed.errors,
    qa,
    sampleTransactions: gapRows.slice(0, 8).map((r) => ({
      date: r.date, description: r.description, amount: r.amount, isExpense: r.isExpense,
    })),
  };

  if (action === "preview") {
    return NextResponse.json({ preview });
  }

  // ── Import: one statement document per calendar month ───────────────────
  if (!accountSlug) {
    return NextResponse.json({ error: "accountSlug is required for import" }, { status: 400 });
  }
  const selectedAccount = knownAccounts.find((a) => a.slug === accountSlug);
  if (!selectedAccount) {
    return NextResponse.json({ error: "Unknown account for this import" }, { status: 400 });
  }

  const plan = planCsvImport({ parsed, account: selectedAccount, docs: stmtSnap.docs });
  const createdIds = await writeCsvStatementDocs({ db, uid, fileName: file.name, plan });
  const totalAdded = plan.months.reduce((s, m) => s + m.expenseCount + m.incomeCount, 0);

  // Log every import so a silent "nothing was written" is traceable later.
  console.log("[csv-import]", JSON.stringify({
    uid, accountSlug, file: file.name,
    parsedRows: parsed.rows.length, cutoff: plan.gapCutoff,
    gapRows: plan.gapRowCount, dupes: plan.skippedByDuplicate,
    months: plan.months.map((m) => m.ym), created: createdIds.length, added: totalAdded,
  }));
  if (createdIds.length === 0) {
    console.warn("[csv-import] nothing written for", accountSlug,
      "- rows:", parsed.rows.length, "cutoff:", plan.gapCutoff, "dupes:", plan.skippedByDuplicate);
  }

  // After a successful import: await cache invalidation so the stale cache
  // is gone before we respond, then fire insights rebuild in the background.
  if (createdIds.length > 0) {
    await invalidateFinancialProfileCache(uid, db);
    fireInsightEvent({ type: "statement.parsed", meta: { statementId: createdIds[0] } }, uid, db)
      .catch((e) => console.error("[csv-import] insight event failed:", e));
  }

  return NextResponse.json({
    ok: true,
    imported: totalAdded,
    skippedByGapFilter: plan.skippedByGapFilter,
    skippedByDuplicate: plan.skippedByDuplicate,
    totalSkipped: plan.skippedByGapFilter + plan.skippedByDuplicate,
    statementIds: createdIds,
    monthsCreated: createdIds.length,
    months: plan.months.map((m) => m.ym),
  });
}

