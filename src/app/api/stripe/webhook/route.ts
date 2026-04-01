/**
 * POST /api/stripe/webhook
 * Receives Stripe events and keeps Firestore in sync.
 *
 * Events handled:
 *   customer.subscription.created   → write subscription + set plan: "pro"
 *   customer.subscription.updated   → update subscription status
 *   customer.subscription.deleted   → clear subscription + set plan: "free"
 *   checkout.session.completed      → ensure stripeCustomerId is stored
 *
 * Firestore shape written to users/{uid}:
 *   {
 *     plan: "pro" | "free",
 *     stripeCustomerId: "cus_xxx",
 *     subscription: {
 *       id: "sub_xxx",
 *       status: "active" | "canceled" | "past_due" | ...,
 *       priceId: "price_xxx",
 *       currentPeriodEnd: "2026-04-01T00:00:00.000Z",
 *     }
 *   }
 *
 * NOTE: This route must be excluded from Next.js body parsing so we can
 * verify the raw Stripe signature. See next.config.js / route config below.
 */

import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { stripe, WEBHOOK_SECRET } from "@/lib/stripe";
import { getFirebaseAdmin } from "@/lib/firebase-admin";

export const config = { api: { bodyParser: false } };

async function uidFromCustomer(
  db: ReturnType<typeof getFirebaseAdmin>["db"],
  customerId: string,
): Promise<string | null> {
  const snap = await db
    .collection("users")
    .where("stripeCustomerId", "==", customerId)
    .limit(1)
    .get();
  return snap.empty ? null : snap.docs[0].id;
}

async function syncSubscription(
  db: ReturnType<typeof getFirebaseAdmin>["db"],
  sub: Stripe.Subscription,
) {
  // Prefer uid from subscription metadata (set at checkout), fall back to customer lookup
  const uid =
    (sub.metadata?.firebaseUid as string | undefined) ??
    (await uidFromCustomer(db, sub.customer as string));

  if (!uid) {
    console.warn("[webhook] Could not resolve uid for subscription", sub.id);
    return;
  }

  const isActive        = sub.status === "active" || sub.status === "trialing";
  const priceId         = sub.items.data[0]?.price.id ?? "";
  const subRaw          = sub as unknown as Record<string, unknown>;
  const periodEndSecs   = (subRaw.current_period_end as number | undefined) ?? 0;
  const cancelAtPeriodEnd = (subRaw.cancel_at_period_end as boolean | undefined) ?? false;

  await db.collection("users").doc(uid).set(
    {
      // Keep plan: "pro" even if cancel_at_period_end is true — access continues until period ends
      plan: isActive ? "pro" : "free",
      subscription: {
        id:                 sub.id,
        status:             sub.status,
        priceId,
        currentPeriodEnd:   periodEndSecs ? new Date(periodEndSecs * 1000).toISOString() : null,
        cancelAtPeriodEnd,
      },
    },
    { merge: true },
  );

  console.log(`[webhook] uid=${uid} plan=${isActive ? "pro" : "free"} status=${sub.status}`);
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const sig     = req.headers.get("stripe-signature") ?? "";

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, WEBHOOK_SECRET);
  } catch (err) {
    console.error("[webhook] Signature verification failed:", err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  const { db } = getFirebaseAdmin();

  try {
    switch (event.type) {
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        await syncSubscription(db, event.data.object as Stripe.Subscription);
        break;

      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.customer && session.metadata?.firebaseUid) {
          // Ensure stripeCustomerId is stored in case checkout route missed it
          await db.collection("users").doc(session.metadata.firebaseUid).set(
            { stripeCustomerId: session.customer as string },
            { merge: true },
          );
        }
        break;
      }

      default:
        // Ignore unhandled events
        break;
    }
  } catch (err) {
    console.error("[webhook] Handler error:", err);
    return NextResponse.json({ error: "Handler error" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
