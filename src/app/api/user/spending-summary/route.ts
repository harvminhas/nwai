import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { getFinancialProfile } from "@/lib/financialProfile";
import { buildSpendingSummary } from "@/lib/spendingSummary";
import { resolveWindowMonths, type TimeRange } from "@/lib/rangeUtils";
import type { DebtPaymentReview } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/user/spending-summary?range=3mo
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

    // Get range parameter
    const { searchParams } = new URL(req.url);
    const rangeParam = searchParams.get("range");
    const isValidMonth = rangeParam?.startsWith("month:") && rangeParam.length > 6;
    const range: TimeRange = rangeParam && (["3mo", "12mo", "ytd"].includes(rangeParam) || isValidMonth)
      ? rangeParam as TimeRange
      : "3mo";

    const profile = await getFinancialProfile(decoded.uid, db);
    
    // Resolve range to months
    const windowResult = resolveWindowMonths(range, profile.monthlyHistory, profile.accountSnapshots);
    
    // Load user debt payment reviews
    const reviewsSnap = await db.collection(`users/${decoded.uid}/debtPaymentReviews`).get();
    const userReviews: DebtPaymentReview[] = reviewsSnap.docs.map((doc) => ({
      txFingerprint: doc.id,
      accountSlug: doc.get("accountSlug"),
      classification: doc.get("classification"),
      date: doc.get("date"),
      amount: doc.get("amount"),
      reviewedAt: doc.get("reviewedAt"),
    }));
    
    const summary = buildSpendingSummary(
      profile.expenseTxns,
      profile.accountSnapshots,
      profile.debtPaymentHistory,
      userReviews,
      profile.fxRates || {},
      profile.homeCurrency,
      windowResult.months
    );

    return NextResponse.json({
      ...summary,
      window: {
        actualMonthsUsed: windowResult.actualCount,
        requestedMonths: windowResult.requestedCount,
        note: windowResult.note,
        months: windowResult.months,
      },
    });
  } catch (error) {
    console.error("Spending summary error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load spending summary" },
      { status: 500 }
    );
  }
}
