/**
 * POST /api/stripe/portal
 * Creates a Stripe Customer Portal session so subscribers can manage or cancel.
 * Returns { url } — redirect the user to this URL.
 */

import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { stripe } from "@/lib/stripe";

function authToken(req: NextRequest): string | null {
  const h = req.headers.get("authorization");
  return h?.startsWith("Bearer ") ? h.slice(7) : null;
}

export async function POST(req: NextRequest) {
  const token = authToken(req);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { auth, db } = getFirebaseAdmin();
    const { uid } = await auth.verifyIdToken(token);

    const userDoc    = await db.collection("users").doc(uid).get();
    const customerId = userDoc.data()?.stripeCustomerId as string | undefined;

    if (!customerId) {
      return NextResponse.json({ error: "No Stripe customer found" }, { status: 404 });
    }

    const base = process.env.NEXT_PUBLIC_BASE_URL
      ?? req.headers.get("origin")
      ?? "http://localhost:3000";

    const session = await stripe.billingPortal.sessions.create({
      customer:   customerId,
      return_url: `${base}/account/billing`,
    });

    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error("POST /api/stripe/portal error:", err);
    return NextResponse.json({ error: "Failed to create portal session" }, { status: 500 });
  }
}
