import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { resolveAccess } from "@/lib/access/resolveAccess";
import type { ManualAsset, AssetCategory } from "@/lib/types";
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
    const snap = await db.collection("users").doc(uid).collection("manualAssets").orderBy("updatedAt", "desc").get();
    const assets: ManualAsset[] = snap.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        label: data.label ?? "",
        category: (data.category as AssetCategory) ?? "other",
        value: data.value ?? 0,
        linkedAccountSlug: data.linkedAccountSlug ?? undefined,
        updatedAt: data.updatedAt?.toDate?.()?.toISOString?.() ?? data.updatedAt ?? new Date().toISOString(),
      };
    });
    return NextResponse.json({ assets });
  } catch (err) {
    console.error("GET /api/user/assets error:", err);
    return NextResponse.json({ error: "Failed to load assets" }, { status: 500 });
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
    if (linkedAccountSlug) doc.linkedAccountSlug = linkedAccountSlug;
    const ref = await db.collection("users").doc(uid).collection("manualAssets").add(doc);
    // Invalidate profile cache so net worth reflects the new asset immediately
    await invalidateFinancialProfileCache(uid, db);
    return NextResponse.json({ id: ref.id });
  } catch (err) {
    console.error("POST /api/user/assets error:", err);
    return NextResponse.json({ error: "Failed to create asset" }, { status: 500 });
  }
}
