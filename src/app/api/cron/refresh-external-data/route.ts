/**
 * POST /api/cron/refresh-external-data
 *
 * Fetches all due external data sources and pushes personalized insight cards
 * to relevant users.
 *
 * Security: two accepted auth paths:
 *   1. Vercel Cron — sends Authorization: Bearer <CRON_SECRET> (env var)
 *   2. Manual admin trigger — sends a valid Firebase ID token for an admin email
 */

import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { refreshExternalData } from "@/lib/external/pipeline";
import { isDebugSuperAdmin } from "@/lib/debugSuperAdmin";

export const maxDuration = 120;

async function isAuthorized(request: NextRequest): Promise<boolean> {
  const token = request.headers.get("authorization")?.replace("Bearer ", "").trim();
  if (!token) return false;

  // Path 1: Vercel Cron secret (set CRON_SECRET in Vercel env vars)
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && token === cronSecret) return true;

  // Path 2: Firebase ID token for an admin email (manual trigger)
  try {
    const { auth } = getFirebaseAdmin();
    const decoded = await auth.verifyIdToken(token);
    return isDebugSuperAdmin(decoded.email);
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  if (!(await isAuthorized(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { db: adminDb } = getFirebaseAdmin();

  // Allow ?force=true to bypass the isDueForRefresh cache (useful for testing)
  const force = new URL(request.url).searchParams.get("force") === "true";

  try {
    console.log(`[cron/external] refreshing global external data (force=${force})`);

    const result = await refreshExternalData(adminDb, { force });

    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[cron/external] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
