/**
 * GET  /api/user/income-category-rules  — return all rules
 * PUT  /api/user/income-category-rules  — upsert { source, category } rule
 * DELETE /api/user/income-category-rules?slug=xxx — remove rule
 *
 * Rules are keyed by a normalised source slug (lowercase, alphanumeric).
 * Setting category = "Transfer" also triggers a cache invalidation so the
 * financial profile rebuilds with that source excluded from income totals.
 */
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

export interface IncomeCategoryRule {
  source: string;   // original source name
  slug: string;     // normalised key
  category: string; // one of INCOME_CATEGORIES
  updatedAt: string;
}

function sourceSlug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 60);
}

export async function GET(req: NextRequest) {
  const uid = await getUid(req);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { db } = getFirebaseAdmin();
  const snap = await db.collection(`users/${uid}/incomeCategoryRules`).get();
  const rules: IncomeCategoryRule[] = snap.docs.map((d) => d.data() as IncomeCategoryRule);
  return NextResponse.json({ rules });
}

export async function PUT(req: NextRequest) {
  const uid = await getUid(req);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const { source, category, frequencyOverride } = body as { source?: string; category?: string; frequencyOverride?: string | null };
  if (!source) {
    return NextResponse.json({ error: "source is required" }, { status: 400 });
  }
  const { db } = getFirebaseAdmin();
  const slug = sourceSlug(source);
  const now = new Date().toISOString();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const payload: Record<string, any> = { source, slug, updatedAt: now };
  if (category !== undefined) payload.category = category;
  if (frequencyOverride !== undefined) {
    if (frequencyOverride === null) {
      // Use FieldValue.delete() to remove the field
      const { FieldValue } = await import("firebase-admin/firestore");
      payload.frequencyOverride = FieldValue.delete();
    } else {
      payload.frequencyOverride = frequencyOverride;
    }
  }
  await db.doc(`users/${uid}/incomeCategoryRules/${slug}`).set(payload, { merge: true });

  // If the user marks a source as Transfer, also add it to transferIncomeSources pref
  // and invalidate the financial profile cache so incomeTotal is recomputed.
  if (category === "Transfer") {
    const prefsRef = db.doc(`users/${uid}/prefs/transferIncomeSources`);
    const prefsSnap = await prefsRef.get();
    const existing: string[] = prefsSnap.exists ? (prefsSnap.data()?.keys ?? []) : [];
    if (!existing.includes(source)) {
      await prefsRef.set({ keys: [...existing, source] });
    }
    await invalidateFinancialProfileCache(uid, db);
  } else {
    // If a previously-Transfer source is re-categorized, remove from transfer prefs
    const prefsRef = db.doc(`users/${uid}/prefs/transferIncomeSources`);
    const prefsSnap = await prefsRef.get();
    if (prefsSnap.exists) {
      const existing: string[] = prefsSnap.data()?.keys ?? [];
      if (existing.includes(source)) {
        await prefsRef.set({ keys: existing.filter((s) => s !== source) });
        await invalidateFinancialProfileCache(uid, db);
      }
    }
  }

  return NextResponse.json({ ok: true, slug });
}

export async function DELETE(req: NextRequest) {
  const uid = await getUid(req);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const slug = searchParams.get("slug");
  if (!slug) return NextResponse.json({ error: "slug required" }, { status: 400 });
  const { db } = getFirebaseAdmin();
  await db.doc(`users/${uid}/incomeCategoryRules/${slug}`).delete();
  return NextResponse.json({ ok: true });
}
