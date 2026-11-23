/**
 * GET /api/user/daily-spend?range=3m
 *
 * Thin adapter: auth → financial profile + the same review context Spending
 * uses → {@link buildDailySpend}. Read-only — does not write parsedData or
 * any user financial record.
 */

import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { resolveAccess } from "@/lib/access/resolveAccess";
import { getFinancialProfile } from "@/lib/financialProfile";
import { loadUserReviewContext } from "@/lib/userReviewContext";
import { buildDailySpend, parseDailySpendRange } from "@/lib/dailySpend";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { db } = getFirebaseAdmin();
  const access = await resolveAccess(req, db);
  if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const range = parseDailySpendRange(new URL(req.url).searchParams.get("range"));
    const profile = await getFinancialProfile(access.targetUid, db);
    const reviews = await loadUserReviewContext(access.targetUid, db);
    const result = buildDailySpend({
      expenseTxns: profile.expenseTxns,
      accountSnapshots: profile.accountSnapshots,
      debtPaymentHistory: profile.debtPaymentHistory,
      userReviews: reviews.debtPaymentReviews,
      fxRates: profile.fxRates || {},
      currency: profile.homeCurrency,
      range,
    });
    return NextResponse.json(result);
  } catch (error) {
    console.error("Daily spend error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load daily spend" },
      { status: 500 },
    );
  }
}
