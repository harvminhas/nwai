import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { merchantSlug } from "@/lib/applyRules";
import { invalidateFinancialProfileCache } from "@/lib/financialProfile";

async function getUid(request: NextRequest): Promise<string | null> {
  const token = request.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) return null;
  try {
    const { auth } = getFirebaseAdmin();
    const decoded = await auth.verifyIdToken(token);
    return decoded.uid;
  } catch {
    return null;
  }
}

/** GET /api/user/category-rules — list all rules for the current user */
export async function GET(request: NextRequest) {
  const uid = await getUid(request);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { db } = getFirebaseAdmin();
  const snap = await db.collection(`users/${uid}/categoryRules`).get();
  const rules = snap.docs.map((d) => ({ merchant: d.data().merchant, category: d.data().category }));
  return NextResponse.json({ rules });
}

/** PUT /api/user/category-rules — upsert a rule { merchant, category } */
export async function PUT(request: NextRequest) {
  const uid = await getUid(request);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const { merchant, category } = body as { merchant?: string; category?: string };
  if (!merchant || !category) {
    return NextResponse.json({ error: "merchant and category are required" }, { status: 400 });
  }

  const { db } = getFirebaseAdmin();
  const slug = merchantSlug(merchant);
  await db.doc(`users/${uid}/categoryRules/${slug}`).set({
    merchant,
    category,
    slug,
    updatedAt: new Date(),
  });

  // Invalidate the financial profile cache so the next consolidated/insights
  // request rebuilds with the new category rule applied.
  await invalidateFinancialProfileCache(uid, db);

  return NextResponse.json({ ok: true, slug });
}
