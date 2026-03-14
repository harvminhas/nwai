import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";

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
    const { label, category, value, linkedAccountSlug } = body;
    if (!label || typeof value !== "number") {
      return NextResponse.json({ error: "label and value are required" }, { status: 400 });
    }
    const doc: Record<string, unknown> = {
      label,
      category: category ?? "other",
      value,
      updatedAt: new Date(),
    };
    // Allow clearing the link by passing null explicitly
    if (linkedAccountSlug !== undefined) {
      doc.linkedAccountSlug = linkedAccountSlug ?? null;
    }
    await db.collection("users").doc(uid).collection("manualAssets").doc(id).set(doc, { merge: true });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("PUT /api/user/assets/[id] error:", err);
    return NextResponse.json({ error: "Failed to update asset" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const token = authToken(req);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const { auth, db } = getFirebaseAdmin();
    const { uid } = await auth.verifyIdToken(token);
    const { id } = await params;
    await db.collection("users").doc(uid).collection("manualAssets").doc(id).delete();
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("DELETE /api/user/assets/[id] error:", err);
    return NextResponse.json({ error: "Failed to delete asset" }, { status: 500 });
  }
}
