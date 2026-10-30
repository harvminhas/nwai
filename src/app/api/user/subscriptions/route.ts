import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { getFinancialProfile } from "@/lib/financialProfile";
import { buildSubscriptionSummary } from "@/lib/subscriptionEngine";
import { buildSpendingSummary } from "@/lib/spendingSummary";
import { synthesizeSubscriptions } from "@/lib/subscriptionSynthesis";
import type { DetectedSubscription } from "@/lib/subscriptionEngine";
import { findMergeSuggestions } from "@/lib/merchantSimilarity";
import { postProcessSubscriptions } from "@/lib/subscriptionPostProcessing";

export const dynamic = "force-dynamic";

/**
 * GET /api/user/subscriptions
 * Returns detected subscriptions with price changes and new subs
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { auth, db } = getFirebaseAdmin();
    const decoded = await auth.verifyIdToken(token);

    const profile = await getFinancialProfile(decoded.uid, db);
    
    // Load user debt payment reviews (needed for spending summary)
    const reviewsSnap = await db.collection(`users/${decoded.uid}/debtPaymentReviews`).get();
    const userReviews = reviewsSnap.docs.map((doc) => ({
      txFingerprint: doc.id,
      accountSlug: doc.get("accountSlug"),
      classification: doc.get("classification"),
      date: doc.get("date"),
      amount: doc.get("amount"),
      reviewedAt: doc.get("reviewedAt"),
    }));
    
    // Load user subscription reviews
    const subReviewsSnap = await db
      .collection(`users/${decoded.uid}/reviews`)
      .where("type", "==", "subscription")
      .get();
    
    // Process reviews: build sets for different actions and billing frequency overrides
    const userConfirmedSlugs: string[] = [];
    const excludedSlugs = new Set<string>();
    const stillActiveSlugs = new Set<string>();
    const cancelledSlugs = new Set<string>();
    const billingFrequencyOverrides = new Map<string, import("@/lib/reviewTypes").BillingFrequency>();
    
    subReviewsSnap.docs.forEach(doc => {
      const classification = doc.get("classification");
      const merchantSlug = doc.get("merchantSlug") || doc.id;
      const billingFrequency = doc.get("billingFrequency");
      
      if (classification === "is_subscription") {
        userConfirmedSlugs.push(merchantSlug);
      } else if (classification === "not_subscription") {
        excludedSlugs.add(merchantSlug);
      } else if (classification === "still_active") {
        userConfirmedSlugs.push(merchantSlug); // Treat as confirmed
        stillActiveSlugs.add(merchantSlug);
      } else if (classification === "cancelled") {
        cancelledSlugs.add(merchantSlug);
      }
      
      // Store billing frequency override if present
      if (billingFrequency) {
        billingFrequencyOverrides.set(merchantSlug, billingFrequency);
      }
    });
    
    // Filter out excluded merchants from expense transactions before passing to engine
    const filteredExpenseTxns = profile.expenseTxns.filter(txn => {
      const slug = require("@/lib/applyRules").merchantSlug(txn.merchant);
      return !excludedSlugs.has(slug);
    });
    
    // Get total spending for sanity check
    const spendingSummary = buildSpendingSummary(
      profile.expenseTxns,
      profile.accountSnapshots,
      profile.debtPaymentHistory,
      userReviews,
      profile.fxRates || {},
      profile.homeCurrency
    );
    
    const summary = buildSubscriptionSummary(
      filteredExpenseTxns, // Use filtered transactions (excluded merchants removed)
      profile.homeCurrency,
      spendingSummary.typicalMonthly,
      userConfirmedSlugs,
      billingFrequencyOverrides
    );
    
    // Synthesize subscriptions for manually marked merchants not detected by engine
    const allDetectedSlugs = new Set([
      ...summary.subscriptions.map(s => s.merchantSlug),
      ...summary.candidates.map(s => s.merchantSlug),
      ...summary.inactive.map(s => s.merchantSlug),
    ]);
    
    const synthesizedSubs = synthesizeSubscriptions(
      userConfirmedSlugs,
      allDetectedSlugs,
      profile.expenseTxns,
      billingFrequencyOverrides
    );
    
    // Load confirmed source mappings to collapse aliases
    const mappingsSnap = await db.collection(`users/${decoded.uid}/sourceMappings`).get();
    const sourceMappings = mappingsSnap.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    } as import("@/lib/sourceMappings").SourceMapping));
    
    // Get latest transaction date from user's data
    const latestTxnDate = profile.expenseTxns.length > 0
      ? profile.expenseTxns.reduce((latest, txn) => txn.date > latest ? txn.date : latest, profile.expenseTxns[0].date)
      : new Date().toISOString().slice(0, 10);
    
    // Post-process subscriptions using shared function
    // Product decision: ALL confirmed subscriptions stay active regardless of staleness
    const { confirmedActive, inactive: finalInactive } = 
      postProcessSubscriptions(summary, cancelledSlugs, synthesizedSubs, latestTxnDate, sourceMappings);
    
    // Recalculate totals including synthesized subs
    let adjustedMonthlyTotal = summary.monthlyTotal;
    let adjustedYearlyTotal = summary.yearlyTotal;
    
    synthesizedSubs.forEach(sub => {
      const frequency = sub.billingFrequency;
      if (frequency === "weekly") {
        adjustedMonthlyTotal += (sub.amount * 52) / 12;
        adjustedYearlyTotal += sub.amount * 52;
      } else if (frequency === "monthly" || (!frequency && sub.cadence === "monthly")) {
        adjustedMonthlyTotal += sub.amount;
        adjustedYearlyTotal += sub.amount * 12;
      } else if (frequency === "quarterly") {
        adjustedMonthlyTotal += (sub.amount * 4) / 12;
        adjustedYearlyTotal += sub.amount * 4;
      } else if (frequency === "yearly" || (!frequency && sub.cadence === "yearly")) {
        adjustedMonthlyTotal += sub.amount / 12;
        adjustedYearlyTotal += sub.amount;
      }
    });

    // Find merge suggestion groups over ALL detected subscriptions (active, candidates, inactive)
    // This catches split variants wherever they show up
    const allDetected = [
      ...confirmedActive,
      ...summary.candidates,
      ...finalInactive,
    ];
    const allMergeSuggestions = findMergeSuggestions(allDetected);
    
    // Exclude already-merged pairs from suggestions
    const confirmedMappings = sourceMappings.filter(m => m.status === "confirmed");
    const mergedNames = new Set<string>();
    confirmedMappings.forEach(m => {
      mergedNames.add(m.canonical.toLowerCase());
      mergedNames.add(m.alias.toLowerCase());
    });
    
    const mergeSuggestions = allMergeSuggestions.filter(group => {
      // Only show suggestion if NOT all members are already merged to the same canonical
      const canonicals = new Set(group.map(s => {
        const { resolveCanonical } = require("@/lib/sourceMappings");
        return resolveCanonical(s.merchant, sourceMappings).toLowerCase();
      }));
      return canonicals.size > 1; // Keep if members resolve to different canonicals
    });
    
    return NextResponse.json({
      ...summary,
      subscriptions: confirmedActive,
      inactive: finalInactive,
      cancelled: finalInactive.filter(s => cancelledSlugs.has(s.merchantSlug)),
      monthlyTotal: adjustedMonthlyTotal,
      yearlyTotal: adjustedYearlyTotal,
      activeCount: confirmedActive.length,
      mergeSuggestions,
    });
  } catch (error) {
    console.error("Subscriptions error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load subscriptions" },
      { status: 500 }
    );
  }
}
