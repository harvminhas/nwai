/**
 * Test cache schema validation with production getFinancialProfile
 * 
 * Tests actual cache return path with mocked Firestore, not duplicated predicates.
 * Verifies old cached profiles trigger rebuild when byAccount incomplete.
 */

import { describe, test, expect, vi } from "vitest";
import { getFinancialProfile, SCHEMA_VERSION } from "../financialProfile";
import type { Firestore } from "firebase-admin/firestore";

function createMockDbWithData(cachedProfile: any, rawManualAssets: any[] = [], rawStatements: any[] = []): {
  db: Firestore;
  counters: { sourceReadCount: number; cacheWriteCount: number };
} {
  const counters = { sourceReadCount: 0, cacheWriteCount: 0 };

  const mockStatementDocs = rawStatements.map(stmt => ({
    id: stmt.id,
    data: () => stmt,
  }));

  const mockManualAssetDocs = rawManualAssets.map(asset => ({
    id: asset.id,
    data: () => asset,
  }));

  const createDocRef = (isCache: boolean) => ({
    get: vi.fn(async () => {
      if (isCache) {
        return {
          exists: !!cachedProfile,
          data: () => (cachedProfile ? { financialProfile: cachedProfile } : {}),
        };
      }
      return { exists: false, data: () => ({}) };
    }),
    set: vi.fn(async () => {
      counters.cacheWriteCount++;
    }),
    collection: vi.fn((name: string) => ({
      get: vi.fn(async () => {
        if (name === "manualAssets") {
          counters.sourceReadCount++;
          return { docs: mockManualAssetDocs };
        }
        return { docs: [] };
      }),
      orderBy: vi.fn(() => ({
        get: vi.fn(async () => ({ docs: [] })),
      })),
    })),
  });

  const db = {
    collection: vi.fn((path: string) => {
      if (path === "statements") {
        return {
          where: vi.fn(() => ({
            where: vi.fn(() => ({
              orderBy: vi.fn(() => ({
                get: vi.fn(async () => {
                  counters.sourceReadCount++;
                  return { docs: mockStatementDocs };
                }),
              })),
              get: vi.fn(async () => {
                counters.sourceReadCount++;
                return { docs: mockStatementDocs };
              }),
            })),
            get: vi.fn(async () => {
              counters.sourceReadCount++;
              return { docs: mockStatementDocs };
            }),
          })),
        };
      }
      if (path === "users") {
        return {
          doc: vi.fn((uid: string) => createDocRef(uid === "test-uid")),
        };
      }
      if (path.startsWith("users/") && path.includes("/manualAssets")) {
        return {
          orderBy: vi.fn(() => ({
            get: vi.fn(async () => {
              counters.sourceReadCount++;
              return { docs: mockManualAssetDocs };
            }),
          })),
          get: vi.fn(async () => {
            counters.sourceReadCount++;
            return { docs: mockManualAssetDocs };
          }),
        };
      }
      return {
        where: vi.fn(() => ({
          where: vi.fn(() => ({
            get: vi.fn(async () => ({ docs: [] })),
          })),
          get: vi.fn(async () => ({ docs: [] })),
        })),
        orderBy: vi.fn(() => ({
          get: vi.fn(async () => ({ docs: [] })),
        })),
        get: vi.fn(async () => ({ docs: [] })),
      };
    }),
    doc: vi.fn((path: string) => createDocRef(path === "users/test-uid")),
  } as unknown as Firestore;

  return { db, counters };
}

describe("Cache Schema Validation - Production Path", () => {
  const mockRawManualAssets = [
    { id: "car-1", label: "Car", category: "vehicle", value: 25000, currency: "CAD", updatedAt: "2026-11-01" },
  ];

  const mockRawStatements = [
    {
      id: "checking-stmt",
      userId: "test-uid",
      status: "completed",
      accountId: "checking-1",
      accountName: "Checking",
      accountType: "checking",
      institutionName: "Bank",
      currency: "CAD",
      balances: [{ date: "2026-11-15", balance: 10000 }],
    },
    {
      id: "mortgage-stmt",
      userId: "test-uid",
      status: "completed",
      accountId: "mortgage-1",
      accountName: "Mortgage",
      accountType: "mortgage",
      institutionName: "Bank",
      currency: "CAD",
      balances: [{ date: "2026-11-15", balance: -200000 }],
    },
  ];

  test("old schema version (68) with manual assets triggers rebuild", async () => {
    const oldCache = {
      schemaVersion: "68", // Old schema version
      sourceVersion: "v1",
      updatedAt: new Date(Date.now() - 120000).toISOString(),
      cacheStale: false,
      homeCurrency: "CAD",
      manualAssets: [
        { id: "car-1", label: "Car", category: "vehicle", value: 25000, updatedAt: "2026-11-01" },
      ],
      monthlyHistory: [
        {
          yearMonth: "2026-11",
          netWorth: -165000,
          totalAssets: 35000, // Includes car
          totalDebts: 200000,
          byAccount: [
            { slug: "checking-1", label: "Checking", type: "checking", value: 10000 },
            { slug: "mortgage-1", label: "Mortgage", type: "mortgage", value: -200000 },
          ],
        },
      ],
      accountBalanceHistory: [],
      allTxMonths: ["2026-11"],
      expenseTxns: [],
      incomeTxns: [],
    };

    const mock = createMockDbWithData(oldCache, mockRawManualAssets, mockRawStatements);
    const profile = await getFinancialProfile("test-uid", mock.db);
    
    expect(mock.counters.sourceReadCount, "Should read from source on rebuild due to schema mismatch").toBeGreaterThan(0);
    expect(mock.counters.cacheWriteCount, "Should write cache on rebuild").toBe(1);
    expect(profile.manualAssets).toHaveLength(1);
    expect(profile.manualAssets[0].id).toBe("car-1");
    
    if (profile.monthlyHistory.length > 0) {
      const month = profile.monthlyHistory[0];
      const carEntries = month.byAccount?.filter(a => a.slug === "manual-car-1") || [];
      expect(carEntries.length, "Car should appear exactly once in byAccount").toBe(1);
      expect(month.totalAssets).toBeGreaterThan(0);
      expect(month.totalDebts).toBeLessThan(0);
    }
  });

  test("current schema (69) with manual assets excluded by startDate accepts cache", async () => {
    const cacheWithDateFilteredAsset = {
      schemaVersion: SCHEMA_VERSION,
      sourceVersion: "v1",
      updatedAt: new Date(Date.now() - 120000).toISOString(),
      cacheStale: false,
      homeCurrency: "CAD",
      manualAssets: [
        { id: "car-1", label: "Car", category: "vehicle", value: 25000, updatedAt: "2026-11-01", startDate: "2026-12-01" },
      ],
      monthlyHistory: [
        {
          yearMonth: "2026-11",
          netWorth: 0,
          totalAssets: 0,
          totalDebts: 0,
          byAccount: [], // Car not in byAccount because startDate is 2026-12-01
        },
      ],
      accountBalanceHistory: [],
      allTxMonths: ["2026-11"],
      expenseTxns: [],
      incomeTxns: [],
    };

    const mock = createMockDbWithData(cacheWithDateFilteredAsset, mockRawManualAssets, mockRawStatements);
    const profile = await getFinancialProfile("test-uid", mock.db);
    
    expect(mock.counters.sourceReadCount, "Should accept cache with startDate-filtered assets").toBe(0);
    expect(mock.counters.cacheWriteCount, "Should not rebuild").toBe(0);
  });

  test("old schema (68) with partially populated byAccount triggers rebuild", async () => {
    const twoManualAssets = [
      { id: "car-1", label: "Car", category: "vehicle", value: 25000, currency: "CAD", updatedAt: "2026-11-01" },
      { id: "house-1", label: "House", category: "property", value: 500000, currency: "CAD", updatedAt: "2026-11-01" },
    ];

    const partialCache = {
      schemaVersion: "68", // Old schema version
      sourceVersion: "v1",
      updatedAt: new Date(Date.now() - 120000).toISOString(),
      cacheStale: false,
      homeCurrency: "CAD",
      manualAssets: [
        { id: "car-1", label: "Car", category: "vehicle", value: 25000, updatedAt: "2026-11-01" },
        { id: "house-1", label: "House", category: "property", value: 500000, updatedAt: "2026-11-01" },
      ],
      monthlyHistory: [
        {
          yearMonth: "2026-11",
          netWorth: 525000,
          totalAssets: 525000,
          totalDebts: 0,
          byAccount: [
            { slug: "manual-car-1", label: "Car", type: "manual-vehicle", value: 25000 },
          ],
        },
      ],
      accountBalanceHistory: [],
      allTxMonths: ["2026-11"],
      expenseTxns: [],
      incomeTxns: [],
    };

    const mock = createMockDbWithData(partialCache, twoManualAssets, mockRawStatements);
    const profile = await getFinancialProfile("test-uid", mock.db);
    
    expect(mock.counters.sourceReadCount, "Should read from source on rebuild due to schema mismatch").toBeGreaterThan(0);
    expect(mock.counters.cacheWriteCount, "Should write cache on rebuild").toBe(1);
    
    if (profile.monthlyHistory.length > 0) {
      const month = profile.monthlyHistory[0];
      const carEntries = month.byAccount?.filter(a => a.slug === "manual-car-1") || [];
      const houseEntries = month.byAccount?.filter(a => a.slug === "manual-house-1") || [];
      expect(carEntries.length, "Car should appear exactly once").toBe(1);
      expect(houseEntries.length, "House should appear exactly once").toBe(1);
    }
  });

  test("valid cache: all manual assets in byAccount returns cached", async () => {
    const validCache = {
      schemaVersion: SCHEMA_VERSION,
      sourceVersion: "v1",
      updatedAt: new Date(Date.now() - 60000).toISOString(), // 1min old (hot)
      cacheStale: false,
      homeCurrency: "CAD",
      manualAssets: [
        { id: "car-1", label: "Car", category: "vehicle", value: 25000, updatedAt: "2026-11-01" },
      ],
      monthlyHistory: [
        {
          yearMonth: "2026-11",
          netWorth: 25000,
          totalAssets: 25000,
          totalDebts: 0,
          byAccount: [
            { slug: "manual-car-1", label: "Car", type: "manual-vehicle", value: 25000 },
          ],
        },
      ],
      accountBalanceHistory: [],
      allTxMonths: ["2026-11"],
      expenseTxns: [],
      incomeTxns: [],
    };

    const mock = createMockDbWithData(validCache, mockRawManualAssets, mockRawStatements);
    const profile = await getFinancialProfile("test-uid", mock.db);
    
    expect(mock.counters.sourceReadCount, "Should NOT read from source when cache valid").toBe(0);
    expect(mock.counters.cacheWriteCount, "Should NOT write cache when returning cached").toBe(0);
    expect(profile.manualAssets).toHaveLength(1);
    expect(profile.manualAssets[0].id).toBe("car-1");
    expect(profile.monthlyHistory[0].yearMonth).toBe("2026-11");
    expect(profile.monthlyHistory[0].netWorth).toBe(25000);
    expect(profile.monthlyHistory[0].totalAssets).toBe(25000);
    expect(profile.monthlyHistory[0].totalDebts).toBe(0);
    
    const car = profile.monthlyHistory[0].byAccount?.find(a => a.slug === "manual-car-1");
    expect(car, "Cached car should be present").toBeDefined();
    expect(car?.value).toBe(25000);
  });

  test("cacheStale bypasses hot and warm return", async () => {
    const staleCache = {
      schemaVersion: SCHEMA_VERSION,
      sourceVersion: "v1",
      updatedAt: new Date(Date.now() - 60000).toISOString(), // 1min (hot window)
      cacheStale: true,
      homeCurrency: "CAD",
      manualAssets: [],
      monthlyHistory: [],
      accountBalanceHistory: [],
      allTxMonths: [],
      expenseTxns: [],
      incomeTxns: [],
    };

    const mock = createMockDbWithData(staleCache, [], mockRawStatements);
    const profile = await getFinancialProfile("test-uid", mock.db);
    
    expect(mock.counters.sourceReadCount, "cacheStale should trigger rebuild (source read)").toBeGreaterThan(0);
    expect(mock.counters.cacheWriteCount, "cacheStale should trigger rebuild (cache write)").toBe(1);
    expect(profile).toBeDefined();
  });

  test("no manual assets does not trigger rebuild", async () => {
    const noManualCache = {
      schemaVersion: SCHEMA_VERSION,
      sourceVersion: "v1",
      updatedAt: new Date(Date.now() - 60000).toISOString(),
      cacheStale: false,
      homeCurrency: "CAD",
      manualAssets: [],
      monthlyHistory: [
        {
          yearMonth: "2026-11",
          netWorth: -190000,
          totalAssets: 10000,
          totalDebts: 200000,
          byAccount: [
            { slug: "checking-1", label: "Checking", type: "checking", value: 10000 },
            { slug: "mortgage-1", label: "Mortgage", type: "mortgage", value: -200000 },
          ],
        },
      ],
      accountBalanceHistory: [],
      allTxMonths: ["2026-11"],
      expenseTxns: [],
      incomeTxns: [],
    };

    const mock = createMockDbWithData(noManualCache, [], mockRawStatements);
    const profile = await getFinancialProfile("test-uid", mock.db);
    
    expect(mock.counters.sourceReadCount, "No manual assets: should NOT read source").toBe(0);
    expect(mock.counters.cacheWriteCount, "No manual assets: should NOT write cache").toBe(0);
    expect(profile.manualAssets).toHaveLength(0);
    expect(profile.monthlyHistory[0].netWorth).toBe(-190000);
  });
});
