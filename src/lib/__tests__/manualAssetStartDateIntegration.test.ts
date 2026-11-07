/**
 * Integration test: raw Firestore → profile → core → changes
 * Tests actual production flow, not synthetic logic duplication
 */

import { describe, test, expect, vi } from "vitest";
import { getFinancialProfile, SCHEMA_VERSION } from "../financialProfile";
import { calculateNetWorthForMonths } from "../netWorthCalculationCore";
import type { Firestore } from "firebase-admin/firestore";
import type { ManualAsset } from "../types";

function createMockFirestore(
  cachedProfile: any,
  rawManualAssets: Array<{ id: string; label: string; category: string; value: number; startDate?: string; updatedAt: any }>
): Firestore {
  const mockManualAssetDocs = rawManualAssets.map(asset => ({
    id: asset.id,
    data: () => asset,
  }));

  const createDocRef = (isCache: boolean) => ({
    get: vi.fn(async () => ({
      exists: isCache && !!cachedProfile,
      data: () => (isCache && cachedProfile ? { financialProfile: cachedProfile } : {}),
    })),
    set: vi.fn(async () => {}),
    collection: vi.fn((name: string) => ({
      get: vi.fn(async () => {
        if (name === "manualAssets") {
          return { docs: mockManualAssetDocs };
        }
        return { docs: [] };
      }),
      orderBy: vi.fn(() => ({
        get: vi.fn(async () => ({ docs: [] })),
      })),
    })),
  });

  return {
    collection: vi.fn((path: string) => {
      if (path === "statements") {
        return {
          where: vi.fn(() => ({
            where: vi.fn(() => ({
              orderBy: vi.fn(() => ({
                get: vi.fn(async () => ({ docs: [] })),
              })),
              get: vi.fn(async () => ({ docs: [] })),
            })),
            get: vi.fn(async () => ({ docs: [] })),
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
            get: vi.fn(async () => ({ docs: mockManualAssetDocs })),
          })),
          get: vi.fn(async () => ({ docs: mockManualAssetDocs })),
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
}

describe("Manual Asset Start Date - Production Integration", () => {
  test("raw Firestore startDate propagates through profile to core inclusion", async () => {
    const rawManualAssets = [
      {
        id: "car-1",
        label: "Honda Civic",
        category: "vehicle",
        value: 25000,
        startDate: "2026-11-15",
        updatedAt: new Date("2026-11-15T10:00:00Z"),
      },
    ];

    const db = createMockFirestore(null, rawManualAssets);
    const profile = await getFinancialProfile("test-uid", db);

    // Assert startDate propagated to profile
    expect(profile.manualAssets).toHaveLength(1);
    expect(profile.manualAssets[0].startDate).toBe("2026-11-15");

    // Build month history
    const history = [
      { yearMonth: "2026-10", netWorth: 0, totalAssets: 0, totalDebts: 0 },
      { yearMonth: "2026-11", netWorth: 0, totalAssets: 0, totalDebts: 0 },
      { yearMonth: "2026-12", netWorth: 0, totalAssets: 0, totalDebts: 0 },
    ];

    const toHome = (v: number) => v;
    calculateNetWorthForMonths(history, [], profile.manualAssets, toHome, new Map());

    // Assert month-based inclusion
    expect(history[0].byAccount?.find(a => a.slug === "manual-car-1")).toBeUndefined(); // Oct: before start
    expect(history[1].byAccount?.find(a => a.slug === "manual-car-1")).toBeDefined(); // Nov: start month
    expect(history[2].byAccount?.find(a => a.slug === "manual-car-1")).toBeDefined(); // Dec: after start
  });

  test("legacy asset without startDate included in all months", async () => {
    const rawManualAssets = [
      {
        id: "old-car",
        label: "Legacy Car",
        category: "vehicle",
        value: 15000,
        // No startDate
        updatedAt: new Date("2026-10-01T00:00:00Z"),
      },
    ];

    const db = createMockFirestore(null, rawManualAssets);
    const profile = await getFinancialProfile("test-uid", db);

    expect(profile.manualAssets[0].startDate).toBeUndefined();

    const history = [
      { yearMonth: "2026-10", netWorth: 0, totalAssets: 0, totalDebts: 0 },
      { yearMonth: "2026-11", netWorth: 0, totalAssets: 0, totalDebts: 0 },
    ];

    const toHome = (v: number) => v;
    calculateNetWorthForMonths(history, [], profile.manualAssets, toHome, new Map());

    // Legacy asset in all months
    expect(history[0].byAccount?.find(a => a.slug === "manual-old-car")).toBeDefined();
    expect(history[1].byAccount?.find(a => a.slug === "manual-old-car")).toBeDefined();
  });

  test("v69 cache with startDate-based exclusion returns without rebuild", async () => {
    const validCache = {
      schemaVersion: SCHEMA_VERSION, // v69
      sourceVersion: "v1",
      updatedAt: new Date(Date.now() - 60000).toISOString(),
      cacheStale: false,
      homeCurrency: "CAD",
      manualAssets: [
        { id: "car-1", label: "Honda Civic", category: "vehicle", value: 25000, startDate: "2026-11-15", updatedAt: "2026-11-15T10:00:00Z" },
      ],
      monthlyHistory: [
        {
          yearMonth: "2026-10",
          netWorth: 0,
          totalAssets: 0,
          totalDebts: 0,
          byAccount: [], // Car not in Oct (before start)
        },
        {
          yearMonth: "2026-11",
          netWorth: 25000,
          totalAssets: 25000,
          totalDebts: 0,
          byAccount: [
            { slug: "manual-car-1", label: "Honda Civic", type: "manual-vehicle", value: 25000 },
          ],
        },
      ],
      accountBalanceHistory: [],
      allTxMonths: ["2026-10", "2026-11"],
      expenseTxns: [],
      incomeTxns: [],
    };

    let sourceReadCount = 0;
    const rawManualAssets = [
      {
        id: "car-1",
        label: "Honda Civic",
        category: "vehicle",
        value: 25000,
        startDate: "2026-11-15",
        updatedAt: new Date("2026-11-15T10:00:00Z"),
      },
    ];

    const db = createMockFirestore(validCache, rawManualAssets);
    
    // Wrap collection to track source reads
    const origCollection = db.collection;
    (db as any).collection = vi.fn((path: string) => {
      const coll = origCollection(path);
      if (path === "statements" || path.startsWith("users/") && path.includes("/manualAssets")) {
        const origGet = coll.get || (() => ({ docs: [] }));
        (coll as any).get = vi.fn(async () => {
          sourceReadCount++;
          return origGet();
        });
      }
      return coll;
    });

    const profile = await getFinancialProfile("test-uid", db);

    // v69 cache with startDate exclusion should be valid - no rebuild
    expect(sourceReadCount).toBe(0); // No source reads
    expect(profile.manualAssets[0].startDate).toBe("2026-11-15");
    expect(profile.monthlyHistory[0].byAccount).toHaveLength(0); // Oct: no car
    expect(profile.monthlyHistory[1].byAccount).toHaveLength(1); // Nov: has car
  });
});
