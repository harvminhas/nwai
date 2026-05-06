/**
 * GET /api/user/plan
 * Returns the user's resolved plan ID.
 *
 * Resolution priority:
 *   1. users/{uid}.manualPro === true  → "pro"  (admin override)
 *   2. users/{uid}.subscription.status === "active" | "trialing"  → "pro"  (written by webhook / billing-info)
 *   3. users/{uid}.promoExpiresAt > now  → "pro"  (promo code grant)
 *   4. Live Stripe lookup (fallback when webhook hasn't fired yet)
 *   5. Otherwise → "free"
 *
 * PUT /api/user/plan  (dev/test only)
 * Body: { plan: "free" | "pro" }
 */

import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { stripe } from "@/lib/stripe";
import { PLAN_ORDER, type PlanId } from "@/lib/plans";
import type { Timestamp, Firestore } from "firebase-admin/firestore";
import type { LinkedPartner } from "@/lib/access/types";

function authToken(req: NextRequest): string | null {
  const h = req.headers.get("authorization");
  return h?.startsWith("Bearer ") ? h.slice(7) : null;
}

/** Resolve plan from raw Firestore user doc data. Returns null if a live Stripe check is needed. */
export function resolvePlan(data: Record<string, unknown> | undefined): PlanId | null {
  if (!data) return "free";

  // 1. Admin manual override
  if (data.manualPro === true) return "pro";

  // 2. Firestore subscription (written by webhook or billing-info)
  const sub = data.subscription as { status?: string } | undefined;
  if (sub?.status === "active" || sub?.status === "trialing") return "pro";
  if (sub?.status && sub.status !== "") return "free"; // explicitly inactive

  // 3. Active promo code grant
  const promoExpiry = data.promoExpiresAt as Timestamp | undefined;
  if (promoExpiry && promoExpiry.toDate() > new Date()) return "pro";

  // 4. Legacy plan field (test mode)
  const legacy = data.plan as PlanId | undefined;
  if (legacy && PLAN_ORDER.includes(legacy)) return legacy;

  // null = no subscription info at all → caller should do live Stripe check
  return null;
}

/**
 * Full plan resolution (Firestore + Stripe fallback + linked-partner inheritance).
 * Shared with debug tooling and other server routes that need the authoritative plan.
 */
export async function getResolvedPlanId(uid: string, db: Firestore): Promise<PlanId> {
  const doc  = await db.collection("users").doc(uid).get();
  const data = doc.data() as Record<string, unknown> | undefined;

  let plan = resolvePlan(data);

  // Firestore has no subscription data yet — check Stripe directly
  if (plan === null) {
    const customerId = data?.stripeCustomerId as string | undefined;
    if (customerId) {
      try {
        const subs = await stripe.subscriptions.list({ customer: customerId, limit: 1, status: "all" });
        const sub  = subs.data[0];
        if (sub?.status === "active" || sub?.status === "trialing") {
          plan = "pro";
          db.collection("users").doc(uid).set(
            { plan: "pro", subscription: { id: sub.id, status: sub.status } },
            { merge: true },
          ).catch(() => {});
        } else {
          plan = "free";
        }
      } catch { plan = "free"; }
    } else {
      plan = "free";
    }
  }

  // If this user can VIEW a Pro partner's data, they inherit Pro access
  if (plan === "free") {
    const canViewSnap = await db.doc(`users/${uid}/linkedPartner/data`).get();
    if (canViewSnap.exists) {
      const canView = canViewSnap.data() as LinkedPartner;
      const canViewDoc = await db.collection("users").doc(canView.partnerUid).get();
      const pdata = canViewDoc.data() as Record<string, unknown> | undefined;
      let canViewPlan = resolvePlan(pdata);
      if (canViewPlan === null) {
        const customerId = pdata?.stripeCustomerId as string | undefined;
        if (customerId) {
          try {
            const subs = await stripe.subscriptions.list({ customer: customerId, limit: 1, status: "all" });
            const sub  = subs.data[0];
            if (sub?.status === "active" || sub?.status === "trialing") {
              canViewPlan = "pro";
              db.collection("users").doc(canView.partnerUid).set(
                { plan: "pro", subscription: { id: sub.id, status: sub.status } },
                { merge: true },
              ).catch(() => {});
            } else {
              canViewPlan = "free";
            }
          } catch { canViewPlan = "free"; }
        } else {
          canViewPlan = "free";
        }
      }
      if (canViewPlan === "pro") plan = "pro";
    }
  }

  return plan;
}

export async function GET(req: NextRequest) {
  const token = authToken(req);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { auth, db } = getFirebaseAdmin();
    const { uid } = await auth.verifyIdToken(token);
    const plan = await getResolvedPlanId(uid, db);

    return NextResponse.json({ plan });
  } catch (err) {
    console.error("GET /api/user/plan error:", err);
    return NextResponse.json({ error: "Failed to load plan" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const token = authToken(req);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { auth, db } = getFirebaseAdmin();
    const { uid } = await auth.verifyIdToken(token);
    const body = await req.json().catch(() => ({}));
    const plan = body.plan as PlanId | undefined;

    if (!plan || !PLAN_ORDER.includes(plan)) {
      return NextResponse.json({ error: "Invalid plan" }, { status: 400 });
    }

    // Only used in dev/test — writes the legacy `plan` field
    await db.collection("users").doc(uid).set({ plan }, { merge: true });
    return NextResponse.json({ ok: true, plan });
  } catch (err) {
    console.error("PUT /api/user/plan error:", err);
    return NextResponse.json({ error: "Failed to save plan" }, { status: 500 });
  }
}
