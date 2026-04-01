/**
 * GET /api/user/plan
 * Returns the user's resolved plan ID.
 *
 * Resolution priority:
 *   1. users/{uid}.manualPro === true  → "pro"  (admin override — set directly in Firestore)
 *   2. users/{uid}.subscription.status === "active" | "trialing"  → "pro"  (Stripe webhook writes this)
 *   3. Otherwise → "free"
 *
 * PUT /api/user/plan
 * Body: { plan: "free" | "pro" }
 * Used in dev/test only (PlanContext test switcher). In production the plan is
 * written exclusively by the Stripe webhook and the manualPro admin flag.
 */

import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { PLAN_ORDER, type PlanId } from "@/lib/plans";

function authToken(req: NextRequest): string | null {
  const h = req.headers.get("authorization");
  return h?.startsWith("Bearer ") ? h.slice(7) : null;
}

/** Resolve plan from raw Firestore user doc data. */
export function resolvePlan(data: Record<string, unknown> | undefined): PlanId {
  if (!data) return "free";

  // 1. Admin manual override — set manualPro: true directly in Firestore
  if (data.manualPro === true) return "pro";

  // 2. Active Stripe subscription
  const sub = data.subscription as { status?: string } | undefined;
  if (sub?.status === "active" || sub?.status === "trialing") return "pro";

  // 3. Fallback (also covers legacy `plan` field written in test mode)
  const legacy = data.plan as PlanId | undefined;
  if (legacy && PLAN_ORDER.includes(legacy)) return legacy;

  return "free";
}

export async function GET(req: NextRequest) {
  const token = authToken(req);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { auth, db } = getFirebaseAdmin();
    const { uid } = await auth.verifyIdToken(token);
    const doc  = await db.collection("users").doc(uid).get();
    const plan = resolvePlan(doc.data() as Record<string, unknown> | undefined);
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
