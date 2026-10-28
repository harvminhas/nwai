import { describe, it, expect } from "vitest";
import { buildSubscriptionSummary } from "../subscriptionEngine";
import type { ExpenseTxnRecord } from "../extractTransactions";

describe("subscriptionEngine", () => {
  const createTxn = (
    merchant: string,
    category: string,
    amount: number,
    date: string
  ): ExpenseTxnRecord => ({
    date,
    txMonth: date.slice(0, 7), // YYYY-MM
    merchant,
    category,
    amount: -Math.abs(amount), // expenses are negative
    accountSlug: "test-account",
    accountLabel: "Test Account",
    currency: "CAD",
  });

  describe("Hard exclusions", () => {
    it("should exclude Interest category", () => {
      const txns: ExpenseTxnRecord[] = [
        createTxn("INTEREST", "Interest", 50, "2024-01-15"),
        createTxn("INTEREST", "Interest", 50, "2024-02-15"),
        createTxn("INTEREST", "Interest", 50, "2024-03-15"),
      ];

      const summary = buildSubscriptionSummary(txns, "CAD");
      
      expect(summary.subscriptions).toHaveLength(0);
      expect(summary.candidates).toHaveLength(0);
      expect(summary.inactive).toHaveLength(0);
    });

    it("should exclude Fees category", () => {
      const txns: ExpenseTxnRecord[] = [
        createTxn("MONTHLY FEE", "Fees", 15, "2024-01-01"),
        createTxn("MONTHLY FEE", "Fees", 15, "2024-02-01"),
        createTxn("MONTHLY FEE", "Fees", 15, "2024-03-01"),
      ];

      const summary = buildSubscriptionSummary(txns, "CAD");
      
      expect(summary.subscriptions).toHaveLength(0);
      expect(summary.candidates).toHaveLength(0);
    });

    it("should exclude Debt Payments category", () => {
      const txns: ExpenseTxnRecord[] = [
        createTxn("VISA PAYMENT", "Debt Payments", 500, "2024-01-01"),
        createTxn("VISA PAYMENT", "Debt Payments", 500, "2024-02-01"),
        createTxn("VISA PAYMENT", "Debt Payments", 500, "2024-03-01"),
      ];

      const summary = buildSubscriptionSummary(txns, "CAD");
      
      expect(summary.subscriptions).toHaveLength(0);
      expect(summary.candidates).toHaveLength(0);
    });

    it("should exclude Transfers category", () => {
      const txns: ExpenseTxnRecord[] = [
        createTxn("E-TRANSFER", "Transfers", 100, "2024-01-15"),
        createTxn("E-TRANSFER", "Transfers", 100, "2024-02-15"),
        createTxn("E-TRANSFER", "Transfers", 100, "2024-03-15"),
      ];

      const summary = buildSubscriptionSummary(txns, "CAD");
      
      expect(summary.subscriptions).toHaveLength(0);
      expect(summary.candidates).toHaveLength(0);
    });

    it("should exclude person names (e-transfers)", () => {
      const txns: ExpenseTxnRecord[] = [
        createTxn("MRS SANDEEP KAUR MINHAS", "Transfers", 1000, "2024-01-01"),
        createTxn("MRS SANDEEP KAUR MINHAS", "Transfers", 1000, "2024-02-01"),
        createTxn("MRS SANDEEP KAUR MINHAS", "Transfers", 1000, "2024-03-01"),
      ];

      const summary = buildSubscriptionSummary(txns, "CAD");
      
      expect(summary.subscriptions).toHaveLength(0);
      expect(summary.candidates).toHaveLength(0);
    });

    it("should exclude utilities", () => {
      const txns: ExpenseTxnRecord[] = [
        createTxn("HYDRO ONE", "Housing", 150, "2024-01-15"),
        createTxn("HYDRO ONE", "Housing", 150, "2024-02-15"),
        createTxn("HYDRO ONE", "Housing", 150, "2024-03-15"),
      ];

      const summary = buildSubscriptionSummary(txns, "CAD");
      
      expect(summary.subscriptions).toHaveLength(0);
      expect(summary.candidates).toHaveLength(0);
    });

    it("should exclude insurance", () => {
      const txns: ExpenseTxnRecord[] = [
        createTxn("TD INSURANCE", "Insurance", 200, "2024-01-01"),
        createTxn("TD INSURANCE", "Insurance", 200, "2024-02-01"),
        createTxn("TD INSURANCE", "Insurance", 200, "2024-03-01"),
      ];

      const summary = buildSubscriptionSummary(txns, "CAD");
      
      expect(summary.subscriptions).toHaveLength(0);
      expect(summary.candidates).toHaveLength(0);
    });
  });

  describe("Known subscription merchants", () => {
    it("should detect Netflix as confirmed subscription", () => {
      const now = new Date();
      const txns: ExpenseTxnRecord[] = [
        createTxn("NETFLIX", "Subscriptions", 16.99, new Date(now.getFullYear(), now.getMonth() - 2, 15).toISOString()),
        createTxn("NETFLIX", "Subscriptions", 16.99, new Date(now.getFullYear(), now.getMonth() - 1, 15).toISOString()),
        createTxn("NETFLIX", "Subscriptions", 16.99, new Date(now.getFullYear(), now.getMonth(), 15).toISOString()),
      ];

      const summary = buildSubscriptionSummary(txns, "CAD");
      
      expect(summary.subscriptions).toHaveLength(1);
      expect(summary.subscriptions[0].merchant).toBe("NETFLIX");
      expect(summary.subscriptions[0].tier).toBe("confirmed");
      expect(summary.subscriptions[0].status).toBe("active");
      expect(summary.subscriptions[0].cadence).toBe("monthly");
      expect(summary.activeCount).toBe(1);
      expect(summary.monthlyTotal).toBeCloseTo(16.99, 2);
    });

    it("should detect Spotify as confirmed subscription", () => {
      const now = new Date();
      const txns: ExpenseTxnRecord[] = [
        createTxn("SPOTIFY", "Subscriptions", 10.99, new Date(now.getFullYear(), now.getMonth() - 2, 1).toISOString()),
        createTxn("SPOTIFY", "Subscriptions", 10.99, new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString()),
        createTxn("SPOTIFY", "Subscriptions", 10.99, new Date(now.getFullYear(), now.getMonth(), 1).toISOString()),
      ];

      const summary = buildSubscriptionSummary(txns, "CAD");
      
      expect(summary.subscriptions).toHaveLength(1);
      expect(summary.subscriptions[0].tier).toBe("confirmed");
      expect(summary.subscriptions[0].status).toBe("active");
    });

    it.skip("should detect yearly subscription (Adobe)", () => {
      // Create charges exactly 365 days apart, most recent within last 6 months
      const recent = new Date();
      recent.setMonth(recent.getMonth() - 3); // 3 months ago
      const oneYearBefore = new Date(recent);
      oneYearBefore.setFullYear(oneYearBefore.getFullYear() - 1);
      
      const txns: ExpenseTxnRecord[] = [
        createTxn("ADOBE CREATIVE", "Subscriptions", 240, oneYearBefore.toISOString().split('T')[0]),
        createTxn("ADOBE CREATIVE", "Subscriptions", 240, recent.toISOString().split('T')[0]),
      ];

      const summary = buildSubscriptionSummary(txns, "CAD");
      
      // Should be detected as yearly and active (within 400 days)
      expect(summary.subscriptions).toHaveLength(1);
      expect(summary.subscriptions[0].cadence).toBe("yearly");
      expect(summary.subscriptions[0].tier).toBe("confirmed");
      expect(summary.subscriptions[0].status).toBe("active");
      expect(summary.yearlyTotal).toBeCloseTo(240, 2);
      expect(summary.monthlyTotal).toBeCloseTo(20, 2);
    });
  });

  describe("Candidates (unknown recurring)", () => {
    it("should mark unknown recurring merchant as candidate", () => {
      const now = new Date();
      const txns: ExpenseTxnRecord[] = [
        createTxn("AIRCANADA", "Travel", 124, new Date(now.getFullYear(), now.getMonth() - 2, 1).toISOString()),
        createTxn("AIRCANADA", "Travel", 124, new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString()),
        createTxn("AIRCANADA", "Travel", 124, new Date(now.getFullYear(), now.getMonth(), 1).toISOString()),
      ];

      const summary = buildSubscriptionSummary(txns, "CAD");
      
      expect(summary.subscriptions).toHaveLength(0);
      expect(summary.candidates).toHaveLength(1);
      expect(summary.candidates[0].merchant).toBe("AIRCANADA");
      expect(summary.candidates[0].tier).toBe("candidate");
      expect(summary.candidateCount).toBe(1);
      // Candidates NOT counted in totals
      expect(summary.monthlyTotal).toBe(0);
      expect(summary.activeCount).toBe(0);
    });

    it("should promote candidate to confirmed when user confirms", () => {
      const now = new Date();
      const txns: ExpenseTxnRecord[] = [
        createTxn("AIRCANADA", "Travel", 124, new Date(now.getFullYear(), now.getMonth() - 2, 1).toISOString()),
        createTxn("AIRCANADA", "Travel", 124, new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString()),
        createTxn("AIRCANADA", "Travel", 124, new Date(now.getFullYear(), now.getMonth(), 1).toISOString()),
      ];

      // Without confirmation: candidate
      const summaryBefore = buildSubscriptionSummary(txns, "CAD", undefined, []);
      expect(summaryBefore.candidates).toHaveLength(1);
      expect(summaryBefore.subscriptions).toHaveLength(0);
      
      // With confirmation: promoted to confirmed
      const summaryAfter = buildSubscriptionSummary(txns, "CAD", undefined, ["aircanada"]);
      expect(summaryAfter.candidates).toHaveLength(0);
      expect(summaryAfter.subscriptions).toHaveLength(1);
      expect(summaryAfter.subscriptions[0].tier).toBe("confirmed");
      expect(summaryAfter.activeCount).toBe(1);
      expect(summaryAfter.monthlyTotal).toBeCloseTo(124, 2);
    });
  });

  describe("Active vs inactive status", () => {
    it.skip("should mark monthly subscription as inactive after 45 days", () => {
      // Create monthly charges, last one 60 days ago (inactive)
      const today = new Date();
      const sixtyDaysAgo = new Date(today);
      sixtyDaysAgo.setDate(today.getDate() - 60);
      const ninetyDaysAgo = new Date(today);
      ninetyDaysAgo.setDate(today.getDate() - 90);
      const oneTwentyDaysAgo = new Date(today);
      oneTwentyDaysAgo.setDate(today.getDate() - 120);
      
      const txns: ExpenseTxnRecord[] = [
        createTxn("NETFLIX", "Subscriptions", 16.99, oneTwentyDaysAgo.toISOString().split('T')[0]),
        createTxn("NETFLIX", "Subscriptions", 16.99, ninetyDaysAgo.toISOString().split('T')[0]),
        createTxn("NETFLIX", "Subscriptions", 16.99, sixtyDaysAgo.toISOString().split('T')[0]),
      ];

      const summary = buildSubscriptionSummary(txns, "CAD");
      
      // Should be detected but marked inactive
      expect(summary.subscriptions).toHaveLength(0);
      expect(summary.inactive).toHaveLength(1);
      expect(summary.inactive[0].status).toBe("inactive");
      expect(summary.monthlyTotal).toBe(0);
      expect(summary.activeCount).toBe(0);
    });

    it("should keep monthly subscription active within 45 days", () => {
      const recentDate = new Date();
      recentDate.setDate(recentDate.getDate() - 25); // 25 days ago
      
      const txns: ExpenseTxnRecord[] = [
        createTxn("NETFLIX", "Subscriptions", 16.99, new Date(recentDate.getFullYear(), recentDate.getMonth() - 2, 1).toISOString()),
        createTxn("NETFLIX", "Subscriptions", 16.99, new Date(recentDate.getFullYear(), recentDate.getMonth() - 1, 1).toISOString()),
        createTxn("NETFLIX", "Subscriptions", 16.99, recentDate.toISOString()),
      ];

      const summary = buildSubscriptionSummary(txns, "CAD");
      
      expect(summary.subscriptions).toHaveLength(1);
      expect(summary.subscriptions[0].status).toBe("active");
      expect(summary.inactive).toHaveLength(0);
      expect(summary.activeCount).toBe(1);
    });

    it.skip("should mark yearly subscription as inactive after 400 days", () => {
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 420); // 420 days ago
      
      const txns: ExpenseTxnRecord[] = [
        createTxn("APPLE.COM/BILL", "Subscriptions", 120, new Date(oldDate.getFullYear() - 1, oldDate.getMonth(), 1).toISOString()),
        createTxn("APPLE.COM/BILL", "Subscriptions", 120, oldDate.toISOString()),
      ];

      const summary = buildSubscriptionSummary(txns, "CAD");
      
      expect(summary.subscriptions).toHaveLength(0);
      expect(summary.inactive).toHaveLength(1);
      expect(summary.inactive[0].status).toBe("inactive");
      expect(summary.monthlyTotal).toBe(0);
    });
  });

  describe("Price increase detection", () => {
    it("should detect price increase for confirmed subscription", () => {
      const now = new Date();
      const txns: ExpenseTxnRecord[] = [
        createTxn("NETFLIX", "Subscriptions", 15.99, new Date(now.getFullYear(), now.getMonth() - 2, 15).toISOString()),
        createTxn("NETFLIX", "Subscriptions", 16.99, new Date(now.getFullYear(), now.getMonth() - 1, 15).toISOString()),
        createTxn("NETFLIX", "Subscriptions", 17.99, new Date(now.getFullYear(), now.getMonth(), 15).toISOString()),
      ];

      const summary = buildSubscriptionSummary(txns, "CAD");
      
      expect(summary.subscriptions).toHaveLength(1);
      expect(summary.subscriptions[0].priceIncrease).toBe(true);
      expect(summary.subscriptions[0].priceIncreaseAmount).toBeCloseTo(1, 2);
      expect(summary.subscriptions[0].previousAmount).toBeCloseTo(16.99, 2);
      expect(summary.priceIncreaseCount).toBe(1);
    });

    it("should NOT detect price increase for candidates", () => {
      const now = new Date();
      const txns: ExpenseTxnRecord[] = [
        createTxn("AIRCANADA", "Travel", 100, new Date(now.getFullYear(), now.getMonth() - 2, 1).toISOString()),
        createTxn("AIRCANADA", "Travel", 110, new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString()),
        createTxn("AIRCANADA", "Travel", 120, new Date(now.getFullYear(), now.getMonth(), 1).toISOString()),
      ];

      const summary = buildSubscriptionSummary(txns, "CAD");
      
      expect(summary.candidates).toHaveLength(1);
      expect(summary.candidates[0].priceIncrease).toBe(false);
      expect(summary.priceIncreaseCount).toBe(0);
    });

    it("should require >=5% increase to flag", () => {
      const now = new Date();
      const txns: ExpenseTxnRecord[] = [
        createTxn("NETFLIX", "Subscriptions", 16.99, new Date(now.getFullYear(), now.getMonth() - 2, 15).toISOString()),
        createTxn("NETFLIX", "Subscriptions", 16.99, new Date(now.getFullYear(), now.getMonth() - 1, 15).toISOString()),
        createTxn("NETFLIX", "Subscriptions", 17.50, new Date(now.getFullYear(), now.getMonth(), 15).toISOString()), // 3% increase
      ];

      const summary = buildSubscriptionSummary(txns, "CAD");
      
      expect(summary.subscriptions).toHaveLength(1);
      expect(summary.subscriptions[0].priceIncrease).toBe(false); // Below 5% threshold
    });
  });

  describe("Sanity checks", () => {
    it("should fail if hard-excluded category appears", () => {
      const now = new Date();
      // This should never happen due to hard exclusions, but test the sanity check
      const txns: ExpenseTxnRecord[] = [
        createTxn("INTEREST", "Interest", 50, new Date(now.getFullYear(), now.getMonth() - 2, 1).toISOString()),
        createTxn("INTEREST", "Interest", 50, new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString()),
        createTxn("INTEREST", "Interest", 50, new Date(now.getFullYear(), now.getMonth(), 1).toISOString()),
      ];

      const summary = buildSubscriptionSummary(txns, "CAD");
      
      // Should be excluded, so no subscriptions
      expect(summary.subscriptions).toHaveLength(0);
      expect(summary.candidates).toHaveLength(0);
    });

    it("should pass with reasonable subscription count", () => {
      const now = new Date();
      const txns: ExpenseTxnRecord[] = [
        createTxn("NETFLIX", "Subscriptions", 16.99, new Date(now.getFullYear(), now.getMonth() - 2, 15).toISOString()),
        createTxn("NETFLIX", "Subscriptions", 16.99, new Date(now.getFullYear(), now.getMonth() - 1, 15).toISOString()),
        createTxn("NETFLIX", "Subscriptions", 16.99, new Date(now.getFullYear(), now.getMonth(), 15).toISOString()),
        createTxn("SPOTIFY", "Subscriptions", 10.99, new Date(now.getFullYear(), now.getMonth() - 2, 1).toISOString()),
        createTxn("SPOTIFY", "Subscriptions", 10.99, new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString()),
        createTxn("SPOTIFY", "Subscriptions", 10.99, new Date(now.getFullYear(), now.getMonth(), 1).toISOString()),
      ];

      const summary = buildSubscriptionSummary(txns, "CAD");
      
      expect(summary.subscriptions).toHaveLength(2);
      expect(summary.activeCount).toBe(2);
      expect(summary.sanityCheckFailures).toHaveLength(0);
    });
  });

  describe("User review decisions", () => {
    it("should require ≥3 charges for candidate detection", () => {
      const now = new Date();
      // Only 2 charges - should not be detected
      const txns: ExpenseTxnRecord[] = [
        createTxn("AIRCANADA", "Travel", 124, new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString()),
        createTxn("AIRCANADA", "Travel", 124, new Date(now.getFullYear(), now.getMonth(), 1).toISOString()),
      ];

      const summary = buildSubscriptionSummary(txns, "CAD");
      
      expect(summary.candidates).toHaveLength(0);
      expect(summary.subscriptions).toHaveLength(0);
    });

    it("should detect candidates with ≥3 charges", () => {
      const now = new Date();
      const txns: ExpenseTxnRecord[] = [
        createTxn("AIRCANADA", "Travel", 124, new Date(now.getFullYear(), now.getMonth() - 2, 1).toISOString()),
        createTxn("AIRCANADA", "Travel", 124, new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString()),
        createTxn("AIRCANADA", "Travel", 124, new Date(now.getFullYear(), now.getMonth(), 1).toISOString()),
      ];

      const summary = buildSubscriptionSummary(txns, "CAD");
      
      expect(summary.candidates).toHaveLength(1);
      expect(summary.candidates[0].merchant).toBe("AIRCANADA");
    });

    it("should promote candidate to confirmed with is_subscription", () => {
      const now = new Date();
      const txns: ExpenseTxnRecord[] = [
        createTxn("Test Service", "Other", 20, new Date(now.getFullYear(), now.getMonth() - 2, 1).toISOString()),
        createTxn("Test Service", "Other", 20, new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString()),
        createTxn("Test Service", "Other", 20, new Date(now.getFullYear(), now.getMonth(), 1).toISOString()),
      ];

      // Without confirmation: candidate
      const beforeSummary = buildSubscriptionSummary(txns, "CAD", undefined, []);
      expect(beforeSummary.candidates.length).toBeGreaterThan(0);
      expect(beforeSummary.subscriptions.length).toBe(0);
      
      // With confirmation: promoted to confirmed
      const afterSummary = buildSubscriptionSummary(txns, "CAD", undefined, ["test-service"]);
      expect(afterSummary.candidates.length).toBe(0);
      expect(afterSummary.subscriptions.length).toBe(1);
      expect(afterSummary.activeCount).toBe(1);
    });

    it("should return cancelled array", () => {
      const now = new Date();
      const txns: ExpenseTxnRecord[] = [
        createTxn("NETFLIX", "Subscriptions", 16.99, new Date(now.getFullYear(), now.getMonth() - 2, 15).toISOString()),
        createTxn("NETFLIX", "Subscriptions", 16.99, new Date(now.getFullYear(), now.getMonth() - 1, 15).toISOString()),
        createTxn("NETFLIX", "Subscriptions", 16.99, new Date(now.getFullYear(), now.getMonth(), 15).toISOString()),
      ];

      const summary = buildSubscriptionSummary(txns, "CAD");
      
      // Cancelled handling is at API layer, but engine should return empty array
      expect(summary.cancelled).toBeDefined();
      expect(Array.isArray(summary.cancelled)).toBe(true);
    });
  });

  describe("Billing frequency overrides", () => {
    it("should honor weekly billing frequency override", () => {
      const now = new Date();
      const txns: ExpenseTxnRecord[] = [
        createTxn("TEST SUB", "Subscriptions", 10, new Date(now.getFullYear(), now.getMonth() - 2, 1).toISOString()),
        createTxn("TEST SUB", "Subscriptions", 10, new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString()),
        createTxn("TEST SUB", "Subscriptions", 10, new Date(now.getFullYear(), now.getMonth(), 1).toISOString()),
      ];

      const overrides = new Map<string, import("@/lib/reviewTypes").BillingFrequency>();
      overrides.set("test-sub", "weekly");
      
      const summary = buildSubscriptionSummary(txns, "CAD", undefined, ["test-sub"], overrides);
      
      const sub = summary.subscriptions[0];
      expect(sub.billingFrequency).toBe("weekly");
      
      // Weekly: 52 weeks/year, monthly = (10 * 52) / 12 = 43.33
      expect(summary.monthlyTotal).toBeCloseTo((10 * 52) / 12, 2);
      // Yearly: 10 * 52 = 520
      expect(summary.yearlyTotal).toBe(10 * 52);
    });

    it("should honor quarterly billing frequency override", () => {
      const now = new Date();
      const txns: ExpenseTxnRecord[] = [
        createTxn("TEST SUB", "Subscriptions", 30, new Date(now.getFullYear(), now.getMonth() - 2, 1).toISOString()),
        createTxn("TEST SUB", "Subscriptions", 30, new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString()),
        createTxn("TEST SUB", "Subscriptions", 30, new Date(now.getFullYear(), now.getMonth(), 1).toISOString()),
      ];

      const overrides = new Map<string, import("@/lib/reviewTypes").BillingFrequency>();
      overrides.set("test-sub", "quarterly");
      
      const summary = buildSubscriptionSummary(txns, "CAD", undefined, ["test-sub"], overrides);
      
      const sub = summary.subscriptions[0];
      expect(sub.billingFrequency).toBe("quarterly");
      
      // Quarterly: 4 times/year, monthly = (30 * 4) / 12 = 10
      expect(summary.monthlyTotal).toBe((30 * 4) / 12);
      // Yearly: 30 * 4 = 120
      expect(summary.yearlyTotal).toBe(30 * 4);
    });

    it("should update next expected date based on override", () => {
      const now = new Date();
      const lastDate = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
      
      const txns: ExpenseTxnRecord[] = [
        createTxn("TEST SUB", "Subscriptions", 30, lastDate),
      ];

      const overrides = new Map<string, import("@/lib/reviewTypes").BillingFrequency>();
      overrides.set("test-sub", "quarterly");
      
      const summary = buildSubscriptionSummary(txns, "CAD", undefined, ["test-sub"], overrides);
      
      const sub = summary.subscriptions[0];
      
      // Next date should be 3 months after last date
      const expectedNextDate = new Date(lastDate);
      expectedNextDate.setMonth(expectedNextDate.getMonth() + 3);
      
      expect(sub.nextDate).toBe(expectedNextDate.toISOString().slice(0, 10));
    });
  });
});
