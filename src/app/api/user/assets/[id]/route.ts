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
    const { label, category, value, linkedAccountSlug, startDate, annualGrowthRate } = body;
    if (!label || typeof value !== "number") {
      return NextResponse.json({ error: "label and value are required" }, { status: 400 });
    }
    
    // Validate startDate format and value if provided
    if (startDate !== undefined) {
      if (startDate !== null && typeof startDate !== 'string') {
        return NextResponse.json({ error: "startDate must be a string or null" }, { status: 400 });
      }
      if (startDate && !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
        return NextResponse.json({ error: "startDate must be YYYY-MM-DD format" }, { status: 400 });
      }
      if (startDate) {
        const date = new Date(startDate);
        if (isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== startDate) {
          return NextResponse.json({ error: "startDate must be a valid calendar date" }, { status: 400 });
        }
      }
    }

    // Validate annualGrowthRate if provided
    if (annualGrowthRate !== undefined && annualGrowthRate !== null) {
      if (typeof annualGrowthRate !== 'number' || !Number.isFinite(annualGrowthRate)) {
        return NextResponse.json({ error: "annualGrowthRate must be a finite number or null" }, { status: 400 });
      }
      // Reasonable bounds: -100% to +100% per year
      if (annualGrowthRate < -100 || annualGrowthRate > 100) {
        return NextResponse.json({ error: "annualGrowthRate must be between -100 and 100" }, { status: 400 });
      }
    }
    
    const doc: Record<string, unknown> = {
      label,
      category: category ?? "other",
      value,
      updatedAt: new Date(),
    };
    if (linkedAccountSlug !== undefined) {
      doc.linkedAccountSlug = linkedAccountSlug ?? null;
    }
    if (startDate !== undefined) {
      doc.startDate = startDate === null || startDate === "" ? null : startDate; // Explicit clear support
    }
    if (annualGrowthRate !== undefined) {
      doc.annualGrowthRate = annualGrowthRate === null || annualGrowthRate === "" ? null : annualGrowthRate;
    }
    await db.collection("users").doc(uid).collection("manualAssets").doc(id).set(doc, { merge: true });
    await invalidateFinancialProfileCache(uid, db);
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
    await invalidateFinancialProfileCache(uid, db);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("DELETE /api/user/assets/[id] error:", err);
    return NextResponse.json({ error: "Failed to delete asset" }, { status: 500 });
  }
}
