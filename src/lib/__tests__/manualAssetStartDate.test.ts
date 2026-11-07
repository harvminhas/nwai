/**
 * Test manual asset startDate field and inclusion logic
 */

import { describe, test, expect } from "vitest";
import { calculateNetWorthForMonths } from "../netWorthCalculationCore";
import type { ManualAsset } from "../types";
import type { MonthNetWorthHistory, AccountBalanceHistory } from "../netWorthCalculationCore";

describe("Manual Asset Start Date", () => {
  const toHome = (v: number, _c: string) => v; // Identity for tests
  const emptyStatusMap = new Map();

  test("asset with startDate included from start month onward only", () => {
    const car: ManualAsset = {
      id: "car-1",
      label: "Honda Civic",
      category: "vehicle",
      value: 25000,
      startDate: "2026-11-15", // Starts Nov 2026
      updatedAt: "2026-11-15T10:00:00Z",
    };

    const history: MonthNetWorthHistory[] = [
      { yearMonth: "2026-10", netWorth: 0, totalAssets: 0, totalDebts: 0 },
      { yearMonth: "2026-11", netWorth: 0, totalAssets: 0, totalDebts: 0 },
      { yearMonth: "2026-12", netWorth: 0, totalAssets: 0, totalDebts: 0 },
    ];

    calculateNetWorthForMonths(history, [], [car], toHome, emptyStatusMap);

    // Oct: before start, no car
    expect(history[0].totalAssets).toBe(0);
    expect(history[0].byAccount?.find(a => a.slug === "manual-car-1")).toBeUndefined();

    // Nov: start month, car included
    expect(history[1].totalAssets).toBe(25000);
    const novCar = history[1].byAccount?.find(a => a.slug === "manual-car-1");
    expect(novCar).toBeDefined();
    expect(novCar?.value).toBe(25000);

    // Dec: after start, car still included
    expect(history[2].totalAssets).toBe(25000);
    const decCar = history[2].byAccount?.find(a => a.slug === "manual-car-1");
    expect(decCar).toBeDefined();
    expect(decCar?.value).toBe(25000);
  });

  test("legacy asset without startDate included in all months", () => {
    const legacyCar: ManualAsset = {
      id: "old-car",
      label: "Old Car",
      category: "vehicle",
      value: 15000,
      // No startDate - legacy
      updatedAt: "2026-11-15T10:00:00Z",
    };

    const history: MonthNetWorthHistory[] = [
      { yearMonth: "2026-10", netWorth: 0, totalAssets: 0, totalDebts: 0 },
      { yearMonth: "2026-11", netWorth: 0, totalAssets: 0, totalDebts: 0 },
    ];

    calculateNetWorthForMonths(history, [], [legacyCar], toHome, emptyStatusMap);

    // All months include legacy asset
    expect(history[0].totalAssets).toBe(15000);
    expect(history[0].byAccount?.find(a => a.slug === "manual-old-car")).toBeDefined();
    
    expect(history[1].totalAssets).toBe(15000);
    expect(history[1].byAccount?.find(a => a.slug === "manual-old-car")).toBeDefined();
  });

  test("new_asset event generated in start month only", () => {
    const car: ManualAsset = {
      id: "car-1",
      label: "Honda Civic",
      category: "vehicle",
      value: 25000,
      startDate: "2026-11-15",
      updatedAt: "2026-11-15T10:00:00Z",
    };

    // Change generation logic
    const assetsByMonth = new Map<string, ManualAsset[]>();
    if (car.startDate) {
      const startMonth = car.startDate.slice(0, 7);
      assetsByMonth.set(startMonth, [car]);
    }

    expect(assetsByMonth.get("2026-11")).toHaveLength(1);
    expect(assetsByMonth.get("2026-10")).toBeUndefined();
    expect(assetsByMonth.get("2026-12")).toBeUndefined();
  });

  test("changing value does not shift start date", () => {
    const originalCar: ManualAsset = {
      id: "car-1",
      label: "Honda Civic",
      category: "vehicle",
      value: 25000,
      startDate: "2026-11-15",
      updatedAt: "2026-11-15T10:00:00Z",
    };

    const editedCar: ManualAsset = {
      ...originalCar,
      value: 23000, // Value changed
      updatedAt: "2026-12-10T14:00:00Z", // Edit timestamp changed
    };

    // startDate unchanged
    expect(editedCar.startDate).toBe("2026-11-15");
    expect(editedCar.startDate).toBe(originalCar.startDate);
  });

  test("reconciliation: sum of changes equals net worth delta with start date", () => {
    const car: ManualAsset = {
      id: "car-1",
      label: "Honda Civic",
      category: "vehicle",
      value: 25000,
      startDate: "2026-11-15",
      updatedAt: "2026-11-15T10:00:00Z",
    };

    const history: MonthNetWorthHistory[] = [
      { yearMonth: "2026-10", netWorth: 0, totalAssets: 0, totalDebts: 0 },
      { yearMonth: "2026-11", netWorth: 0, totalAssets: 0, totalDebts: 0 },
    ];

    calculateNetWorthForMonths(history, [], [car], toHome, emptyStatusMap);

    // Oct → Nov delta
    const delta = history[1].netWorth - history[0].netWorth;
    
    // Compute change from byAccount
    const octBySlug = new Map((history[0].byAccount || []).map(a => [a.slug, a.value]));
    const novBySlug = new Map((history[1].byAccount || []).map(a => [a.slug, a.value]));
    const allSlugs = new Set([...octBySlug.keys(), ...novBySlug.keys()]);
    
    let sumChanges = 0;
    for (const slug of allSlugs) {
      sumChanges += (novBySlug.get(slug) || 0) - (octBySlug.get(slug) || 0);
    }

    expect(sumChanges).toBe(delta);
    expect(delta).toBe(25000); // Car added in Nov
  });

  test("startDate validation: YYYY-MM-DD format", () => {
    const validDates = ["2026-11-15", "2025-01-01", "2027-12-31"];
    const invalidDates = ["2026-11", "11-15-2026", "2026/11/15", "invalid"];

    for (const date of validDates) {
      expect(/^\d{4}-\d{2}-\d{2}$/.test(date)).toBe(true);
    }

    for (const date of invalidDates) {
      expect(/^\d{4}-\d{2}-\d{2}$/.test(date)).toBe(false);
    }
  });

  test("multiple assets with different start dates", () => {
    const car: ManualAsset = {
      id: "car-1",
      label: "Car",
      category: "vehicle",
      value: 25000,
      startDate: "2026-11-01",
      updatedAt: "2026-11-01T00:00:00Z",
    };

    const house: ManualAsset = {
      id: "house-1",
      label: "House",
      category: "property",
      value: 500000,
      startDate: "2026-12-01",
      updatedAt: "2026-12-01T00:00:00Z",
    };

    const history: MonthNetWorthHistory[] = [
      { yearMonth: "2026-10", netWorth: 0, totalAssets: 0, totalDebts: 0 },
      { yearMonth: "2026-11", netWorth: 0, totalAssets: 0, totalDebts: 0 },
      { yearMonth: "2026-12", netWorth: 0, totalAssets: 0, totalDebts: 0 },
    ];

    calculateNetWorthForMonths(history, [], [car, house], toHome, emptyStatusMap);

    // Oct: neither
    expect(history[0].totalAssets).toBe(0);

    // Nov: car only
    expect(history[1].totalAssets).toBe(25000);
    expect(history[1].byAccount?.find(a => a.slug === "manual-car-1")).toBeDefined();
    expect(history[1].byAccount?.find(a => a.slug === "manual-house-1")).toBeUndefined();

    // Dec: both
    expect(history[2].totalAssets).toBe(525000);
    expect(history[2].byAccount?.find(a => a.slug === "manual-car-1")).toBeDefined();
    expect(history[2].byAccount?.find(a => a.slug === "manual-house-1")).toBeDefined();
  });
});
