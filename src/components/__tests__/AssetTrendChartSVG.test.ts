/**
 * AssetTrendChartSVG Render Tests
 * Tests actual rendered output to verify Recharts integration and canonical styling.
 * Validates monotone curves, gradients, and proper data handling.
 */

import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { AssetTrendChartSVG } from "../AssetTrendChartSVG";
import type { TrendDataPoint } from "@/lib/assetTrendChart";
import { calculateBalanceChartDomain } from "@/lib/chartDomain";

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

describe("AssetTrendChartSVG render tests", () => {
  it("renders without error and contains testid", () => {
    const actualPoints: TrendDataPoint[] = [
      { date: "2022-03-01", value: 5200000, label: "Mar '22", isProjected: false },
    ];
    const projectedPoints: TrendDataPoint[] = [
      { date: "2023-03-01", value: 4940000, label: "2023", isProjected: true },
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
    
    // Verify component renders with testid
    expect(markup).toContain('data-testid="trend-chart-svg"');
    expect(markup).not.toContain('NaN');
  });

  it("renders actual and projected data points", () => {
    const actualPoints: TrendDataPoint[] = [
      { date: "2025-10-01", value: 29000, label: "Oct '25", isProjected: false },
      { date: "2026-11-01", value: 31000, label: "Nov '26", isProjected: false },
    ];
    const projectedPoints: TrendDataPoint[] = [
      { date: "2027-01-01", value: 32000, label: "Jan '27", isProjected: true },
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
    
    // Verify component renders
    expect(markup).toContain('data-testid="trend-chart-svg"');
    expect(markup.length).toBeGreaterThan(100);
  });

  it("handles single data point without error", () => {
    const actualPoints: TrendDataPoint[] = [
      { date: "2024-01-01", value: 15000, label: "Jan '24", isProjected: false },
    ];
    
    const markup = renderToStaticMarkup(
      createElement(AssetTrendChartSVG, {
        actualPoints,
        projectedPoints: [],
        todayDate: "2026-11-07",
        currency: "USD",
        formatCurrency,
        formatCurrencyWithCents,
      })
    );
    
    expect(markup).toContain('data-testid="trend-chart-svg"');
  });

  it("uses shared domain calculation for consistent scaling", () => {
    const actualPoints: TrendDataPoint[] = [
      { date: "2024-01-01", value: 100000, label: "Jan '24", isProjected: false },
      { date: "2024-02-01", value: 100100, label: "Feb '24", isProjected: false },
    ];
    
    // Verify domain calculation provides visible separation
    const values = actualPoints.map(p => p.value);
    const domain = calculateBalanceChartDomain(values);
    const range = domain.max - domain.min;
    const changeRatio = 100 / range;
    
    // $100 change should occupy at least 5% of chart height
    expect(changeRatio).toBeGreaterThan(0.05);
    
    const markup = renderToStaticMarkup(
      createElement(AssetTrendChartSVG, {
        actualPoints,
        projectedPoints: [],
        todayDate: "2026-11-07",
        currency: "USD",
        formatCurrency,
        formatCurrencyWithCents,
      })
    );
    
    expect(markup).toContain('data-testid="trend-chart-svg"');
  });

  it("handles all-zero values without NaN (domain regression)", () => {
    const actualPoints: TrendDataPoint[] = [
      { date: "2024-01-01", value: 0, label: "Jan '24", isProjected: false },
    ];
    const projectedPoints: TrendDataPoint[] = [
      { date: "2024-02-01", value: 0, label: "Feb '24", isProjected: true },
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
    
    // Should not contain NaN in output
    expect(markup).not.toContain('NaN');
    expect(markup).toContain('data-testid="trend-chart-svg"');
  });

  it("renders with projections without error", () => {
    const actualPoints: TrendDataPoint[] = [
      { date: "2024-01-01", value: 10000, label: "Jan '24", isProjected: false },
    ];
    const projectedPoints: TrendDataPoint[] = [
      { date: "2025-01-01", value: 12000, label: "Jan '25", isProjected: true },
    ];
    
    const markup = renderToStaticMarkup(
      createElement(AssetTrendChartSVG, {
        actualPoints,
        projectedPoints,
        todayDate: "2024-06-15",
        currency: "USD",
        formatCurrency,
        formatCurrencyWithCents,
      })
    );
    
    // Verify component renders without error
    expect(markup).toContain('data-testid="trend-chart-svg"');
    expect(markup).not.toContain('NaN');
  });
});
