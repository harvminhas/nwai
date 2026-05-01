/**
 * POST /api/user/setup-dismiss
 * Clears backfillPromptNeeded + accountConfirmNeeded on a batch of statement IDs.
 * Called by the setup page after the user completes OR skips a new account,
 * to ensure all sibling statements (same accountSlug, multiple months) are cleared.
 */
import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { resolveAccess } from "@/lib/access/resolveAccess";

export async function POST(request: NextRequest) {
  try {
    const { db } = getFirebaseAdmin();
    const access = await resolveAccess(request, db);
    if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const uid = access.targetUid;

    const body = await request.json() as { statementIds: string[] };
    const ids: string[] = Array.isArray(body.statementIds) ? body.statementIds : [];
    if (ids.length === 0) return NextResponse.json({ cleared: 0 });

    // Verify all statements belong to this user before clearing
    const batch = db.batch();
    let cleared = 0;

    // Firestore `in` limited to 30 per query
    const chunks: string[][] = [];
    for (let i = 0; i < ids.length; i += 30) chunks.push(ids.slice(i, i + 30));

    for (const chunk of chunks) {
      const snap = await db.collection("statements").where("__name__", "in", chunk).where("userId", "==", uid).get();
      for (const doc of snap.docs) {
        batch.update(doc.ref, { backfillPromptNeeded: false, accountConfirmNeeded: false });
        cleared++;
      }
    }

    await batch.commit();
    return NextResponse.json({ cleared });
  } catch (err) {
    console.error("[setup-dismiss POST]", err);
    return NextResponse.json({ error: "Failed to dismiss" }, { status: 500 });
  }
}
