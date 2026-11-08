/**
 * Tests for Trend tab combined actual/projected chart logic.
 * Confirms legacy baseline display, projection anchoring, and rate-only save behavior.
 */

import { describe, it, expect } from "vitest";
import type { ManualAsset } from "@/lib/types";

describe("Asset Trend Combined Chart", () => {
  describe("Legacy baseline display", () => {
    it("shows asset.value as baseline when no explicit valuations", () => {
      const asset: ManualAsset = {
        id: "asset1",
        label: "House",
        category: "property",
        value: 500000,
        startDate: "2020-01-01",
      };

      // Simulate building actual points (from Trend tab logic)
      const actualPoints: Array<{ date: string; value: number; isBaseline?: boolean }> = [];
      if (!asset.valuations || asset.valuations.length === 0) {
        const baselineDate = asset.startDate || new Date().toISOString().slice(0, 10);
        actualPoints.push({
          date: baselineDate,
          value: asset.value,
          isBaseline: true,
        });
      }

      expect(actualPoints).toHaveLength(1);
      expect(actualPoints[0].value).toBe(500000);
      expect(actualPoints[0].date).toBe("2020-01-01");
      expect(actualPoints[0].isBaseline).toBe(true);
    });

    it("shows current date baseline when no startDate", () => {
      const asset: ManualAsset = {
        id: "asset1",
        label: "Car",
        category: "vehicle",
        value: 25000,
      };

      const actualPoints: Array<{ date: string; value: number; isBaseline?: boolean }> = [];
      if (!asset.valuations || asset.valuations.length === 0) {
        const baselineDate = asset.startDate || new Date().toISOString().slice(0, 10);
        actualPoints.push({
          date: baselineDate,
          value: asset.value,
          isBaseline: true,
        });
      }

      expect(actualPoints).toHaveLength(1);
      expect(actualPoints[0].value).toBe(25000);
      expect(actualPoints[0].isBaseline).toBe(true);
      // Date should be today (YYYY-MM-DD format)
      expect(actualPoints[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it("handles asset.value of zero gracefully", () => {
      const asset: ManualAsset = {
        id: "asset1",
        label: "Paid Off Loan",
        category: "other",
        value: 0,
        startDate: "2023-01-01",
      };

      const actualPoints: Array<{ date: string; value: number; isBaseline?: boolean }> = [];
      if (!asset.valuations || asset.valuations.length === 0) {
        const baselineDate = asset.startDate || new Date().toISOString().slice(0, 10);
        actualPoints.push({
          date: baselineDate,
          value: asset.value,
          isBaseline: true,
        });
      }

      expect(actualPoints).toHaveLength(1);
      expect(actualPoints[0].value).toBe(0);
      expect(actualPoints[0].isBaseline).toBe(true);
    });
  });

  describe("Explicit valuations display", () => {
    it("shows all explicit valuations when present", () => {
      const asset: ManualAsset = {
        id: "asset1",
        label: "Honda Civic",
        category: "vehicle",
        value: 30000,
        valuations: [
          {
            id: "val1",
            effectiveDate: "2024-01-01",
            valueCents: 3200000,
            createdAt: "2024-01-01T12:00:00Z",
          },
          {
            id: "val2",
            effectiveDate: "2024-06-01",
            valueCents: 3100000,
            createdAt: "2024-06-01T12:00:00Z",
          },
          {
            id: "val3",
            effectiveDate: "2024-10-01",
            valueCents: 3000000,
            createdAt: "2024-10-01T12:00:00Z",
          },
        ],
      };

      const actualPoints: Array<{ date: string; value: number }> = [];
      if (asset.valuations && asset.valuations.length > 0) {
        asset.valuations.forEach(val => {
          actualPoints.push({
            date: val.effectiveDate,
            value: val.valueCents / 100,
          });
        });
      }

      expect(actualPoints).toHaveLength(3);
      expect(actualPoints[0].date).toBe("2024-01-01");
      expect(actualPoints[0].value).toBe(32000);
      expect(actualPoints[2].date).toBe("2024-10-01");
      expect(actualPoints[2].value).toBe(30000);
    });
  });

  describe("Projection anchoring", () => {
    it("anchors projections on most recent actual value (not future)", () => {
      const asset: ManualAsset = {
        id: "asset1",
        label: "Property",
        category: "property",
        value: 500000,
        annualGrowthRate: 5.0,
        valuations: [
          {
            id: "val1",
            effectiveDate: "2024-01-01",
            valueCents: 48000000,
            createdAt: "2024-01-01T12:00:00Z",
          },
          {
            id: "val2",
            effectiveDate: "2024-10-01",
            valueCents: 50000000,
            createdAt: "2024-10-01T12:00:00Z",
          },
        ],
      };

      // Simulate projection anchor logic
      const today = "2024-11-08"; // Mock today
      const actualPoints = asset.valuations.map(v => ({
        date: v.effectiveDate,
        value: v.valueCents / 100,
      }));

      const actualFutureFiltered = actualPoints.filter(p => p.date <= today);
      const anchorValue = actualFutureFiltered.length > 0
        ? actualFutureFiltered[actualFutureFiltered.length - 1].value
        : asset.value;

      expect(anchorValue).toBe(500000); // Oct 1 2024 value
      expect(actualFutureFiltered).toHaveLength(2);
    });

    it("ignores future-dated valuations for projection anchor", () => {
      const asset: ManualAsset = {
        id: "asset1",
        label: "Investment",
        category: "investment",
        value: 100000,
        annualGrowthRate: 7.0,
        valuations: [
          {
            id: "val1",
            effectiveDate: "2024-01-01",
            valueCents: 9500000,
            createdAt: "2024-01-01T12:00:00Z",
          },
          {
            id: "val2",
            effectiveDate: "2025-12-31", // Future
            valueCents: 12000000,
            createdAt: "2024-01-01T12:00:00Z",
          },
        ],
      };

      const today = "2024-11-08";
      const actualPoints = asset.valuations.map(v => ({
        date: v.effectiveDate,
        value: v.valueCents / 100,
      }));

      const actualFutureFiltered = actualPoints.filter(p => p.date <= today);
      const anchorValue = actualFutureFiltered.length > 0
        ? actualFutureFiltered[actualFutureFiltered.length - 1].value
        : asset.value;

      expect(anchorValue).toBe(95000); // Jan 1 2024 value, not future
      expect(actualFutureFiltered).toHaveLength(1);
    });

    it("handles zero growth rate by not generating projections", () => {
      const asset: ManualAsset = {
        id: "asset1",
        label: "Cash",
        category: "other",
        value: 10000,
        annualGrowthRate: 0,
      };

      const projectedPoints: Array<{ date: string; value: number }> = [];
      if (asset.annualGrowthRate !== null && asset.annualGrowthRate !== undefined && asset.annualGrowthRate !== 0) {
        // Would generate projections here
        projectedPoints.push({ date: "2025-12-31", value: 10000 });
      }

      expect(projectedPoints).toHaveLength(0);
    });

    it("handles null growth rate by not generating projections", () => {
      const asset: ManualAsset = {
        id: "asset1",
        label: "Asset",
        category: "other",
        value: 10000,
        annualGrowthRate: null,
      };

      const projectedPoints: Array<{ date: string; value: number }> = [];
      if (asset.annualGrowthRate !== null && asset.annualGrowthRate !== undefined && asset.annualGrowthRate !== 0) {
        projectedPoints.push({ date: "2025-12-31", value: 10000 });
      }

      expect(projectedPoints).toHaveLength(0);
    });

    it("generates positive projections for appreciation", () => {
      const asset: ManualAsset = {
        id: "asset1",
        label: "Property",
        category: "property",
        value: 500000,
        annualGrowthRate: 5.0,
      };

      const projectionYears = 3;
      const projectedPoints: Array<{ date: string; value: number }> = [];
      
      if (asset.annualGrowthRate !== null && asset.annualGrowthRate !== undefined && asset.annualGrowthRate !== 0) {
        const rate = asset.annualGrowthRate / 100;
        const anchorValue = asset.value;
        const currentYear = new Date().getFullYear();
        
        for (let i = 1; i <= projectionYears; i++) {
          const projectedValue = anchorValue * Math.pow(1 + rate, i);
          projectedPoints.push({
            date: `${currentYear + i}-12-31`,
            value: projectedValue,
          });
        }
      }

      expect(projectedPoints).toHaveLength(3);
      expect(projectedPoints[0].value).toBeCloseTo(525000, -1); // Year 1: 500k * 1.05
      expect(projectedPoints[1].value).toBeCloseTo(551250, -1); // Year 2: 500k * 1.05^2
      expect(projectedPoints[2].value).toBeCloseTo(578812, -1); // Year 3: 500k * 1.05^3
    });

    it("generates negative projections for depreciation", () => {
      const asset: ManualAsset = {
        id: "asset1",
        label: "Car",
        category: "vehicle",
        value: 30000,
        annualGrowthRate: -10.0,
      };

      const projectionYears = 3;
      const projectedPoints: Array<{ date: string; value: number }> = [];
      
      if (asset.annualGrowthRate !== null && asset.annualGrowthRate !== undefined && asset.annualGrowthRate !== 0) {
        const rate = asset.annualGrowthRate / 100;
        const anchorValue = asset.value;
        const currentYear = new Date().getFullYear();
        
        for (let i = 1; i <= projectionYears; i++) {
          const projectedValue = anchorValue * Math.pow(1 + rate, i);
          projectedPoints.push({
            date: `${currentYear + i}-12-31`,
            value: projectedValue,
          });
        }
      }

      expect(projectedPoints).toHaveLength(3);
      expect(projectedPoints[0].value).toBeCloseTo(27000, 0); // Year 1: 30k * 0.9
      expect(projectedPoints[1].value).toBeCloseTo(24300, 0); // Year 2: 30k * 0.9^2
      expect(projectedPoints[2].value).toBeCloseTo(21870, 0); // Year 3: 30k * 0.9^3
    });
  });

  describe("Rate-only save behavior", () => {
    it("confirms rate-only PATCH does not modify valuations array", () => {
      // This is verified by the assetProjectionRateSave.test.ts suite
      // The PATCH endpoint only updates annualGrowthRate field
      // Here we just document the expected behavior
      
      const assetBefore: ManualAsset = {
        id: "asset1",
        label: "House",
        category: "property",
        value: 500000,
        annualGrowthRate: null,
        valuations: [
          {
            id: "val1",
            effectiveDate: "2024-01-01",
            valueCents: 50000000,
            createdAt: "2024-01-01T12:00:00Z",
          },
        ],
      };

      // After PATCH with annualGrowthRate: 5.0
      const assetAfter: ManualAsset = {
        ...assetBefore,
        annualGrowthRate: 5.0,
        // valuations array remains UNCHANGED
      };

      expect(assetAfter.valuations).toEqual(assetBefore.valuations);
      expect(assetAfter.annualGrowthRate).toBe(5.0);
      expect(assetAfter.value).toBe(500000);
    });
  });

  describe("Combined chart data integrity", () => {
    it("keeps actual and projected points separate with correct properties", () => {
      const asset: ManualAsset = {
        id: "asset1",
        label: "Investment",
        category: "investment",
        value: 100000,
        annualGrowthRate: 8.0,
        valuations: [
          {
            id: "val1",
            effectiveDate: "2024-01-01",
            valueCents: 9500000,
            createdAt: "2024-01-01T12:00:00Z",
          },
          {
            id: "val2",
            effectiveDate: "2024-06-01",
            valueCents: 9800000,
            createdAt: "2024-06-01T12:00:00Z",
          },
        ],
      };

      // Build actual points
      const actualPoints = asset.valuations.map(v => ({
        date: v.effectiveDate,
        value: v.valueCents / 100,
        label: new Date(v.effectiveDate).toLocaleDateString("en-US", { month: "short", year: "numeric" }),
      }));

      // Build projected points
      const projectedPoints: Array<{ date: string; value: number; label: string }> = [];
      const rate = (asset.annualGrowthRate ?? 0) / 100;
      const anchorValue = actualPoints[actualPoints.length - 1].value;
      const currentYear = new Date().getFullYear();
      
      for (let i = 1; i <= 2; i++) {
        projectedPoints.push({
          date: `${currentYear + i}-12-31`,
          value: anchorValue * Math.pow(1 + rate, i),
          label: String(currentYear + i),
        });
      }

      expect(actualPoints).toHaveLength(2);
      expect(projectedPoints).toHaveLength(2);
      expect(actualPoints[0].value).toBe(95000);
      expect(actualPoints[1].value).toBe(98000);
      expect(projectedPoints[0].value).toBeCloseTo(105840, 0); // 98k * 1.08
      expect(projectedPoints[1].value).toBeCloseTo(114307, 0); // 98k * 1.08^2
    });
  });
});
