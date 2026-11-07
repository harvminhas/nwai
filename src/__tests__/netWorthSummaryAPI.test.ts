/**
 * Tests for /api/user/net-worth-summary API endpoint
 * 
 * Verifies full API contract preservation including monthlyHistory.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "../app/api/user/net-worth-summary/route";
import * as financialProfile from "../lib/financialProfile";

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
  resolveAccess: vi.fn(() => Promise.resolve({ targetUid: "test-uid" })),
}));

vi.mock("../lib/financialProfile");

const mockGetFinancialProfile = vi.mocked(financialProfile.getFinancialProfile);

describe("GET /api/user/net-worth-summary - API Contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should preserve monthlyHistory with last 12 months for detail page chart", async () => {
    // Simulate 18 months of history
    const history = [];
    for (let i = 0; i < 18; i++) {
      const year = 2026;
      const month = 11 - i; // Nov back to... earlier
      const adjustedYear = year - Math.floor((11 - month) / 12);
      const adjustedMonth = ((month + 12) % 12) || 12;
      history.push({
        yearMonth: `${adjustedYear}-${String(adjustedMonth).padStart(2, "0")}`,
        netWorth: 1200000 + i * 10000,
        totalAssets: 1500000 + i * 10000,
        totalDebts: 300000,
        byAccount: [{ slug: "test", label: "Test", type: "checking", value: 100000 }],
      });
    }

    mockGetFinancialProfile.mockResolvedValue({
      monthlyHistory: history,
    } as any);

    const request = new NextRequest("http://localhost:3000/api/user/net-worth-summary", {
      headers: { authorization: "Bearer mock-token" },
    });

    const response = await GET(request);
    const data = await response.json();

    // Should return last 12 months only
    expect(data.monthlyHistory).toHaveLength(12);
    
    // Should preserve byAccount for detail page
    expect(data.monthlyHistory[0].byAccount).toBeDefined();
    expect(Array.isArray(data.monthlyHistory[0].byAccount)).toBe(true);
    
    // Should be in chronological order (oldest first for chart)
    const firstMonth = data.monthlyHistory[0].yearMonth;
    const lastMonth = data.monthlyHistory[11].yearMonth;
    expect(firstMonth < lastMonth).toBe(true);
  });

  it("should return latest month net worth in top-level fields", async () => {
    mockGetFinancialProfile.mockResolvedValue({
      monthlyHistory: [
        { yearMonth: "2026-10", netWorth: 1244076, totalAssets: 1500000, totalDebts: 255924, byAccount: [] },
        { yearMonth: "2026-11", netWorth: 1267002, totalAssets: 1517076, totalDebts: 250074, byAccount: [] },
      ],
    } as any);

    const request = new NextRequest("http://localhost:3000/api/user/net-worth-summary", {
      headers: { authorization: "Bearer mock-token" },
    });

    const response = await GET(request);
    const data = await response.json();

    // Top-level should be latest (Nov)
    expect(data.netWorth).toBe(1267002);
    expect(data.latestMonth).toBe("2026-11");
    expect(data.current).toBe(1267002);
  });

  it("should calculate monthlyChange and trend", async () => {
    mockGetFinancialProfile.mockResolvedValue({
      monthlyHistory: [
        { yearMonth: "2026-10", netWorth: 1244076, totalAssets: 1500000, totalDebts: 255924, byAccount: [] },
        { yearMonth: "2026-11", netWorth: 1267002, totalAssets: 1517076, totalDebts: 250074, byAccount: [] },
      ],
    } as any);

    const request = new NextRequest("http://localhost:3000/api/user/net-worth-summary", {
      headers: { authorization: "Bearer mock-token" },
    });

    const response = await GET(request);
    const data = await response.json();

    expect(data.monthlyChange).toBe(22926); // 1267002 - 1244076
    expect(data.change).toBe(22926);
    expect(data.trend).toBe("up");
    expect(data.changePercent).toBeCloseTo(1.84, 1);
  });

  it("should handle no data gracefully", async () => {
    mockGetFinancialProfile.mockResolvedValue({
      monthlyHistory: [],
    } as any);

    const request = new NextRequest("http://localhost:3000/api/user/net-worth-summary", {
      headers: { authorization: "Bearer mock-token" },
    });

    const response = await GET(request);
    const data = await response.json();

    expect(data.netWorth).toBe(0);
    expect(data.monthlyChange).toBe(0);
    expect(data.monthlyHistory).toEqual([]);
    expect(data.latestMonth).toBeNull();
  });

  it("should preserve currency from user doc", async () => {
    mockGetFinancialProfile.mockResolvedValue({
      monthlyHistory: [
        { yearMonth: "2026-11", netWorth: 1267002, totalAssets: 1517076, totalDebts: 250074, byAccount: [] },
      ],
    } as any);

    const request = new NextRequest("http://localhost:3000/api/user/net-worth-summary", {
      headers: { authorization: "Bearer mock-token" },
    });

    const response = await GET(request);
    const data = await response.json();

    expect(data.currency).toBe("CAD"); // From mocked user doc
  });
});
