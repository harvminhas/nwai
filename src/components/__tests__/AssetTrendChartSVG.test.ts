/**
 * AssetTrendChartSVG Render Tests
 * Tests actual rendered SVG output to verify chronological x-axis positioning.
 * These tests render the actual component using react-dom/server and parse
 * the resulting HTML to assert x-coordinates are chronologically ordered.
 */

import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { AssetTrendChartSVG } from "../AssetTrendChartSVG";
import type { TrendDataPoint } from "@/lib/assetTrendChart";

// Helper to format currency (mimics app behavior)
const formatCurrency = (value: number, currency: string): string => {
  const symbol = currency === "USD" ? "$" : currency;
  const absValue = Math.abs(value);
  if (absValue >= 1000000) return `${symbol}${(value / 1000000).toFixed(1)}M`;
  if (absValue >= 1000) return `${symbol}${(value / 1000).toFixed(0)}k`;
  return `${symbol}${value.toFixed(0)}`;
};

const formatCurrencyWithCents = (value: number, currency: string): string => {
  const symbol = currency === "USD" ? "$" : currency;
  return `${symbol}${(value / 100).toFixed(2)}`;
};

/**
 * Extract x-coordinate from rendered markup by data-testid
 */
function extractX(markup: string, testId: string): number | null {
  // Match cx or x1 attributes for the given testId
  const cxMatch = markup.match(
    new RegExp(`data-testid="${testId}"[^>]*\\s+cx="([^"]+)"`)
  );
  if (cxMatch) return parseFloat(cxMatch[1]);
  
  const x1Match = markup.match(
    new RegExp(`data-testid="${testId}"[^>]*\\s+x1="([^"]+)"`)
  );
  if (x1Match) return parseFloat(x1Match[1]);
  
  return null;
}

/**
 * Extract all x-label coordinates with their dates
 */
function extractXLabels(markup: string): Array<{ x: number; date: string }> {
  const labelRegex = /data-testid="x-label-\d+"[^>]*data-date="([^"]+)"[^>]*\s+x="([^"]+)"/g;
  const labels: Array<{ x: number; date: string }> = [];
  let match;
  
  while ((match = labelRegex.exec(markup)) !== null) {
    labels.push({
      date: match[1],
      x: parseFloat(match[2]),
    });
  }
  
  return labels;
}

describe("AssetTrendChartSVG render tests", () => {
  it("renders chronological x-coordinates for Mar 2022 baseline -5%", () => {
    const actualPoints: TrendDataPoint[] = [
      { date: "2022-03-01", value: 5200000, label: "Mar '22", isProjected: false },
    ];
    const projectedPoints: TrendDataPoint[] = [
      { date: "2023-03-01", value: 4940000, label: "2023", isProjected: true },
      { date: "2024-03-01", value: 4693000, label: "2024", isProjected: true },
      { date: "2025-03-01", value: 4458350, label: "2025", isProjected: true },
    ];
    
    const markup = renderToStaticMarkup(
      createElement(AssetTrendChartSVG, {
        actualPoints,
        projectedPoints,
        todayDate: "2026-11-07",
        currency: "USD",
        formatCurrency,
        formatCurrencyWithCents,
      })
    );
    
    // Extract x-coordinates for actual and projected points
    const actualX0 = extractX(markup, "actual-point-0");
    const projX0 = extractX(markup, "projected-point-0");
    const projX1 = extractX(markup, "projected-point-1");
    const projX2 = extractX(markup, "projected-point-2");
    
    expect(actualX0).not.toBeNull();
    expect(projX0).not.toBeNull();
    expect(projX1).not.toBeNull();
    expect(projX2).not.toBeNull();
    
    // Assert strict chronological ordering: Mar 2022 < 2023 < 2024 < 2025
    expect(actualX0!).toBeLessThan(projX0!);
    expect(projX0!).toBeLessThan(projX1!);
    expect(projX1!).toBeLessThan(projX2!);
    
    // Verify spacing is date-proportional (not index-based)
    // All projections are 1 year apart, so spacing should be approximately equal
    const spacing0to1 = projX1! - projX0!;
    const spacing1to2 = projX2! - projX1!;
    expect(Math.abs(spacing0to1 - spacing1to2)).toBeLessThan(1); // Allow 1px tolerance
  });

  it("renders chronological x-coordinates for Oct→Nov 2026 (29k→31k)", () => {
    const actualPoints: TrendDataPoint[] = [
      { date: "2026-10-01", value: 2900000, label: "Oct '26", isProjected: false },
      { date: "2026-11-01", value: 3100000, label: "Nov '26", isProjected: false },
    ];
    const projectedPoints: TrendDataPoint[] = [];
    
    const markup = renderToStaticMarkup(
      createElement(AssetTrendChartSVG, {
        actualPoints,
        projectedPoints,
        todayDate: "2026-11-07",
        currency: "USD",
        formatCurrency,
        formatCurrencyWithCents,
      })
    );
    
    const actualX0 = extractX(markup, "actual-point-0");
    const actualX1 = extractX(markup, "actual-point-1");
    
    expect(actualX0).not.toBeNull();
    expect(actualX1).not.toBeNull();
    
    // Oct 2026 must be strictly left of Nov 2026
    expect(actualX0!).toBeLessThan(actualX1!);
    
    // Verify Today marker is present and positioned after Oct but near Nov
    const todayX = extractX(markup, "today-marker");
    expect(todayX).toBeNull(); // No projections, so no Today marker in this scenario
  });

  it("handles single point at center when dateRange = 0", () => {
    const actualPoints: TrendDataPoint[] = [
      { date: "2026-11-07", value: 5000000, label: "Nov '26", isProjected: false },
    ];
    const projectedPoints: TrendDataPoint[] = [];
    
    const markup = renderToStaticMarkup(
      createElement(AssetTrendChartSVG, {
        actualPoints,
        projectedPoints,
        todayDate: "2026-11-07",
        currency: "USD",
        formatCurrency,
        formatCurrencyWithCents,
      })
    );
    
    const actualX = extractX(markup, "actual-point-0");
    expect(actualX).not.toBeNull();
    
    // With padding.left=80 and chartWidth=700, center should be at 80 + 350 = 430
    expect(actualX).toBeCloseTo(430, 0);
  });

  it("handles zero points gracefully (empty chart)", () => {
    const actualPoints: TrendDataPoint[] = [];
    const projectedPoints: TrendDataPoint[] = [];
    
    const markup = renderToStaticMarkup(
      createElement(AssetTrendChartSVG, {
        actualPoints,
        projectedPoints,
        todayDate: "2026-11-07",
        currency: "USD",
        formatCurrency,
        formatCurrencyWithCents,
      })
    );
    
    // Should render an empty SVG (grid only, no paths or points)
    expect(markup).toContain('data-testid="trend-chart-svg"');
    expect(markup).not.toContain('data-testid="actual-path"');
    expect(markup).not.toContain('data-testid="projected-path"');
  });

  it("verifies x-labels are chronologically positioned", () => {
    const actualPoints: TrendDataPoint[] = [
      { date: "2024-01-01", value: 1000000, label: "Jan '24", isProjected: false },
      { date: "2024-06-01", value: 1100000, label: "Jun '24", isProjected: false },
    ];
    const projectedPoints: TrendDataPoint[] = [
      { date: "2025-01-01", value: 1200000, label: "2025", isProjected: true },
      { date: "2026-01-01", value: 1300000, label: "2026", isProjected: true },
    ];
    
    const markup = renderToStaticMarkup(
      createElement(AssetTrendChartSVG, {
        actualPoints,
        projectedPoints,
        todayDate: "2026-11-07",
        currency: "USD",
        formatCurrency,
        formatCurrencyWithCents,
      })
    );
    
    const labels = extractXLabels(markup);
    expect(labels).toHaveLength(4);
    
    // Verify labels are strictly increasing by x-coordinate
    for (let i = 1; i < labels.length; i++) {
      expect(labels[i].x).toBeGreaterThan(labels[i - 1].x);
    }
    
    // Verify dates match expected order
    expect(labels[0].date).toBe("2024-01-01");
    expect(labels[1].date).toBe("2024-06-01");
    expect(labels[2].date).toBe("2025-01-01");
    expect(labels[3].date).toBe("2026-01-01");
  });

  it("Today marker renders at correct position between actual and projected", () => {
    const actualPoints: TrendDataPoint[] = [
      { date: "2025-01-01", value: 1000000, label: "Jan '25", isProjected: false },
    ];
    const projectedPoints: TrendDataPoint[] = [
      { date: "2026-01-01", value: 1100000, label: "2026", isProjected: true },
      { date: "2027-01-01", value: 1200000, label: "2027", isProjected: true },
    ];
    
    const markup = renderToStaticMarkup(
      createElement(AssetTrendChartSVG, {
        actualPoints,
        projectedPoints,
        todayDate: "2026-06-01",
        currency: "USD",
        formatCurrency,
        formatCurrencyWithCents,
      })
    );
    
    const actualX = extractX(markup, "actual-point-0")!;
    const projX0 = extractX(markup, "projected-point-0")!;
    const projX1 = extractX(markup, "projected-point-1")!;
    const todayX = extractX(markup, "today-marker")!;
    
    expect(todayX).not.toBeNull();
    
    // Today (Jun 2026) should be positioned between first projection (Jan 2026) and second (Jan 2027)
    expect(todayX).toBeGreaterThan(actualX);
    expect(todayX).toBeGreaterThan(projX0);
    expect(todayX).toBeLessThan(projX1);
  });
});
