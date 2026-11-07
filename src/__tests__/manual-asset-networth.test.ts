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

describe("Manual Asset Net Worth Bug", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should include manual assets in net worth when monthlyHistory is empty", async () => {
    // Mock auth to return valid user
    vi.mocked(resolveAccess).mockResolvedValue({
      targetUid: "test-uid",
    } as any);

    // Mock profile with NO statements (empty monthlyHistory) but WITH manual assets
    vi.mocked(getFinancialProfile).mockResolvedValue({
      uid: "test-uid",
      homeCurrency: "CAD",
      monthlyHistory: [], // NO STATEMENTS
      manualAssets: [
        {
          id: "car-1",
          label: "2020 Honda Civic",
          category: "vehicle" as any,
          value: 50000, // $50k car
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

    // VERIFY: Net worth should be $50,000 (manual asset total), NOT $0
    expect(data.netWorth).toBe(50000);
    expect(data.current).toBe(50000);
    
    // Additional assertions
    expect(data.currency).toBe("CAD");
    expect(data.monthlyChange).toBe(0); // No previous month
    expect(data.latestMonth).toBeNull(); // No history
  });

  it("should NOT include manual assets when monthlyHistory has data (existing behavior)", async () => {
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
