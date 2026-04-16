import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { resolveAccess } from "@/lib/access/resolveAccess";
import { getFinancialProfile, invalidateFinancialProfileCache } from "@/lib/financialProfile";
import { inferCurrencyFromBankName } from "@/lib/currencyUtils";

export interface UnconfirmedAccount {
  slug: string;
  bankName: string;
  accountName: string;
  accountType: string;
  inferredCurrency: string;
}

/**
 * GET /api/user/currency-overrides
 *
 * Returns the list of accounts that have no user-confirmed currency override yet,
 * along with their inferred currency. Used by the Today page to prompt confirmation.
 */
export async function GET(request: NextRequest) {
  try {
    const { db } = getFirebaseAdmin();
    const access = await resolveAccess(request, db);
    if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const uid = access.targetUid;

    const profile = await getFinancialProfile(uid, db);
    const { accountSnapshots, homeCurrency } = profile;

    // Load all existing overrides from the canonical accountCurrencies collection
    const overridesSnap = await db
      .collection("users").doc(uid)
      .collection("accountCurrencies").get();

    const overrides: Record<string, { currency: string; confirmed: boolean }> = {};
    for (const doc of overridesSnap.docs) {
      overrides[doc.id] = doc.data() as { currency: string; confirmed: boolean };
    }

    // Unique slugs — only take the most-recent snapshot per slug
    const seen = new Set<string>();
    const unconfirmed: UnconfirmedAccount[] = [];
    for (const snap of accountSnapshots) {
      if (seen.has(snap.slug)) continue;
      seen.add(snap.slug);
      const override = overrides[snap.slug];
      if (override?.confirmed) continue; // already confirmed by user
      const inferredCurrency = override?.currency
        ?? inferCurrencyFromBankName(snap.bankName, snap.currency ?? null, homeCurrency);
      unconfirmed.push({
        slug: snap.slug,
        bankName: snap.bankName,
        accountName: snap.accountName ?? snap.accountId,
        accountType: snap.accountType,
        inferredCurrency,
      });
    }

    return NextResponse.json({ unconfirmed, homeCurrency });
  } catch (err) {
    console.error("[currency-overrides GET] error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

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

    // Write to the canonical accountCurrencies collection (same one financialProfile reads)
    await db
      .collection("users").doc(uid)
      .collection("accountCurrencies").doc(accountSlug)
      .set({ currency: ccy, confirmed, updatedAt: new Date().toISOString() });

    // Invalidate profile cache so the new currency takes effect immediately
    await invalidateFinancialProfileCache(uid, db);

    return NextResponse.json({ ok: true, accountSlug, currency: ccy });
  } catch (err) {
    console.error("[currency-overrides] error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
