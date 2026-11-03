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
import { getNetWorthChanges } from "@/lib/netWorthChanges";

const ALLOWED_COUNTRIES = ["CA", "US"] as const;
type Country = (typeof ALLOWED_COUNTRIES)[number];

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const { db } = getFirebaseAdmin();
  const access = await resolveAccess(req, db);
  if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userDoc = await db.collection("users").doc(access.targetUid).get();
  const userData = userDoc.data();
  const confirmedCountry = (userData?.country as Country | undefined) ?? null;
  const netWorthLastViewedAt = userData?.netWorthLastViewedAt as string | undefined;

  // Auto-detect from bank names if not yet confirmed
  let detectedCountry: Country = "US";
  try {
    const profile = await getFinancialProfile(access.targetUid, db);
    detectedCountry = detectCountry(profile);
  } catch {
    // no statements yet — default to US
  }

  return NextResponse.json({ confirmedCountry, detectedCountry, netWorthLastViewedAt });
}

// ── PATCH ─────────────────────────────────────────────────────────────────────

export async function PATCH(req: NextRequest) {
  const { db } = getFirebaseAdmin();
  const access = await resolveAccess(req, db);
  if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { country?: unknown; netWorthLastViewedAt?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const updates: Record<string, any> = {};

  // Handle country update
  if (body.country !== undefined) {
    const country = body.country;
    if (!ALLOWED_COUNTRIES.includes(country as Country)) {
      return NextResponse.json(
        { error: `country must be one of: ${ALLOWED_COUNTRIES.join(", ")}` },
        { status: 400 },
      );
    }
    updates.country = country as Country;
  }

  // Handle netWorthLastViewedAt update
  // Set to max(now, newest generatedAt) to avoid race conditions
  if (body.netWorthLastViewedAt !== undefined) {
    const now = new Date();
    let maxTimestamp = now;
    
    try {
      // Get all changes to find the newest generatedAt
      const changes = await getNetWorthChanges(access.targetUid, db, {});
      for (const change of changes) {
        for (const item of change.items) {
          if (item.generatedAt) {
            const itemDate = new Date(item.generatedAt);
            if (itemDate > maxTimestamp) {
              maxTimestamp = itemDate;
            }
          }
        }
      }
    } catch (err) {
      console.error("Failed to fetch changes for timestamp:", err);
      // Fall back to now
    }
    
    updates.netWorthLastViewedAt = maxTimestamp.toISOString();
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  const batch = db.batch();

  batch.set(
    db.collection("users").doc(access.targetUid),
    updates,
    { merge: true },
  );

  // Invalidate external cards cache if country was updated
  if (updates.country) {
    batch.delete(
      db.doc(`users/${access.targetUid}/externalCardsMeta/v1`),
    );
  }

  await batch.commit();

  return NextResponse.json({ ok: true, ...updates });
}
