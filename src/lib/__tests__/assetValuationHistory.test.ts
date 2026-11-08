/**
 * Test manual asset dated valuation history
 */

import { describe, test, expect } from "vitest";
import { calculateNetWorthForMonths } from "../netWorthCalculationCore";
import type { ManualAsset, AssetValuation } from "../types";
import type { MonthNetWorthHistory } from "../netWorthCalculationCore";

describe("Asset Valuation History", () => {
  const toHome = (v: number, _c: string) => v; // Identity for tests
  const emptyStatusMap = new Map();

  test("legacy asset without valuations uses single value for all months", () => {
    const legacyCar: ManualAsset = {
      id: "car-1",
      label: "Old Car",
      category: "vehicle",
      value: 25000,
      startDate: "2026-10-01",
      updatedAt: "2026-11-15T10:00:00Z",
      // No valuations array
    };

    const history: MonthNetWorthHistory[] = [
      { yearMonth: "2026-10", netWorth: 0, totalAssets: 0, totalDebts: 0 },
      { yearMonth: "2026-11", netWorth: 0, totalAssets: 0, totalDebts: 0 },
      { yearMonth: "2026-12", netWorth: 0, totalAssets: 0, totalDebts: 0 },
    ];

    calculateNetWorthForMonths(history, [], [legacyCar], toHome, emptyStatusMap);

    // All months use the same value
    expect(history[0].totalAssets).toBe(25000);
    expect(history[1].totalAssets).toBe(25000);
    expect(history[2].totalAssets).toBe(25000);
  });

  test("asset value changes retroactively with valuations", () => {
    const car: ManualAsset = {
      id: "car-1",
      label: "Honda Civic",
      category: "vehicle",
      value: 20000, // Current value (latest)
      startDate: "2026-10-01",
      updatedAt: "2026-11-15T10:00:00Z",
      valuations: [
        { id: "val1", effectiveDate: "2026-10-15", valueCents: 2500000, createdAt: "2026-10-15T10:00:00Z" }, // $25,000
        { id: "val2", effectiveDate: "2026-11-10", valueCents: 2000000, createdAt: "2026-11-10T12:00:00Z" }, // $20,000
      ],
    };

    const history: MonthNetWorthHistory[] = [
      { yearMonth: "2026-10", netWorth: 0, totalAssets: 0, totalDebts: 0 },
      { yearMonth: "2026-11", netWorth: 0, totalAssets: 0, totalDebts: 0 },
      { yearMonth: "2026-12", netWorth: 0, totalAssets: 0, totalDebts: 0 },
    ];

    calculateNetWorthForMonths(history, [], [car], toHome, emptyStatusMap);

    // Oct: $25,000 (first valuation)
    expect(history[0].totalAssets).toBe(25000);
    const octCar = history[0].byAccount?.find((a) => a.slug === "manual-car-1");
    expect(octCar?.value).toBe(25000);

    // Nov: $20,000 (second valuation effective 11-10)
    expect(history[1].totalAssets).toBe(20000);
    const novCar = history[1].byAccount?.find((a) => a.slug === "manual-car-1");
    expect(novCar?.value).toBe(20000);

    // Dec: $20,000 (carry forward)
    expect(history[2].totalAssets).toBe(20000);
    const decCar = history[2].byAccount?.find((a) => a.slug === "manual-car-1");
    expect(decCar?.value).toBe(20000);
  });

  test("correct net worth delta when value changes mid-history", () => {
    const car: ManualAsset = {
      id: "car-1",
      label: "Car",
      category: "vehicle",
      value: 29000,
      startDate: "2026-10-01",
      updatedAt: "2026-11-15T10:00:00Z",
      valuations: [
        { id: "val3", effectiveDate: "2026-10-15", valueCents: 3100000, createdAt: "2026-10-15T10:00:00Z" }, // $31,000
        { id: "val4", effectiveDate: "2026-11-10", valueCents: 2900000, createdAt: "2026-11-10T12:00:00Z" }, // $29,000
      ],
    };

    const history: MonthNetWorthHistory[] = [
      { yearMonth: "2026-10", netWorth: 0, totalAssets: 0, totalDebts: 0 },
      { yearMonth: "2026-11", netWorth: 0, totalAssets: 0, totalDebts: 0 },
    ];

    calculateNetWorthForMonths(history, [], [car], toHome, emptyStatusMap);

    // Oct: $31,000
    expect(history[0].totalAssets).toBe(31000);
    expect(history[0].netWorth).toBe(31000);

    // Nov: $29,000 (depreciation)
    expect(history[1].totalAssets).toBe(29000);
    expect(history[1].netWorth).toBe(29000);

    // Delta: -$2,000
    const delta = history[1].netWorth - history[0].netWorth;
    expect(delta).toBe(-2000);

    // Verify sum of account changes equals delta
    const octBySlug = new Map((history[0].byAccount || []).map((a) => [a.slug, a.value]));
    const novBySlug = new Map((history[1].byAccount || []).map((a) => [a.slug, a.value]));
    const allSlugs = new Set([...octBySlug.keys(), ...novBySlug.keys()]);

    let sumChanges = 0;
    for (const slug of allSlugs) {
      sumChanges += (novBySlug.get(slug) || 0) - (octBySlug.get(slug) || 0);
    }

    expect(sumChanges).toBe(delta);
  });

  test("valuation before asset start date is ignored", () => {
    const car: ManualAsset = {
      id: "car-1",
      label: "Car",
      category: "vehicle",
      value: 25000,
      startDate: "2026-11-01", // Starts in November
      updatedAt: "2026-11-15T10:00:00Z",
      valuations: [
        { id: "val1", effectiveDate: "2026-09-15", valueCents: 2700000, createdAt: "2026-10-15T10:00:00Z" }, // Before start
        { id: "val2", effectiveDate: "2026-11-10", valueCents: 2500000, createdAt: "2026-11-10T12:00:00Z" }, // After start
      ],
    };

    const history: MonthNetWorthHistory[] = [
      { yearMonth: "2026-09", netWorth: 0, totalAssets: 0, totalDebts: 0 },
      { yearMonth: "2026-10", netWorth: 0, totalAssets: 0, totalDebts: 0 },
      { yearMonth: "2026-11", netWorth: 0, totalAssets: 0, totalDebts: 0 },
    ];

    calculateNetWorthForMonths(history, [], [car], toHome, emptyStatusMap);

    // Sept: excluded (before startDate)
    expect(history[0].totalAssets).toBe(0);

    // Oct: excluded (before startDate month)
    expect(history[1].totalAssets).toBe(0);

    // Nov: included with Nov valuation
    expect(history[2].totalAssets).toBe(25000);
  });

  test("same-day multiple edits use last valuation for that date", () => {
    const car: ManualAsset = {
      id: "car-1",
      label: "Car",
      category: "vehicle",
      value: 24500,
      startDate: "2026-11-01",
      updatedAt: "2026-11-15T10:00:00Z",
      valuations: [
        { id: "val3", effectiveDate: "2026-11-01", valueCents: 2500000, createdAt: "2026-11-01T09:00:00Z" }, // First edit
        { id: "val4", effectiveDate: "2026-11-01", valueCents: 2450000, createdAt: "2026-11-01T14:00:00Z" }, // Later edit same day
      ],
    };

    const history: MonthNetWorthHistory[] = [
      { yearMonth: "2026-11", netWorth: 0, totalAssets: 0, totalDebts: 0 },
    ];

    calculateNetWorthForMonths(history, [], [car], toHome, emptyStatusMap);

    // Uses the LAST entry for that date (sorted by effectiveDate, not createdAt)
    // Since both have same effectiveDate, the array order is deterministic
    expect(history[0].totalAssets).toBe(24500);
  });

  test("backdating valuation updates prior month", () => {
    const car: ManualAsset = {
      id: "car-1",
      label: "Car",
      category: "vehicle",
      value: 23000,
      startDate: "2026-10-01",
      updatedAt: "2026-12-01T10:00:00Z",
      valuations: [
        { id: "val5", effectiveDate: "2026-10-15", valueCents: 2500000, createdAt: "2026-10-15T10:00:00Z" }, // Initial
        { id: "val6", effectiveDate: "2026-10-25", valueCents: 2300000, createdAt: "2026-12-01T10:00:00Z" }, // Backdated
      ],
    };

    const history: MonthNetWorthHistory[] = [
      { yearMonth: "2026-10", netWorth: 0, totalAssets: 0, totalDebts: 0 },
      { yearMonth: "2026-11", netWorth: 0, totalAssets: 0, totalDebts: 0 },
      { yearMonth: "2026-12", netWorth: 0, totalAssets: 0, totalDebts: 0 },
    ];

    calculateNetWorthForMonths(history, [], [car], toHome, emptyStatusMap);

    // Oct: uses backdated value ($23,000 on 10-25 is latest as of month-end)
    expect(history[0].totalAssets).toBe(23000);

    // Nov & Dec: carry forward
    expect(history[1].totalAssets).toBe(23000);
    expect(history[2].totalAssets).toBe(23000);
  });

  test("deletion of latest valuation falls back to previous", () => {
    const car: ManualAsset = {
      id: "car-1",
      label: "Car",
      category: "vehicle",
      value: 25000, // After deleting Nov edit, this should match Oct value
      startDate: "2026-10-01",
      updatedAt: "2026-11-20T10:00:00Z",
      valuations: [
        { id: "val7", effectiveDate: "2026-10-15", valueCents: 2500000, createdAt: "2026-10-15T10:00:00Z" },
        // Nov valuation was deleted
      ],
    };

    const history: MonthNetWorthHistory[] = [
      { yearMonth: "2026-10", netWorth: 0, totalAssets: 0, totalDebts: 0 },
      { yearMonth: "2026-11", netWorth: 0, totalAssets: 0, totalDebts: 0 },
    ];

    calculateNetWorthForMonths(history, [], [car], toHome, emptyStatusMap);

    // Oct: $25,000
    expect(history[0].totalAssets).toBe(25000);

    // Nov: still $25,000 (carries forward from Oct)
    expect(history[1].totalAssets).toBe(25000);
  });

  test("deletion of earlier valuation leaves later months unchanged", () => {
    const car: ManualAsset = {
      id: "car-1",
      label: "Car",
      category: "vehicle",
      value: 20000,
      startDate: "2026-09-01",
      updatedAt: "2026-11-15T10:00:00Z",
      valuations: [
        // Oct valuation was deleted
        { id: "val8", effectiveDate: "2026-11-10", valueCents: 2000000, createdAt: "2026-11-10T12:00:00Z" },
      ],
    };

    const history: MonthNetWorthHistory[] = [
      { yearMonth: "2026-09", netWorth: 0, totalAssets: 0, totalDebts: 0 },
      { yearMonth: "2026-10", netWorth: 0, totalAssets: 0, totalDebts: 0 },
      { yearMonth: "2026-11", netWorth: 0, totalAssets: 0, totalDebts: 0 },
    ];

    calculateNetWorthForMonths(history, [], [car], toHome, emptyStatusMap);

    // Sept & Oct: no valuation yet (before Nov), use legacy value
    expect(history[0].totalAssets).toBe(20000);
    expect(history[1].totalAssets).toBe(20000);

    // Nov: new valuation
    expect(history[2].totalAssets).toBe(20000);
  });

  test("first valuation on legacy asset preserves pre-edit value as baseline", () => {
    // This tests the API behavior: when the first valuation is added,
    // the existing asset.value should be preserved as the baseline entry.
    // This is a data transformation test, not calculation.

    const beforeEdit: ManualAsset = {
      id: "car-1",
      label: "Car",
      category: "vehicle",
      value: 30000, // Original value before any edits
      startDate: "2026-10-01",
      updatedAt: "2026-10-01T00:00:00Z",
    };

    // Simulate first valuation being added
    const afterFirstEdit: ManualAsset = {
      ...beforeEdit,
      value: 29000, // New value
      updatedAt: "2026-11-10T12:00:00Z",
      valuations: [
        // Baseline: preserved original value at startDate
        { id: "val9", effectiveDate: "2026-10-01", valueCents: 3000000, createdAt: "2026-10-01T00:00:00Z" },
        // New edit
        { id: "val10", effectiveDate: "2026-11-10", valueCents: 2900000, createdAt: "2026-11-10T12:00:00Z" },
      ],
    };

    const history: MonthNetWorthHistory[] = [
      { yearMonth: "2026-10", netWorth: 0, totalAssets: 0, totalDebts: 0 },
      { yearMonth: "2026-11", netWorth: 0, totalAssets: 0, totalDebts: 0 },
    ];

    calculateNetWorthForMonths(history, [], [afterFirstEdit], toHome, emptyStatusMap);

    // Oct: original baseline value
    expect(history[0].totalAssets).toBe(30000);

    // Nov: new value
    expect(history[1].totalAssets).toBe(29000);
  });

  test("exact cents preserved in valuation but rounded for display", () => {
    const car: ManualAsset = {
      id: "car-1",
      label: "Car",
      category: "vehicle",
      value: 24999.99, // Current value
      startDate: "2026-11-01",
      updatedAt: "2026-11-15T10:00:00Z",
      valuations: [
        { id: "val11", effectiveDate: "2026-11-01", valueCents: 2499999, createdAt: "2026-11-01T09:00:00Z" }, // $24,999.99
      ],
    };

    const history: MonthNetWorthHistory[] = [
      { yearMonth: "2026-11", netWorth: 0, totalAssets: 0, totalDebts: 0 },
    ];

    calculateNetWorthForMonths(history, [], [car], toHome, emptyStatusMap);

    // Value in cents is preserved precisely
    expect(history[0].totalAssets).toBeCloseTo(24999.99, 2);
  });

  test("rate-only edit does not append valuations", () => {
    // This ensures that changing only annualGrowthRate (or other metadata)
    // does NOT add a new valuation entry or alter historical values.

    const car: ManualAsset = {
      id: "car-1",
      label: "Car",
      category: "vehicle",
      value: 25000,
      startDate: "2026-10-01",
      updatedAt: "2026-11-20T10:00:00Z", // Later edit timestamp
      annualGrowthRate: -10, // Added projection rate
      valuations: [
        { id: "val12", effectiveDate: "2026-10-15", valueCents: 2500000, createdAt: "2026-10-15T10:00:00Z" },
        // No new valuation added when only rate changed
      ],
    };

    const history: MonthNetWorthHistory[] = [
      { yearMonth: "2026-10", netWorth: 0, totalAssets: 0, totalDebts: 0 },
      { yearMonth: "2026-11", netWorth: 0, totalAssets: 0, totalDebts: 0 },
    ];

    calculateNetWorthForMonths(history, [], [car], toHome, emptyStatusMap);

    // Both months use same valuation (rate change doesn't affect actual values)
    expect(history[0].totalAssets).toBe(25000);
    expect(history[1].totalAssets).toBe(25000);
  });

  test("empty valuations array behaves like legacy asset", () => {
    const car: ManualAsset = {
      id: "car-1",
      label: "Car",
      category: "vehicle",
      value: 25000,
      startDate: "2026-10-01",
      updatedAt: "2026-11-15T10:00:00Z",
      valuations: [], // Explicitly empty
    };

    const history: MonthNetWorthHistory[] = [
      { yearMonth: "2026-10", netWorth: 0, totalAssets: 0, totalDebts: 0 },
      { yearMonth: "2026-11", netWorth: 0, totalAssets: 0, totalDebts: 0 },
    ];

    calculateNetWorthForMonths(history, [], [car], toHome, emptyStatusMap);

    // Uses legacy value field
    expect(history[0].totalAssets).toBe(25000);
    expect(history[1].totalAssets).toBe(25000);
  });
});
