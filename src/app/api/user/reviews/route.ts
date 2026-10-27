import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { getFinancialProfile } from "@/lib/financialProfile";
import { getAllUnreviewedAnomalies } from "@/lib/debtPayments";
import { generateIncomeReviews } from "@/lib/incomeReviews";
import { generateSavingsReviews } from "@/lib/savingsReviews";
import { buildSubscriptionSummary } from "@/lib/subscriptionEngine";
import { buildIncomeSummary } from "@/lib/incomeSummary";
import type { ReviewItem, ReviewClassification, DebtPaymentReviewItem, SavingsReviewItem, IncomeClassificationReviewItem, SubscriptionReviewItem, IncomeDepositReviewItem } from "@/lib/reviewTypes";

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
    const reviewType = searchParams.get("type") as "debt_payment" | "savings_item" | "income_classification" | "subscription" | "income_deposit" | null;

    if (!reviewType || !["debt_payment", "savings_item", "income_classification", "subscription", "income_deposit"].includes(reviewType)) {
      return NextResponse.json({ error: "Invalid review type" }, { status: 400 });
    }

    const profile = await getFinancialProfile(decoded.uid, db);

    // Load existing reviews to filter out already-reviewed items
    const reviewsSnap = await db.collection(`users/${decoded.uid}/reviews`).get();
    const reviewedIds = new Set(reviewsSnap.docs.map(doc => doc.id));

    let items: ReviewItem[] = [];

    if (reviewType === "debt_payment") {
      // Load existing debt payment reviews from BOTH collections (unified + legacy)
      const unifiedDebtReviewsSnap = await db
        .collection(`users/${decoded.uid}/reviews`)
        .where("type", "==", "debt_payment")
        .get();
      
      const legacyDebtReviewsSnap = await db
        .collection(`users/${decoded.uid}/debtPaymentReviews`)
        .get();
      
      // Build userReviews array (same format as debt-payment-anomalies route)
      const debtReviewedIds = new Set<string>();
      const userReviews: any[] = [];
      
      // Add from unified collection first
      unifiedDebtReviewsSnap.docs.forEach(doc => {
        debtReviewedIds.add(doc.id);
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
      legacyDebtReviewsSnap.docs.forEach(doc => {
        if (!debtReviewedIds.has(doc.id)) {
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
      
      // Get debt payment anomalies WITH proper review filtering
      const anomalies = getAllUnreviewedAnomalies(
        profile.accountSnapshots,
        profile.debtPaymentHistory,
        userReviews, // Pass actual reviews, not empty array
        profile.fxRates ?? {},
        profile.homeCurrency
      );

      items = anomalies.map(a => ({
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
      const savingsReviews = generateSavingsReviews(profile, reviewedIds);
      items = savingsReviews as SavingsReviewItem[];
    } else if (reviewType === "income_classification") {
      // Get income items needing classification
      const incomeReviews = generateIncomeReviews(
        profile.incomeTxns,
        reviewedIds
      );
      items = incomeReviews as IncomeClassificationReviewItem[];
    } else if (reviewType === "income_deposit") {
      // Get unusual income deposits needing review
      const incomeSummary = buildIncomeSummary(
        profile.incomeTxns,
        profile.accountSnapshots,
        profile.homeCurrency
      );
      
      items = incomeSummary.unreviewedDeposits
        .filter(d => !reviewedIds.has(d.txId))
        .map(d => ({
          id: d.txId,
          type: "income_deposit" as const,
          source: d.source,
          date: d.date,
          amount: d.amount,
          usualAmount: d.usualAmount,
          txMonth: d.date.slice(0, 7),
          reason: (d.reason || "unusual_amount") as "unusual_amount" | "large_refund"
        })) as IncomeDepositReviewItem[];
    } else if (reviewType === "subscription") {
      // Get subscription candidates needing confirmation
      const subSummary = buildSubscriptionSummary(
        profile.expenseTxns,
        profile.homeCurrency,
        undefined,
        [] // Don't pass confirmed slugs yet, we want candidates
      );
      
      items = subSummary.candidates
        .filter(c => !reviewedIds.has(c.merchantSlug))
        .map(c => ({
          id: c.merchantSlug,
          type: "subscription" as const,
          merchant: c.merchant,
          merchantSlug: c.merchantSlug,
          category: c.category,
          cadence: c.cadence,
          chargeCount: c.chargeCount,
          date: c.lastDate,
          amount: c.amount,
          txMonth: c.lastDate.slice(0, 7), // YYYY-MM
        })) as SubscriptionReviewItem[];
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
    const { id, type, classification, accountSlug, merchantSlug, date, amount, billingFrequency } = body;

    if (!id || !type || !classification) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    if (!["debt_payment", "savings_item", "income_classification", "subscription", "income_deposit"].includes(type)) {
      return NextResponse.json({ error: "Invalid review type" }, { status: 400 });
    }

    // Save review to unified collection
    const reviewData: any = {
      type,
      classification,
      accountSlug: accountSlug || null,
      merchantSlug: merchantSlug || null,
      date,
      amount,
      reviewedAt: new Date().toISOString(),
    };
    
    // Add billingFrequency if provided (for subscriptions)
    if (billingFrequency && type === "subscription") {
      reviewData.billingFrequency = billingFrequency;
    }
    
    await db
      .collection(`users/${decoded.uid}/reviews`)
      .doc(id)
      .set(reviewData);

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

/**
 * DELETE /api/user/reviews?id=xxx
 * Deletes a review (for undo functionality)
 */
export async function DELETE(req: NextRequest): Promise<NextResponse> {
  try {
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { auth, db } = getFirebaseAdmin();
    const decoded = await auth.verifyIdToken(token);

    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "Missing review ID" }, { status: 400 });
    }

    // Delete from reviews collection
    await db
      .collection(`users/${decoded.uid}/reviews`)
      .doc(id)
      .delete();

    // Also delete from old debt payment reviews if it exists
    await db
      .collection(`users/${decoded.uid}/debtPaymentReviews`)
      .doc(id)
      .delete()
      .catch(() => {}); // Ignore if doesn't exist

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Reviews DELETE error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to delete review" },
      { status: 500 }
    );
  }
}
