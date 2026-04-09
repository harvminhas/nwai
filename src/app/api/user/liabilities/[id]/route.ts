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
    const { label, category, balance, interestRate } = body;
    if (!label || typeof balance !== "number") {
      return NextResponse.json({ error: "label and balance are required" }, { status: 400 });
    }
    const doc: Record<string, unknown> = {
      label,
      category: category ?? "other",
      balance,
      updatedAt: new Date(),
      interestRate: typeof interestRate === "number" ? interestRate : null,
    };
    await db.collection("users").doc(uid).collection("manualLiabilities").doc(id).set(doc, { merge: true });
    await invalidateFinancialProfileCache(uid, db);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("PUT /api/user/liabilities/[id] error:", err);
    return NextResponse.json({ error: "Failed to update liability" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const token = authToken(req);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const { auth, db } = getFirebaseAdmin();
    const { uid } = await auth.verifyIdToken(token);
    const { id } = await params;
    await db.collection("users").doc(uid).collection("manualLiabilities").doc(id).delete();
    await invalidateFinancialProfileCache(uid, db);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("DELETE /api/user/liabilities/[id] error:", err);
    return NextResponse.json({ error: "Failed to delete liability" }, { status: 500 });
  }
}
