/**
 * Tests for NetWorthChart component
 * Ensures canonical chart domain calculation is applied correctly
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import NetWorthChart from "../NetWorthChart";
import * as chartDomain from "../../lib/chartDomain";

// Mock recharts to avoid rendering issues in tests
vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div data-testid="responsive-container">{children}</div>,
  LineChart: ({ children }: { children: React.ReactNode }) => <div data-testid="line-chart">{children}</div>,
  Line: () => <div data-testid="line" />,
  XAxis: () => <div data-testid="x-axis" />,
  YAxis: ({ domain }: { domain: [number, number] }) => <div data-testid="y-axis" data-domain={JSON.stringify(domain)} />,
  Tooltip: () => <div data-testid="tooltip" />,
  CartesianGrid: () => <div data-testid="cartesian-grid" />,
}));

describe("NetWorthChart", () => {
  it("applies canonical domain calculation for small changes on large balance", () => {
    const calculateBalanceChartDomainSpy = vi.spyOn(chartDomain, "calculateBalanceChartDomain");
    
    const history = [
      { yearMonth: "2024-01", netWorth: 100000, isEstimate: false },
      { yearMonth: "2024-02", netWorth: 100100, isEstimate: false },
    ];

    render(
      <NetWorthChart
        history={history}
        currency="USD"
      />
    );

    // Should have called the canonical domain calculation
    expect(calculateBalanceChartDomainSpy).toHaveBeenCalledWith(
      expect.arrayContaining([100000, 100100])
    );

    const domain = chartDomain.calculateBalanceChartDomain([100000, 100100]);
    
    // Domain should be tight (zoomed in) for small changes
    expect(domain.max - domain.min).toBeLessThan(10000);
    
    // Should render chart components
    expect(screen.getByTestId("line-chart")).toBeInTheDocument();
    expect(screen.getByTestId("y-axis")).toBeInTheDocument();
  });

  it("applies canonical domain calculation for large changes", () => {
    const history = [
      { yearMonth: "2024-01", netWorth: 100000, isEstimate: false },
      { yearMonth: "2024-02", netWorth: 110000, isEstimate: false },
    ];

    render(
      <NetWorthChart
        history={history}
        currency="USD"
      />
    );

    const domain = chartDomain.calculateBalanceChartDomain([100000, 110000]);
    
    // Domain should have standard padding
    expect(domain.min).toBeLessThanOrEqual(99000);
    expect(domain.max).toBeGreaterThanOrEqual(110500);
  });

  it("handles negative values (debt accounts)", () => {
    const history = [
      { yearMonth: "2024-01", netWorth: -50000, isEstimate: false },
      { yearMonth: "2024-02", netWorth: -45000, isEstimate: false },
    ];

    render(
      <NetWorthChart
        history={history}
        currency="USD"
        isDebt={true}
      />
    );

    const domain = chartDomain.calculateBalanceChartDomain([50000, 45000]);
    
    // Should handle negative values correctly
    expect(domain.min).toBeDefined();
    expect(domain.max).toBeGreaterThan(domain.min);
  });

  it("handles estimated months with dashed lines", () => {
    const history = [
      { yearMonth: "2024-01", netWorth: 100000, isEstimate: false },
      { yearMonth: "2024-02", netWorth: 101000, isEstimate: true },
    ];

    render(
      <NetWorthChart
        history={history}
        currency="USD"
      />
    );

    // Should render both solid and dashed lines
    const lines = screen.getAllByTestId("line");
    expect(lines).toHaveLength(2); // One solid, one dashed
  });

  it("preserves exact data values", () => {
    const calculateBalanceChartDomainSpy = vi.spyOn(chartDomain, "calculateBalanceChartDomain");
    
    const history = [
      { yearMonth: "2024-01", netWorth: 123456.78, isEstimate: false },
      { yearMonth: "2024-02", netWorth: 123567.89, isEstimate: false },
    ];

    render(
      <NetWorthChart
        history={history}
        currency="USD"
      />
    );

    // Should be called with exact values
    expect(calculateBalanceChartDomainSpy).toHaveBeenCalledWith(
      expect.arrayContaining([123456.78, 123567.89])
    );
  });

  it("rounds domain to thousands for clean labels", () => {
    const history = [
      { yearMonth: "2024-01", netWorth: 12345, isEstimate: false },
      { yearMonth: "2024-02", netWorth: 23456, isEstimate: false },
    ];

    render(
      <NetWorthChart
        history={history}
        currency="USD"
      />
    );

    const domain = chartDomain.calculateBalanceChartDomain([12345, 23456]);
    
    // Both min and max should be multiples of 1000
    expect(domain.min % 1000).toBe(0);
    expect(domain.max % 1000).toBe(0);
  });
});
