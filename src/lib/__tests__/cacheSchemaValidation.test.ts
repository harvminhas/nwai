/**
 * Test cache schema validation logic
 * 
 * Verifies the schema check that detects old cached profiles with incomplete
 * byAccount (manual assets in totalAssets but not in byAccount breakdown).
 */

import { describe, test, expect } from "vitest";

describe("Cache Schema Validation Logic", () => {
  test("detects incomplete byAccount when manual assets exist but not in breakdown", () => {
    // Simulate old cached profile structure
    const cached = {
      manualAssets: [
        { id: "car-1", label: "2022 Honda Civic", category: "vehicle", value: 25000, updatedAt: "2026-11-01" },
      ],
      monthlyHistory: [
        {
          yearMonth: "2026-11",
          netWorth: -165000,
          totalAssets: 35000, // Includes car!
          totalDebts: 200000,
          byAccount: [
            // Old schema: manual car missing
            { slug: "checking-1", label: "Checking", type: "checking", value: 10000 },
            { slug: "mortgage-1", label: "Mortgage", type: "mortgage", value: -200000 },
          ],
        },
      ],
    };

    // Schema validation logic (from financialProfile.ts ~1465)
    const hasManualAssets = cached.manualAssets && cached.manualAssets.length > 0;
    const hasIncompleteByAccount = hasManualAssets && cached.monthlyHistory.some(h => 
      h.byAccount && h.byAccount.length > 0 && !h.byAccount.some(item => item.slug?.startsWith("manual-"))
    );

    // Should detect incomplete schema
    expect(hasManualAssets).toBe(true);
    expect(hasIncompleteByAccount).toBe(true);
  });

  test("does not trigger on complete byAccount schema", () => {
    // Simulate upgraded cached profile
    const cached = {
      manualAssets: [
        { id: "car-1", label: "2022 Honda Civic", category: "vehicle", value: 25000, updatedAt: "2026-11-01" },
      ],
      monthlyHistory: [
        {
          yearMonth: "2026-11",
          netWorth: -165000,
          totalAssets: 35000,
          totalDebts: 200000,
          byAccount: [
            { slug: "checking-1", label: "Checking", type: "checking", value: 10000 },
            { slug: "mortgage-1", label: "Mortgage", type: "mortgage", value: -200000 },
            // Complete schema: manual car included
            { slug: "manual-car-1", label: "2022 Honda Civic", type: "manual-vehicle", value: 25000 },
          ],
        },
      ],
    };

    const hasManualAssets = cached.manualAssets && cached.manualAssets.length > 0;
    const hasIncompleteByAccount = hasManualAssets && cached.monthlyHistory.some(h => 
      h.byAccount && h.byAccount.length > 0 && !h.byAccount.some(item => item.slug?.startsWith("manual-"))
    );

    // Should NOT detect incomplete schema
    expect(hasManualAssets).toBe(true);
    expect(hasIncompleteByAccount).toBe(false);
  });

  test("does not trigger when no manual assets exist", () => {
    const cached = {
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
    };

    const hasManualAssets = cached.manualAssets && cached.manualAssets.length > 0;
    const hasIncompleteByAccount = hasManualAssets && cached.monthlyHistory.some(h => 
      h.byAccount && h.byAccount.length > 0 && !h.byAccount.some(item => item.slug?.startsWith("manual-"))
    );

    expect(hasManualAssets).toBe(false);
    expect(hasIncompleteByAccount).toBe(false);
  });
});
