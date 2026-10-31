/**
 * Tests for income merge review generation
 * Ensures masked personal transfers are not merged and group-level dismissals work
 */

import { describe, test, expect } from "vitest";
import { generateIncomeReviews } from "@/lib/incomeReviews";
import type { IncomeTxnRecord } from "@/lib/extractTransactions";

describe("generateIncomeReviews - merge suggestions", () => {
  test("should NOT merge e-transfer sources with masked tokens (different senders)", () => {
    const incomeTxns: IncomeTxnRecord[] = [
      {
        txMonth: "2026-10",
        date: "2026-10-15",
        source: "E-TRANSFER ***JXQ",
        category: "Income",
        amount: 100,
        accountSlug: "td-checking-1234",
        accountLabel: "TD Checking",
        currency: "CAD",
        description: "E-TRANSFER ***JXQ"
      },
      {
        txMonth: "2026-10",
        date: "2026-10-16",
        source: "E-TRANSFER ***y7A",
        category: "Income",
        amount: 200,
        accountSlug: "td-checking-1234",
        accountLabel: "TD Checking",
        currency: "CAD",
        description: "E-TRANSFER ***y7A"
      },
      {
        txMonth: "2026-10",
        date: "2026-10-17",
        source: "INTERAC E-TRANSFER ***ABC",
        category: "Income",
        amount: 150,
        accountSlug: "td-checking-1234",
        accountLabel: "TD Checking",
        currency: "CAD",
        description: "INTERAC E-TRANSFER ***ABC"
      }
    ];

    const reviewedIds = new Set<string>();
    const reviews = generateIncomeReviews(incomeTxns, reviewedIds);

    // Should NOT generate merge suggestions for these
    const mergeReviews = reviews.filter(r => r.suggestedCategory === "merge");
    expect(mergeReviews.length).toBe(0);
  });

  test("should merge legitimate similar sources (not masked transfers)", () => {
    const incomeTxns: IncomeTxnRecord[] = [
      {
        txMonth: "2026-10",
        date: "2026-10-15",
        source: "ACME CORP",
        category: "Income",
        amount: 3000,
        accountSlug: "td-checking-1234",
        accountLabel: "TD Checking",
        currency: "CAD",
        description: "ACME CORP"
      },
      {
        txMonth: "2026-10",
        date: "2026-10-16",
        source: "ACME CORPORATION",
        category: "Income",
        amount: 500,
        accountSlug: "td-checking-1234",
        accountLabel: "TD Checking",
        currency: "CAD",
        description: "ACME CORPORATION"
      }
    ];

    const reviewedIds = new Set<string>();
    const reviews = generateIncomeReviews(incomeTxns, reviewedIds);

    // Should generate ONE merge suggestion for the group
    const mergeReviews = reviews.filter(r => r.suggestedCategory === "merge");
    expect(mergeReviews.length).toBe(1);
    expect(mergeReviews[0].source).toContain("→");
  });

  test("should generate ONE review per group (group-level dismissal)", () => {
    const incomeTxns: IncomeTxnRecord[] = [
      {
        txMonth: "2026-10",
        date: "2026-10-15",
        source: "ABC Company",
        category: "Income",
        amount: 1000,
        accountSlug: "td-checking-1234",
        accountLabel: "TD Checking",
        currency: "CAD",
        description: "ABC Company"
      },
      {
        txMonth: "2026-10",
        date: "2026-10-16",
        source: "ABC Corp",
        category: "Income",
        amount: 1000,
        accountSlug: "td-checking-1234",
        accountLabel: "TD Checking",
        currency: "CAD",
        description: "ABC Corp"
      },
      {
        txMonth: "2026-10",
        date: "2026-10-17",
        source: "ABC Inc",
        category: "Income",
        amount: 1000,
        accountSlug: "td-checking-1234",
        accountLabel: "TD Checking",
        currency: "CAD",
        description: "ABC Inc"
      }
    ];

    const reviewedIds = new Set<string>();
    const reviews = generateIncomeReviews(incomeTxns, reviewedIds);

    // Should generate exactly ONE merge review for the entire group
    const mergeReviews = reviews.filter(r => r.suggestedCategory === "merge");
    expect(mergeReviews.length).toBe(1);
    
    // Review ID should be group-based (contains "group")
    expect(mergeReviews[0].id).toContain("income_merge_group_");
  });

  test("should suppress entire group when group review is dismissed", () => {
    const incomeTxns: IncomeTxnRecord[] = [
      {
        txMonth: "2026-10",
        date: "2026-10-15",
        source: "XYZ Company",
        category: "Income",
        amount: 2000,
        accountSlug: "td-checking-1234",
        accountLabel: "TD Checking",
        currency: "CAD",
        description: "XYZ Company"
      },
      {
        txMonth: "2026-10",
        date: "2026-10-16",
        source: "XYZ Corp",
        category: "Income",
        amount: 2000,
        accountSlug: "td-checking-1234",
        accountLabel: "TD Checking",
        currency: "CAD",
        description: "XYZ Corp"
      }
    ];

    // First call: get the review
    const reviewedIds1 = new Set<string>();
    const reviews1 = generateIncomeReviews(incomeTxns, reviewedIds1);
    expect(reviews1.filter(r => r.suggestedCategory === "merge").length).toBe(1);
    
    // Simulate dismissing the group review
    const groupReviewId = reviews1.find(r => r.suggestedCategory === "merge")!.id;
    const reviewedIds2 = new Set<string>([groupReviewId]);
    
    // Second call: should return NO merge reviews (entire group suppressed)
    const reviews2 = generateIncomeReviews(incomeTxns, reviewedIds2);
    expect(reviews2.filter(r => r.suggestedCategory === "merge").length).toBe(0);
  });
});
