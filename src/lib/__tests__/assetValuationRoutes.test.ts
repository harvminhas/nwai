/**
 * Test asset valuation API routes with mocked Firestore.
 * Tests the actual production route handlers, not synthetic copies.
 */

import { describe, test, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// Mock Firestore
const mockTransaction = {
  get: vi.fn(),
  update: vi.fn(),
  set: vi.fn(),
};

const mockDocRef = {
  get: vi.fn(),
  update: vi.fn(),
  set: vi.fn(),
  delete: vi.fn(),
};

const mockDb = {
  collection: vi.fn(() => ({
    doc: vi.fn(() => ({
      collection: vi.fn(() => ({
        doc: vi.fn(() => mockDocRef),
      })),
    })),
  })),
  runTransaction: vi.fn(async (callback) => {
    return await callback(mockTransaction);
  }),
};

const mockAuth = {
  verifyIdToken: vi.fn(async () => ({ uid: "test-uid" })),
};

vi.mock("@/lib/firebase-admin", () => ({
  getFirebaseAdmin: () => ({ db: mockDb, auth: mockAuth }),
}));

vi.mock("@/lib/financialProfile", () => ({
  invalidateFinancialProfileCache: vi.fn(),
}));

vi.mock("@/lib/dateUtils", () => ({
  getTodayInNewYork: () => "2026-11-07",
  isValidDateString: (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d),
}));

describe("Asset Valuation Routes - POST", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("appends dated valuation with unique ID using transaction", async () => {
    const existingAsset = {
      value: 30000,
      valuations: [
        { id: "val1", effectiveDate: "2026-10-15", valueCents: 3000000, createdAt: "2026-10-15T10:00:00Z" }
      ],
      updatedAt: "2026-10-15T10:00:00Z",
    };

    mockTransaction.get.mockResolvedValue({
      exists: true,
      data: () => existingAsset,
    });

    const { POST } = await import("@/app/api/user/assets/[id]/valuations/route");
    
    const req = new NextRequest("http://localhost/api/user/assets/asset1/valuations", {
      method: "POST",
      headers: { Authorization: "Bearer test-token" },
      body: JSON.stringify({
        valueCents: 2900000,
        effectiveDate: "2026-11-07",
      }),
    });

    const response = await POST(req, { params: Promise.resolve({ id: "asset1" }) });
    const result = await response.json();

    expect(result.ok).toBe(true);
    expect(mockDb.runTransaction).toHaveBeenCalled();
    expect(mockTransaction.update).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        valuations: expect.arrayContaining([
          expect.objectContaining({ id: expect.any(String), valueCents: 2900000 })
        ]),
        value: 29000,
      })
    );
  });

  test("preserves legacy baseline on first valuation", async () => {
    const legacyAsset = {
      value: 30000,
      valuations: [],
      startDate: "2026-10-01",
      updatedAt: "2026-10-01T00:00:00Z",
    };

    mockTransaction.get.mockResolvedValue({
      exists: true,
      data: () => legacyAsset,
    });

    const { POST } = await import("@/app/api/user/assets/[id]/valuations/route");
    
    const req = new NextRequest("http://localhost/api/user/assets/asset1/valuations", {
      method: "POST",
      headers: { Authorization: "Bearer test-token" },
      body: JSON.stringify({
        valueCents: 2900000,
        effectiveDate: "2026-11-07",
      }),
    });

    const response = await POST(req, { params: Promise.resolve({ id: "asset1" }) });
    const result = await response.json();

    expect(result.ok).toBe(true);
    
    const updateCall = mockTransaction.update.mock.calls[0][1];
    expect(updateCall.valuations).toHaveLength(2);
    expect(updateCall.valuations[0]).toMatchObject({
      effectiveDate: "2026-10-01",
      valueCents: 3000000, // Preserved original
    });
    expect(updateCall.valuations[1]).toMatchObject({
      effectiveDate: "2026-11-07",
      valueCents: 2900000,
    });
  });

  test("validates valueCents is finite number", async () => {
    const { POST } = await import("@/app/api/user/assets/[id]/valuations/route");
    
    const req = new NextRequest("http://localhost/api/user/assets/asset1/valuations", {
      method: "POST",
      headers: { Authorization: "Bearer test-token" },
      body: JSON.stringify({
        valueCents: Infinity,
        effectiveDate: "2026-11-07",
      }),
    });

    const response = await POST(req, { params: Promise.resolve({ id: "asset1" }) });
    expect(response.status).toBe(400);
    const result = await response.json();
    expect(result.error).toContain("finite number");
  });

  test("validates effectiveDate format", async () => {
    const { POST } = await import("@/app/api/user/assets/[id]/valuations/route");
    
    const req = new NextRequest("http://localhost/api/user/assets/asset1/valuations", {
      method: "POST",
      headers: { Authorization: "Bearer test-token" },
      body: JSON.stringify({
        valueCents: 3000000,
        effectiveDate: "2026-11", // Invalid format
      }),
    });

    const response = await POST(req, { params: Promise.resolve({ id: "asset1" }) });
    expect(response.status).toBe(400);
  });

  test("sorts valuations by date then createdAt", async () => {
    const existingAsset = {
      value: 30000,
      valuations: [
        { id: "val1", effectiveDate: "2026-11-07", valueCents: 3000000, createdAt: "2026-11-07T10:00:00Z" },
        { id: "val2", effectiveDate: "2026-10-15", valueCents: 3100000, createdAt: "2026-10-15T10:00:00Z" },
      ],
      updatedAt: "2026-10-15T10:00:00Z",
    };

    mockTransaction.get.mockResolvedValue({
      exists: true,
      data: () => existingAsset,
    });

    const { POST } = await import("@/app/api/user/assets/[id]/valuations/route");
    
    const req = new NextRequest("http://localhost/api/user/assets/asset1/valuations", {
      method: "POST",
      headers: { Authorization: "Bearer test-token" },
      body: JSON.stringify({
        valueCents: 2950000,
        effectiveDate: "2026-11-07", // Same day as val1
      }),
    });

    await POST(req, { params: Promise.resolve({ id: "asset1" }) });

    const updateCall = mockTransaction.update.mock.calls[0][1];
    const valuations = updateCall.valuations;
    
    // Should be sorted: Oct < Nov (first same-day) < Nov (second same-day)
    expect(valuations[0].effectiveDate).toBe("2026-10-15");
    expect(valuations[1].effectiveDate).toBe("2026-11-07");
    expect(valuations[1].id).toBe("val1"); // Earlier createdAt
    expect(valuations[2].effectiveDate).toBe("2026-11-07");
    expect(valuations[2].valueCents).toBe(2950000); // New one has later createdAt
  });
});

describe("Asset Valuation Routes - DELETE", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("deletes specific valuation by ID using transaction", async () => {
    const existingAsset = {
      value: 29000,
      valuations: [
        { id: "val1", effectiveDate: "2026-10-15", valueCents: 3100000, createdAt: "2026-10-15T10:00:00Z" },
        { id: "val2", effectiveDate: "2026-11-07", valueCents: 2900000, createdAt: "2026-11-07T10:00:00Z" },
      ],
    };

    mockTransaction.get.mockResolvedValue({
      exists: true,
      data: () => existingAsset,
    });

    const { DELETE } = await import("@/app/api/user/assets/[id]/valuations/route");
    
    const req = new NextRequest("http://localhost/api/user/assets/asset1/valuations?valuationId=val2", {
      method: "DELETE",
      headers: { Authorization: "Bearer test-token" },
    });

    const response = await DELETE(req, { params: Promise.resolve({ id: "asset1" }) });
    const result = await response.json();

    expect(result.ok).toBe(true);
    expect(mockDb.runTransaction).toHaveBeenCalled();
    
    const updateCall = mockTransaction.update.mock.calls[0][1];
    expect(updateCall.valuations).toHaveLength(1);
    expect(updateCall.valuations[0].id).toBe("val1");
    expect(updateCall.value).toBe(31000); // Falls back to remaining valuation
  });

  test("prevents deleting the only valuation", async () => {
    const existingAsset = {
      value: 30000,
      valuations: [
        { id: "val1", effectiveDate: "2026-10-15", valueCents: 3000000, createdAt: "2026-10-15T10:00:00Z" },
      ],
    };

    mockTransaction.get.mockResolvedValue({
      exists: true,
      data: () => existingAsset,
    });

    const { DELETE } = await import("@/app/api/user/assets/[id]/valuations/route");
    
    const req = new NextRequest("http://localhost/api/user/assets/asset1/valuations?valuationId=val1", {
      method: "DELETE",
      headers: { Authorization: "Bearer test-token" },
    });

    const response = await DELETE(req, { params: Promise.resolve({ id: "asset1" }) });
    expect(response.status).toBe(400);
    const result = await response.json();
    expect(result.error).toContain("Cannot delete the only valuation");
  });

  test("handles multiple same-day entries correctly", async () => {
    const existingAsset = {
      value: 29000,
      valuations: [
        { id: "val1", effectiveDate: "2026-11-07", valueCents: 3000000, createdAt: "2026-11-07T09:00:00Z" },
        { id: "val2", effectiveDate: "2026-11-07", valueCents: 2950000, createdAt: "2026-11-07T10:00:00Z" },
        { id: "val3", effectiveDate: "2026-11-07", valueCents: 2900000, createdAt: "2026-11-07T11:00:00Z" },
      ],
    };

    mockTransaction.get.mockResolvedValue({
      exists: true,
      data: () => existingAsset,
    });

    const { DELETE } = await import("@/app/api/user/assets/[id]/valuations/route");
    
    // Delete the middle one
    const req = new NextRequest("http://localhost/api/user/assets/asset1/valuations?valuationId=val2", {
      method: "DELETE",
      headers: { Authorization: "Bearer test-token" },
    });

    const response = await DELETE(req, { params: Promise.resolve({ id: "asset1" }) });
    const result = await response.json();

    expect(result.ok).toBe(true);
    
    const updateCall = mockTransaction.update.mock.calls[0][1];
    expect(updateCall.valuations).toHaveLength(2);
    expect(updateCall.valuations.find((v: any) => v.id === "val1")).toBeDefined();
    expect(updateCall.valuations.find((v: any) => v.id === "val3")).toBeDefined();
    expect(updateCall.valuations.find((v: any) => v.id === "val2")).toBeUndefined();
  });
});

describe("Asset Routes - PUT with valuations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("appends valuation when value changes", async () => {
    const existingAsset = {
      label: "Car",
      category: "vehicle",
      value: 30000,
      valuations: [
        { id: "val1", effectiveDate: "2026-10-15", valueCents: 3000000, createdAt: "2026-10-15T10:00:00Z" },
      ],
      updatedAt: "2026-10-15T10:00:00Z",
    };

    mockTransaction.get.mockResolvedValue({
      exists: true,
      data: () => existingAsset,
    });

    const { PUT } = await import("@/app/api/user/assets/[id]/route");
    
    const req = new NextRequest("http://localhost/api/user/assets/asset1", {
      method: "PUT",
      headers: { Authorization: "Bearer test-token" },
      body: JSON.stringify({
        label: "Car",
        category: "vehicle",
        value: 29000, // Value changed
      }),
    });

    const response = await PUT(req, { params: Promise.resolve({ id: "asset1" }) });
    const result = await response.json();

    expect(result.ok).toBe(true);
    expect(mockDb.runTransaction).toHaveBeenCalled();
    
    const setCall = mockTransaction.set.mock.calls[0][1];
    expect(setCall.valuations).toHaveLength(2);
    expect(setCall.valuations[1]).toMatchObject({
      effectiveDate: "2026-11-07",
      valueCents: 2900000,
    });
  });

  test("does NOT append valuation when only label changes", async () => {
    const existingAsset = {
      label: "Car",
      category: "vehicle",
      value: 30000,
      valuations: [
        { id: "val1", effectiveDate: "2026-10-15", valueCents: 3000000, createdAt: "2026-10-15T10:00:00Z" },
      ],
      updatedAt: "2026-10-15T10:00:00Z",
    };

    mockTransaction.get.mockResolvedValue({
      exists: true,
      data: () => existingAsset,
    });

    const { PUT } = await import("@/app/api/user/assets/[id]/route");
    
    const req = new NextRequest("http://localhost/api/user/assets/asset1", {
      method: "PUT",
      headers: { Authorization: "Bearer test-token" },
      body: JSON.stringify({
        label: "Honda Civic", // Only name changed
        category: "vehicle",
        value: 30000, // Same value
      }),
    });

    const response = await PUT(req, { params: Promise.resolve({ id: "asset1" }) });
    const result = await response.json();

    expect(result.ok).toBe(true);
    
    const setCall = mockTransaction.set.mock.calls[0][1];
    expect(setCall.valuations).toBeUndefined(); // No valuations update
  });

  test("does NOT append valuation when only rate changes", async () => {
    const existingAsset = {
      label: "House",
      category: "property",
      value: 500000,
      annualGrowthRate: null,
      valuations: [
        { id: "val1", effectiveDate: "2026-10-15", valueCents: 50000000, createdAt: "2026-10-15T10:00:00Z" },
      ],
      updatedAt: "2026-10-15T10:00:00Z",
    };

    mockTransaction.get.mockResolvedValue({
      exists: true,
      data: () => existingAsset,
    });

    const { PUT } = await import("@/app/api/user/assets/[id]/route");
    
    const req = new NextRequest("http://localhost/api/user/assets/asset1", {
      method: "PUT",
      headers: { Authorization: "Bearer test-token" },
      body: JSON.stringify({
        label: "House",
        category: "property",
        value: 500000, // Same value
        annualGrowthRate: 5, // Only rate changed
      }),
    });

    const response = await PUT(req, { params: Promise.resolve({ id: "asset1" }) });
    const result = await response.json();

    expect(result.ok).toBe(true);
    
    const setCall = mockTransaction.set.mock.calls[0][1];
    expect(setCall.valuations).toBeUndefined(); // No valuations update
    expect(setCall.annualGrowthRate).toBe(5); // Rate updated
  });

  test("preserves old value as baseline on first value edit", async () => {
    const legacyAsset = {
      label: "Car",
      category: "vehicle",
      value: 30000,
      valuations: [],
      startDate: "2026-10-01",
      updatedAt: "2026-10-01T00:00:00Z",
    };

    mockTransaction.get.mockResolvedValue({
      exists: true,
      data: () => legacyAsset,
    });

    const { PUT } = await import("@/app/api/user/assets/[id]/route");
    
    const req = new NextRequest("http://localhost/api/user/assets/asset1", {
      method: "PUT",
      headers: { Authorization: "Bearer test-token" },
      body: JSON.stringify({
        label: "Car",
        category: "vehicle",
        value: 29000, // First value change
      }),
    });

    await PUT(req, { params: Promise.resolve({ id: "asset1" }) });

    const setCall = mockTransaction.set.mock.calls[0][1];
    expect(setCall.valuations).toHaveLength(2);
    expect(setCall.valuations[0]).toMatchObject({
      effectiveDate: "2026-10-01",
      valueCents: 3000000, // OLD value preserved as baseline
    });
    expect(setCall.valuations[1]).toMatchObject({
      effectiveDate: "2026-11-07",
      valueCents: 2900000, // NEW value
    });
  });

  test("validates calendar dates correctly", async () => {
    mockTransaction.get.mockResolvedValue({
      exists: true,
      data: () => ({
        label: "Car",
        value: 30000,
        valuations: [],
      }),
    });

    const { PUT } = await import("@/app/api/user/assets/[id]/route");
    
    // Invalid: Feb 30
    const req = new NextRequest("http://localhost/api/user/assets/asset1", {
      method: "PUT",
      headers: { Authorization: "Bearer test-token" },
      body: JSON.stringify({
        label: "Car",
        category: "vehicle",
        value: 30000,
        startDate: "2024-02-30", // Invalid calendar date
      }),
    });

    const response = await PUT(req, { params: Promise.resolve({ id: "asset1" }) });
    expect(response.status).toBe(400);
    const result = await response.json();
    expect(result.error).toContain("valid calendar date");
  });

  test("accepts valid calendar dates including leap year", async () => {
    mockTransaction.get.mockResolvedValue({
      exists: true,
      data: () => ({
        label: "Car",
        value: 30000,
        valuations: [],
      }),
    });

    const { PUT } = await import("@/app/api/user/assets/[id]/route");
    
    // Valid: Feb 29 in leap year
    const req = new NextRequest("http://localhost/api/user/assets/asset1", {
      method: "PUT",
      headers: { Authorization: "Bearer test-token" },
      body: JSON.stringify({
        label: "Car",
        category: "vehicle",
        value: 30000,
        startDate: "2024-02-29", // Valid leap year date
      }),
    });

    const response = await PUT(req, { params: Promise.resolve({ id: "asset1" }) });
    expect(response.status).toBe(200);
  });
});
