/**
 * GET /api/user/net-worth-changes?startMonth=YYYY-MM&endMonth=YYYY-MM
 * Returns net worth change summaries for a date range.
 * 
 * POST /api/user/net-worth-changes
 * Manually regenerates the net worth changes feed.
 */

import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { getNetWorthChanges, generateNetWorthChanges } from "@/lib/netWorthChanges";

// Must match GENERATOR_VERSION in netWorthChanges.ts
const CURRENT_GENERATOR_VERSION = 2;

export const dynamic = "force-dynamic";

function authToken(req: NextRequest): string | null {
  const h = req.headers.get("authorization");
  return h?.startsWith("Bearer ") ? h.slice(7) : null;
}

export async function GET(req: NextRequest) {
  const token = authToken(req);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { auth, db } = getFirebaseAdmin();
  let decoded;
  try {
    decoded = await auth.verifyIdToken(token);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const startMonth = url.searchParams.get("startMonth") || undefined;
  const endMonth = url.searchParams.get("endMonth") || undefined;
  const month = url.searchParams.get("month") || undefined;

  try {
    let changes = await getNetWorthChanges(decoded.uid, db, {
      month,
      startMonth,
      endMonth,
    });

    // Regenerate if:
    // 1. No changes exist (first time), OR
    // 2. Any existing change has missing/old generatorVersion (stale logic)
    const needsRegeneration = changes.length === 0 || 
      changes.some(c => !c.generatorVersion || c.generatorVersion < CURRENT_GENERATOR_VERSION);

    if (needsRegeneration) {
      await generateNetWorthChanges(decoded.uid, db);
      changes = await getNetWorthChanges(decoded.uid, db, {
        month,
        startMonth,
        endMonth,
      });
    }

    return NextResponse.json({ changes });
  } catch (err) {
    console.error("[net-worth-changes GET]", err);
    return NextResponse.json({ error: "Failed to fetch changes" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const token = authToken(req);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { auth, db } = getFirebaseAdmin();
  let decoded;
  try {
    decoded = await auth.verifyIdToken(token);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await generateNetWorthChanges(decoded.uid, db);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[net-worth-changes POST]", err);
    return NextResponse.json({ error: "Failed to regenerate changes" }, { status: 500 });
  }
}
