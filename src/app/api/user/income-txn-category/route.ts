import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { resolveAccess } from "@/lib/access/resolveAccess";
import { incomeTxnKey } from "@/lib/applyRules";
import { buildAccountSlug } from "@/lib/accountSlug";
import type { ParsedStatementData } from "@/lib/types";

export interface IncomeSplit {
  category: string;
  amount: number;
}

/**
 * PUT /api/user/income-txn-category
 * Save per-transaction income splits.
 * The "residual" (txn.amount - sum(splits)) automatically belongs to the source-level
 * category — callers never need to pass a split for the residual.
 *
 * Body: { stmtId?, accountSlug?, date?, amount, source, splits: IncomeSplit[] }
 *   - Pass splits: [] to clear all splits for this transaction.
 *   - splits must not sum to more than amount (server returns 400 if violated).
 */
export async function PUT(req: NextRequest) {
  const { db } = getFirebaseAdmin();
  const access = await resolveAccess(req, db);
  if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const uid = access.targetUid;

  const body = await req.json().catch(() => ({})) as {
    stmtId?: string;
    accountSlug?: string;
    date?: string;
    amount?: number;
    source?: string;
    splits?: IncomeSplit[];
  };

  const { stmtId, date, amount, source, splits } = body;
  if (amount === undefined || !source || !Array.isArray(splits)) {
    return NextResponse.json({ error: "amount, source and splits are required" }, { status: 400 });
  }

  const splitTotal = splits.reduce((s, x) => s + (x.amount ?? 0), 0);
  if (splitTotal > amount + 0.005) {
    return NextResponse.json({ error: "Splits exceed transaction total" }, { status: 400 });
  }

  // Resolve stable accountSlug
  let accountSlug = body.accountSlug ?? stmtId ?? "unknown";
  if (stmtId && !body.accountSlug) {
    try {
      const stmtDoc = await db.collection("statements").doc(stmtId).get();
      const p = stmtDoc.data()?.parsedData as ParsedStatementData | undefined;
      if (p) accountSlug = buildAccountSlug(p.bankName, p.accountId, p.accountName, p.accountType);
    } catch { /* fall back */ }
  }

  const key = incomeTxnKey(accountSlug, { date, amount, source });

  if (splits.length === 0) {
    // No splits → delete the override entirely
    await db.doc(`users/${uid}/incomeTxnCategories/${key}`).delete();
  } else {
    await db.doc(`users/${uid}/incomeTxnCategories/${key}`).set({
      splits,
      stmtId: stmtId ?? null,
      accountSlug,
      source,
      date: date ?? null,
      amount,
      updatedAt: new Date().toISOString(),
    });
  }

  return NextResponse.json({ ok: true, key });
}

/**
 * DELETE /api/user/income-txn-category
 * Remove all splits for a transaction (reverts to source-level category).
 * Body: { key }
 */
export async function DELETE(req: NextRequest) {
  const { db } = getFirebaseAdmin();
  const access = await resolveAccess(req, db);
  if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const uid = access.targetUid;

  const body = await req.json().catch(() => ({})) as { key?: string };
  if (!body.key) return NextResponse.json({ error: "key required" }, { status: 400 });

  await db.doc(`users/${uid}/incomeTxnCategories/${body.key}`).delete();
  return NextResponse.json({ ok: true });
}

