import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { resolveAccess } from "@/lib/access/resolveAccess";
import type { ManualLiability, LiabilityCategory } from "@/lib/types";
import { invalidateFinancialProfileCache } from "@/lib/financialProfile";

function authToken(req: NextRequest): string | null {
  const h = req.headers.get("authorization");
  return h?.startsWith("Bearer ") ? h.slice(7) : null;
}

export async function GET(req: NextRequest) {
  const token = authToken(req);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const { db } = getFirebaseAdmin();
    const access = await resolveAccess(req, db);
    if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const uid = access.actorUid;
    const snap = await db
      .collection("users").doc(uid).collection("manualLiabilities")
      .orderBy("updatedAt", "desc")
      .get();
    const liabilities: ManualLiability[] = snap.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        label: data.label ?? "",
        category: (data.category as LiabilityCategory) ?? "other",
        balance: data.balance ?? 0,
        interestRate: data.interestRate ?? undefined,
        updatedAt: data.updatedAt?.toDate?.()?.toISOString?.() ?? data.updatedAt ?? new Date().toISOString(),
      };
    });
    return NextResponse.json({ liabilities });
  } catch (err) {
    console.error("GET /api/user/liabilities error:", err);
    return NextResponse.json({ error: "Failed to load liabilities" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const token = authToken(req);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const { db } = getFirebaseAdmin();
    const access = await resolveAccess(req, db);
    if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const uid = access.actorUid;
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
    };
    if (typeof interestRate === "number") doc.interestRate = interestRate;
    const ref = await db.collection("users").doc(uid).collection("manualLiabilities").add(doc);
    await invalidateFinancialProfileCache(uid, db);
    return NextResponse.json({ id: ref.id });
  } catch (err) {
    console.error("POST /api/user/liabilities error:", err);
    return NextResponse.json({ error: "Failed to create liability" }, { status: 500 });
  }
}
