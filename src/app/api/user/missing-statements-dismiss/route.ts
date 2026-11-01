/**
 * POST /api/user/missing-statements-dismiss?range=3mo|12mo|ytd
 * Records that the user dismissed the missing statements nudge for a specific window.
 * The nudge will reappear when the calendar month changes.
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

    const { searchParams } = new URL(request.url);
    const range = searchParams.get('range') || '3mo';
    
    // Get current calendar month (YYYY-MM)
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    
    // Store per-window dismissal with current month
    const userDoc = await db.doc(`users/${uid}`).get();
    const existingDismissals = userDoc.get('missingStatementsDismissed') || {};
    
    await db.doc(`users/${uid}`).set({
      missingStatementsDismissed: {
        ...existingDismissals,
        [range]: currentMonth,
      },
    }, { merge: true });

    return NextResponse.json({ success: true, range, dismissedMonth: currentMonth });
  } catch (err) {
    console.error("[missing-statements-dismiss POST]", err);
    return NextResponse.json({ error: "Failed to dismiss" }, { status: 500 });
  }
}

/**
 * GET /api/user/missing-statements-dismiss?range=3mo|12mo|ytd
 * Returns whether the nudge was dismissed for this range in the current month.
 */
export async function GET(request: NextRequest) {
  try {
    const { db } = getFirebaseAdmin();
    const access = await resolveAccess(request, db);
    if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const uid = access.targetUid;

    const { searchParams } = new URL(request.url);
    const range = searchParams.get('range') || '3mo';
    
    // Get current calendar month
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    const userDoc = await db.doc(`users/${uid}`).get();
    const dismissals = userDoc.get('missingStatementsDismissed') || {};
    const dismissedMonth = dismissals[range];
    
    // Dismissed only if the stored month matches current month
    const isDismissed = dismissedMonth === currentMonth;

    return NextResponse.json({
      isDismissed,
      dismissedMonth: dismissedMonth || null,
      currentMonth,
    });
  } catch (err) {
    console.error("[missing-statements-dismiss GET]", err);
    return NextResponse.json({ error: "Failed to check dismissal" }, { status: 500 });
  }
}

/**
 * DELETE /api/user/missing-statements-dismiss
 * Dev-only: clears all dismissals so the modal can be tested again.
 */
export async function DELETE(request: NextRequest) {
  try {
    const { db } = getFirebaseAdmin();
    const access = await resolveAccess(request, db);
    if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const uid = access.targetUid;

    await db.doc(`users/${uid}`).set({
      missingStatementsDismissed: {},
    }, { merge: true });

    return NextResponse.json({ success: true, message: "All dismissals cleared" });
  } catch (err) {
    console.error("[missing-statements-dismiss DELETE]", err);
    return NextResponse.json({ error: "Failed to clear" }, { status: 500 });
  }
}
