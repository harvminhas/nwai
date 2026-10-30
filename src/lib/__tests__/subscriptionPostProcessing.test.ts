import { describe, test, expect } from "vitest";
import { postProcessSubscriptions } from "../subscriptionPostProcessing";
import type { DetectedSubscription } from "../subscriptionEngine";

describe("postProcessSubscriptions", () => {
  test("single charge 5 months ago with yearly cadence stays yearly with no flag", () => {
    const fiveMonthsAgo = "2026-05-30";
    
    const detected: DetectedSubscription = {
      merchant: "Amazon Prime",
      merchantSlug: "amazon-ca-prime-member",
      category: "Shopping",
      amount: 111.87,
      cadence: "yearly",
      lastDate: fiveMonthsAgo,
      nextDate: "2027-05-30",
      chargeCount: 1,
      isNew: false,
      priceIncrease: false,
      transactions: [{ date: fiveMonthsAgo, amount: 111.87 }],
      tier: "confirmed",
      status: "active", // Within yearly window (< 395 days)
      noRecentCharge: undefined,
    };
    
    const result = postProcessSubscriptions(
      {
        subscriptions: [detected],
        candidates: [],
        inactive: [],
      },
      new Set(),
      []
    );
    
    expect(result.confirmedActive).toHaveLength(1);
    expect(result.confirmedActive[0].cadence).toBe("yearly");
    expect(result.confirmedActive[0].noRecentCharge).toBeFalsy();
  });
  
  test("monthly charge last seen 9 months ago is active with noRecentCharge=true", () => {
    const nineMonthsAgo = "2026-01-30";
    
    const detected: DetectedSubscription = {
      merchant: "Cursor",
      merchantSlug: "cursor-ai",
      category: "Subscriptions",
      amount: 20.00,
      cadence: "monthly",
      lastDate: nineMonthsAgo,
      nextDate: "2026-02-30",
      chargeCount: 9,
      isNew: false,
      priceIncrease: false,
      transactions: [{ date: nineMonthsAgo, amount: 20.00 }],
      tier: "confirmed",
      status: "inactive", // Past monthly window (> 45 days)
      noRecentCharge: undefined,
    };
    
    const result = postProcessSubscriptions(
      {
        subscriptions: [],
        candidates: [],
        inactive: [detected],
      },
      new Set(),
      []
    );
    
    expect(result.confirmedActive).toHaveLength(1);
    expect(result.confirmedActive[0].cadence).toBe("monthly");
    expect(result.confirmedActive[0].status).toBe("active");
    expect(result.confirmedActive[0].noRecentCharge).toBe(true);
  });
  
  test("cancelled items stay in inactive list", () => {
    const detected: DetectedSubscription = {
      merchant: "Old Service",
      merchantSlug: "old-service",
      category: "Subscriptions",
      amount: 10.00,
      cadence: "monthly",
      lastDate: "2025-01-01",
      nextDate: null,
      chargeCount: 5,
      isNew: false,
      priceIncrease: false,
      transactions: [{ date: "2025-01-01", amount: 10.00 }],
      tier: "confirmed",
      status: "inactive",
      noRecentCharge: undefined,
    };
    
    const result = postProcessSubscriptions(
      {
        subscriptions: [],
        candidates: [],
        inactive: [detected],
      },
      new Set(["old-service"]), // User marked as cancelled
      []
    );
    
    expect(result.confirmedActive).toHaveLength(0);
    expect(result.inactive).toHaveLength(1);
    expect(result.inactive[0].merchantSlug).toBe("old-service");
  });
});
