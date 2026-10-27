import { NextRequest } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { getFinancialProfile } from "@/lib/financialProfile";
import { computeMoneyCoachBreakdown } from "@/lib/moneyCoach";
import type { DebtPaymentReview } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/user/money-coach
 * Returns money coach breakdown: Fixed, Essentials, Discretionary, Savings buckets
 * with median monthly amounts, % of income, and plain-language advice.
 */
export async function GET(req: NextRequest) {
  try {
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { auth, db } = getFirebaseAdmin();
    const decoded = await auth.verifyIdToken(token);

    const profile = await getFinancialProfile(decoded.uid, db);

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

    // Load income deposit reviews
    const incomeReviewsSnap = await db
      .collection(`users/${decoded.uid}/reviews`)
      .where("type", "==", "income_deposit")
      .get();
    const incomeDepositReviews = new Map<string, string>();
    incomeReviewsSnap.docs.forEach(doc => {
      incomeDepositReviews.set(doc.id, doc.get("classification"));
    });

    const breakdown = computeMoneyCoachBreakdown(
      profile, 
      userReviews, 
      profile.incomeTxns, 
      profile.accountSnapshots, 
      profile.homeCurrency || "CAD",
      incomeDepositReviews
    );

    return Response.json({
      ...breakdown,
      homeCurrency: profile.homeCurrency,
    });
  } catch (error) {
    console.error("Money coach error:", error);
    return Response.json(
      { error: "Failed to compute money coach breakdown" },
      { status: 500 }
    );
  }
}
