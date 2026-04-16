import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { resolveAccess } from "@/lib/access/resolveAccess";
import { invalidateFinancialProfileCache } from "@/lib/financialProfile";

const SUPPORTED_CURRENCIES = ["CAD", "USD", "EUR", "GBP", "AUD", "CHF", "JPY", "MXN", "INR"];

/** GET — return all currency overrides for the user */
export async function GET(request: NextRequest) {
  const token = request.headers.get("authorization")?.replace("Bearer ", "").trim();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { db } = getFirebaseAdmin();
    const access = await resolveAccess(request, db);
    if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const uid = access.targetUid;
    const snap = await db.collection(`users/${uid}/accountCurrencies`).get();
    const overrides: Record<string, string> = {};
    for (const doc of snap.docs) overrides[doc.id] = doc.data().currency as string;
    return NextResponse.json({ overrides });
  } catch {
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}

/** PUT { accountSlug, currency } — save override + invalidate cache */
export async function PUT(request: NextRequest) {
  const token = request.headers.get("authorization")?.replace("Bearer ", "").trim();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { db } = getFirebaseAdmin();
    const access = await resolveAccess(request, db);
    if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const uid = access.targetUid;
    const body = await request.json().catch(() => ({})) as { accountSlug?: string; currency?: string };

    if (!body.accountSlug) return NextResponse.json({ error: "accountSlug required" }, { status: 400 });
    const currency = (body.currency ?? "CAD").toUpperCase();
    if (!SUPPORTED_CURRENCIES.includes(currency)) {
      return NextResponse.json({ error: `Unsupported currency. Supported: ${SUPPORTED_CURRENCIES.join(", ")}` }, { status: 400 });
    }

    // Always save the explicit override — never delete it.
    // The old "delete on CAD" logic assumed CAD was the universal default,
    // but for a USD-home user a CAD account needs an explicit CAD override or
    // inferCurrencyFromBankName will fall back to USD for unknown banks.
    await db.collection(`users/${uid}/accountCurrencies`).doc(body.accountSlug).set({
      currency,
      confirmed: true,
      updatedAt: new Date().toISOString(),
    });

    await invalidateFinancialProfileCache(uid, db);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
