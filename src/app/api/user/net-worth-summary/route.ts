/**
 * GET /api/user/net-worth-summary
 * Returns current net worth and trend for dashboard badge.
 */

import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { getNetWorthSummary } from "@/lib/netWorthSummary";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { auth, db } = getFirebaseAdmin();
    const decoded = await auth.verifyIdToken(token);

    const summary = await getNetWorthSummary(decoded.uid, db);

    return NextResponse.json(summary);
  } catch (error) {
    console.error("Net worth summary error:", error);
    return NextResponse.json(
      { error: "Failed to compute net worth summary" },
      { status: 500 }
    );
  }
}
