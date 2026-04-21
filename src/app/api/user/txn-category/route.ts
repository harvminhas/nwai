import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { resolveAccess } from "@/lib/access/resolveAccess";
import { invalidateFinancialProfileCache } from "@/lib/financialProfile";
import { txnKey } from "@/lib/applyRules";
import { buildAccountSlug } from "@/lib/accountSlug";
import type { ExpenseTransaction, ParsedStatementData } from "@/lib/types";

/**
 * PUT /api/user/txn-category
 * Save a per-transaction category override.
 * Body: { stmtId, date?, amount, merchant, category }
 */
export async function PUT(req: NextRequest) {
  const { db } = getFirebaseAdmin();
  const access = await resolveAccess(req, db);
  if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const uid = access.targetUid;

  const body = await req.json().catch(() => ({})) as {
    stmtId?: string;
    date?: string;
    amount?: number;
    merchant?: string;
    category?: string;
  };

  const { stmtId, date, amount, merchant, category } = body;
  if (!stmtId || amount === undefined || !merchant || !category) {
    return NextResponse.json({ error: "stmtId, amount, merchant and category are required" }, { status: 400 });
  }

  // Resolve stmtId → stable accountSlug so the key survives statement re-uploads.
  // A re-upload produces a new stmtId but the same bankName + accountId (= same accountSlug).
  let accountSlug = stmtId; // safe fallback: if lookup fails, key won't match but won't crash
  try {
    const stmtDoc = await db.collection("statements").doc(stmtId).get();
    const p = stmtDoc.data()?.parsedData as ParsedStatementData | undefined;
    if (p) accountSlug = buildAccountSlug(p.bankName, p.accountId);
  } catch {
    // Non-fatal: fall back to stmtId
  }

  const txn: Pick<ExpenseTransaction, "date" | "amount" | "merchant"> = { date, amount, merchant };
  const key = txnKey(accountSlug, txn);

  await db.doc(`users/${uid}/txnCategoryOverrides/${key}`).set({
    category,
    stmtId,
    accountSlug,
    merchant,
    date: date ?? null,
    amount,
    updatedAt: new Date().toISOString(),
  });

  await invalidateFinancialProfileCache(uid, db);

  return NextResponse.json({ ok: true, key });
}

/**
 * DELETE /api/user/txn-category
 * Remove a per-transaction category override (reverts to merchant rule / AI).
 * Body: { key } — the composite txnKey
 */
export async function DELETE(req: NextRequest) {
  const { db } = getFirebaseAdmin();
  const access = await resolveAccess(req, db);
  if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const uid = access.targetUid;

  const body = await req.json().catch(() => ({})) as { key?: string };
  if (!body.key) return NextResponse.json({ error: "key required" }, { status: 400 });

  await db.doc(`users/${uid}/txnCategoryOverrides/${body.key}`).delete();
  await invalidateFinancialProfileCache(uid, db);

  return NextResponse.json({ ok: true });
}
