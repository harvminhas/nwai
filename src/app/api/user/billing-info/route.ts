/**
 * GET /api/user/billing-info
 * Returns live subscription detail fetched directly from the Stripe API.
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

    // Cast to plain object so we can read any field regardless of TS type version
    const raw = sub as unknown as Record<string, unknown>;

    // --- Detect cancellation ---
    // Stripe sets cancel_at (unix ts) when a subscription is scheduled to cancel.
    // cancel_at_period_end may also be true in older API versions.
    const cancelAt          = raw.cancel_at as number | null | undefined;
    const cancelAtPeriodEnd =
      Boolean(raw.cancel_at_period_end) ||  // older API field
      (cancelAt != null && cancelAt > 0);    // newer API: cancel_at timestamp set

    const isActive = sub.status === "active" || sub.status === "trialing";

    // Helper: unix seconds → ISO string
    const fromSecs = (n: number | undefined | null): string | null =>
      n && n > 0 ? new Date(n * 1000).toISOString() : null;

    // --- Determine end/renewal date ---
    let currentPeriodEnd: string | null = null;

    // 1. If cancelling, cancel_at IS the access-until date
    if (cancelAtPeriodEnd && cancelAt) {
      currentPeriodEnd = fromSecs(cancelAt);
    }

    // 2. Subscription item's current_period_end (Stripe API 2024-09-30+)
    if (!currentPeriodEnd) {
      const firstItem = raw.items as { data?: Record<string, unknown>[] } | undefined;
      const item      = firstItem?.data?.[0];
      currentPeriodEnd ??= fromSecs(item?.current_period_end as number | undefined);
    }

    // 3. Top-level current_period_end (older API versions)
    currentPeriodEnd ??= fromSecs(raw.current_period_end as number | undefined);

    // 4. billing_cycle_anchor + interval math
    if (!currentPeriodEnd) {
      const anchor   = raw.billing_cycle_anchor as number | undefined;
      const rawItems = raw.items as { data?: Record<string, unknown>[] } | undefined;
      const plan     = rawItems?.data?.[0]?.plan as Record<string, unknown> | undefined;
      const interval      = plan?.interval as string | undefined;
      const intervalCount = (plan?.interval_count as number | undefined) ?? 1;
      if (anchor && anchor > 0 && interval) {
        const d   = new Date(anchor * 1000);
        const now = new Date();
        while (d <= now) {
          if (interval === "month") d.setMonth(d.getMonth() + intervalCount);
          else if (interval === "year") d.setFullYear(d.getFullYear() + intervalCount);
          else d.setDate(d.getDate() + intervalCount);
        }
        currentPeriodEnd = d.toISOString();
      }
    }

    // 5. Upcoming invoice preview — last resort
    if (!currentPeriodEnd && isActive) {
      try {
        const preview = await stripe.invoices.createPreview({ customer: customerId });
        const p       = preview as unknown as Record<string, unknown>;
        currentPeriodEnd ??= fromSecs(p.period_end as number | undefined);
      } catch { /* no preview */ }
    }

    // Log key fields + all cancel-related raw keys for debugging
    console.log(
      `[billing-info] uid=${uid} status=${sub.status}`,
      `cancelAtPeriodEnd=${cancelAtPeriodEnd} cancel_at=${cancelAt} cancel_at_period_end=${raw.cancel_at_period_end}`,
      `currentPeriodEnd=${currentPeriodEnd}`,
      `raw cancel/period keys:`, Object.keys(raw).filter((k) => k.includes("cancel") || k.includes("period")),
    );

    // Best-effort Firestore sync
    db.collection("users").doc(uid).set(
      { plan: isActive ? "pro" : "free", subscription: { id: sub.id, status: sub.status, cancelAtPeriodEnd, currentPeriodEnd } },
      { merge: true },
    ).catch(() => {});

    return NextResponse.json({
      manualPro: false,
      status: sub.status,
      currentPeriodEnd,
      cancelAtPeriodEnd,
      // Raw debug fields — visible in the debug section on the billing page
      _raw: {
        cancel_at:            raw.cancel_at,
        cancel_at_period_end: raw.cancel_at_period_end,
        status:               raw.status,
        billing_cycle_anchor: raw.billing_cycle_anchor,
      },
    });
  } catch (err) {
    console.error("GET /api/user/billing-info error:", err);
    return NextResponse.json({ error: "Failed to load billing info" }, { status: 500 });
  }
}
