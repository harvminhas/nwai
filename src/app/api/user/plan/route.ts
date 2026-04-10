/**
 * GET /api/user/plan
 * Returns the user's resolved plan ID.
 *
 * Resolution priority:
 *   1. users/{uid}.manualPro === true  → "pro"  (admin override)
 *   2. users/{uid}.subscription.status === "active" | "trialing"  → "pro"  (written by webhook / billing-info)
 *   3. Live Stripe lookup (fallback when webhook hasn't fired yet)
 *   4. Otherwise → "free"
 *
 * PUT /api/user/plan  (dev/test only)
 * Body: { plan: "free" | "pro" }
 */

import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { stripe } from "@/lib/stripe";
import { PLAN_ORDER, type PlanId } from "@/lib/plans";

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

  // 3. Legacy plan field (test mode)
  const legacy = data.plan as PlanId | undefined;
  if (legacy && PLAN_ORDER.includes(legacy)) return legacy;

  // null = no subscription info at all → caller should do live Stripe check
  return null;
}

import type { LinkedPartner } from "@/lib/access/types";

export async function GET(req: NextRequest) {
  const token = authToken(req);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { auth, db } = getFirebaseAdmin();
    const { uid } = await auth.verifyIdToken(token);
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

    // Linked partner inherits the partner's plan — if partner is Pro, so are they
    if (plan === "free") {
      const partnerSnap = await db.doc(`users/${uid}/linkedPartner/data`).get();
      if (partnerSnap.exists) {
        const partner = partnerSnap.data() as LinkedPartner;
        const partnerDoc = await db.collection("users").doc(partner.partnerUid).get();
        const partnerPlan = resolvePlan(partnerDoc.data() as Record<string, unknown> | undefined);
        if (partnerPlan === "pro") plan = "pro";
      }
    }

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
