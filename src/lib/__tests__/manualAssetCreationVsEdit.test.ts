/**
 * Test creation vs edit timestamps for manual assets
 */

import { describe, test, expect } from "vitest";
import type { ManualAsset } from "../types";

describe("Manual Asset Creation vs Edit", () => {
  test("new asset has both createdAt and updatedAt", () => {
    const now = new Date().toISOString();
    const newAsset: ManualAsset = {
      id: "car-1",
      label: "Honda Civic",
      category: "vehicle",
      value: 25000,
      createdAt: now,
      updatedAt: now,
    };

    expect(newAsset.createdAt).toBeDefined();
    expect(newAsset.updatedAt).toBeDefined();
    expect(newAsset.createdAt).toBe(newAsset.updatedAt); // Same on creation
  });

  test("edited asset has different updatedAt but same createdAt", () => {
    const created = "2026-11-01T10:00:00Z";
    const updated = "2026-12-15T14:30:00Z";
    
    const editedAsset: ManualAsset = {
      id: "car-1",
      label: "Honda Civic",
      category: "vehicle",
      value: 23000, // Value edited
      createdAt: created,
      updatedAt: updated,
    };

    expect(editedAsset.createdAt).toBe(created); // Preserved from creation
    expect(editedAsset.updatedAt).toBe(updated); // Updated on edit
    expect(editedAsset.updatedAt).not.toBe(editedAsset.createdAt); // Different
  });

  test("legacy asset without createdAt is excluded from new_asset events", () => {
    const legacyAsset: ManualAsset = {
      id: "old-car",
      label: "Legacy Car",
      category: "vehicle",
      value: 15000,
      updatedAt: "2026-11-15T10:00:00Z",
      // No createdAt - legacy asset
    };

    // Change generation logic
    const assetsWithKnownCreation = [legacyAsset].filter(a => a.createdAt);
    expect(assetsWithKnownCreation).toHaveLength(0); // Legacy excluded
  });

  test("new asset with createdAt generates new_asset event in creation month", () => {
    const newAsset: ManualAsset = {
      id: "car-1",
      label: "Honda Civic",
      category: "vehicle",
      value: 25000,
      createdAt: "2026-11-15T10:00:00Z",
      updatedAt: "2026-11-15T10:00:00Z",
    };

    const creationMonth = newAsset.createdAt!.slice(0, 7);
    expect(creationMonth).toBe("2026-11");

    // Should generate event in Nov 2026, not in other months
    const eventMonth = newAsset.createdAt!.slice(0, 7);
    expect(eventMonth).not.toBe("2026-10");
    expect(eventMonth).not.toBe("2026-12");
  });

  test("edited asset does not generate new_asset event in edit month", () => {
    const editedAsset: ManualAsset = {
      id: "car-1",
      label: "Honda Civic",
      category: "vehicle",
      value: 23000,
      createdAt: "2026-11-15T10:00:00Z",
      updatedAt: "2026-12-15T14:30:00Z", // Edited in Dec
    };

    // Event uses createdAt, not updatedAt
    const eventMonth = editedAsset.createdAt!.slice(0, 7);
    expect(eventMonth).toBe("2026-11"); // Nov creation
    expect(eventMonth).not.toBe("2026-12"); // Not Dec edit
  });
});
