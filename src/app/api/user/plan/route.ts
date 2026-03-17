/**
 * PUT /api/user/plan
 * Body: { plan: "free" | "pro" | "family" }
 * Saves the user's plan to their Firestore user doc.
 * In test mode this is called by the PlanContext when the user switches plans.
 * When Stripe is integrated, this endpoint will be called by the Stripe webhook instead.
 */

import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { PLAN_ORDER, type PlanId } from "@/lib/plans";

function authToken(req: NextRequest): string | null {
  const h = req.headers.get("authorization");
  return h?.startsWith("Bearer ") ? h.slice(7) : null;
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

    await db.collection("users").doc(uid).set({ plan }, { merge: true });
    return NextResponse.json({ ok: true, plan });
  } catch (err) {
    console.error("PUT /api/user/plan error:", err);
    return NextResponse.json({ error: "Failed to save plan" }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const token = authToken(req);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { auth, db } = getFirebaseAdmin();
    const { uid } = await auth.verifyIdToken(token);
    const doc = await db.collection("users").doc(uid).get();
    const plan = (doc.data()?.plan as PlanId) ?? "free";
    return NextResponse.json({ plan });
  } catch (err) {
    console.error("GET /api/user/plan error:", err);
    return NextResponse.json({ error: "Failed to load plan" }, { status: 500 });
  }
}
