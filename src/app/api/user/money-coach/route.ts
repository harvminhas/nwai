import { NextRequest } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { getFinancialProfile } from "@/lib/financialProfile";
import { loadUserReviewContext } from "@/lib/userReviewContext";
import { computeMoneyCoachBreakdown } from "@/lib/moneyCoach";
import { resolveWindowMonths, type TimeRange } from "@/lib/rangeUtils";
import { getCompletenessDebugInfo } from "@/lib/completenessDebug";

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
    
    // Get range parameter and debug flag
    const url = new URL(req.url);
    const rangeParam = url.searchParams.get("range") as TimeRange | null;
    const debugCompleteness = url.searchParams.get("debugCompleteness") === "1";
    const isValidMonth = rangeParam?.startsWith("month:") && rangeParam.length > 6;
    const range: TimeRange = rangeParam && (["3mo", "12mo", "ytd"].includes(rangeParam) || isValidMonth)
      ? rangeParam as TimeRange
      : "3mo";

    const { auth, db } = getFirebaseAdmin();
    const decoded = await auth.verifyIdToken(token);

    const profile = await getFinancialProfile(decoded.uid, db);
    
    // If debug mode, return diagnostic info instead of normal response
    if (debugCompleteness) {
      const debugInfo = getCompletenessDebugInfo(profile.statementHistory);
      return Response.json({ 
        debug: true,
        accounts: debugInfo,
        totalAccounts: debugInfo.length,
        monthlyHistory: profile.monthlyHistory.map(m => m.yearMonth),
      });
    }
    
    // Use shared window resolution helper with statement history for completeness check
    // Pass account status map to exclude paid-off/closed accounts from completeness checks
    const accountStatusMap = new Map(
      profile.accountStatusRecords.map(r => [r.accountSlug, { status: r.status, statusDate: r.statusDate }])
    );
    const windowResult = resolveWindowMonths(range, profile.monthlyHistory, profile.statementHistory, accountStatusMap);

    // Load all user review context (income, debt, savings)
    const reviewContext = await loadUserReviewContext(decoded.uid, db);

    const breakdown = computeMoneyCoachBreakdown(
      profile, 
      reviewContext.debtPaymentReviews, 
      profile.incomeTxns, 
      profile.accountSnapshots, 
      profile.homeCurrency || "CAD",
      reviewContext.incomeDepositReviews,
      windowResult.months,
    );

    return Response.json({
      ...breakdown,
      homeCurrency: profile.homeCurrency,
      window: {
        actualMonthsUsed: windowResult.actualCount,
        requestedMonths: windowResult.requestedCount,
        note: windowResult.note,
        anchorMonth: windowResult.anchorMonth,
        missingMonths: windowResult.missingMonths,
        missingAccounts: windowResult.missingAccounts,
        months: windowResult.months,
        statementHistory: profile.statementHistory, // For month dropdown completeness check
        accountStatusRecords: profile.accountStatusRecords, // For excluding paid-off/closed accounts
      },
    });
  } catch (error) {
    console.error("Money coach error:", error);
    return Response.json(
      { error: "Failed to compute money coach breakdown" },
      { status: 500 }
    );
  }
}
