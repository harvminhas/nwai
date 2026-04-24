import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { merchantSlug, applyRulesAndRecalculate } from "@/lib/applyRules";
import type { ParsedStatementData } from "@/lib/types";
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
 * PATCH /api/user/statements/[id]
 * Re-categorizes all transactions for a merchant and saves the rule.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const uid = await getUid(request);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const { merchant, category } = body as { merchant?: string; category?: string };
  if (!merchant || !category) {
    return NextResponse.json({ error: "merchant and category are required" }, { status: 400 });
  }

  const { db } = getFirebaseAdmin();
  const statementRef = db.collection("statements").doc(id);
  const doc = await statementRef.get();

  if (!doc.exists) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const data = doc.data();
  if (data?.userId !== uid) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsedData = data?.parsedData as ParsedStatementData | undefined;
  if (!parsedData) return NextResponse.json({ error: "Statement has no parsed data" }, { status: 400 });

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
