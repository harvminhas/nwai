import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { merchantSlug } from "@/lib/applyRules";

async function getUid(req: NextRequest): Promise<string | null> {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) return null;
  try {
    const { auth } = getFirebaseAdmin();
    return (await auth.verifyIdToken(token)).uid;
  } catch { return null; }
}

export interface RecurringRule {
  merchant: string;
  amount: number;
  frequency: string; // "monthly" | "annual" | "weekly" etc.
  category?: string;
  slug: string;
}

/** GET — list all user-marked recurring rules */
export async function GET(req: NextRequest) {
  const uid = await getUid(req);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { db } = getFirebaseAdmin();
  const snap = await db.collection(`users/${uid}/recurringRules`).get();
  const rules: RecurringRule[] = snap.docs.map((d) => d.data() as RecurringRule);
  return NextResponse.json({ rules });
}

/** PUT — upsert a recurring rule { merchant, amount, frequency, category? } */
export async function PUT(req: NextRequest) {
  const uid = await getUid(req);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const { merchant, amount, frequency, category } = body as {
    merchant?: string; amount?: number; frequency?: string; category?: string;
  };
  if (!merchant || amount === undefined) {
    return NextResponse.json({ error: "merchant and amount required" }, { status: 400 });
  }
  const { db } = getFirebaseAdmin();
  const slug = merchantSlug(merchant);
  await db.doc(`users/${uid}/recurringRules/${slug}`).set({
    merchant, amount, frequency: frequency ?? "monthly",
    category: category ?? null, slug,
    updatedAt: new Date(),
  });
  return NextResponse.json({ ok: true, slug });
}

/** DELETE — remove a recurring rule by merchant slug */
export async function DELETE(req: NextRequest) {
  const uid = await getUid(req);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const slug = searchParams.get("slug");
  if (!slug) return NextResponse.json({ error: "slug required" }, { status: 400 });
  const { db } = getFirebaseAdmin();
  await db.doc(`users/${uid}/recurringRules/${slug}`).delete();
  return NextResponse.json({ ok: true });
}
