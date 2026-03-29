import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";

/**
 * POST /api/user/statements/:id/reparse
 *
 * Resets a statement's status to "processing" so the client can re-trigger
 * /api/parse on it.  Only the statement's owner may do this.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { auth, db } = getFirebaseAdmin();
    const decoded = await auth.verifyIdToken(token);
    const uid = decoded.uid;

    const { id: statementId } = await params;
    const ref = db.collection("statements").doc(statementId);
    const snap = await ref.get();

    if (!snap.exists) {
      return NextResponse.json({ error: "Statement not found" }, { status: 404 });
    }
    if (snap.data()?.userId !== uid) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Reset so /api/parse can overwrite it
    await ref.update({ status: "processing", errorMessage: null });

    return NextResponse.json({ ok: true, statementId });
  } catch (err) {
    console.error("Reparse reset error:", err);
    return NextResponse.json({ error: "Failed to reset statement" }, { status: 500 });
  }
}
