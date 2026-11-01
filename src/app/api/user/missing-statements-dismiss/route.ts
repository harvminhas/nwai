/**
 * POST /api/user/missing-statements-dismiss
 * Records that the user dismissed the missing statements nudge.
 * The nudge will reappear after 3 days.
 */
import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { resolveAccess } from "@/lib/access/resolveAccess";

export async function POST(request: NextRequest) {
  try {
    const { db } = getFirebaseAdmin();
    const access = await resolveAccess(request, db);
    if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const uid = access.targetUid;

    // Set dismissedAt to current timestamp
    const dismissedAt = new Date().toISOString();
    
    await db.doc(`users/${uid}`).set({
      missingStatementsDismissedAt: dismissedAt,
    }, { merge: true });

    return NextResponse.json({ success: true, dismissedAt });
  } catch (err) {
    console.error("[missing-statements-dismiss POST]", err);
    return NextResponse.json({ error: "Failed to dismiss" }, { status: 500 });
  }
}

/**
 * GET /api/user/missing-statements-dismiss
 * Returns whether the nudge was dismissed and when.
 */
export async function GET(request: NextRequest) {
  try {
    const { db } = getFirebaseAdmin();
    const access = await resolveAccess(request, db);
    if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const uid = access.targetUid;

    const userDoc = await db.doc(`users/${uid}`).get();
    const dismissedAt = userDoc.get('missingStatementsDismissedAt') as string | undefined;
    
    // Check if dismissed within last 3 days
    const threeDaysAgo = Date.now() - (3 * 24 * 60 * 60 * 1000);
    const isDismissed = dismissedAt && new Date(dismissedAt).getTime() > threeDaysAgo;

    return NextResponse.json({
      isDismissed,
      dismissedAt: dismissedAt || null,
    });
  } catch (err) {
    console.error("[missing-statements-dismiss GET]", err);
    return NextResponse.json({ error: "Failed to check dismissal" }, { status: 500 });
  }
}
