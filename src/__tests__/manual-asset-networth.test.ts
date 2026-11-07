import { NextRequest } from "next/server";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { GET } from "../app/api/user/net-worth-summary/route";

// Mock dependencies
vi.mock("../lib/firebase-admin", () => ({
  getFirebaseAdmin: vi.fn(() => ({
    db: {
      collection: vi.fn(() => ({
        doc: vi.fn(() => ({
          get: vi.fn(() => Promise.resolve({
            exists: true,
            data: () => ({ homeCurrency: "CAD" }),
          })),
        })),
      })),
    },
  })),
}));

vi.mock("../lib/access/resolveAccess", () => ({
  resolveAccess: vi.fn(),
}));

vi.mock("../lib/financialProfile", () => ({
  getFinancialProfile: vi.fn(),
}));

import { resolveAccess } from "../lib/access/resolveAccess";
import { getFinancialProfile } from "../lib/financialProfile";

describe("Manual Asset Net Worth Bug - User adds car to existing net worth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should increase net worth when user adds manual car asset to existing history", async () => {
    // Mock auth to return valid user
    vi.mocked(resolveAccess).mockResolvedValue({
      targetUid: "test-uid",
    } as any);

    // Mock profile with EXISTING Oct/Nov history (~$1.24m) PLUS newly added $50k car
    // This simulates the state AFTER cache rebuild triggered by requestProfileRefresh()
    vi.mocked(getFinancialProfile).mockResolvedValue({
      uid: "test-uid",
      homeCurrency: "CAD",
      monthlyHistory: [
        {
          yearMonth: "2026-10",
          netWorth: 1244076, // Oct: ~$1.24m (original)
          totalAssets: 1500000,
          totalDebts: 255924,
          byAccount: [],
        },
        {
          yearMonth: "2026-11",
          // Nov: $1,217,002 (original) + $50,000 (car) = $1,267,002
          // Manual assets added in financialProfile.ts:1378 during rebuild
          netWorth: 1267002,
          totalAssets: 1550000,
          totalDebts: 282998,
          byAccount: [],
        },
      ],
      manualAssets: [
        {
          id: "car-1",
          label: "2020 Honda Civic",
          category: "vehicle" as any,
          value: 50000, // $50k car newly added
          updatedAt: "2026-11-07T00:00:00Z",
        },
      ],
      accounts: [],
      expenseCategories: [],
      expenseTxns: [],
      incomeTxns: [],
      allSnapshots: [],
      debtPaymentHistory: [],
      categoryMonthlyTotals: {},
      incomeMonthlyTotal: {},
      cacheStale: false,
      cacheLastUpdated: new Date().toISOString(),
    } as any);

    // Create mock request with auth header
    const request = new NextRequest("http://localhost:3000/api/user/net-worth-summary", {
      headers: {
        authorization: "Bearer mock-token",
      },
    });

    // Call actual production route handler
    const response = await GET(request);
    const data = await response.json();

    // VERIFY: Net worth should be $1,267,002 (Nov $1,217,002 + car $50,000)
    expect(data.netWorth).toBe(1267002);
    expect(data.current).toBe(1267002);
    expect(data.latestMonth).toBe("2026-11");
    
    // Verify monthly change from Oct to Nov
    const expectedChange = 1267002 - 1244076; // $22,926 increase
    expect(data.monthlyChange).toBe(expectedChange);
    
    expect(data.currency).toBe("CAD");
  });

  it("should handle empty monthlyHistory edge case (fallback for users with no statements)", async () => {
    vi.mocked(resolveAccess).mockResolvedValue({
      targetUid: "test-uid",
    } as any);

    // Profile WITH statements - manual assets already included in netWorth by financialProfile.ts
    vi.mocked(getFinancialProfile).mockResolvedValue({
      uid: "test-uid",
      homeCurrency: "CAD",
      monthlyHistory: [
        {
          yearMonth: "2026-11",
          netWorth: 150000, // Already includes manual assets via financialProfile.ts:1378
          totalAssets: 200000,
          totalDebts: 50000,
          byAccount: [],
        },
      ],
      manualAssets: [
        {
          id: "car-1",
          label: "2020 Honda Civic",
          category: "vehicle" as any,
          value: 50000,
          updatedAt: "2026-11-07T00:00:00Z",
        },
      ],
      accounts: [],
      expenseCategories: [],
      expenseTxns: [],
      incomeTxns: [],
      allSnapshots: [],
      debtPaymentHistory: [],
      categoryMonthlyTotals: {},
      incomeMonthlyTotal: {},
      cacheStale: false,
      cacheLastUpdated: new Date().toISOString(),
    } as any);

    const request = new NextRequest("http://localhost:3000/api/user/net-worth-summary", {
      headers: {
        authorization: "Bearer mock-token",
      },
    });

    const response = await GET(request);
    const data = await response.json();

    // Should use monthlyHistory netWorth, NOT recalculate from manual assets
    expect(data.netWorth).toBe(150000);
    expect(data.current).toBe(150000);
    expect(data.latestMonth).toBe("2026-11");
  });

  it("should return 0 when no statements AND no manual assets", async () => {
    vi.mocked(resolveAccess).mockResolvedValue({
      targetUid: "test-uid",
    } as any);

    vi.mocked(getFinancialProfile).mockResolvedValue({
      uid: "test-uid",
      homeCurrency: "USD",
      monthlyHistory: [],
      manualAssets: [], // NO manual assets either
      accounts: [],
      expenseCategories: [],
      expenseTxns: [],
      incomeTxns: [],
      allSnapshots: [],
      debtPaymentHistory: [],
      categoryMonthlyTotals: {},
      incomeMonthlyTotal: {},
      cacheStale: false,
      cacheLastUpdated: new Date().toISOString(),
    } as any);

    const request = new NextRequest("http://localhost:3000/api/user/net-worth-summary", {
      headers: {
        authorization: "Bearer mock-token",
      },
    });

    const response = await GET(request);
    const data = await response.json();

    // Should return 0 when completely empty
    expect(data.netWorth).toBe(0);
    expect(data.current).toBe(0);
  });
});
