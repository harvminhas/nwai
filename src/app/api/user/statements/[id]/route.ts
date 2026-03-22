import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { merchantSlug, applyRulesAndRecalculate } from "@/lib/applyRules";
import type { ParsedStatementData } from "@/lib/types";

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
  await statementRef.delete();

  return NextResponse.json({ ok: true });
}
