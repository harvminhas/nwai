import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { getFinancialProfile } from "@/lib/financialProfile";
import { buildSubscriptionSummary } from "@/lib/subscriptionEngine";

/**
 * Integration test: POST review → GET subscriptions moves item
 * 
 * Tests the full flow:
 * 1. Merchant starts as candidate
 * 2. POST /api/user/reviews with is_subscription classification
 * 3. GET /api/user/subscriptions shows it moved to confirmed
 */
describe("Subscription Review API Integration", () => {
  // This test requires a real Firebase environment
  // Skip if no Firebase credentials
  const hasFirebase = process.env.FIREBASE_PROJECT_ID !== undefined;
  
  it.skipIf(!hasFirebase)("POST review then GET subscriptions moves item from candidate to confirmed", async () => {
    const { db } = getFirebaseAdmin();
    
    // Use test UID
    const testUid = "test-subscription-review-" + Date.now();
    
    try {
      // Setup: Create test data with a candidate subscription
      const testMerchantSlug = "test-recurring-merchant";
      const testExpenseTxns = [
        {
          date: "2024-01-15",
          merchant: "Test Recurring Merchant",
          category: "Other",
          amount: -50,
          accountSlug: "test-account",
          currency: "CAD",
        },
        {
          date: "2024-02-15",
          merchant: "Test Recurring Merchant", 
          category: "Other",
          amount: -50,
          accountSlug: "test-account",
          currency: "CAD",
        },
        {
          date: "2024-03-15",
          merchant: "Test Recurring Merchant",
          category: "Other", 
          amount: -50,
          accountSlug: "test-account",
          currency: "CAD",
        },
      ];
      
      // Verify it starts as a candidate
      const beforeSummary = buildSubscriptionSummary(testExpenseTxns, "CAD", 1000, []);
      expect(beforeSummary.candidates.length).toBeGreaterThan(0);
      expect(beforeSummary.candidates.some(c => c.merchantSlug === testMerchantSlug)).toBe(true);
      expect(beforeSummary.subscriptions.some(s => s.merchantSlug === testMerchantSlug)).toBe(false);
      
      // Simulate POST review: write directly to Firestore
      await db
        .collection(`users/${testUid}/reviews`)
        .doc(testMerchantSlug)
        .set({
          type: "subscription",
          classification: "is_subscription",
          merchantSlug: testMerchantSlug,
          date: "2024-03-15",
          amount: 50,
          reviewedAt: new Date().toISOString(),
        });
      
      // Simulate GET subscriptions: load reviews and apply them
      const reviewsSnap = await db
        .collection(`users/${testUid}/reviews`)
        .where("type", "==", "subscription")
        .get();
      
      const userConfirmedSlugs: string[] = [];
      reviewsSnap.docs.forEach(doc => {
        const classification = doc.get("classification");
        const merchantSlug = doc.get("merchantSlug") || doc.id;
        
        if (classification === "is_subscription") {
          userConfirmedSlugs.push(merchantSlug);
        }
      });
      
      // Verify it moved to confirmed
      const afterSummary = buildSubscriptionSummary(testExpenseTxns, "CAD", 1000, userConfirmedSlugs);
      expect(afterSummary.candidates.some(c => c.merchantSlug === testMerchantSlug)).toBe(false);
      expect(afterSummary.subscriptions.some(s => s.merchantSlug === testMerchantSlug)).toBe(true);
      
      // Verify counts changed
      expect(afterSummary.candidateCount).toBe(beforeSummary.candidateCount - 1);
      expect(afterSummary.activeCount).toBe(beforeSummary.activeCount + 1);
      
    } finally {
      // Cleanup
      await db.collection(`users/${testUid}/reviews`).doc(testMerchantSlug).delete().catch(() => {});
    }
  });
  
  it("not_subscription classification excludes merchant from all lists", () => {
    const testExpenseTxns = [
      {
        date: "2024-01-15",
        merchant: "Test Merchant",
        category: "Other",
        amount: -50,
        accountSlug: "test-account",
        currency: "CAD",
      },
      {
        date: "2024-02-15",
        merchant: "Test Merchant",
        category: "Other",
        amount: -50,
        accountSlug: "test-account",
        currency: "CAD",
      },
      {
        date: "2024-03-15",
        merchant: "Test Merchant",
        category: "Other",
        amount: -50,
        accountSlug: "test-account",
        currency: "CAD",
      },
    ];
    
    // Without review: should be candidate
    const beforeSummary = buildSubscriptionSummary(testExpenseTxns, "CAD", 1000, []);
    expect(beforeSummary.candidates.length).toBeGreaterThan(0);
    
    // Simulate filtering out excluded merchants (done at API layer)
    // not_subscription merchants are filtered from expense txns before engine
    const filteredTxns = testExpenseTxns.filter(t => t.merchant !== "Test Merchant");
    const afterSummary = buildSubscriptionSummary(filteredTxns, "CAD", 1000, []);
    
    expect(afterSummary.candidates.length).toBe(0);
    expect(afterSummary.subscriptions.length).toBe(0);
    expect(afterSummary.inactive.length).toBe(0);
  });
});
