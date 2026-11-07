/**
 * Tests for /api/user/net-worth-summary explicit period validation.
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

describe("GET /api/user/net-worth-summary - Explicit Period Validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetFinancialProfile.mockResolvedValue({
      monthlyHistory: [
        { yearMonth: "2026-10", netWorth: 1244076, totalAssets: 1500000, totalDebts: 255924, byAccount: [] },
        { yearMonth: "2026-11", netWorth: 1267002, totalAssets: 1517076, totalDebts: 250074, byAccount: [] },
      ],
    } as any);
  });

  it("should return 400 when month provided without year", async () => {
    const request = new NextRequest("http://localhost:3000/api/user/net-worth-summary?month=11", {
      headers: { authorization: "Bearer mock-token" },
    });

    const response = await GET(request);
    expect(response.status).toBe(400);
    
    const data = await response.json();
    expect(data.error).toContain("month and year must be provided together");
  });

  it("should return 400 when year provided without month", async () => {
    const request = new NextRequest("http://localhost:3000/api/user/net-worth-summary?year=2026", {
      headers: { authorization: "Bearer mock-token" },
    });

    const response = await GET(request);
    expect(response.status).toBe(400);
    
    const data = await response.json();
    expect(data.error).toContain("month and year must be provided together");
  });

  it("should return 400 when month < 1", async () => {
    const request = new NextRequest("http://localhost:3000/api/user/net-worth-summary?month=0&year=2026", {
      headers: { authorization: "Bearer mock-token" },
    });

    const response = await GET(request);
    expect(response.status).toBe(400);
    
    const data = await response.json();
    expect(data.error).toContain("month must be an integer between 1 and 12");
  });

  it("should return 400 when month > 12", async () => {
    const request = new NextRequest("http://localhost:3000/api/user/net-worth-summary?month=13&year=2026", {
      headers: { authorization: "Bearer mock-token" },
    });

    const response = await GET(request);
    expect(response.status).toBe(400);
    
    const data = await response.json();
    expect(data.error).toContain("month must be an integer between 1 and 12");
  });

  it("should return 400 when month is not an integer", async () => {
    const request = new NextRequest("http://localhost:3000/api/user/net-worth-summary?month=abc&year=2026", {
      headers: { authorization: "Bearer mock-token" },
    });

    const response = await GET(request);
    expect(response.status).toBe(400);
  });

  it("should return 404 when explicit period unavailable", async () => {
    const request = new NextRequest("http://localhost:3000/api/user/net-worth-summary?month=9&year=2026", {
      headers: { authorization: "Bearer mock-token" },
    });

    const response = await GET(request);
    expect(response.status).toBe(404);
    
    const data = await response.json();
    expect(data.error).toContain("No data available for 2026-09");
  });

  it("should return 200 with explicit valid period", async () => {
    const request = new NextRequest("http://localhost:3000/api/user/net-worth-summary?month=10&year=2026", {
      headers: { authorization: "Bearer mock-token" },
    });

    const response = await GET(request);
    expect(response.status).toBe(200);
    
    const data = await response.json();
    expect(data.netWorth).toBe(1244076); // October data
    expect(data.latestMonth).toBe("2026-10");
  });

  it("should default to latest when no params provided", async () => {
    const request = new NextRequest("http://localhost:3000/api/user/net-worth-summary", {
      headers: { authorization: "Bearer mock-token" },
    });

    const response = await GET(request);
    expect(response.status).toBe(200);
    
    const data = await response.json();
    expect(data.netWorth).toBe(1267002); // November (latest)
    expect(data.latestMonth).toBe("2026-11");
  });
});
