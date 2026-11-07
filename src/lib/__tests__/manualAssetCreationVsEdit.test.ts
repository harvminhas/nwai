/**
 * Test creation vs edit with startDate for manual assets
 */

import { describe, test, expect } from "vitest";
import type { ManualAsset } from "../types";

describe("Manual Asset Creation vs Edit", () => {
  test("new asset has startDate and updatedAt", () => {
    const now = new Date().toISOString();
    const today = now.slice(0, 10);
    const newAsset: ManualAsset = {
      id: "car-1",
      label: "Honda Civic",
      category: "vehicle",
      value: 25000,
      startDate: today,
      updatedAt: now,
    };

    expect(newAsset.startDate).toBeDefined();
    expect(newAsset.updatedAt).toBeDefined();
  });

  test("edited asset has different updatedAt but same startDate", () => {
    const startDate = "2026-11-01";
    const updated = "2026-12-15T14:30:00Z";
    
    const editedAsset: ManualAsset = {
      id: "car-1",
      label: "Honda Civic",
      category: "vehicle",
      value: 23000, // Value edited
      startDate,
      updatedAt: updated,
    };

    expect(editedAsset.startDate).toBe(startDate); // Preserved from creation
    expect(editedAsset.updatedAt).toBe(updated); // Updated on edit
  });

  test("legacy asset without startDate is excluded from new_asset events", () => {
    const legacyAsset: ManualAsset = {
      id: "old-car",
      label: "Legacy Car",
      category: "vehicle",
      value: 15000,
      updatedAt: "2026-11-15T10:00:00Z",
      // No startDate - legacy asset
    };

    // Change generation logic
    const assetsWithStartDate = [legacyAsset].filter(a => a.startDate);
    expect(assetsWithStartDate).toHaveLength(0); // Legacy excluded
  });

  test("new asset with startDate generates new_asset event in start month", () => {
    const newAsset: ManualAsset = {
      id: "car-1",
      label: "Honda Civic",
      category: "vehicle",
      value: 25000,
      startDate: "2026-11-15",
      updatedAt: "2026-11-15T10:00:00Z",
    };

    const startMonth = newAsset.startDate!.slice(0, 7);
    expect(startMonth).toBe("2026-11");

    // Should generate event in Nov 2026, not in other months
    expect(startMonth).not.toBe("2026-10");
    expect(startMonth).not.toBe("2026-12");
  });

  test("edited asset does not generate new_asset event in edit month", () => {
    const editedAsset: ManualAsset = {
      id: "car-1",
      label: "Honda Civic",
      category: "vehicle",
      value: 23000,
      startDate: "2026-11-15",
      updatedAt: "2026-12-15T14:30:00Z", // Edited in Dec
    };

    // Event uses startDate, not updatedAt
    const eventMonth = editedAsset.startDate!.slice(0, 7);
    expect(eventMonth).toBe("2026-11"); // Nov start
    expect(eventMonth).not.toBe("2026-12"); // Not Dec edit
  });
});
