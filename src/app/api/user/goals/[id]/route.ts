import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { invalidateFinancialProfileCache } from "@/lib/financialProfile";

function authToken(req: NextRequest): string | null {
  const h = req.headers.get("authorization");
  return h?.startsWith("Bearer ") ? h.slice(7) : null;
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const token = authToken(req);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const { auth, db } = getFirebaseAdmin();
    const { uid } = await auth.verifyIdToken(token);
    const { id } = await params;
    const body = await req.json();
    await db.collection("users").doc(uid).collection("goals").doc(id).update({
      ...body,
      updatedAt: new Date(),
    });
    await invalidateFinancialProfileCache(uid, db);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("PUT /api/user/goals/[id] error:", err);
    return NextResponse.json({ error: "Failed to update goal" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const token = authToken(req);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const { auth, db } = getFirebaseAdmin();
    const { uid } = await auth.verifyIdToken(token);
    const { id } = await params;
    await db.collection("users").doc(uid).collection("goals").doc(id).delete();
    await invalidateFinancialProfileCache(uid, db);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("DELETE /api/user/goals/[id] error:", err);
    return NextResponse.json({ error: "Failed to delete goal" }, { status: 500 });
  }
}
