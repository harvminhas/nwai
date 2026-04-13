/**
 * POST /api/user/redeem-promo
 * Body: { code: string }
 *
 * Validates a promo code and grants Pro access for its duration.
 * This route is intentionally isolated from the extraction/compute engine layer.
 * It only reads/writes:
 *   - promoCodes/{code}          (promo catalogue)
 *   - users/{uid}.redeemedPromo  (which code the user used)
 *   - users/{uid}.promoExpiresAt (when their promo Pro access expires)
 *
 * GET /api/user/redeem-promo?code=X  (status check — is this code valid?)
 *
 * Admin: POST /api/admin/promo-campaigns  (manage campaigns — see /account/debug)
 */

import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { FieldValue, Timestamp } from "firebase-admin/firestore";

function authToken(req: NextRequest): string | null {
  const h = req.headers.get("authorization");
  return h?.startsWith("Bearer ") ? h.slice(7) : null;
}

export interface PromoCode {
  active: boolean;
  plan: "pro";
  durationDays: number;
  maxRedemptions: number | null; // null = unlimited
  redemptionCount: number;
  expiresAt: Timestamp | null;   // null = no campaign end date
  description: string;
  createdAt: Timestamp;
}

/** Validate a promo code doc without redeeming it. Returns an error string or null. */
function validateCode(promo: PromoCode, now: Date): string | null {
  if (!promo.active) return "This promo code is no longer active.";
  if (promo.expiresAt && promo.expiresAt.toDate() < now) return "This promo code has expired.";
  if (promo.maxRedemptions !== null && promo.redemptionCount >= promo.maxRedemptions) {
    return "This promo code has reached its redemption limit.";
  }
  return null;
}

// ── GET — check if a code is valid (no auth required) ────────────────────────

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code")?.toUpperCase().trim();
  if (!code) return NextResponse.json({ valid: false, error: "No code provided" });

  const { db } = getFirebaseAdmin();
  const snap = await db.collection("promoCodes").doc(code).get();
  if (!snap.exists) return NextResponse.json({ valid: false, error: "Invalid promo code." });

  const promo = snap.data() as PromoCode;
  const err   = validateCode(promo, new Date());
  if (err) return NextResponse.json({ valid: false, error: err });

  return NextResponse.json({
    valid: true,
    durationDays: promo.durationDays,
    description: promo.description,
  });
}

// ── POST — redeem a code for the authenticated user ───────────────────────────

export async function POST(req: NextRequest) {
  const token = authToken(req);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const code = (body.code as string | undefined)?.toUpperCase().trim();
  if (!code) return NextResponse.json({ error: "No code provided" }, { status: 400 });

  try {
    const { auth, db } = getFirebaseAdmin();
    const { uid } = await auth.verifyIdToken(token);

    const [promoSnap, userSnap] = await Promise.all([
      db.collection("promoCodes").doc(code).get(),
      db.collection("users").doc(uid).get(),
    ]);

    if (!promoSnap.exists) {
      return NextResponse.json({ error: "Invalid promo code." }, { status: 400 });
    }

    const promo = promoSnap.data() as PromoCode;
    const now   = new Date();

    const validationError = validateCode(promo, now);
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }

    // Check if user has already redeemed any promo code
    const userData = userSnap.data() ?? {};
    if (userData.redeemedPromo) {
      // If their existing promo is still active, block; otherwise allow re-redemption
      const existingExpiry = userData.promoExpiresAt as Timestamp | undefined;
      if (existingExpiry && existingExpiry.toDate() > now) {
        return NextResponse.json(
          { error: "You already have an active promo applied to your account." },
          { status: 400 },
        );
      }
    }

    // Calculate expiry
    const expiresAt = new Date(now);
    expiresAt.setDate(expiresAt.getDate() + promo.durationDays);
    const expiresAtTs = Timestamp.fromDate(expiresAt);

    // Atomically: update user + increment counter
    const batch = db.batch();

    batch.set(
      db.collection("users").doc(uid),
      {
        redeemedPromo: code,
        promoExpiresAt: expiresAtTs,
        promoRedeemedAt: Timestamp.fromDate(now),
      },
      { merge: true },
    );

    batch.update(db.collection("promoCodes").doc(code), {
      redemptionCount: FieldValue.increment(1),
    });

    await batch.commit();

    console.log(`[redeem-promo] uid=${uid} redeemed code=${code} expires=${expiresAt.toISOString()}`);

    return NextResponse.json({
      ok: true,
      durationDays: promo.durationDays,
      expiresAt: expiresAt.toISOString(),
    });
  } catch (err) {
    console.error("[redeem-promo] error:", err);
    return NextResponse.json({ error: "Failed to redeem promo code." }, { status: 500 });
  }
}
