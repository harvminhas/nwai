/**
 * GET /api/user/billing-info
 * Returns live subscription detail fetched directly from the Stripe API.
 *
 * In Stripe API 2024-09-30+ (acacia), `current_period_end` was removed from the
 * top-level Subscription object. Renewal date is obtained from the upcoming invoice.
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

    if (data.manualPro === true) {
      return NextResponse.json({ manualPro: true, status: null, currentPeriodEnd: null, cancelAtPeriodEnd: false });
    }

    const customerId = data.stripeCustomerId as string | undefined;
    if (!customerId) {
      return NextResponse.json({ manualPro: false, status: null, currentPeriodEnd: null, cancelAtPeriodEnd: false });
    }

    // Fetch the most-recent subscription directly from Stripe
    const subscriptions = await stripe.subscriptions.list({
      customer: customerId,
      limit:    1,
      status:   "all",
    });

    const sub = subscriptions.data[0];
    if (!sub) {
      return NextResponse.json({ manualPro: false, status: null, currentPeriodEnd: null, cancelAtPeriodEnd: false });
    }

    const subAny            = sub as unknown as Record<string, unknown>;
    const cancelAtPeriodEnd = Boolean(subAny.cancel_at_period_end);
    const isActive          = sub.status === "active" || sub.status === "trialing";

    // In Stripe API 2024-09-30+, current_period_end was removed from the top-level
    // subscription. We fall back through a chain of options:
    let currentPeriodEnd: string | null = null;

    // 1. Still try the old field in case it exists (older API or beta flag)
    const legacyPeriodEnd = subAny.current_period_end as number | undefined;
    if (legacyPeriodEnd && legacyPeriodEnd > 0) {
      currentPeriodEnd = new Date(legacyPeriodEnd * 1000).toISOString();
    }

    // 2. For cancelling subscriptions, cancel_at is the expiry date
    if (!currentPeriodEnd && cancelAtPeriodEnd) {
      const cancelAt = subAny.cancel_at as number | undefined;
      if (cancelAt && cancelAt > 0) {
        currentPeriodEnd = new Date(cancelAt * 1000).toISOString();
      }
    }

    // 3. For active subscriptions, preview the next invoice for the next charge date
    //    (Stripe SDK v21 renamed retrieveUpcoming → createPreview)
    if (!currentPeriodEnd && isActive) {
      try {
        const preview = await stripe.invoices.createPreview({ customer: customerId });
        const previewAny = preview as unknown as Record<string, unknown>;
        const periodEnd  = previewAny.period_end as number | undefined;
        if (periodEnd && periodEnd > 0) {
          currentPeriodEnd = new Date(periodEnd * 1000).toISOString();
        }
      } catch {
        // No preview available — sub may be cancelled or have no upcoming invoice
      }
    }

    // 4. Last resort: billing_cycle_anchor (start of current cycle — approximate)
    if (!currentPeriodEnd) {
      const anchor = subAny.billing_cycle_anchor as number | undefined;
      if (anchor && anchor > 0) {
        currentPeriodEnd = new Date(anchor * 1000).toISOString();
      }
    }

    console.log(
      `[billing-info] uid=${uid} status=${sub.status} cancelAtPeriodEnd=${cancelAtPeriodEnd} currentPeriodEnd=${currentPeriodEnd}`,
      "raw keys:", Object.keys(subAny).filter((k) => k.includes("period") || k.includes("cancel") || k.includes("billing")),
    );

    // Best-effort Firestore sync
    db.collection("users").doc(uid).set(
      {
        plan: isActive ? "pro" : "free",
        subscription: { id: sub.id, status: sub.status, cancelAtPeriodEnd, currentPeriodEnd },
      },
      { merge: true },
    ).catch(() => {});

    return NextResponse.json({ manualPro: false, status: sub.status, currentPeriodEnd, cancelAtPeriodEnd });
  } catch (err) {
    console.error("GET /api/user/billing-info error:", err);
    return NextResponse.json({ error: "Failed to load billing info" }, { status: 500 });
  }
}
