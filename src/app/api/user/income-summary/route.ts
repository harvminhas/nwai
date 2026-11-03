import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { getFinancialProfile } from "@/lib/financialProfile";
import { buildIncomeSummary } from "@/lib/incomeSummary";
import { resolveWindowMonths, type TimeRange } from "@/lib/rangeUtils";

export const dynamic = "force-dynamic";

/**
 * GET /api/user/income-summary?range=3mo
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

    // Get range parameter
    const { searchParams } = new URL(req.url);
    const rangeParam = searchParams.get("range");
    const isValidMonth = rangeParam?.startsWith("month:") && rangeParam.length > 6;
    const range: TimeRange = rangeParam && (["3mo", "12mo", "ytd"].includes(rangeParam) || isValidMonth)
      ? rangeParam as TimeRange
      : "3mo";

    // Load financial profile (single source of truth for transaction data)
    const profile = await getFinancialProfile(decoded.uid, db);

    // Use shared window resolution helper with account snapshots for completeness check
    // Pass account status map to exclude paid-off/closed accounts from completeness checks
    const accountStatusMap = new Map(
      profile.accountStatusRecords.map(r => [r.accountSlug, { status: r.status, statusDate: r.statusDate }])
    );
    const windowResult = resolveWindowMonths(range, profile.monthlyHistory, profile.statementHistory, accountStatusMap);

    // Load income deposit reviews
    const incomeReviewsSnap = await db
      .collection(`users/${decoded.uid}/reviews`)
      .where("type", "==", "income_deposit")
      .get();
    const incomeDepositReviews = new Map<string, string>();
    incomeReviewsSnap.docs.forEach(doc => {
      incomeDepositReviews.set(doc.id, doc.get("classification"));
    });

    // Build income summary with consistent month selection
    const summary = buildIncomeSummary(
      profile.incomeTxns,
      profile.accountSnapshots,
      profile.homeCurrency,
      incomeDepositReviews,
      windowResult.months
    );

    return NextResponse.json({
      ...summary,
      window: {
        actualMonthsUsed: windowResult.actualCount,
        requestedMonths: windowResult.requestedCount,
        note: windowResult.note,
      },
    });
  } catch (error) {
    console.error("Income summary error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load income summary" },
      { status: 500 }
    );
  }
}
