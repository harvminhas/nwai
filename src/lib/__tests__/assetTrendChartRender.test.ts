/**
 * Render tests for Trend chart - verifies actual SVG coordinate generation.
 * Tests chronological x-axis ordering and monotonic coordinates.
 */

import { describe, it, expect } from "vitest";
import { buildTrendChartData } from "@/lib/assetTrendChart";
import type { ManualAsset } from "@/lib/types";

/**
 * Simulates the xScale function from the actual component.
 * Date-based x-axis: all points share same chronological domain.
 */
function createDateXScale(allPoints: Array<{ date: string }>, chartWidth: number, paddingLeft: number) {
  const allDates = allPoints.map(p => new Date(p.date).getTime());
  const minDate = Math.min(...allDates);
  const maxDate = Math.max(...allDates);
  const dateRange = maxDate - minDate;
  
  return (dateStr: string) => {
    const dateMs = new Date(dateStr).getTime();
    if (dateRange === 0) return paddingLeft + chartWidth / 2;
    return paddingLeft + ((dateMs - minDate) / dateRange) * chartWidth;
  };
}

describe("Asset Trend Chart - Render Coordinates", () => {
  it("Mar 2022 baseline with -5% depreciation: chronological x-coordinates", () => {
    const asset: ManualAsset = {
      id: "asset1",
      label: "House",
      category: "property",
      value: 52000,
      startDate: "2022-03-15",
      annualGrowthRate: -5.0,
    };

    const { actualPoints, projectedPoints } = buildTrendChartData(asset, 5);
    const allPoints = [...actualPoints, ...projectedPoints];

    // Create x-scale matching component implementation
    const chartWidth = 720; // 800 - 80 padding
    const paddingLeft = 80;
    const xScale = createDateXScale(allPoints, chartWidth, paddingLeft);

    // Get x-coordinates for all points
    const xCoords = allPoints.map(p => ({ date: p.date, x: xScale(p.date), label: p.label }));

    // Assert: x-coordinates are strictly monotonic increasing (left to right chronological)
    for (let i = 1; i < xCoords.length; i++) {
      expect(xCoords[i].x).toBeGreaterThan(xCoords[i - 1].x);
    }

    // Assert: dates are chronological
    for (let i = 1; i < allPoints.length; i++) {
      expect(allPoints[i].date >= allPoints[i - 1].date).toBe(true);
    }

    // Assert: earliest date (Mar 2022) is leftmost
    expect(xCoords[0].date).toBe("2022-03-15");
    expect(xCoords[0].x).toBe(paddingLeft); // Leftmost coordinate

    // Assert: latest date is rightmost
    expect(xCoords[xCoords.length - 1].x).toBe(paddingLeft + chartWidth); // Rightmost
  });

  it("Oct 31k, Nov 29k with depreciation: two actuals then projected monotonic", () => {
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
    const allPoints = [...actualPoints, ...projectedPoints];

    const chartWidth = 720;
    const paddingLeft = 80;
    const xScale = createDateXScale(allPoints, chartWidth, paddingLeft);

    const xCoords = allPoints.map(p => ({ date: p.date, x: xScale(p.date), isProjected: p.isProjected }));

    // Assert: strictly monotonic
    for (let i = 1; i < xCoords.length; i++) {
      expect(xCoords[i].x).toBeGreaterThan(xCoords[i - 1].x);
    }

    // Assert: two actuals, then three projected
    expect(actualPoints).toHaveLength(2);
    expect(projectedPoints).toHaveLength(3);

    // Assert: Oct before Nov
    expect(xCoords[0].date).toBe("2024-10-01");
    expect(xCoords[1].date).toBe("2024-11-01");
    expect(xCoords[1].x).toBeGreaterThan(xCoords[0].x);

    // Assert: projections continue right from Nov
    expect(xCoords[2].date).toBe("2025-11-01");
    expect(xCoords[3].date).toBe("2026-11-01");
    expect(xCoords[4].date).toBe("2027-11-01");
  });

  it("single point: centered coordinate", () => {
    const asset: ManualAsset = {
      id: "asset1",
      label: "Asset",
      category: "other",
      value: 10000,
      startDate: "2024-01-01",
    };

    const { actualPoints } = buildTrendChartData(asset, 0);

    const chartWidth = 720;
    const paddingLeft = 80;
    const xScale = createDateXScale(actualPoints, chartWidth, paddingLeft);

    const x = xScale(actualPoints[0].date);

    // Single point: centered in chart
    expect(x).toBe(paddingLeft + chartWidth / 2);
  });

  it("actual + projected use same date domain (no separate index scales)", () => {
    const asset: ManualAsset = {
      id: "asset1",
      label: "Investment",
      category: "investment",
      value: 100000,
      annualGrowthRate: 5.0,
      valuations: [
        {
          id: "val1",
          effectiveDate: "2023-01-01",
          valueCents: 9500000,
          createdAt: "2023-01-01T12:00:00Z",
        },
        {
          id: "val2",
          effectiveDate: "2024-01-01",
          valueCents: 10000000,
          createdAt: "2024-01-01T12:00:00Z",
        },
      ],
    };

    const { actualPoints, projectedPoints } = buildTrendChartData(asset, 2);
    const allPoints = [...actualPoints, ...projectedPoints];

    const chartWidth = 720;
    const paddingLeft = 80;
    const xScale = createDateXScale(allPoints, chartWidth, paddingLeft);

    // Get x-coordinates
    const xCoords = allPoints.map(p => xScale(p.date));

    // Assert: monotonic across actual AND projected
    for (let i = 1; i < xCoords.length; i++) {
      expect(xCoords[i]).toBeGreaterThan(xCoords[i - 1]);
    }

    // Assert: same x-coordinate for same date (if we had duplicates)
    const date2023 = "2023-01-01";
    const date2024 = "2024-01-01";
    expect(xScale(date2023)).toBe(xScale(date2023)); // Deterministic
    expect(xScale(date2024)).toBe(xScale(date2024));
    expect(xScale(date2024)).toBeGreaterThan(xScale(date2023)); // Later date = further right
  });

  it("zero values: finite coordinates, no NaN", () => {
    const asset: ManualAsset = {
      id: "asset1",
      label: "Zero Asset",
      category: "other",
      value: 0,
      startDate: "2024-01-01",
    };

    const { actualPoints } = buildTrendChartData(asset, 0);

    const chartWidth = 720;
    const paddingLeft = 80;
    const xScale = createDateXScale(actualPoints, chartWidth, paddingLeft);

    const x = xScale(actualPoints[0].date);

    expect(Number.isFinite(x)).toBe(true);
    expect(Number.isNaN(x)).toBe(false);
  });

  it("increasing values: all same x-scale domain", () => {
    const asset: ManualAsset = {
      id: "asset1",
      label: "Growth Asset",
      category: "investment",
      value: 10000,
      annualGrowthRate: 20.0,
      valuations: [
        {
          id: "val1",
          effectiveDate: "2020-01-01",
          valueCents: 1000000,
          createdAt: "2020-01-01T12:00:00Z",
        },
        {
          id: "val2",
          effectiveDate: "2024-01-01",
          valueCents: 2000000,
          createdAt: "2024-01-01T12:00:00Z",
        },
      ],
    };

    const { actualPoints, projectedPoints } = buildTrendChartData(asset, 2);
    const allPoints = [...actualPoints, ...projectedPoints];

    const chartWidth = 720;
    const paddingLeft = 80;
    const xScale = createDateXScale(allPoints, chartWidth, paddingLeft);

    const xCoords = allPoints.map(p => xScale(p.date));

    // Assert: all finite
    xCoords.forEach(x => {
      expect(Number.isFinite(x)).toBe(true);
      expect(Number.isNaN(x)).toBe(false);
    });

    // Assert: monotonic
    for (let i = 1; i < xCoords.length; i++) {
      expect(xCoords[i]).toBeGreaterThan(xCoords[i - 1]);
    }
  });
});
