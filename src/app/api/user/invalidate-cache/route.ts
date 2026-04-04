import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { invalidateFinancialProfileCache } from "@/lib/financialProfile";

async function getUid(req: NextRequest): Promise<string | null> {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) return null;
  try {
    const { auth } = getFirebaseAdmin();
    return (await auth.verifyIdToken(token)).uid;
  } catch { return null; }
}

/**
 * POST /api/user/invalidate-cache
 * Marks the financial profile cache as stale so the next read triggers a full
 * rebuild. Called whenever a user preference that affects income/expense totals
 * changes (e.g. marking a source as a transfer).
 */
export async function POST(req: NextRequest) {
  const uid = await getUid(req);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { db } = getFirebaseAdmin();
  await invalidateFinancialProfileCache(uid, db);
  return NextResponse.json({ ok: true });
}
