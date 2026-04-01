/**
 * GET /api/user/billing-info
 * Returns live subscription detail for the billing page.
 * Fetches directly from the Stripe API using the stored stripeCustomerId
 * so the data is always fresh, regardless of webhook delivery timing.
 */

import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { stripe } from "@/lib/stripe";

function authToken(req: NextRequest): string | null {
  const h = req.headers.get("authorization");
  return h?.startsWith("Bearer ") ? h.slice(7) : null;
}

export async function GET(req: NextRequest) {
  const token = authToken(req);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { auth, db } = getFirebaseAdmin();
    const { uid }      = await auth.verifyIdToken(token);
    const doc  = await db.collection("users").doc(uid).get();
    const data = doc.data() ?? {};

    // Admin manual override — no Stripe data needed
    if (data.manualPro === true) {
      return NextResponse.json({ manualPro: true, status: null, currentPeriodEnd: null, cancelAtPeriodEnd: false });
    }

    const customerId = data.stripeCustomerId as string | undefined;
    if (!customerId) {
      return NextResponse.json({ manualPro: false, status: null, currentPeriodEnd: null, cancelAtPeriodEnd: false });
    }

    // Fetch active subscriptions directly from Stripe — always fresh
    const subscriptions = await stripe.subscriptions.list({
      customer: customerId,
      limit:    1,
      status:   "all",
    });

    const sub = subscriptions.data[0];
    if (!sub) {
      return NextResponse.json({ manualPro: false, status: null, currentPeriodEnd: null, cancelAtPeriodEnd: false });
    }

    // current_period_end exists in the wire format; access via raw object
    const subRaw            = sub as unknown as Record<string, unknown>;
    const periodEndSecs     = subRaw.current_period_end as number | undefined;
    const cancelAtPeriodEnd = (subRaw.cancel_at_period_end as boolean | undefined) ?? false;
    const currentPeriodEnd  = periodEndSecs
      ? new Date(periodEndSecs * 1000).toISOString()
      : null;

    // Keep Firestore in sync while we're here (best-effort, don't await)
    const isActive = sub.status === "active" || sub.status === "trialing";
    db.collection("users").doc(uid).set(
      {
        plan: isActive ? "pro" : "free",
        subscription: { id: sub.id, status: sub.status, cancelAtPeriodEnd, currentPeriodEnd },
      },
      { merge: true },
    ).catch(() => {});

    return NextResponse.json({
      manualPro: false,
      status:    sub.status,
      currentPeriodEnd,
      cancelAtPeriodEnd,
    });
  } catch (err) {
    console.error("GET /api/user/billing-info error:", err);
    return NextResponse.json({ error: "Failed to load billing info" }, { status: 500 });
  }
}
