/**
 * POST /api/stripe/checkout
 * Creates a Stripe Checkout Session for the Pro plan.
 * Body: { interval?: "month" | "year" } — defaults to "month"
 * Returns { url } — redirect the user to this URL.
 *
 * Stripe will redirect back to /account/billing?session_id={CHECKOUT_SESSION_ID}
 * on success, and /account/billing?canceled=1 on cancel.
 */

import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { stripe, PRO_PRICE_ID } from "@/lib/stripe";

function authToken(req: NextRequest): string | null {
  const h = req.headers.get("authorization");
  return h?.startsWith("Bearer ") ? h.slice(7) : null;
}

export async function POST(req: NextRequest) {
  const token = authToken(req);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { auth, db } = getFirebaseAdmin();
    const { uid, email } = await auth.verifyIdToken(token);

    // Read optional interval from request body
    const body = await req.json().catch(() => ({}));
    const interval = body.interval === "year" ? "year" : "month";

    // Use STRIPE_PRICE_ID_YEARLY if interval is "year" and env var is set
    const yearlyPriceId = process.env.STRIPE_PRICE_ID_YEARLY ?? "";
    const priceId = interval === "year" && yearlyPriceId
      ? yearlyPriceId
      : PRO_PRICE_ID;

    // Re-use existing Stripe customer if one was already created
    const userDoc  = await db.collection("users").doc(uid).get();
    const userData = userDoc.data() ?? {};
    let customerId = userData.stripeCustomerId as string | undefined;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: email ?? undefined,
        metadata: { firebaseUid: uid },
      });
      customerId = customer.id;
      await db.collection("users").doc(uid).set(
        { stripeCustomerId: customerId },
        { merge: true },
      );
    }

    const origin = req.headers.get("origin") ?? process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";

    const session = await stripe.checkout.sessions.create({
      customer:   customerId,
      mode:       "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${origin}/account/billing?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${origin}/account/billing?canceled=1`,
      metadata:   { firebaseUid: uid },
      subscription_data: {
        metadata: { firebaseUid: uid },
      },
    });

    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error("POST /api/stripe/checkout error:", err);
    return NextResponse.json({ error: "Failed to create checkout session" }, { status: 500 });
  }
}
