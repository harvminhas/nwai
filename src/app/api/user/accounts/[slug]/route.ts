import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { buildAccountSlug } from "@/lib/accountSlug";
import { buildAndCacheFinancialProfile } from "@/lib/financialProfile";
import type { ParsedStatementData } from "@/lib/types";

export const maxDuration = 60;

/**
 * DELETE /api/user/accounts/[slug]
 *
 * Deletes every statement (Firestore doc + Storage file) that belongs to the
 * given account slug, then rebuilds the financial profile so the account
 * disappears from the UI immediately.
 *
 * Slug matching is tolerant: we check both the stored `accountSlug` field
 * (present on newer statements) and the slug computed live from
 * `parsedData.bankName + parsedData.accountId` (for older statements that
 * were saved before the field existed).
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const token = request.headers.get("authorization")?.replace("Bearer ", "").trim();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let uid: string;
  try {
    const { auth } = getFirebaseAdmin();
    uid = (await auth.verifyIdToken(token)).uid;
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { slug } = await params;
  if (!slug) return NextResponse.json({ error: "slug is required" }, { status: 400 });

  const { db, storage } = getFirebaseAdmin();

  // Fetch all completed statements for this user
  const allSnap = await db
    .collection("statements")
    .where("userId", "==", uid)
    .where("status", "==", "completed")
    .get();

  // Match on stored accountSlug OR computed slug from parsedData
  const toDelete = allSnap.docs.filter((doc) => {
    const d = doc.data();
    if (d.accountSlug === slug) return true;
    const parsed = d.parsedData as ParsedStatementData | undefined;
    if (parsed) {
      return buildAccountSlug(parsed.bankName, parsed.accountId, parsed.accountName, parsed.accountType) === slug;
    }
    return false;
  });

  if (toDelete.length === 0) {
    return NextResponse.json({ error: "No statements found for this account" }, { status: 404 });
  }

  const bucketName =
    process.env.FIREBASE_STORAGE_BUCKET ||
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ||
    `${process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID}.appspot.com`;

  // Delete Storage files and Firestore statement docs
  await Promise.all(
    toDelete.map(async (doc) => {
      const d = doc.data();
      if (d.fileUrl) {
        try {
          await storage.bucket(bucketName).file(d.fileUrl).delete();
        } catch {
          // Non-fatal — file may already be gone
        }
      }
      await doc.ref.delete();
    })
  );

  // Delete all backfill records for this account slug.
  // Backfills are tied to the account's existence — once the account is deleted
  // the synthetic history is meaningless and must not ghost into other views.
  const backfillSnap = await db
    .collection(`users/${uid}/accountBackfills`)
    .where("accountSlug", "==", slug)
    .get();
  if (!backfillSnap.empty) {
    const batch = db.batch();
    backfillSnap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }

  // Rebuild the financial profile so the deleted account disappears immediately
  try {
    await buildAndCacheFinancialProfile(uid, db);
  } catch (e) {
    console.error("[delete-account] profile rebuild failed:", e);
  }

  return NextResponse.json({ ok: true, deletedCount: toDelete.length });
}
