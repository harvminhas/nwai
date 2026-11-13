/**
 * GET /api/user/cash-flow-summary
 *
 * Thin adapter: auth → financial profile + the same review context the
 * dashboard money-coach route loads → {@link getMonthlyCashFlow} via
 * buildCashFlowSummary.
 * Read-only — does not write parsedData or any user financial record.
 */

import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { resolveAccess } from "@/lib/access/resolveAccess";
import { getFinancialProfile } from "@/lib/financialProfile";
import { loadUserReviewContext } from "@/lib/userReviewContext";
import { buildCashFlowSummary } from "@/lib/cashFlowSummary";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { db } = getFirebaseAdmin();
  const access = await resolveAccess(req, db);
  if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const profile = await getFinancialProfile(access.targetUid, db);
    const reviews = await loadUserReviewContext(access.targetUid, db);
    const summary = buildCashFlowSummary({
      expenseTxns: profile.expenseTxns,
      incomeTxns: profile.incomeTxns,
      homeCurrency: profile.homeCurrency,
      fxRates: profile.fxRates,
      accountSnapshots: profile.accountSnapshots,
      debtPaymentHistory: profile.debtPaymentHistory,
      userReviews: reviews.debtPaymentReviews,
      incomeDepositReviews: reviews.incomeDepositReviews,
    });
    return NextResponse.json(summary);
  } catch (error) {
    console.error("Cash flow summary error:", error);
    return NextResponse.json(
      { error: "Failed to load cash flow" },
      { status: 500 },
    );
  }
}
