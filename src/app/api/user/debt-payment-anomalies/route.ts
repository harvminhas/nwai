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

    // Load user debt payment reviews from BOTH collections (unified + legacy)
    // 1. New unified reviews collection
    const unifiedReviewsSnap = await db
      .collection(`users/${decoded.uid}/reviews`)
      .where("type", "==", "debt_payment")
      .get();
    
    // 2. Old debtPaymentReviews collection (for backward compatibility)
    const legacyReviewsSnap = await db
      .collection(`users/${decoded.uid}/debtPaymentReviews`)
      .get();
    
    // Combine both sources, using unified as source of truth
    const reviewedIds = new Set<string>();
    const userReviews: DebtPaymentReview[] = [];
    
    // Add from unified collection first
    unifiedReviewsSnap.docs.forEach(doc => {
      reviewedIds.add(doc.id);
      userReviews.push({
        txFingerprint: doc.id,
        accountSlug: doc.get("accountSlug"),
        classification: doc.get("classification"),
        date: doc.get("date"),
        amount: doc.get("amount"),
        reviewedAt: doc.get("reviewedAt"),
      });
    });
    
    // Add from legacy collection only if not already in unified
    legacyReviewsSnap.docs.forEach(doc => {
      if (!reviewedIds.has(doc.id)) {
        userReviews.push({
          txFingerprint: doc.id,
          accountSlug: doc.get("accountSlug"),
          classification: doc.get("classification"),
          date: doc.get("date"),
          amount: doc.get("amount"),
          reviewedAt: doc.get("reviewedAt"),
        });
      }
    });

    const profile = await getFinancialProfile(decoded.uid, db);
    const anomalies = getAllUnreviewedAnomalies(
      profile.accountSnapshots,
      profile.debtPaymentHistory,
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
