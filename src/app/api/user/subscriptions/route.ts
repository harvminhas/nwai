import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { resolveAccess } from "@/lib/access/resolveAccess";
import type { SubscriptionRecord, SubscriptionFrequency } from "@/lib/insights/types";

const VALID_FREQUENCIES = new Set<SubscriptionFrequency>([
  "weekly", "biweekly", "monthly", "quarterly", "annual",
]);

/**
 * GET /api/user/subscriptions
 * Returns all SubscriptionRecords from users/{uid}/subscriptions — the
 * canonical, all-time subscription registry maintained by the insights pipeline.
 */
export async function GET(req: NextRequest) {
  const { db } = getFirebaseAdmin();
  const access = await resolveAccess(req, db);
  if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const uid = access.targetUid;

  try {
    const snap = await db.collection(`users/${uid}/subscriptions`).get();
    const subscriptions: SubscriptionRecord[] = snap.docs.map((d) => d.data() as SubscriptionRecord);
    return NextResponse.json({ subscriptions });
  } catch (err) {
    console.error("[subscriptions] GET error uid=" + uid, err);
    return NextResponse.json({ subscriptions: [] });
  }
}

/**
 * PATCH /api/user/subscriptions
 * Body: { slug, frequency?, baseAmount? }
 *
 * Lets the user confirm/lock the frequency and/or base plan price for a subscription.
 * Sets status to user_confirmed and adds the touched fields to lockedFields.
 */
export async function PATCH(req: NextRequest) {
  const { db } = getFirebaseAdmin();
  const access = await resolveAccess(req, db);
  if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const uid = access.targetUid;

  const body = await req.json().catch(() => ({})) as {
    slug?: string;
    frequency?: string;
    baseAmount?: number;
  };

  const slug = typeof body.slug === "string" ? body.slug.trim() : "";
  if (!slug) return NextResponse.json({ error: "slug required" }, { status: 400 });

  const ref = db.doc(`users/${uid}/subscriptions/${slug}`);
  const snap = await ref.get();
  if (!snap.exists) return NextResponse.json({ error: "Subscription not found" }, { status: 404 });

  const existing = snap.data() as SubscriptionRecord;
  const now = new Date().toISOString();

  const updates: Record<string, unknown> = {
    status: "user_confirmed",
    confirmedBy: "user",
    confirmedAt: now,
    updatedAt: now,
  };

  const newLocked = new Set<string>(existing.lockedFields ?? []);

  if (body.frequency !== undefined) {
    const freq = body.frequency as SubscriptionFrequency;
    if (!VALID_FREQUENCIES.has(freq)) {
      return NextResponse.json({ error: "Invalid frequency" }, { status: 400 });
    }
    updates.frequency = freq;
    newLocked.add("frequency");
  }

  if (body.baseAmount !== undefined) {
    const amt = Number(body.baseAmount);
    if (!Number.isFinite(amt) || amt < 0) {
      return NextResponse.json({ error: "Invalid baseAmount" }, { status: 400 });
    }
    updates.baseAmount = amt;
    newLocked.add("baseAmount");
  }

  updates.lockedFields = Array.from(newLocked);

  await ref.update(updates);

  return NextResponse.json({ ok: true });
}
