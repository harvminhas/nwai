/**
 * GET /api/user/billing-info
 * Returns subscription detail for the billing page.
 * Exposes only what the UI needs — no sensitive Stripe keys.
 */

import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";

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

    const sub = data.subscription as {
      status?: string;
      currentPeriodEnd?: string;
      cancelAtPeriodEnd?: boolean;
    } | undefined;

    return NextResponse.json({
      manualPro:          data.manualPro === true,
      status:             sub?.status ?? null,
      currentPeriodEnd:   sub?.currentPeriodEnd ?? null,
      cancelAtPeriodEnd:  sub?.cancelAtPeriodEnd ?? false,
    });
  } catch (err) {
    console.error("GET /api/user/billing-info error:", err);
    return NextResponse.json({ error: "Failed to load billing info" }, { status: 500 });
  }
}
