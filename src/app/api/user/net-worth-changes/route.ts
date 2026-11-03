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

    // Compute new items count for badge
    const userDoc = await db.collection("users").doc(decoded.uid).get();
    const userData = userDoc.exists ? userDoc.data() ?? {} : {};
    const netWorthLastViewedAt = userData.netWorthLastViewedAt;

    let newCount = 0;
    if (netWorthLastViewedAt) {
      // Count items generated after last viewed
      const lastViewedDate = new Date(netWorthLastViewedAt);
      for (const change of changes) {
        for (const item of change.items) {
          if (item.generatedAt && new Date(item.generatedAt) > lastViewedDate) {
            newCount++;
          }
        }
      }
    } else {
      // No lastViewed: count items in latest complete month only
      // (prevents 108-item badge on first visit)
      // Filter out current calendar month (incomplete by definition)
      const now = new Date();
      const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const completeMonths = changes.filter(c => c.month < currentMonth);
      if (completeMonths.length > 0) {
        const latestCompleteMonth = completeMonths.sort((a, b) => b.month.localeCompare(a.month))[0];
        newCount = latestCompleteMonth.items.length;
      }
    }

    return NextResponse.json({ changes, newCount });
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
