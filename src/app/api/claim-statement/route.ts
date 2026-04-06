import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { fireInsightEvent } from "@/lib/insights/index";
import { invalidateFinancialProfileCache } from "@/lib/financialProfile";

export const maxDuration = 30;

async function getUid(req: NextRequest): Promise<string | null> {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) return null;
  try {
    const { auth } = getFirebaseAdmin();
    return (await auth.verifyIdToken(token)).uid;
  } catch { return null; }
}

/**
 * POST /api/claim-statement
 *
 * Called immediately after signup when an anonymous statement upload preceded
 * account creation. Adopts the orphaned statement by setting its userId, then
 * invalidates the financial profile cache (awaited) and fires the insights
 * pipeline (fire-and-forget).
 *
 * Body: { statementId: string }
 * Auth: Bearer <idToken>
 */
export async function POST(req: NextRequest) {
  const uid = await getUid(req);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let statementId: string | undefined;
  try {
    const body = await req.json();
    statementId = body?.statementId;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!statementId || typeof statementId !== "string") {
    return NextResponse.json({ error: "Missing statementId" }, { status: 400 });
  }

  const { db } = getFirebaseAdmin();
  const ref = db.collection("statements").doc(statementId);
  const snap = await ref.get();

  if (!snap.exists) {
    return NextResponse.json({ error: "Statement not found" }, { status: 404 });
  }

  const existing = snap.data();

  // Already claimed by this user — idempotent success
  if (existing?.userId === uid) {
    return NextResponse.json({ ok: true, alreadyClaimed: true });
  }

  // Refuse to steal another user's statement
  if (existing?.userId && existing.userId !== uid) {
    return NextResponse.json({ error: "Statement belongs to another account" }, { status: 403 });
  }

  // Only claim completed statements (no parsedData = nothing useful to import)
  if (existing?.status !== "completed" || !existing?.parsedData) {
    return NextResponse.json({ error: "Statement is not ready" }, { status: 422 });
  }

  // ── Adopt the statement ──────────────────────────────────────────────────
  await ref.update({ userId: uid });

  // ── Invalidate cache synchronously so the next dashboard load rebuilds ──
  try {
    await invalidateFinancialProfileCache(uid, db);
  } catch (e) {
    console.error("[claim-statement] cache invalidation failed:", e);
  }

  // ── Fire insights pipeline (fire-and-forget — runs after response) ───────
  fireInsightEvent({ type: "statement.parsed", meta: { statementId } }, uid, db)
    .catch((e) => console.error("[claim-statement] insights event failed:", e));

  return NextResponse.json({ ok: true });
}
