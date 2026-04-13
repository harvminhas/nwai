/**
 * GET /api/promo/featured
 *
 * Returns the first active promo campaign (no auth required).
 * Used by the billing page to surface a "special offer" banner for free users.
 *
 * Returns: { campaign: { code, durationDays, description } } | { campaign: null }
 */

import { NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { Timestamp } from "firebase-admin/firestore";

export async function GET() {
  try {
    const { db } = getFirebaseAdmin();

    // No orderBy — avoids a composite index requirement on a tiny collection.
    const snap = await db
      .collection("promoCodes")
      .where("active", "==", true)
      .limit(5)
      .get();

    if (snap.empty) return NextResponse.json({ campaign: null });

    const now = new Date();

    // Pick the first doc that passes all validity checks
    for (const doc of snap.docs) {
      const data = doc.data();

      const expiresAt = data.expiresAt as Timestamp | undefined;
      if (expiresAt && expiresAt.toDate() < now) continue;

      const max   = data.maxRedemptions as number | null | undefined;
      const count = (data.redemptionCount as number | undefined) ?? 0;
      if (max !== null && max !== undefined && count >= max) continue;

      // Never return the code — users must type it themselves.
      return NextResponse.json({
        campaign: {
          durationDays: data.durationDays as number,
          description:  data.description as string,
        },
      });
    }

    return NextResponse.json({ campaign: null });
  } catch (err) {
    console.error("[promo/featured] error:", err);
    // Always return gracefully — a banner failing to load should never break billing
    return NextResponse.json({ campaign: null });
  }
}
