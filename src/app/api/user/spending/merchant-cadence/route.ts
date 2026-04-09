/**
 * GET  /api/user/spending/merchant-cadence?slug=...
 * PUT  /api/user/spending/merchant-cadence  { slug, frequency }
 *
 * How often the user actually spends at this merchant (not the Pro forecast calculator).
 * Collection: users/{uid}/merchantCadence/{slug}
 */

import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import type { RecurringFrequency } from "@/lib/merchantForecast";
import {
  applyRecurringRuleToSubscriptionDoc,
  releaseSubscriptionUserLock,
} from "@/lib/subscriptionRegistry";

const VALID = new Set<RecurringFrequency>([
  "oneoff",
  "weekly",
  "biweekly",
  "monthly",
  "quarterly",
  "yearly",
]);

function authUid(req: NextRequest): Promise<string | null> {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) return Promise.resolve(null);
  return getFirebaseAdmin()
    .auth.verifyIdToken(token)
    .then((d) => d.uid)
    .catch(() => null);
}

export async function GET(req: NextRequest) {
  const uid = await authUid(req);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const slug = new URL(req.url).searchParams.get("slug")?.trim();
  if (!slug) return NextResponse.json({ error: "slug required" }, { status: 400 });

  const { db } = getFirebaseAdmin();
  const snap = await db.doc(`users/${uid}/merchantCadence/${slug}`).get();
  if (!snap.exists) {
    return NextResponse.json({ cadence: null });
  }
  const d = snap.data() as { frequency?: string };
  const frequency = d.frequency as RecurringFrequency | undefined;
  if (!frequency || !VALID.has(frequency)) {
    return NextResponse.json({ cadence: null });
  }
  return NextResponse.json({ cadence: { frequency } });
}

export async function PUT(req: NextRequest) {
  const uid = await authUid(req);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    slug?: string;
    frequency?: string;
    merchantName?: string;
    amount?: number;
    lastSeenDate?: string;
  };
  const slug = typeof body.slug === "string" ? body.slug.trim() : "";
  if (!slug) return NextResponse.json({ error: "slug required" }, { status: 400 });

  const frequency = body.frequency as RecurringFrequency | undefined;
  if (!frequency || !VALID.has(frequency)) {
    return NextResponse.json({ error: "Invalid frequency" }, { status: 400 });
  }

  const { db } = getFirebaseAdmin();

  // Always persist the display cadence
  await db.doc(`users/${uid}/merchantCadence/${slug}`).set({
    slug,
    frequency,
    updatedAt: new Date().toISOString(),
  });

  // Mirror into the subscription registry so Upcoming reflects the user's choice.
  // Only do this when we know the merchant name (passed by the merchant detail page).
  const merchantName = typeof body.merchantName === "string" ? body.merchantName.trim() : "";
  if (merchantName) {
    if (frequency === "oneoff") {
      // User says this is not recurring — suppress from Upcoming
      await releaseSubscriptionUserLock(uid, db, slug);
      await db.collection("users").doc(uid).collection("subscriptions").doc(slug).set(
        { upcomingSuppressed: true, updatedAt: new Date().toISOString(), merchantSlug: slug },
        { merge: true },
      );
    } else {
      // Promote to user_confirmed with the chosen frequency and latest avg amount
      const amount = typeof body.amount === "number" && body.amount > 0 ? body.amount : undefined;
      // Read existing amount from subscription doc if caller didn't supply one
      const subRef = db.collection("users").doc(uid).collection("subscriptions").doc(slug);
      const existingSnap = await subRef.get();
      const existing = existingSnap.exists ? existingSnap.data() : null;

      // Use caller-supplied amount, then fall back to what's already in the subscription doc
      let resolvedAmount = amount;
      if (!resolvedAmount) {
        resolvedAmount = (existing?.amount ?? existing?.suggestedAmount ?? 0) as number;
      }

      // Use the merchant's actual last transaction date as the subscription anchor.
      // This ensures annual/quarterly subscriptions project from the real payment date,
      // not from today (which would show them as "Today" on the day the user taps the pill).
      const lastSeenDate = typeof body.lastSeenDate === "string" && body.lastSeenDate
        ? body.lastSeenDate.slice(0, 10)
        : null;
      const anchorDate = lastSeenDate
        ?? (typeof existing?.lastSeenAt === "string" ? (existing.lastSeenAt as string).slice(0, 10) : null)
        ?? (typeof existing?.firstSeenAt === "string" ? (existing.firstSeenAt as string).slice(0, 10) : null);

      await applyRecurringRuleToSubscriptionDoc(uid, db, {
        merchant: merchantName,
        amount: resolvedAmount ?? 0,
        frequency,
        slug,
      });

      // After upsert, patch the anchor dates if we have a better one from the merchant page
      if (anchorDate) {
        await subRef.set(
          { lastSeenAt: anchorDate, firstSeenAt: anchorDate },
          { merge: true },
        );
      }
    }
  }

  return NextResponse.json({ ok: true, cadence: { frequency } });
}
