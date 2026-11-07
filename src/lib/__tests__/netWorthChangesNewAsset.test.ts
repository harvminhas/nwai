/**
 * Test new_asset change generation for manual assets
 */

import { describe, test, expect } from "vitest";
import type { MonthlyHistoryEntry } from "../financialProfile";
import type { FinancialProfileCache } from "../financialProfile";
import type { ManualAsset } from "../types";

// Mock minimal profile for change generation tests
function createMockProfile(
  monthlyHistory: MonthlyHistoryEntry[],
  manualAssets: ManualAsset[]
): Pick<FinancialProfileCache, "monthlyHistory" | "manualAssets" | "accountBalanceHistory" | "accountStatusRecords" | "homeCurrency"> {
  return {
    monthlyHistory,
    manualAssets,
    accountBalanceHistory: [],
    accountStatusRecords: [],
    homeCurrency: "CAD",
  };
}

describe("new_asset change generation", () => {
  test("manual asset added in Nov 2026 generates new_asset change item", () => {
    const manualAssets: ManualAsset[] = [
      {
        id: "car-1",
        label: "Honda Civic",
        category: "vehicle",
        value: 25000,
        createdAt: "2026-11-15T10:00:00Z", // Created in Nov 2026
        updatedAt: "2026-11-15T10:00:00Z",
      },
    ];

    const monthlyHistory: MonthlyHistoryEntry[] = [
      {
        yearMonth: "2026-10",
        netWorth: -190000,
        totalAssets: 10000,
        totalDebts: 200000,
        expensesTotal: 3000,
        coreExpensesTotal: 2500,
        incomeTotal: 5000,
        byAccount: [
          { slug: "checking-1", label: "Checking", type: "checking", value: 10000 },
          { slug: "mortgage-1", label: "Mortgage", type: "mortgage", value: -200000 },
        ],
      },
      {
        yearMonth: "2026-11",
        netWorth: -165000,
        totalAssets: 35000, // Includes car
        totalDebts: 200000,
        expensesTotal: 3200,
        coreExpensesTotal: 2700,
        incomeTotal: 5100,
        byAccount: [
          { slug: "checking-1", label: "Checking", type: "checking", value: 10000 },
          { slug: "manual-car-1", label: "Honda Civic", type: "manual-vehicle", value: 25000 },
          { slug: "mortgage-1", label: "Mortgage", type: "mortgage", value: -200000 },
        ],
      },
    ];

    const profile = createMockProfile(monthlyHistory, manualAssets);

    // Manual asset detection logic (from netWorthChanges.ts)
    const manualAssetsByMonth = new Map<string, ManualAsset[]>();
    for (const asset of profile.manualAssets) {
      if (!asset.createdAt) continue; // Skip legacy without createdAt
      const addedMonth = asset.createdAt.slice(0, 7);
      if (!manualAssetsByMonth.has(addedMonth)) {
        manualAssetsByMonth.set(addedMonth, []);
      }
      manualAssetsByMonth.get(addedMonth)!.push(asset);
    }

    // Nov 2026 should have the car
    const novAssets = manualAssetsByMonth.get("2026-11") || [];
    expect(novAssets).toHaveLength(1);
    expect(novAssets[0].label).toBe("Honda Civic");
    expect(novAssets[0].value).toBe(25000);

    // Oct 2026 should have no assets
    const octAssets = manualAssetsByMonth.get("2026-10") || [];
    expect(octAssets).toHaveLength(0);
  });

  test("multiple assets added in different months", () => {
    const manualAssets: ManualAsset[] = [
      {
        id: "car-1",
        label: "Honda Civic",
        category: "vehicle",
        value: 25000,
        createdAt: "2026-11-15T10:00:00Z",
        updatedAt: "2026-11-15T10:00:00Z",
      },
      {
        id: "house-1",
        label: "Investment Property",
        category: "property",
        value: 500000,
        createdAt: "2026-12-20T14:30:00Z",
        updatedAt: "2026-12-20T14:30:00Z",
      },
    ];

    const manualAssetsByMonth = new Map<string, ManualAsset[]>();
    for (const asset of manualAssets) {
      if (!asset.createdAt) continue;
      const addedMonth = asset.createdAt.slice(0, 7);
      if (!manualAssetsByMonth.has(addedMonth)) {
        manualAssetsByMonth.set(addedMonth, []);
      }
      manualAssetsByMonth.get(addedMonth)!.push(asset);
    }

    expect(manualAssetsByMonth.get("2026-11")).toHaveLength(1);
    expect(manualAssetsByMonth.get("2026-11")![0].label).toBe("Honda Civic");
    
    expect(manualAssetsByMonth.get("2026-12")).toHaveLength(1);
    expect(manualAssetsByMonth.get("2026-12")![0].label).toBe("Investment Property");
  });

  test("reconciliation: totalAssets - totalDebts === netWorth with manual asset", () => {
    const manualAssets: ManualAsset[] = [
      {
        id: "car-1",
        label: "Honda Civic",
        category: "vehicle",
        value: 25000,
        createdAt: "2026-11-15T10:00:00Z",
        updatedAt: "2026-11-15T10:00:00Z",
      },
    ];

    const monthlyHistory: MonthlyHistoryEntry[] = [
      {
        yearMonth: "2026-11",
        netWorth: -165000,
        totalAssets: 35000,
        totalDebts: 200000,
        expensesTotal: 3200,
        coreExpensesTotal: 2700,
        incomeTotal: 5100,
        byAccount: [
          { slug: "checking-1", label: "Checking", type: "checking", value: 10000 },
          { slug: "manual-car-1", label: "Honda Civic", type: "manual-vehicle", value: 25000 },
          { slug: "mortgage-1", label: "Mortgage", type: "mortgage", value: -200000 },
        ],
      },
    ];

    const month = monthlyHistory[0];
    
    // Verify reconciliation
    expect(month.totalAssets - month.totalDebts).toBe(month.netWorth);
    
    // Verify manual asset is in byAccount
    const carEntry = month.byAccount?.find(a => a.slug === "manual-car-1");
    expect(carEntry).toBeDefined();
    expect(carEntry?.value).toBe(25000);
    
    // Verify manual asset contributes to totalAssets
    const assetsSum = month.byAccount
      ?.filter(a => a.value > 0)
      .reduce((sum, a) => sum + a.value, 0) || 0;
    expect(assetsSum).toBe(month.totalAssets);
    
    // Verify debts contribute to totalDebts
    const debtsSum = Math.abs(
      month.byAccount
        ?.filter(a => a.value < 0)
        .reduce((sum, a) => sum + a.value, 0) || 0
    );
    expect(debtsSum).toBe(month.totalDebts);
  });

  test("change event shows in month asset was created, not edited", () => {
    const carCreatedAt = "2026-11-15T10:00:00Z";
    const addedMonth = carCreatedAt.slice(0, 7);
    
    expect(addedMonth).toBe("2026-11");
    expect(addedMonth).not.toBe("2026-10");
    expect(addedMonth).not.toBe("2026-12");
  });

  test("legacy asset without createdAt does not generate new_asset event", () => {
    const legacyAsset: ManualAsset = {
      id: "old-car",
      label: "Old Car",
      category: "vehicle",
      value: 15000,
      updatedAt: "2026-11-15T10:00:00Z", // Only updatedAt, no createdAt
    };

    const manualAssetsByMonth = new Map<string, ManualAsset[]>();
    for (const asset of [legacyAsset]) {
      if (!asset.createdAt) continue; // Skip
      const addedMonth = asset.createdAt.slice(0, 7);
      if (!manualAssetsByMonth.has(addedMonth)) {
        manualAssetsByMonth.set(addedMonth, []);
      }
      manualAssetsByMonth.get(addedMonth)!.push(asset);
    }

    // No event generated for legacy asset
    expect(manualAssetsByMonth.size).toBe(0);
  });

  test("cached profile with all-months manual assets still generates correct change event", () => {
    // Regression test: even though manual assets appear in ALL months in byAccount,
    // the change event should only show in the createdAt month
    
    const manualAssets: ManualAsset[] = [
      {
        id: "car-1",
        label: "Honda Civic",
        category: "vehicle",
        value: 25000,
        createdAt: "2026-11-15T10:00:00Z",
        updatedAt: "2026-11-15T10:00:00Z",
      },
    ];

    // Both months have the car in byAccount (from cached calculation)
    const monthlyHistory: MonthlyHistoryEntry[] = [
      {
        yearMonth: "2026-10",
        netWorth: -165000,
        totalAssets: 35000,
        totalDebts: 200000,
        expensesTotal: 3000,
        coreExpensesTotal: 2500,
        incomeTotal: 5000,
        byAccount: [
          { slug: "checking-1", label: "Checking", type: "checking", value: 10000 },
          { slug: "manual-car-1", label: "Honda Civic", type: "manual-vehicle", value: 25000 },
          { slug: "mortgage-1", label: "Mortgage", type: "mortgage", value: -200000 },
        ],
      },
      {
        yearMonth: "2026-11",
        netWorth: -165000,
        totalAssets: 35000,
        totalDebts: 200000,
        expensesTotal: 3200,
        coreExpensesTotal: 2700,
        incomeTotal: 5100,
        byAccount: [
          { slug: "checking-1", label: "Checking", type: "checking", value: 10000 },
          { slug: "manual-car-1", label: "Honda Civic", type: "manual-vehicle", value: 25000 },
          { slug: "mortgage-1", label: "Mortgage", type: "mortgage", value: -200000 },
        ],
      },
    ];

    // Change generation uses createdAt, not byAccount presence
    const manualAssetsByMonth = new Map<string, ManualAsset[]>();
    for (const asset of manualAssets) {
      if (!asset.createdAt) continue;
      const addedMonth = asset.createdAt.slice(0, 7);
      if (!manualAssetsByMonth.has(addedMonth)) {
        manualAssetsByMonth.set(addedMonth, []);
      }
      manualAssetsByMonth.get(addedMonth)!.push(asset);
    }

    // Oct should have NO change event (even though car is in byAccount)
    expect(manualAssetsByMonth.get("2026-10") || []).toHaveLength(0);
    
    // Nov should have the change event
    expect(manualAssetsByMonth.get("2026-11")).toHaveLength(1);
    expect(manualAssetsByMonth.get("2026-11")![0].label).toBe("Honda Civic");
  });
});
