import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { getFinancialProfile } from "@/lib/financialProfile";
import { buildIncomeSummary } from "@/lib/incomeSummary";
import { getRangeMonths } from "@/lib/rangeUtils";

export const dynamic = "force-dynamic";

/**
 * GET /api/user/income-summary
 * 
 * Returns unified income summary used by:
 * - Income page (Overview, Trends, Sources tabs)
 * - Dashboard income card/drawer
 * 
 * Single source of truth for all income computations.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { auth, db } = getFirebaseAdmin();
    const decoded = await auth.verifyIdToken(token);

    // Load financial profile (single source of truth for transaction data)
    const profile = await getFinancialProfile(decoded.uid, db);

    // Get available months from profile (same as dashboard money-coach route)
    const availableMonths = profile.monthlyHistory.map(m => m.yearMonth).sort();
    const rangeMonths = getRangeMonths("3mo", availableMonths);

    // Load income deposit reviews
    const incomeReviewsSnap = await db
      .collection(`users/${decoded.uid}/reviews`)
      .where("type", "==", "income_deposit")
      .get();
    const incomeDepositReviews = new Map<string, string>();
    incomeReviewsSnap.docs.forEach(doc => {
      incomeDepositReviews.set(doc.id, doc.get("classification"));
    });

    // Build income summary with consistent month selection (last 3 complete calendar months)
    const summary = buildIncomeSummary(
      profile.incomeTxns,
      profile.accountSnapshots,
      profile.homeCurrency,
      incomeDepositReviews,
      rangeMonths
    );

    return NextResponse.json(summary);
  } catch (error) {
    console.error("Income summary error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load income summary" },
      { status: 500 }
    );
  }
}
