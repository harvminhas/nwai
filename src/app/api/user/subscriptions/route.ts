import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { getFinancialProfile } from "@/lib/financialProfile";
import { buildSubscriptionSummary } from "@/lib/subscriptionEngine";

export const dynamic = "force-dynamic";

/**
 * GET /api/user/subscriptions
 * Returns detected subscriptions with price changes and new subs
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { auth, db } = getFirebaseAdmin();
    const decoded = await auth.verifyIdToken(token);

    const profile = await getFinancialProfile(decoded.uid, db);
    const summary = buildSubscriptionSummary(profile.expenseTxns, profile.homeCurrency);

    return NextResponse.json(summary);
  } catch (error) {
    console.error("Subscriptions error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load subscriptions" },
      { status: 500 }
    );
  }
}
