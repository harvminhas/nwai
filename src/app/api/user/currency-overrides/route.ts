import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { resolveAccess } from "@/lib/access/resolveAccess";
import { invalidateFinancialProfileCache } from "@/lib/financialProfile";

/**
 * POST /api/user/currency-overrides
 *
 * Saves a user-confirmed currency for a specific account slug.
 * Stored in users/{uid}/currencyOverrides/{accountSlug} so every part of the
 * financial profile pipeline respects the user's choice.
 *
 * Body: { accountSlug: string; currency: string; confirmed: boolean }
 */
export async function POST(request: NextRequest) {
  try {
    const { db } = getFirebaseAdmin();
    const access = await resolveAccess(request, db);
    if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const uid = access.targetUid;

    const body = await request.json() as { accountSlug?: string; currency?: string; confirmed?: boolean };
    const { accountSlug, currency, confirmed = true } = body;

    if (!accountSlug || !currency) {
      return NextResponse.json({ error: "accountSlug and currency are required" }, { status: 400 });
    }

    const ccy = currency.toUpperCase();
    if (!["CAD", "USD", "EUR", "GBP", "AUD", "NZD", "CHF", "JPY", "MXN", "INR"].includes(ccy)) {
      return NextResponse.json({ error: `Unsupported currency: ${ccy}` }, { status: 400 });
    }

    await db
      .collection("users").doc(uid)
      .collection("currencyOverrides").doc(accountSlug)
      .set({ currency: ccy, confirmed, updatedAt: new Date().toISOString() });

    // Invalidate profile cache so the new currency takes effect immediately
    await invalidateFinancialProfileCache(uid, db);

    return NextResponse.json({ ok: true, accountSlug, currency: ccy });
  } catch (err) {
    console.error("[currency-overrides] error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
