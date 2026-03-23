/**
 * POST /api/claim-statement
 * Body: { statementId }
 *
 * Associates an unclaimed (anonymous) statement with the authenticated user.
 * Only works if the statement has no userId set yet — prevents claiming others' data.
 */

import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";

function authToken(req: NextRequest): string | null {
  const h = req.headers.get("authorization");
  return h?.startsWith("Bearer ") ? h.slice(7) : null;
}

export async function POST(req: NextRequest) {
  const token = authToken(req);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { auth, db } = getFirebaseAdmin();
    const { uid } = await auth.verifyIdToken(token);
    const { statementId } = (await req.json()) as { statementId?: string };

    if (!statementId) {
      return NextResponse.json({ error: "Missing statementId" }, { status: 400 });
    }

    const ref = db.collection("statements").doc(statementId);
    const doc = await ref.get();

    if (!doc.exists) {
      return NextResponse.json({ error: "Statement not found" }, { status: 404 });
    }

    const existing = doc.data()?.userId;
    if (existing && existing !== uid) {
      // Already owned by a different user — don't allow claiming
      return NextResponse.json({ error: "Already claimed" }, { status: 403 });
    }

    if (existing === uid) {
      // Already theirs — idempotent success
      return NextResponse.json({ ok: true, alreadyOwned: true });
    }

    // Unclaimed — assign to this user
    await ref.update({ userId: uid });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[claim-statement]", e);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
