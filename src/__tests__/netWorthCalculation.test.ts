/**
 * Tests for getNetWorthForMonth - the single authoritative data-layer function.
 * 
 * Tests import and call ACTUAL production function with synthetic inputs.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { getNetWorthForMonth } from "../lib/netWorthCalculation";
import * as financialProfile from "../lib/financialProfile";

// Mock dependencies
vi.mock("../lib/financialProfile");

const mockGetFinancialProfile = vi.mocked(financialProfile.getFinancialProfile);

describe("getNetWorthForMonth - Authoritative Data Layer", () => {
  const mockDb = {} as any;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return latest available month when month/year omitted (explicit max comparison)", async () => {
    // Out-of-order history: Nov, Oct, Sep (not sorted)
    mockGetFinancialProfile.mockResolvedValue({
      monthlyHistory: [
        { yearMonth: "2026-11", netWorth: 1267002, totalAssets: 1517076, totalDebts: 250074, byAccount: [] },
        { yearMonth: "2026-10", netWorth: 1244076, totalAssets: 1500000, totalDebts: 255924, byAccount: [] },
        { yearMonth: "2026-09", netWorth: 1200000, totalAssets: 1450000, totalDebts: 250000, byAccount: [] },
      ],
    } as any);

    const mockUserDoc = {
      exists: true,
      data: () => ({ homeCurrency: "CAD" }),
    };
    const mockCollection = vi.fn(() => ({
      doc: vi.fn(() => ({
        get: vi.fn(() => Promise.resolve(mockUserDoc)),
      })),
    }));
    (mockDb as any).collection = mockCollection;

    const result = await getNetWorthForMonth("test-uid", mockDb);

    expect(result).not.toBeNull();
    expect(result!.yearMonth).toBe("2026-11"); // Latest by explicit comparison, not array position
    expect(result!.netWorth).toBe(1267002);
    expect(result!.currency).toBe("CAD");
  });

  it("should return specific month when month/year explicitly provided", async () => {
    mockGetFinancialProfile.mockResolvedValue({
      monthlyHistory: [
        { yearMonth: "2026-11", netWorth: 1267002, totalAssets: 1517076, totalDebts: 250074, byAccount: [] },
        { yearMonth: "2026-10", netWorth: 1244076, totalAssets: 1500000, totalDebts: 255924, byAccount: [] },
      ],
    } as any);

    const mockUserDoc = { exists: true, data: () => ({ homeCurrency: "CAD" }) };
    (mockDb as any).collection = vi.fn(() => ({
      doc: vi.fn(() => ({ get: vi.fn(() => Promise.resolve(mockUserDoc)) })),
    }));

    // Explicitly request October
    const result = await getNetWorthForMonth("test-uid", mockDb, { month: 10, year: 2026 });

    expect(result).not.toBeNull();
    expect(result!.yearMonth).toBe("2026-10");
    expect(result!.netWorth).toBe(1244076);
  });

  it("should return null when explicit month/year not available (not silently substituted)", async () => {
    mockGetFinancialProfile.mockResolvedValue({
      monthlyHistory: [
        { yearMonth: "2026-11", netWorth: 1267002, totalAssets: 1517076, totalDebts: 250074, byAccount: [] },
        { yearMonth: "2026-10", netWorth: 1244076, totalAssets: 1500000, totalDebts: 255924, byAccount: [] },
      ],
    } as any);

    const mockUserDoc = { exists: true, data: () => ({ homeCurrency: "CAD" }) };
    (mockDb as any).collection = vi.fn(() => ({
      doc: vi.fn(() => ({ get: vi.fn(() => Promise.resolve(mockUserDoc)) })),
    }));

    // Request September (not available)
    const result = await getNetWorthForMonth("test-uid", mockDb, { month: 9, year: 2026 });

    expect(result).toBeNull(); // Not substituted with latest
  });

  it("should handle year boundary correctly", async () => {
    mockGetFinancialProfile.mockResolvedValue({
      monthlyHistory: [
        { yearMonth: "2027-01", netWorth: 1300000, totalAssets: 1550000, totalDebts: 250000, byAccount: [] },
        { yearMonth: "2026-12", netWorth: 1280000, totalAssets: 1530000, totalDebts: 250000, byAccount: [] },
        { yearMonth: "2026-11", netWorth: 1267002, totalAssets: 1517076, totalDebts: 250074, byAccount: [] },
      ],
    } as any);

    const mockUserDoc = { exists: true, data: () => ({ homeCurrency: "CAD" }) };
    (mockDb as any).collection = vi.fn(() => ({
      doc: vi.fn(() => ({ get: vi.fn(() => Promise.resolve(mockUserDoc)) })),
    }));

    // Omitted month/year should return 2027-01 (latest)
    const result = await getNetWorthForMonth("test-uid", mockDb);

    expect(result).not.toBeNull();
    expect(result!.yearMonth).toBe("2027-01");
    expect(result!.netWorth).toBe(1300000);
    
    // monthlyChange should be relative to previous month (2026-12)
    expect(result!.monthlyChange).toBe(20000); // 1300000 - 1280000
    expect(result!.previousMonth?.yearMonth).toBe("2026-12");
  });

  it("should calculate monthlyChange from previous month in sorted order", async () => {
    mockGetFinancialProfile.mockResolvedValue({
      monthlyHistory: [
        { yearMonth: "2026-11", netWorth: 1267002, totalAssets: 1517076, totalDebts: 250074, byAccount: [] },
        { yearMonth: "2026-10", netWorth: 1244076, totalAssets: 1500000, totalDebts: 255924, byAccount: [] },
        { yearMonth: "2026-09", netWorth: 1200000, totalAssets: 1450000, totalDebts: 250000, byAccount: [] },
      ],
    } as any);

    const mockUserDoc = { exists: true, data: () => ({ homeCurrency: "CAD" }) };
    (mockDb as any).collection = vi.fn(() => ({
      doc: vi.fn(() => ({ get: vi.fn(() => Promise.resolve(mockUserDoc)) })),
    }));

    const result = await getNetWorthForMonth("test-uid", mockDb);

    expect(result!.monthlyChange).toBe(22926); // Nov 1267002 - Oct 1244076
    expect(result!.previousMonth?.yearMonth).toBe("2026-10");
    expect(result!.previousMonth?.netWorth).toBe(1244076);
  });

  it("should return null monthlyChange when no previous month exists", async () => {
    mockGetFinancialProfile.mockResolvedValue({
      monthlyHistory: [
        { yearMonth: "2026-11", netWorth: 1267002, totalAssets: 1517076, totalDebts: 250074, byAccount: [] },
      ],
    } as any);

    const mockUserDoc = { exists: true, data: () => ({ homeCurrency: "CAD" }) };
    (mockDb as any).collection = vi.fn(() => ({
      doc: vi.fn(() => ({ get: vi.fn(() => Promise.resolve(mockUserDoc)) })),
    }));

    const result = await getNetWorthForMonth("test-uid", mockDb);

    expect(result!.monthlyChange).toBeNull();
    expect(result!.previousMonth).toBeNull();
  });

  it("should return null when no data available", async () => {
    mockGetFinancialProfile.mockResolvedValue({
      monthlyHistory: [],
    } as any);

    const mockUserDoc = { exists: true, data: () => ({ homeCurrency: "USD" }) };
    (mockDb as any).collection = vi.fn(() => ({
      doc: vi.fn(() => ({ get: vi.fn(() => Promise.resolve(mockUserDoc)) })),
    }));

    const result = await getNetWorthForMonth("test-uid", mockDb);

    expect(result).toBeNull();
  });

  it("should preserve totalAssets and totalDebts from profile (includes manual assets)", async () => {
    // financialProfile.ts already adds manual assets to totalAssets (line 1378)
    // This function just returns those values
    mockGetFinancialProfile.mockResolvedValue({
      monthlyHistory: [
        {
          yearMonth: "2026-11",
          netWorth: 1267002, // Already includes manual car
          totalAssets: 1517076, // $1,467,076 (statements) + $50,000 (car)
          totalDebts: 250074,
          byAccount: [],
        },
      ],
    } as any);

    const mockUserDoc = { exists: true, data: () => ({ homeCurrency: "CAD" }) };
    (mockDb as any).collection = vi.fn(() => ({
      doc: vi.fn(() => ({ get: vi.fn(() => Promise.resolve(mockUserDoc)) })),
    }));

    const result = await getNetWorthForMonth("test-uid", mockDb);

    expect(result!.totalAssets).toBe(1517076); // Includes manual assets
    expect(result!.totalDebts).toBe(250074);
    expect(result!.netWorth).toBe(1267002); // totalAssets - totalDebts
    expect(result!.netWorth).toBe(result!.totalAssets - result!.totalDebts);
  });

  it("should use homeCurrency from user doc", async () => {
    mockGetFinancialProfile.mockResolvedValue({
      monthlyHistory: [
        { yearMonth: "2026-11", netWorth: 100000, totalAssets: 150000, totalDebts: 50000, byAccount: [] },
      ],
    } as any);

    const mockUserDoc = { exists: true, data: () => ({ homeCurrency: "USD" }) };
    (mockDb as any).collection = vi.fn(() => ({
      doc: vi.fn(() => ({ get: vi.fn(() => Promise.resolve(mockUserDoc)) })),
    }));

    const result = await getNetWorthForMonth("test-uid", mockDb);

    expect(result!.currency).toBe("USD");
  });

  it("should fallback to CAD when no currency specified", async () => {
    mockGetFinancialProfile.mockResolvedValue({
      monthlyHistory: [
        { yearMonth: "2026-11", netWorth: 100000, totalAssets: 150000, totalDebts: 50000, byAccount: [] },
      ],
    } as any);

    const mockUserDoc = { exists: true, data: () => ({}) };
    (mockDb as any).collection = vi.fn(() => ({
      doc: vi.fn(() => ({ get: vi.fn(() => Promise.resolve(mockUserDoc)) })),
    }));

    const result = await getNetWorthForMonth("test-uid", mockDb);

    expect(result!.currency).toBe("CAD");
  });

  it("exposes priorMonth for the first visible month of the 12-month window", async () => {
    const history = [];
    for (let i = 0; i < 15; i++) {
      const d = new Date(2025, i, 1);
      const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      history.push({
        yearMonth: ym,
        netWorth: i * 1000,
        totalAssets: i * 1000,
        totalDebts: 0,
        byAccount: [{ slug: "chk", label: "Checking", type: "checking", value: i * 1000 }],
      });
    }
    mockGetFinancialProfile.mockResolvedValue({ monthlyHistory: history } as any);

    const mockUserDoc = { exists: true, data: () => ({ homeCurrency: "CAD" }) };
    (mockDb as any).collection = vi.fn(() => ({
      doc: vi.fn(() => ({ get: vi.fn(() => Promise.resolve(mockUserDoc)) })),
    }));

    const result = await getNetWorthForMonth("test-uid", mockDb);
    expect(result!.monthlyHistory).toHaveLength(12);
    expect(result!.monthlyHistory[0].yearMonth).toBe("2025-04");
    expect(result!.priorMonth?.yearMonth).toBe("2025-03");
    expect(result!.priorMonth?.netWorth).toBe(2000);
  });
});
