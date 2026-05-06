import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { merchantSlug, applyRulesAndRecalculate } from "@/lib/applyRules";
import type { ParsedStatementData, IncomeTransaction, ExpenseTransaction } from "@/lib/types";
import { invalidateFinancialProfileCache } from "@/lib/financialProfile";
import { fireInsightEvent } from "@/lib/insights/index";

async function getUid(request: NextRequest): Promise<string | null> {
  const token = request.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) return null;
  try {
    const { auth } = getFirebaseAdmin();
    const decoded = await auth.verifyIdToken(token);
    return decoded.uid;
  } catch {
    return null;
  }
}

/**
 * GET /api/user/statements/[id]
 * Returns full statement data (including partialParsedData and parseError)
 * for the authenticated owner.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const uid = await getUid(request);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const { db } = getFirebaseAdmin();
  const doc = await db.collection("statements").doc(id).get();

  if (!doc.exists) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const data = doc.data()!;
  if (data.userId !== uid) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  return NextResponse.json({
    id,
    status: data.status,
    fileName: data.fileName,
    uploadedAt: data.uploadedAt?.toDate?.()?.toISOString() ?? null,
    parsedData: data.parsedData ?? null,
    partialParsedData: data.partialParsedData ?? null,
    parseError: data.parseError ?? data.errorMessage ?? null,
    accountSlug: data.accountSlug ?? null,
    yearMonth: data.yearMonth ?? null,
  });
}

/** Recompute all derived totals from raw transaction arrays. */
function recomputeTotals(
  base: ParsedStatementData,
  incomeTxns: IncomeTransaction[],
  expenseTxns: ExpenseTransaction[],
): ParsedStatementData {
  const incomeTotal    = incomeTxns.reduce((s, t) => s + (t.amount ?? 0), 0);
  const expensesTotal  = expenseTxns.reduce((s, t) => s + (t.amount ?? 0), 0);

  const sourceMap = new Map<string, number>();
  for (const t of incomeTxns) {
    const k = (t.source ?? "Unknown").trim();
    sourceMap.set(k, (sourceMap.get(k) ?? 0) + t.amount);
  }
  const sources = Array.from(sourceMap.entries()).map(([description, amount]) => ({ description, amount }));

  const catMap = new Map<string, number>();
  for (const t of expenseTxns) {
    const k = (t.category ?? "Other").trim();
    catMap.set(k, (catMap.get(k) ?? 0) + t.amount);
  }
  const categories = Array.from(catMap.entries()).map(([name, amount]) => ({
    name,
    amount,
    percentage: expensesTotal > 0 ? Math.round((amount / expensesTotal) * 100) : 0,
  }));

  return {
    ...base,
    income:   { ...base.income,   transactions: incomeTxns,  total: incomeTotal,   sources },
    expenses: { ...base.expenses, transactions: expenseTxns, total: expensesTotal, categories },
    savingsRate: incomeTotal > 0
      ? Math.round(((incomeTotal - expensesTotal) / incomeTotal) * 100)
      : 0,
  };
}

/**
 * PATCH /api/user/statements/[id]
 *
 * action = "save_transactions" — user directly edits income/expense transaction lists.
 * action omitted               — merchant re-categorize (existing behaviour).
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const uid = await getUid(request);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;

  const { db } = getFirebaseAdmin();
  const statementRef = db.collection("statements").doc(id);
  const doc = await statementRef.get();

  if (!doc.exists) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const data = doc.data();
  if (data?.userId !== uid) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsedData = data?.parsedData as ParsedStatementData | undefined;
  if (!parsedData) return NextResponse.json({ error: "Statement has no parsed data" }, { status: 400 });

  // ── New: user-initiated transaction edits ──────────────────────────────────
  if (body.action === "save_transactions") {
    const incomeTxns  = (body.incomeTxns  as IncomeTransaction[]  | undefined) ?? parsedData.income.transactions  ?? [];
    const expenseTxns = (body.expenseTxns as ExpenseTransaction[] | undefined) ?? parsedData.expenses.transactions ?? [];

    const updated = recomputeTotals(parsedData, incomeTxns, expenseTxns);
    await statementRef.update({ parsedData: updated });

    // Just mark the cache stale — the rebuild runs once on the next page
    // that reads the financial profile (dashboard, spending, accounts, etc.).
    // This is intentionally fire-and-forget and cheap (a single flag write).
    invalidateFinancialProfileCache(uid, db).catch(console.error);

    return NextResponse.json({ ok: true, parsedData: updated });
  }

  // ── Existing: merchant re-categorize ──────────────────────────────────────
  const { merchant, category } = body as { merchant?: string; category?: string };
  if (!merchant || !category) {
    return NextResponse.json({ error: "merchant and category are required" }, { status: 400 });
  }

  const slug = merchantSlug(merchant);
  const rules = new Map([[slug, category]]);
  const updated = applyRulesAndRecalculate(parsedData, rules);

  await statementRef.update({ parsedData: updated });

  await db.doc(`users/${uid}/categoryRules/${slug}`).set({
    merchant, category, slug, updatedAt: new Date(),
  });

  // Re-categorization changes parsedData — await so the cache is stale before we respond
  await invalidateFinancialProfileCache(uid, db);

  return NextResponse.json({ ok: true, parsedData: updated });
}

/**
 * DELETE /api/user/statements/[id]
 * Deletes the Firestore document AND the associated file from Firebase Storage.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const uid = await getUid(request);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const { db, storage } = getFirebaseAdmin();
  const statementRef = db.collection("statements").doc(id);
  const doc = await statementRef.get();

  if (!doc.exists) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const data = doc.data()!;
  if (data.userId !== uid) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // ── 1. Delete the file from Firebase Storage ─────────────────────────────
  const storagePath: string | undefined = data.fileUrl;
  const storageBucket: string | undefined = data.storageBucket;

  if (storagePath) {
    try {
      const bucketName = storageBucket
        || process.env.FIREBASE_STORAGE_BUCKET
        || process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
        || `${process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID}.appspot.com`;

      await storage.bucket(bucketName).file(storagePath).delete();
    } catch {
      // Non-fatal — file may already be gone or bucket misconfigured
    }
  }

  // ── 2. Delete the Firestore document ─────────────────────────────────────
  const accountSlug: string | undefined = data.accountSlug;
  await statementRef.delete();

  // ── 3. If this was the last statement for the account, delete its backfills ─
  // Backfill records are only meaningful while real statements exist. Keeping them
  // after all statements are deleted causes ghost entries in history/balance views.
  if (accountSlug) {
    const remaining = await db
      .collection("statements")
      .where("userId", "==", uid)
      .where("accountSlug", "==", accountSlug)
      .where("status", "==", "completed")
      .limit(1)
      .get();

    if (remaining.empty) {
      const backfillSnap = await db
        .collection(`users/${uid}/accountBackfills`)
        .where("accountSlug", "==", accountSlug)
        .get();
      const batch = db.batch();
      backfillSnap.docs.forEach((d) => batch.delete(d.ref));
      if (!backfillSnap.empty) await batch.commit();
    }
  }

  // Await cache invalidation so the stale cache is gone before we respond.
  // Clients that reload immediately after deletion will always trigger a fresh rebuild.
  await invalidateFinancialProfileCache(uid, db);

  // Fire-and-forget the insights rebuild (does not block the response)
  fireInsightEvent({ type: "statement.parsed", meta: { statementId: id } }, uid, db)
    .catch((e) => console.error("[statements/delete] insight event failed:", e));

  return NextResponse.json({ ok: true });
}
