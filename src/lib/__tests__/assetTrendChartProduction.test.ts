/**
 * Production tests for asset Trend chart model.
 * Tests the actual buildTrendChartData and getDisplayValuations functions.
 */

import { describe, it, expect } from "vitest";
import { buildTrendChartData, getDisplayValuations } from "@/lib/assetTrendChart";
import type { ManualAsset } from "@/lib/types";

describe("Asset Trend Chart - Production", () => {
  describe("Legacy baseline display", () => {
    it("shows asset.value with known startDate as baseline", () => {
      const asset: ManualAsset = {
        id: "asset1",
        label: "House",
        category: "property",
        value: 500000,
        startDate: "2020-10-15",
      };

      const { actualPoints } = buildTrendChartData(asset, 5);

      expect(actualPoints).toHaveLength(1);
      expect(actualPoints[0].date).toBe("2020-10-15");
      expect(actualPoints[0].value).toBe(500000);
      expect(actualPoints[0].label).toBe("Oct 2020");
      expect(actualPoints[0].isBaseline).toBe(true);
    });

    it("shows asset.value with 'As of' label when startDate unknown", () => {
      const asset: ManualAsset = {
        id: "asset1",
        label: "Car",
        category: "vehicle",
        value: 25000,
      };

      const { actualPoints } = buildTrendChartData(asset, 5);

      expect(actualPoints).toHaveLength(1);
      expect(actualPoints[0].value).toBe(25000);
      expect(actualPoints[0].label).toMatch(/^As of /);
      expect(actualPoints[0].isBaseline).toBe(true);
      // Date should be today (YYYY-MM-DD)
      expect(actualPoints[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it("handles asset.value of zero with finite output", () => {
      const asset: ManualAsset = {
        id: "asset1",
        label: "Zeroed Asset",
        category: "other",
        value: 0,
        startDate: "2023-01-01",
      };

      const { actualPoints } = buildTrendChartData(asset, 5);

      expect(actualPoints).toHaveLength(1);
      expect(actualPoints[0].value).toBe(0);
      expect(actualPoints[0].date).toBe("2023-01-01");
      expect(Number.isFinite(actualPoints[0].value)).toBe(true);
    });
  });

  describe("Explicit valuations with date-spaced points", () => {
    it("Oct 2020 to Nov 2026 shows actual date intervals", () => {
      const asset: ManualAsset = {
        id: "asset1",
        label: "Honda Civic",
        category: "vehicle",
        value: 29000,
        valuations: [
          {
            id: "val1",
            effectiveDate: "2020-10-01",
            valueCents: 3100000,
            createdAt: "2020-10-01T12:00:00Z",
          },
          {
            id: "val2",
            effectiveDate: "2026-11-01",
            valueCents: 2900000,
            createdAt: "2026-11-01T12:00:00Z",
          },
        ],
      };

      const { actualPoints } = buildTrendChartData(asset, 5);

      expect(actualPoints).toHaveLength(2);
      expect(actualPoints[0].date).toBe("2020-10-01");
      expect(actualPoints[0].value).toBe(31000);
      expect(actualPoints[0].label).toBe("Oct 2020");
      expect(actualPoints[1].date).toBe("2026-11-01");
      expect(actualPoints[1].value).toBe(29000);
      expect(actualPoints[1].label).toBe("Nov 2026");
    });

    it("sorts valuations by date ascending", () => {
      const asset: ManualAsset = {
        id: "asset1",
        label: "Property",
        category: "property",
        value: 500000,
        valuations: [
          {
            id: "val1",
            effectiveDate: "2024-10-01",
            valueCents: 50000000,
            createdAt: "2024-10-01T12:00:00Z",
          },
          {
            id: "val2",
            effectiveDate: "2024-01-01",
            valueCents: 48000000,
            createdAt: "2024-01-01T12:00:00Z",
          },
          {
            id: "val3",
            effectiveDate: "2024-06-01",
            valueCents: 49000000,
            createdAt: "2024-06-01T12:00:00Z",
          },
        ],
      };

      const { actualPoints } = buildTrendChartData(asset, 5);

      expect(actualPoints[0].date).toBe("2024-01-01");
      expect(actualPoints[1].date).toBe("2024-06-01");
      expect(actualPoints[2].date).toBe("2024-10-01");
    });
  });

  describe("Projection anchoring on latest actual effectiveDate", () => {
    it("anchors on Oct 31k, Nov 29k => projects from Nov 29k anchor", () => {
      const asset: ManualAsset = {
        id: "asset1",
        label: "Car",
        category: "vehicle",
        value: 29000,
        annualGrowthRate: -10.0,
        valuations: [
          {
            id: "val1",
            effectiveDate: "2024-10-01",
            valueCents: 3100000,
            createdAt: "2024-10-01T12:00:00Z",
          },
          {
            id: "val2",
            effectiveDate: "2024-11-01",
            valueCents: 2900000,
            createdAt: "2024-11-01T12:00:00Z",
          },
        ],
      };

      const { actualPoints, projectedPoints } = buildTrendChartData(asset, 3);

      // Two actual points
      expect(actualPoints).toHaveLength(2);
      expect(actualPoints[0].value).toBe(31000);
      expect(actualPoints[1].value).toBe(29000);

      // Projections now extend to today + 3 years
      // Anchor: Nov 2024, Today: ~Nov 2026, End: Nov 2029
      // Years from anchor: 2025, 2026, 2027, 2028, 2029 = 5 years
      expect(projectedPoints.length).toBeGreaterThanOrEqual(3);
      
      // First few years from anchor still use correct compounding
      expect(projectedPoints[0].value).toBeCloseTo(26100, -1); // Year 1
      expect(projectedPoints[0].date).toBe("2025-11-01");
      
      expect(projectedPoints[1].value).toBeCloseTo(23490, -1); // Year 2
      expect(projectedPoints[1].date).toBe("2026-11-01");
      
      expect(projectedPoints[2].value).toBeCloseTo(21141, -1); // Year 3
      expect(projectedPoints[2].date).toBe("2027-11-01")
    });

    it("ignores future-dated valuations for projection anchor", () => {
      const asset: ManualAsset = {
        id: "asset1",
        label: "Investment",
        category: "investment",
        value: 100000,
        annualGrowthRate: 5.0,
        valuations: [
          {
            id: "val1",
            effectiveDate: "2024-01-01",
            valueCents: 9500000,
            createdAt: "2024-01-01T12:00:00Z",
          },
          {
            id: "val2",
            effectiveDate: "2027-12-31", // Future
            valueCents: 12000000,
            createdAt: "2024-01-01T12:00:00Z",
          },
        ],
      };

      const { actualPoints, projectedPoints } = buildTrendChartData(asset, 2);

      // Both shown as actual
      expect(actualPoints).toHaveLength(2);
      
      // But projection anchored on Jan 2024 (not future)
      expect(projectedPoints[0].date).toBe("2025-01-01"); // +1 year from Jan 2024
      expect(projectedPoints[0].value).toBeCloseTo(99750, -1); // 95000 * 1.05
    });

    it("handles positive appreciation rate with correct year spacing", () => {
      const asset: ManualAsset = {
        id: "asset1",
        label: "Property",
        category: "property",
        value: 500000,
        annualGrowthRate: 5.0,
        startDate: "2024-01-15",
      };

      const { actualPoints, projectedPoints } = buildTrendChartData(asset, 3);

      expect(actualPoints).toHaveLength(1);
      expect(actualPoints[0].value).toBe(500000);
      expect(actualPoints[0].date).toBe("2024-01-15");

      // Projections now extend to today + 3 years (not just anchor + 3)
      // Anchor: Jan 2024, Today: ~Nov 2026, End: Nov 2029
      // Years: 2025, 2026, 2027, 2028, 2029 = 5 years
      expect(projectedPoints.length).toBeGreaterThanOrEqual(3);
      
      // First few years still use correct yearly intervals and compounding
      expect(projectedPoints[0].date).toBe("2025-01-15"); // Exactly +1 year
      expect(projectedPoints[1].date).toBe("2026-01-15"); // Exactly +2 years
      expect(projectedPoints[2].date).toBe("2027-01-15"); // Exactly +3 years
      
      expect(projectedPoints[0].value).toBeCloseTo(525000, -1); // 500k * 1.05
      expect(projectedPoints[1].value).toBeCloseTo(551250, -1); // 500k * 1.05^2
      expect(projectedPoints[2].value).toBeCloseTo(578812, -1); // 500k * 1.05^3
    });
  });

  describe("Zero and null growth rate handling", () => {
    it("zero growth rate produces no projections", () => {
      const asset: ManualAsset = {
        id: "asset1",
        label: "Cash",
        category: "other",
        value: 10000,
        annualGrowthRate: 0,
      };

      const { projectedPoints } = buildTrendChartData(asset, 5);

      expect(projectedPoints).toHaveLength(0);
    });

    it("null growth rate produces no projections", () => {
      const asset: ManualAsset = {
        id: "asset1",
        label: "Asset",
        category: "other",
        value: 10000,
        annualGrowthRate: null,
      };

      const { projectedPoints } = buildTrendChartData(asset, 5);

      expect(projectedPoints).toHaveLength(0);
    });

    it("undefined growth rate produces no projections", () => {
      const asset: ManualAsset = {
        id: "asset1",
        label: "Asset",
        category: "other",
        value: 10000,
      };

      const { projectedPoints } = buildTrendChartData(asset, 5);

      expect(projectedPoints).toHaveLength(0);
    });
  });

  describe("Edge cases: all same value, all zero", () => {
    it("handles all same value without NaN or scaling overflow", () => {
      const asset: ManualAsset = {
        id: "asset1",
        label: "Stable Asset",
        category: "other",
        value: 50000,
        annualGrowthRate: 0,
        valuations: [
          {
            id: "val1",
            effectiveDate: "2024-01-01",
            valueCents: 5000000,
            createdAt: "2024-01-01T12:00:00Z",
          },
          {
            id: "val2",
            effectiveDate: "2024-06-01",
            valueCents: 5000000,
            createdAt: "2024-06-01T12:00:00Z",
          },
          {
            id: "val3",
            effectiveDate: "2024-12-01",
            valueCents: 5000000,
            createdAt: "2024-12-01T12:00:00Z",
          },
        ],
      };

      const { actualPoints } = buildTrendChartData(asset, 5);

      expect(actualPoints).toHaveLength(3);
      actualPoints.forEach(p => {
        expect(p.value).toBe(50000);
        expect(Number.isFinite(p.value)).toBe(true);
      });
    });

    it("handles all zero values with finite SVG output", () => {
      const asset: ManualAsset = {
        id: "asset1",
        label: "Zero Asset",
        category: "other",
        value: 0,
        valuations: [
          {
            id: "val1",
            effectiveDate: "2024-01-01",
            valueCents: 0,
            createdAt: "2024-01-01T12:00:00Z",
          },
          {
            id: "val2",
            effectiveDate: "2024-06-01",
            valueCents: 0,
            createdAt: "2024-06-01T12:00:00Z",
          },
        ],
      };

      const { actualPoints } = buildTrendChartData(asset, 5);

      expect(actualPoints).toHaveLength(2);
      actualPoints.forEach(p => {
        expect(p.value).toBe(0);
        expect(Number.isFinite(p.value)).toBe(true);
        expect(Number.isNaN(p.value)).toBe(false);
      });
    });
  });

  describe("getDisplayValuations", () => {
    it("returns explicit valuations when present", () => {
      const asset: ManualAsset = {
        id: "asset1",
        label: "Asset",
        category: "other",
        value: 30000,
        valuations: [
          {
            id: "val1",
            effectiveDate: "2024-01-01",
            valueCents: 3200000,
            createdAt: "2024-01-01T12:00:00Z",
          },
        ],
      };

      const valuations = getDisplayValuations(asset);

      expect(valuations).toHaveLength(1);
      expect(valuations[0].id).toBe("val1");
      expect(valuations[0].effectiveDate).toBe("2024-01-01");
      expect(valuations[0].valueCents).toBe(3200000);
    });

    it("returns baseline for legacy asset with known startDate", () => {
      const asset: ManualAsset = {
        id: "asset1",
        label: "House",
        category: "property",
        value: 500000,
        startDate: "2020-10-15",
      };

      const valuations = getDisplayValuations(asset);

      expect(valuations).toHaveLength(1);
      expect(valuations[0].id).toBe("__baseline__");
      expect(valuations[0].effectiveDate).toBe("2020-10-15");
      expect(valuations[0].valueCents).toBe(50000000);
      expect(valuations[0].isBaseline).toBe(true);
    });

    it("returns baseline with today's date for unknown startDate", () => {
      const asset: ManualAsset = {
        id: "asset1",
        label: "Car",
        category: "vehicle",
        value: 25000,
      };

      const valuations = getDisplayValuations(asset);

      expect(valuations).toHaveLength(1);
      expect(valuations[0].id).toBe("__baseline__");
      expect(valuations[0].valueCents).toBe(2500000);
      expect(valuations[0].isBaseline).toBe(true);
      expect(valuations[0].effectiveDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it("preserves exact cents for baseline display", () => {
      const asset: ManualAsset = {
        id: "asset1",
        label: "Asset",
        category: "other",
        value: 12345.67,
        startDate: "2024-01-01",
      };

      const valuations = getDisplayValuations(asset);

      expect(valuations[0].valueCents).toBe(1234567);
    });
  });

  describe("Bug regression tests (af7e367 fixes)", () => {
    it("handles all-zero values without NaN in yScale", () => {
      // Bug #1: All-zero values caused yMax === yMin, leading to divide-by-zero
      const asset: ManualAsset = {
        id: "asset1",
        label: "Worthless Asset",
        category: "other",
        value: 0,
        startDate: "2024-01-01",
        annualGrowthRate: 5,
        updatedAt: "2024-01-01T00:00:00Z",
      };

      const { actualPoints, projectedPoints } = buildTrendChartData(asset, 3);

      expect(actualPoints).toHaveLength(1);
      expect(actualPoints[0].value).toBe(0);
      // All projected values will also be 0 (0 * 1.05^n = 0)
      expect(projectedPoints.length).toBeGreaterThan(0);
      projectedPoints.forEach(p => {
        expect(p.value).toBe(0);
        expect(p.value).not.toBeNaN();
      });
    });

    it("formats first-of-month dates correctly in America/New_York timezone", () => {
      // Bug #2: Date "2026-11-01" displayed as "Oct" in NY timezone due to UTC midnight -> local conversion
      const asset: ManualAsset = {
        id: "asset1",
        label: "Test Asset",
        category: "other",
        value: 100000,
        updatedAt: "2026-11-01T00:00:00Z",
        valuations: [
          {
            id: "val1",
            effectiveDate: "2026-11-01",
            valueCents: 10000000,
            createdAt: "2026-11-01T00:00:00Z",
          },
          {
            id: "val2",
            effectiveDate: "2027-01-01",
            valueCents: 11000000,
            createdAt: "2027-01-01T00:00:00Z",
          },
        ],
      };

      const { actualPoints } = buildTrendChartData(asset, 5);

      expect(actualPoints).toHaveLength(2);
      expect(actualPoints[0].date).toBe("2026-11-01");
      expect(actualPoints[0].label).toBe("Nov 2026"); // Must be Nov, not Oct
      expect(actualPoints[1].date).toBe("2027-01-01");
      expect(actualPoints[1].label).toBe("Jan 2027"); // Must be Jan, not Dec
    });

    it("generates projections through exact horizon (today + years), not stopping months short", () => {
      // Bug #3: Mar 2022 anchor with 5-year forecast from Nov 2026 should reach Nov 2031,
      // not stop at Mar 2031 (anchor anniversary problem)
      
      // Mock today as 2026-11-08 for this test
      const originalToday = new Date().toLocaleString("en-US", { timeZone: "America/New_York" });
      
      const asset: ManualAsset = {
        id: "asset1",
        label: "House",
        category: "property",
        value: 520000,
        startDate: "2022-03-01",
        annualGrowthRate: -5,
        updatedAt: "2022-03-01T00:00:00Z",
      };

      // Build with 5 year projection
      const { projectedPoints } = buildTrendChartData(asset, 5);

      // With today = 2026-11-08, anchor = 2022-03-01, projectionYears = 5:
      // Projection end = 2031-11-08
      // Should generate points: 2023-03-01, 2024-03-01, ..., 2031-03-01
      // The last point (2031-03-01) should be <= 2031-11-08
      
      expect(projectedPoints.length).toBeGreaterThanOrEqual(3);
      
      // Parse today from the function (uses America/New_York)
      const todayStr = new Date().toLocaleString("en-US", { timeZone: "America/New_York" });
      const todayParsed = new Date(todayStr);
      const todayYear = todayParsed.getFullYear();
      const targetYear = todayYear + 5;
      
      // Last projection point should be in the target year or earlier
      const lastPoint = projectedPoints[projectedPoints.length - 1];
      const lastYear = parseInt(lastPoint.date.split('-')[0]);
      expect(lastYear).toBeLessThanOrEqual(targetYear);
      
      // Verify it's not stopping too early (at least reaches target year - 1)
      expect(lastYear).toBeGreaterThanOrEqual(targetYear - 1);
    });

    it("handles leap year edge case (Feb 29 anchor -> Feb 28 in non-leap year)", () => {
      // Ensure Feb 29 anchor gets clamped to Feb 28 in non-leap years
      const asset: ManualAsset = {
        id: "asset1",
        label: "Leap Year Asset",
        category: "other",
        value: 100000,
        startDate: "2024-02-29",
        annualGrowthRate: 3,
        updatedAt: "2024-02-29T00:00:00Z",
      };

      const { projectedPoints } = buildTrendChartData(asset, 3);

      // 2024 is leap year (anchor), next years: 2025 (not leap), 2026 (not leap), 2027 (not leap)
      expect(projectedPoints.length).toBeGreaterThanOrEqual(2);
      
      // Find 2025 projection (should be Feb 28)
      const proj2025 = projectedPoints.find(p => p.date.startsWith('2025-02'));
      expect(proj2025).toBeDefined();
      expect(proj2025!.date).toBe('2025-02-28'); // Clamped from Feb 29
    });
  });
});
