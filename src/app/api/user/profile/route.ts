/**
 * GET  /api/user/profile  — return profile fields (country, etc.)
 * PATCH /api/user/profile  — update profile fields (country confirmation, etc.)
 *
 * Writes to users/{uid}.country (and future profile fields).
 */

import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { resolveAccess } from "@/lib/access/resolveAccess";
import { detectCountry } from "@/lib/external/registry";
import { getFinancialProfile } from "@/lib/financialProfile";

const ALLOWED_COUNTRIES = ["CA", "US"] as const;
type Country = (typeof ALLOWED_COUNTRIES)[number];

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const { db } = getFirebaseAdmin();
  const access = await resolveAccess(req, db);
  if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userDoc = await db.collection("users").doc(access.targetUid).get();
  const confirmedCountry = (userDoc.data()?.country as Country | undefined) ?? null;

  // Auto-detect from bank names if not yet confirmed
  let detectedCountry: Country = "US";
  try {
    const profile = await getFinancialProfile(access.targetUid, db);
    detectedCountry = detectCountry(profile);
  } catch {
    // no statements yet — default to US
  }

  return NextResponse.json({ confirmedCountry, detectedCountry });
}

// ── PATCH ─────────────────────────────────────────────────────────────────────

export async function PATCH(req: NextRequest) {
  const { db } = getFirebaseAdmin();
  const access = await resolveAccess(req, db);
  if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { country?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const country = body.country;
  if (!country || !ALLOWED_COUNTRIES.includes(country as Country)) {
    return NextResponse.json(
      { error: `country must be one of: ${ALLOWED_COUNTRIES.join(", ")}` },
      { status: 400 },
    );
  }

  const batch = db.batch();

  batch.set(
    db.collection("users").doc(access.targetUid),
    { country: country as Country },
    { merge: true },
  );

  // Invalidate external cards cache so the pipeline regenerates with the
  // new country on the next dashboard load — not doing this would leave
  // wrong-country cards in place until global data is refreshed.
  batch.delete(
    db.doc(`users/${access.targetUid}/externalCardsMeta/v1`),
  );

  await batch.commit();

  return NextResponse.json({ ok: true, country });
}
