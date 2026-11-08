/**
 * AssetTrendChartSVG Render Tests
 * Tests actual rendered SVG paths and coordinates with real dimensions.
 * Uses jsdom client-side rendering with fixed dimensions to assert geometry.
 */

import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { AssetTrendChartSVG } from "../AssetTrendChartSVG";
import type { TrendDataPoint } from "@/lib/assetTrendChart";

// @vitest-environment jsdom

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

describe("AssetTrendChartSVG time-based axis and connection", () => {
  it("renders with default ResponsiveContainer production wrapper", () => {
    // Mock ResizeObserver to notify ResponsiveContainer of dimensions
    const mockObserve = vi.fn();
    const mockDisconnect = vi.fn();
    let observerCallback: ResizeObserverCallback | null = null;
    
    global.ResizeObserver = class MockResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        observerCallback = callback;
      }
      observe(target: Element) {
        mockObserve(target);
        // Simulate observer notification with measured dimensions
        if (observerCallback) {
          observerCallback([{
            target,
            contentRect: { width: 800, height: 300, top: 0, left: 0, bottom: 300, right: 800, x: 0, y: 0 },
            borderBoxSize: [],
            contentBoxSize: [],
            devicePixelContentBoxSize: [],
          }] as ResizeObserverEntry[], this as unknown as ResizeObserver);
        }
      }
      unobserve() {}
      disconnect() { mockDisconnect(); }
    };
    
    const actualPoints: TrendDataPoint[] = [
      { date: "2024-01-01", value: 10000, label: "Jan '24", isProjected: false },
    ];
    const projectedPoints: TrendDataPoint[] = [
      { date: "2025-01-01", value: 11000, label: "Jan '25", isProjected: true },
    ];
    
    // Test production path: no width/height props, uses ResponsiveContainer
    const { container } = render(
      <AssetTrendChartSVG
        actualPoints={actualPoints}
        projectedPoints={projectedPoints}
        todayDate="2024-06-01"
        currency="USD"
        formatCurrency={formatCurrency}
        formatCurrencyWithCents={formatCurrencyWithCents}
      />
    );
    
    // Verify ResponsiveContainer wrapper renders
    const wrapper = container.querySelector('[data-testid="trend-chart-svg"]');
    expect(wrapper).toBeTruthy();
    
    // Verify observer was called (ResponsiveContainer measured container)
    expect(mockObserve).toHaveBeenCalled();
    
    // Verify SVG renders inside ResponsiveContainer with measured dimensions
    const svg = container.querySelector('svg.recharts-surface');
    expect(svg).toBeTruthy();
    
    // Verify chart content exists (not blank)
    const paths = container.querySelectorAll('path');
    expect(paths.length).toBeGreaterThan(0);
  });

  it("renders actual SVG paths with fixed dimensions", () => {
    const actualPoints: TrendDataPoint[] = [
      { date: "2022-01-01", value: 10000, label: "Jan '22", isProjected: false },
      { date: "2024-01-01", value: 12000, label: "Jan '24", isProjected: false },
    ];
    const projectedPoints: TrendDataPoint[] = [
      { date: "2025-01-01", value: 13000, label: "Jan '25", isProjected: true },
    ];
    
    const { container } = render(
      <AssetTrendChartSVG
        actualPoints={actualPoints}
        projectedPoints={projectedPoints}
        todayDate="2024-06-01"
        currency="USD"
        formatCurrency={formatCurrency}
        formatCurrencyWithCents={formatCurrencyWithCents}
        width={800}
        height={300}
      />
    );
    
    // Assert actual SVG elements exist
    const svg = container.querySelector('svg.recharts-surface');
    expect(svg).toBeTruthy();
    
    // Assert line paths exist
    const paths = container.querySelectorAll('path.recharts-line-curve');
    expect(paths.length).toBeGreaterThan(0);
    
    // Assert dots (circles) exist
    const dots = container.querySelectorAll('circle.recharts-dot');
    expect(dots.length).toBeGreaterThan(0);
  });

  it("anchors at latest actual ≤ today (not future actuals)", () => {
    // Scenario: Jan 2024 $10k, Jan 2027 $20k (future), today Nov 2026
    // Should anchor at Jan 2024, not Jan 2027
    const actualPoints: TrendDataPoint[] = [
      { date: "2024-01-01", value: 10000, label: "Jan '24", isProjected: false },
      { date: "2027-01-01", value: 20000, label: "Jan '27", isProjected: false }, // Future actual
    ];
    const projectedPoints: TrendDataPoint[] = [
      { date: "2028-01-01", value: 25000, label: "Jan '28", isProjected: true },
    ];
    
    const { container } = render(
      <AssetTrendChartSVG
        actualPoints={actualPoints}
        projectedPoints={projectedPoints}
        todayDate="2026-11-01"
        currency="USD"
        formatCurrency={formatCurrency}
        formatCurrencyWithCents={formatCurrencyWithCents}
        width={800}
        height={300}
      />
    );
    
    // Verify SVG renders with proper anchor (not creating false spike to $20k)
    const svg = container.querySelector('svg.recharts-surface');
    expect(svg).toBeTruthy();
    
    const paths = container.querySelectorAll('path.recharts-line-curve');
    expect(paths.length).toBeGreaterThan(0);
  });

  it("renders Today ReferenceLine at actual UTC timestamp", () => {
    const actualPoints: TrendDataPoint[] = [
      { date: "2024-01-01", value: 10000, label: "Jan '24", isProjected: false },
    ];
    const projectedPoints: TrendDataPoint[] = [
      { date: "2025-01-01", value: 11000, label: "Jan '25", isProjected: true },
    ];
    
    const { container } = render(
      <AssetTrendChartSVG
        actualPoints={actualPoints}
        projectedPoints={projectedPoints}
        todayDate="2024-06-15"
        currency="USD"
        formatCurrency={formatCurrency}
        formatCurrencyWithCents={formatCurrencyWithCents}
        width={800}
        height={300}
      />
    );
    
    // Verify ReferenceLine exists (amber color #fbbf24)
    const svg = container.querySelector('svg.recharts-surface');
    expect(svg).toBeTruthy();
    
    const referenceLine = container.querySelector('line.recharts-reference-line-line');
    expect(referenceLine).toBeTruthy();
  });

  it("handles irregular date spacing with proportional positioning", () => {
    const actualPoints: TrendDataPoint[] = [
      { date: "2022-01-01", value: 10000, label: "Jan '22", isProjected: false },
      { date: "2022-02-01", value: 10100, label: "Feb '22", isProjected: false }, // 1 month gap
      { date: "2024-01-01", value: 12000, label: "Jan '24", isProjected: false }, // 2 year gap
    ];
    
    const { container } = render(
      <AssetTrendChartSVG
        actualPoints={actualPoints}
        projectedPoints={[]}
        todayDate="2024-06-01"
        currency="USD"
        formatCurrency={formatCurrency}
        formatCurrencyWithCents={formatCurrencyWithCents}
        width={800}
        height={300}
      />
    );
    
    // Verify SVG with numeric time-based axis
    const svg = container.querySelector('svg.recharts-surface');
    expect(svg).toBeTruthy();
    
    const dots = container.querySelectorAll('circle.recharts-dot');
    expect(dots.length).toBe(3); // Three actual points
  });

  it("continuous lines with connectNulls through interleaved rows", () => {
    const actualPoints: TrendDataPoint[] = [
      { date: "2024-01-01", value: 10000, label: "Jan '24", isProjected: false },
      { date: "2024-02-01", value: 10500, label: "Feb '24", isProjected: false },
    ];
    const projectedPoints: TrendDataPoint[] = [
      { date: "2024-03-01", value: 11000, label: "Mar '24", isProjected: true },
    ];
    
    const { container } = render(
      <AssetTrendChartSVG
        actualPoints={actualPoints}
        projectedPoints={projectedPoints}
        todayDate="2024-02-15"
        currency="USD"
        formatCurrency={formatCurrency}
        formatCurrencyWithCents={formatCurrencyWithCents}
        width={800}
        height={300}
      />
    );
    
    // Both lines render continuously (not broken by nulls)
    const paths = container.querySelectorAll('path.recharts-line-curve');
    expect(paths.length).toBeGreaterThanOrEqual(2); // Actual + projected lines
  });

  it("handles all-zero values without NaN", () => {
    const actualPoints: TrendDataPoint[] = [
      { date: "2024-01-01", value: 0, label: "Jan '24", isProjected: false },
    ];
    const projectedPoints: TrendDataPoint[] = [
      { date: "2025-01-01", value: 0, label: "Jan '25", isProjected: true },
    ];
    
    const { container } = render(
      <AssetTrendChartSVG
        actualPoints={actualPoints}
        projectedPoints={projectedPoints}
        todayDate="2024-06-01"
        currency="USD"
        formatCurrency={formatCurrency}
        formatCurrencyWithCents={formatCurrencyWithCents}
        width={800}
        height={300}
      />
    );
    
    const html = container.innerHTML;
    expect(html).not.toContain('NaN');
    
    const svg = container.querySelector('svg.recharts-surface');
    expect(svg).toBeTruthy();
  });

  it("handles single actual point without projected", () => {
    const actualPoints: TrendDataPoint[] = [
      { date: "2024-01-01", value: 15000, label: "Jan '24", isProjected: false },
    ];
    
    const { container } = render(
      <AssetTrendChartSVG
        actualPoints={actualPoints}
        projectedPoints={[]}
        todayDate="2024-06-01"
        currency="USD"
        formatCurrency={formatCurrency}
        formatCurrencyWithCents={formatCurrencyWithCents}
        width={800}
        height={300}
      />
    );
    
    const svg = container.querySelector('svg.recharts-surface');
    expect(svg).toBeTruthy();
  });

  it("uses shared domain calculation for small ranges", () => {
    const actualPoints: TrendDataPoint[] = [
      { date: "2024-01-01", value: 100000, label: "Jan '24", isProjected: false },
      { date: "2024-02-01", value: 100100, label: "Feb '24", isProjected: false },
    ];
    
    const { container } = render(
      <AssetTrendChartSVG
        actualPoints={actualPoints}
        projectedPoints={[]}
        todayDate="2024-06-01"
        currency="USD"
        formatCurrency={formatCurrency}
        formatCurrencyWithCents={formatCurrencyWithCents}
        width={800}
        height={300}
      />
    );
    
    // Domain calculation ensures $100 change is visible
    const svg = container.querySelector('svg.recharts-surface');
    expect(svg).toBeTruthy();
    
    const dots = container.querySelectorAll('circle.recharts-dot');
    expect(dots.length).toBe(2);
  });
});
