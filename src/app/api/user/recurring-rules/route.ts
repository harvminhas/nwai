import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { resolveAccess } from "@/lib/access/resolveAccess";
import { merchantSlug } from "@/lib/applyRules";
import {
  applyRecurringRuleToSubscriptionDoc,
  releaseSubscriptionUserLock,
} from "@/lib/subscriptionRegistry";
import { invalidateFinancialProfileCache } from "@/lib/financialProfile";
import type { SubscriptionRecord } from "@/lib/insights/types";

async function getUid(req: NextRequest): Promise<string | null> {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) return null;
  try {
    const { db } = getFirebaseAdmin(); const access = await resolveAccess(req, db); return access?.targetUid ?? null;
  } catch { return null; }
}

export interface RecurringRule {
  merchant: string;
  amount: number;
  frequency: string; // "monthly" | "annual" | "weekly" etc.
  category?: string;
  slug: string;
}

/** GET — list all user-confirmed subscriptions (single source of truth) */
export async function GET(req: NextRequest) {
  const uid = await getUid(req);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { db } = getFirebaseAdmin();
  const snap = await db
    .collection(`users/${uid}/subscriptions`)
    .where("status", "==", "user_confirmed")
    .get();
  const rules: RecurringRule[] = snap.docs.map((d) => {
    const s = d.data() as SubscriptionRecord;
    return {
      merchant: s.name,
      amount:   s.amount ?? s.suggestedAmount ?? 0,
      frequency: s.frequency ?? s.suggestedFrequency ?? "monthly",
      category: s.category ?? undefined,
      slug:     s.merchantSlug,
    };
  });
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
  const freq = frequency ?? "monthly";
  await applyRecurringRuleToSubscriptionDoc(uid, db, {
    merchant,
    amount,
    frequency: freq,
    category: category ?? null,
    slug,
  });
  await invalidateFinancialProfileCache(uid, db);
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
  await releaseSubscriptionUserLock(uid, db, slug);
  await invalidateFinancialProfileCache(uid, db);
  return NextResponse.json({ ok: true });
}
