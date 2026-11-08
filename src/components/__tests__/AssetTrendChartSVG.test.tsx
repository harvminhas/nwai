/**
 * Tests for AssetTrendChartSVG component
 * Verifies canonical chart domain calculation with actual/projected data
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AssetTrendChartSVG } from "../AssetTrendChartSVG";
import * as chartDomain from "../../lib/chartDomain";
import type { TrendDataPoint } from "../../lib/assetTrendChart";

describe("AssetTrendChartSVG", () => {
  const formatCurrency = (value: number, currency: string) => 
    `$${value.toLocaleString()}`;
  const formatCurrencyWithCents = (value: number, currency: string) => 
    `$${value.toFixed(2)}`;

  it("applies canonical domain to actual + projected values", () => {
    const calculateBalanceChartDomainSpy = vi.spyOn(chartDomain, "calculateBalanceChartDomain");
    
    const actualPoints: TrendDataPoint[] = [
      { date: "2024-01-01", label: "Jan", value: 100000, isProjected: false },
      { date: "2024-02-01", label: "Feb", value: 102000, isProjected: false },
    ];
    
    const projectedPoints: TrendDataPoint[] = [
      { date: "2024-03-01", label: "Mar", value: 104000, isProjected: true },
      { date: "2024-04-01", label: "Apr", value: 106000, isProjected: true },
    ];

    render(
      <AssetTrendChartSVG
        actualPoints={actualPoints}
        projectedPoints={projectedPoints}
        todayDate="2024-02-15"
        currency="USD"
        formatCurrency={formatCurrency}
        formatCurrencyWithCents={formatCurrencyWithCents}
      />
    );

    // Should call domain calculation with all values
    expect(calculateBalanceChartDomainSpy).toHaveBeenCalledWith(
      expect.arrayContaining([100000, 102000, 104000, 106000])
    );

    // Should render SVG chart
    expect(screen.getByTestId("trend-chart-svg")).toBeInTheDocument();
  });

  it("renders actual line as solid", () => {
    const actualPoints: TrendDataPoint[] = [
      { date: "2024-01-01", label: "Jan", value: 100000, isProjected: false },
      { date: "2024-02-01", label: "Feb", value: 102000, isProjected: false },
    ];

    render(
      <AssetTrendChartSVG
        actualPoints={actualPoints}
        projectedPoints={[]}
        todayDate="2024-02-15"
        currency="USD"
        formatCurrency={formatCurrency}
        formatCurrencyWithCents={formatCurrencyWithCents}
      />
    );

    const actualPath = screen.getByTestId("actual-path");
    expect(actualPath).toBeInTheDocument();
    expect(actualPath).not.toHaveAttribute("stroke-dasharray");
  });

  it("renders projected line as dashed", () => {
    const actualPoints: TrendDataPoint[] = [
      { date: "2024-01-01", label: "Jan", value: 100000, isProjected: false },
    ];
    
    const projectedPoints: TrendDataPoint[] = [
      { date: "2024-02-01", label: "Feb", value: 102000, isProjected: true },
    ];

    render(
      <AssetTrendChartSVG
        actualPoints={actualPoints}
        projectedPoints={projectedPoints}
        todayDate="2024-01-15"
        currency="USD"
        formatCurrency={formatCurrency}
        formatCurrencyWithCents={formatCurrencyWithCents}
      />
    );

    const projectedPath = screen.getByTestId("projected-path");
    expect(projectedPath).toBeInTheDocument();
    expect(projectedPath).toHaveAttribute("stroke-dasharray", "4 3");
  });

  it("renders Today marker when projections exist", () => {
    const actualPoints: TrendDataPoint[] = [
      { date: "2024-01-01", label: "Jan", value: 100000, isProjected: false },
    ];
    
    const projectedPoints: TrendDataPoint[] = [
      { date: "2024-02-01", label: "Feb", value: 102000, isProjected: true },
    ];

    render(
      <AssetTrendChartSVG
        actualPoints={actualPoints}
        projectedPoints={projectedPoints}
        todayDate="2024-01-15"
        currency="USD"
        formatCurrency={formatCurrency}
        formatCurrencyWithCents={formatCurrencyWithCents}
      />
    );

    expect(screen.getByTestId("today-marker")).toBeInTheDocument();
  });

  it("uses chronological date-based x-axis", () => {
    const actualPoints: TrendDataPoint[] = [
      { date: "2024-01-01", label: "Jan", value: 100000, isProjected: false },
      { date: "2024-02-01", label: "Feb", value: 102000, isProjected: false },
      { date: "2024-03-01", label: "Mar", value: 104000, isProjected: false },
    ];

    render(
      <AssetTrendChartSVG
        actualPoints={actualPoints}
        projectedPoints={[]}
        todayDate="2024-03-15"
        currency="USD"
        formatCurrency={formatCurrency}
        formatCurrencyWithCents={formatCurrencyWithCents}
      />
    );

    // Should have labels for each month in chronological order
    actualPoints.forEach((point, i) => {
      const label = screen.getByTestId(`x-label-${i}`);
      expect(label).toHaveAttribute("data-date", point.date);
    });
  });

  it("handles all-zero values without divide-by-zero", () => {
    const calculateBalanceChartDomainSpy = vi.spyOn(chartDomain, "calculateBalanceChartDomain");
    
    const actualPoints: TrendDataPoint[] = [
      { date: "2024-01-01", label: "Jan", value: 0, isProjected: false },
      { date: "2024-02-01", label: "Feb", value: 0, isProjected: false },
    ];

    render(
      <AssetTrendChartSVG
        actualPoints={actualPoints}
        projectedPoints={[]}
        todayDate="2024-02-15"
        currency="USD"
        formatCurrency={formatCurrency}
        formatCurrencyWithCents={formatCurrencyWithCents}
      />
    );

    // Should handle zeros without crashing
    expect(calculateBalanceChartDomainSpy).toHaveBeenCalledWith([0, 0]);
    const domain = chartDomain.calculateBalanceChartDomain([0, 0]);
    expect(domain.max - domain.min).toBeGreaterThan(0);
  });

  it("preserves exact point values for display", () => {
    const actualPoints: TrendDataPoint[] = [
      { date: "2024-01-01", label: "Jan", value: 123456.78, isProjected: false },
    ];

    render(
      <AssetTrendChartSVG
        actualPoints={actualPoints}
        projectedPoints={[]}
        todayDate="2024-01-15"
        currency="USD"
        formatCurrency={formatCurrency}
        formatCurrencyWithCents={formatCurrencyWithCents}
      />
    );

    const point = screen.getByTestId("actual-point-0");
    expect(point).toHaveAttribute("data-value", "123456.78");
  });

  it("handles single data point without errors", () => {
    const actualPoints: TrendDataPoint[] = [
      { date: "2024-01-01", label: "Jan", value: 100000, isProjected: false },
    ];

    render(
      <AssetTrendChartSVG
        actualPoints={actualPoints}
        projectedPoints={[]}
        todayDate="2024-01-15"
        currency="USD"
        formatCurrency={formatCurrency}
        formatCurrencyWithCents={formatCurrencyWithCents}
      />
    );

    const domain = chartDomain.calculateBalanceChartDomain([100000]);
    expect(domain.min).toBeLessThan(100000);
    expect(domain.max).toBeGreaterThan(100000);
  });
});
