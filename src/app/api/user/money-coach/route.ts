import { NextRequest } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { getFinancialProfile } from "@/lib/financialProfile";
import { loadUserReviewContext } from "@/lib/userReviewContext";
import { computeMoneyCoachBreakdown } from "@/lib/moneyCoach";
import { getRangeMonths, type TimeRange } from "@/lib/rangeUtils";
import { computeGapReconciliation } from "@/lib/gapReconciliation";

export const dynamic = "force-dynamic";

/**
 * GET /api/user/money-coach?range=3mo|12mo|ytd
 * Returns money coach breakdown: Fixed, Essentials, Discretionary, Savings buckets
 * with median monthly amounts, % of income, and plain-language advice.
 */
export async function GET(req: NextRequest) {
  try {
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    
    // Get range parameter
    const url = new URL(req.url);
    const rangeParam = url.searchParams.get("range") as TimeRange | null;
    const range: TimeRange = rangeParam && ["3mo", "12mo", "ytd"].includes(rangeParam)
      ? rangeParam
      : "3mo";

    const { auth, db } = getFirebaseAdmin();
    const decoded = await auth.verifyIdToken(token);

    const profile = await getFinancialProfile(decoded.uid, db);
    
    // Get available months from profile
    const availableMonths = profile.monthlyHistory.map(m => m.yearMonth).sort();
    const rangeMonths = getRangeMonths(range, availableMonths);

    // Load all user review context (income, debt, savings)
    const reviewContext = await loadUserReviewContext(decoded.uid, db);

    const breakdown = computeMoneyCoachBreakdown(
      profile, 
      reviewContext.debtPaymentReviews, 
      profile.incomeTxns, 
      profile.accountSnapshots, 
      profile.homeCurrency || "CAD",
      reviewContext.incomeDepositReviews,
      rangeMonths,
      reviewContext.savingsConfirmedItems
    );
    
    // Compute gap reconciliation
    const gapReconciliation = computeGapReconciliation(
      range,
      profile.expenseTxns,
      profile.incomeTxns,
      profile.accountSnapshots,
      profile.accountBalanceHistory,
      profile.monthlyHistory,
      {
        income: breakdown.incomeAmount,
        fixed: breakdown.buckets.find(b => b.bucket === "fixed")?.monthlyAverage || 0,
        essentials: breakdown.buckets.find(b => b.bucket === "essentials")?.monthlyAverage || 0,
        flexible: breakdown.buckets.find(b => b.bucket === "flexible")?.monthlyAverage || 0,
        netSavings: breakdown.buckets.find(b => b.bucket === "savings")?.monthlyAverage || 0,
      }
    );

    return Response.json({
      ...breakdown,
      homeCurrency: profile.homeCurrency,
      gapReconciliation,
    });
  } catch (error) {
    console.error("Money coach error:", error);
    return Response.json(
      { error: "Failed to compute money coach breakdown" },
      { status: 500 }
    );
  }
}
