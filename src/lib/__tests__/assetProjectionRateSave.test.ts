/**
 * Tests for asset projection rate-only save via PATCH endpoint.
 * Confirms atomic rate updates without appending valuations.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { PATCH } from "@/app/api/user/assets/[id]/route";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { invalidateFinancialProfileCache } from "@/lib/financialProfile";
import type { ManualAsset } from "@/lib/types";

vi.mock("@/lib/firebase-admin");
vi.mock("@/lib/financialProfile");

describe("Asset Projection Rate Save (PATCH)", () => {
  let mockTransaction: ReturnType<typeof vi.fn>;
  let mockGet: ReturnType<typeof vi.fn>;
  let mockUpdate: ReturnType<typeof vi.fn>;
  let mockAssetRef: unknown;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGet = vi.fn();
    mockUpdate = vi.fn();
    mockTransaction = vi.fn();
    mockAssetRef = {};

    vi.mocked(getFirebaseAdmin).mockReturnValue({
      auth: {
        verifyIdToken: vi.fn().mockResolvedValue({ uid: "test-uid" }),
      } as any,
      db: {
        collection: vi.fn().mockReturnValue({
          doc: vi.fn().mockReturnValue({
            collection: vi.fn().mockReturnValue({
              doc: vi.fn().mockReturnValue(mockAssetRef),
            }),
          }),
        }),
        runTransaction: mockTransaction,
      } as any,
    });

    vi.mocked(invalidateFinancialProfileCache).mockResolvedValue(undefined);
  });

  it("updates only annualGrowthRate without appending valuation", async () => {
    const existingAsset: ManualAsset = {
      id: "asset1",
      label: "Honda Civic",
      category: "vehicle",
      value: 20000,
      valuations: [
        {
          id: "val1",
          effectiveDate: "2024-10-01",
          valueCents: 2000000,
          createdAt: "2024-10-01T12:00:00Z",
        },
      ],
      annualGrowthRate: null,
    };

    mockTransaction.mockImplementation(async (fn: (txn: any) => Promise<void>) => {
      const txn = {
        get: mockGet.mockResolvedValue({
          exists: true,
          data: () => existingAsset,
        }),
        update: mockUpdate,
      };
      await fn(txn);
    });

    const req = new NextRequest("http://localhost/api/user/assets/asset1", {
      method: "PATCH",
      headers: { Authorization: "Bearer test-token" },
      body: JSON.stringify({ annualGrowthRate: -10.5 }),
    });

    const res = await PATCH(req, { params: Promise.resolve({ id: "asset1" }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ ok: true });
    expect(mockUpdate).toHaveBeenCalledWith(mockAssetRef, {
      annualGrowthRate: -10.5,
      updatedAt: expect.any(Date),
    });

    // Ensure update does NOT include valuations
    const updateCall = mockUpdate.mock.calls[0][1];
    expect(updateCall).not.toHaveProperty("valuations");
    expect(updateCall).not.toHaveProperty("value");
    expect(updateCall).not.toHaveProperty("label");
  });

  it("accepts null to clear growth rate", async () => {
    const existingAsset: ManualAsset = {
      id: "asset1",
      label: "House",
      category: "property",
      value: 500000,
      annualGrowthRate: 5.0,
    };

    mockTransaction.mockImplementation(async (fn: (txn: any) => Promise<void>) => {
      const txn = {
        get: mockGet.mockResolvedValue({
          exists: true,
          data: () => existingAsset,
        }),
        update: mockUpdate,
      };
      await fn(txn);
    });

    const req = new NextRequest("http://localhost/api/user/assets/asset1", {
      method: "PATCH",
      headers: { Authorization: "Bearer test-token" },
      body: JSON.stringify({ annualGrowthRate: null }),
    });

    const res = await PATCH(req, { params: Promise.resolve({ id: "asset1" }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ ok: true });
    expect(mockUpdate).toHaveBeenCalledWith(mockAssetRef, {
      annualGrowthRate: null,
      updatedAt: expect.any(Date),
    });
  });

  it("rejects rate outside -100 to 100 range", async () => {
    const req = new NextRequest("http://localhost/api/user/assets/asset1", {
      method: "PATCH",
      headers: { Authorization: "Bearer test-token" },
      body: JSON.stringify({ annualGrowthRate: 150 }),
    });

    const res = await PATCH(req, { params: Promise.resolve({ id: "asset1" }) });
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain("between -100 and 100");
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("rejects non-numeric rate", async () => {
    const req = new NextRequest("http://localhost/api/user/assets/asset1", {
      method: "PATCH",
      headers: { Authorization: "Bearer test-token" },
      body: JSON.stringify({ annualGrowthRate: "abc" }),
    });

    const res = await PATCH(req, { params: Promise.resolve({ id: "asset1" }) });
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain("finite number");
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("preserves existing valuations array untouched", async () => {
    const existingAsset: ManualAsset = {
      id: "asset1",
      label: "Car",
      category: "vehicle",
      value: 30000,
      valuations: [
        {
          id: "val1",
          effectiveDate: "2024-09-01",
          valueCents: 3100000,
          createdAt: "2024-09-01T12:00:00Z",
        },
        {
          id: "val2",
          effectiveDate: "2024-10-01",
          valueCents: 3000000,
          createdAt: "2024-10-01T12:00:00Z",
        },
      ],
      annualGrowthRate: null,
    };

    mockTransaction.mockImplementation(async (fn: (txn: any) => Promise<void>) => {
      const txn = {
        get: mockGet.mockResolvedValue({
          exists: true,
          data: () => existingAsset,
        }),
        update: mockUpdate,
      };
      await fn(txn);
    });

    const req = new NextRequest("http://localhost/api/user/assets/asset1", {
      method: "PATCH",
      headers: { Authorization: "Bearer test-token" },
      body: JSON.stringify({ annualGrowthRate: 3.5 }),
    });

    const res = await PATCH(req, { params: Promise.resolve({ id: "asset1" }) });
    expect(res.status).toBe(200);

    const updateCall = mockUpdate.mock.calls[0][1];
    expect(updateCall.annualGrowthRate).toBe(3.5);
    expect(updateCall).not.toHaveProperty("valuations");
    expect(mockUpdate).toHaveBeenCalledTimes(1);
  });

  it("preserves asset.value field untouched", async () => {
    const existingAsset: ManualAsset = {
      id: "asset1",
      label: "Property",
      category: "property",
      value: 750000,
      annualGrowthRate: 2.0,
    };

    mockTransaction.mockImplementation(async (fn: (txn: any) => Promise<void>) => {
      const txn = {
        get: mockGet.mockResolvedValue({
          exists: true,
          data: () => existingAsset,
        }),
        update: mockUpdate,
      };
      await fn(txn);
    });

    const req = new NextRequest("http://localhost/api/user/assets/asset1", {
      method: "PATCH",
      headers: { Authorization: "Bearer test-token" },
      body: JSON.stringify({ annualGrowthRate: 4.0 }),
    });

    const res = await PATCH(req, { params: Promise.resolve({ id: "asset1" }) });
    expect(res.status).toBe(200);

    const updateCall = mockUpdate.mock.calls[0][1];
    expect(updateCall).not.toHaveProperty("value");
    expect(updateCall).not.toHaveProperty("label");
    expect(updateCall).not.toHaveProperty("category");
  });

  it("invalidates financial profile cache after update", async () => {
    const existingAsset: ManualAsset = {
      id: "asset1",
      label: "Asset",
      category: "other",
      value: 10000,
      annualGrowthRate: null,
    };

    mockTransaction.mockImplementation(async (fn: (txn: any) => Promise<void>) => {
      const txn = {
        get: mockGet.mockResolvedValue({
          exists: true,
          data: () => existingAsset,
        }),
        update: mockUpdate,
      };
      await fn(txn);
    });

    const req = new NextRequest("http://localhost/api/user/assets/asset1", {
      method: "PATCH",
      headers: { Authorization: "Bearer test-token" },
      body: JSON.stringify({ annualGrowthRate: 1.5 }),
    });

    await PATCH(req, { params: Promise.resolve({ id: "asset1" }) });

    expect(invalidateFinancialProfileCache).toHaveBeenCalledWith("test-uid", expect.anything());
  });

  it("returns 404 for non-existent asset", async () => {
    mockTransaction.mockImplementation(async (fn: (txn: any) => Promise<void>) => {
      const txn = {
        get: mockGet.mockResolvedValue({
          exists: false,
        }),
        update: mockUpdate,
      };
      await fn(txn);
    });

    const req = new NextRequest("http://localhost/api/user/assets/nonexistent", {
      method: "PATCH",
      headers: { Authorization: "Bearer test-token" },
      body: JSON.stringify({ annualGrowthRate: 5.0 }),
    });

    const res = await PATCH(req, { params: Promise.resolve({ id: "nonexistent" }) });
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toContain("not found");
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
