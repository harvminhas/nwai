import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { fireInsightEvent } from "@/lib/insights/index";
import type { InsightEventType } from "@/lib/insights/index";

export const maxDuration = 120;

/**
 * POST /api/user/insights/generate
 *
 * Triggers insight generation for the authenticated user.
 * Accepts an optional event type to run only the relevant detectors:
 *
 *   {}                                    → full.refresh (regenerate everything)
 *   { "event": "statement.parsed" }       → run statement-triggered detectors only
 *   { "event": "subscription.confirmed" } → run subscription detectors only
 *
 * Decoupled from the parse/upload pipeline — never called as a side-effect
 * of ingesting a single statement.
 */
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { auth, db } = getFirebaseAdmin();
    const decoded = await auth.verifyIdToken(token);
    const uid = decoded.uid;

    const body = await request.json().catch(() => ({})) as { event?: InsightEventType; meta?: Record<string, unknown> };
    const eventType: InsightEventType = body.event ?? "full.refresh";

    await fireInsightEvent({ type: eventType, meta: body.meta }, uid, db);

    return NextResponse.json({ ok: true, event: eventType });
  } catch (err) {
    console.error("[insights/generate] Pipeline error:", err);
    return NextResponse.json({ error: "Insights generation failed" }, { status: 500 });
  }
}
