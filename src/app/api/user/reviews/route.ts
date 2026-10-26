import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { getFinancialProfile } from "@/lib/financialProfile";
import { getAllUnreviewedAnomalies } from "@/lib/debtPayments";
import type { ReviewItem, ReviewClassification, DebtPaymentReviewItem, SavingsReviewItem } from "@/lib/reviewTypes";

export const dynamic = "force-dynamic";

/**
 * GET /api/user/reviews?type=debt_payment|savings_item
 * Returns unreviewed items for the specified review type.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { auth, db } = getFirebaseAdmin();
    const decoded = await auth.verifyIdToken(token);
    const { searchParams } = new URL(req.url);
    const reviewType = searchParams.get("type") as "debt_payment" | "savings_item" | null;

    if (!reviewType || !["debt_payment", "savings_item"].includes(reviewType)) {
      return NextResponse.json({ error: "Invalid review type" }, { status: 400 });
    }

    const profile = await getFinancialProfile(decoded.uid, db);

    // Load existing reviews to filter out already-reviewed items
    const reviewsSnap = await db.collection(`users/${decoded.uid}/reviews`).get();
    const reviewedIds = new Set(reviewsSnap.docs.map(doc => doc.id));

    let items: ReviewItem[] = [];

    if (reviewType === "debt_payment") {
      // Get debt payment anomalies
      const anomalies = getAllUnreviewedAnomalies(
        profile.accountSnapshots,
        profile.debtPaymentHistory,
        [], // We'll filter by reviewedIds below
        profile.fxRates ?? {},
        profile.homeCurrency
      );

      items = anomalies
        .filter(a => !reviewedIds.has(a.txFingerprint))
        .map(a => ({
          id: a.txFingerprint,
          type: "debt_payment" as const,
          accountSlug: a.accountSlug,
          accountName: a.accountName,
          date: a.date,
          amount: a.amount,
          txMonth: a.txMonth,
          reason: a.reason,
          regularAmount: a.regularAmount,
        })) as DebtPaymentReviewItem[];
    } else if (reviewType === "savings_item") {
      // Get savings items needing confirmation
      // For now, return empty - savings confirmations will be wired later
      // TODO: Wire savings confirmations from computeMonthlySavings
      items = [];
    }

    return NextResponse.json({ items });
  } catch (error) {
    console.error("Reviews GET error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load reviews" },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/user/reviews
 * Saves a user's classification of a review item.
 */
export async function PUT(req: NextRequest): Promise<NextResponse> {
  try {
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { auth, db } = getFirebaseAdmin();
    const decoded = await auth.verifyIdToken(token);

    const body = await req.json();
    const { id, type, classification, accountSlug, date, amount } = body;

    if (!id || !type || !classification) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    if (!["debt_payment", "savings_item"].includes(type)) {
      return NextResponse.json({ error: "Invalid review type" }, { status: 400 });
    }

    // Save review to unified collection
    await db
      .collection(`users/${decoded.uid}/reviews`)
      .doc(id)
      .set({
        type,
        classification,
        accountSlug: accountSlug || null,
        date,
        amount,
        reviewedAt: new Date().toISOString(),
      });

    // For backward compatibility, also write to old debt payment reviews collection
    if (type === "debt_payment") {
      await db
        .collection(`users/${decoded.uid}/debtPaymentReviews`)
        .doc(id)
        .set({
          accountSlug,
          classification,
          date,
          amount,
          reviewedAt: new Date().toISOString(),
        });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Reviews PUT error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to save review" },
      { status: 500 }
    );
  }
}
