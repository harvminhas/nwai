import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { getFinancialProfile } from "@/lib/financialProfile";
import { buildSpendingSummary } from "@/lib/spendingSummary";

export const dynamic = "force-dynamic";

/**
 * GET /api/user/spending-summary
 * Returns unified spending summary for all tabs
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
    const summary = buildSpendingSummary(profile.expenseTxns, profile.homeCurrency);

    return NextResponse.json(summary);
  } catch (error) {
    console.error("Spending summary error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load spending summary" },
      { status: 500 }
    );
  }
}
