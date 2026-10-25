import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { getFinancialProfile } from "@/lib/financialProfile";
import { getAllUnreviewedAnomalies } from "@/lib/debtPayments";
import type { DebtPaymentReview } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/user/debt-payment-anomalies
 * Returns list of unreviewed debt payment anomalies for the review workflow.
 */
export async function GET(req: NextRequest) {
  try {
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { auth, db } = getFirebaseAdmin();
    const decoded = await auth.verifyIdToken(token);

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

    const profile = await getFinancialProfile(decoded.uid, db);
    const anomalies = getAllUnreviewedAnomalies(
      profile.accountSnapshots,
      profile.expenseTxns,
      userReviews,
      profile.fxRates ?? {},
      profile.homeCurrency
    );

    return NextResponse.json({ anomalies });
  } catch (error) {
    console.error("Debt payment anomalies error:", error);
    return NextResponse.json(
      { error: "Failed to load debt payment anomalies" },
      { status: 500 }
    );
  }
}
