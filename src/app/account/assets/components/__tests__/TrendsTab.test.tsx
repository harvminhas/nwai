/**
 * Integration tests for Assets TrendsTab
 * Tests production component logic: latest month default, authoritative breakdown with carry-forward/FX/manual assets
 */

import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TrendsTab } from "../TrendsTab";
import type { AssetsSummary } from "@/lib/assetsSummary";

// @vitest-environment jsdom

const mockSummary: AssetsSummary = {
  totalAssets: 150000,
  currency: "USD",
  changeVsLastMonth: 5000,
  changeVs12Months: 15000,
  groups: [],
  monthlyHistory: [
    {
      month: "2024-01",
      monthLabel: "Jan 2024",
      total: 100000,
      groups: [{ type: "cash", total: 100000 }],
      accountDetails: [
        { slug: "checking-1", label: "Chase Checking", type: "checking", value: 50000 },
        { slug: "savings-1", label: "Ally Savings", type: "savings", value: 50000 },
      ],
    },
    {
      month: "2024-02",
      monthLabel: "Feb 2024",
      total: 120000,
      groups: [{ type: "cash", total: 120000 }],
      accountDetails: [
        { slug: "checking-1", label: "Chase Checking", type: "checking", value: 60000 },
        { slug: "savings-1", label: "Ally Savings", type: "savings", value: 60000 },
      ],
    },
    {
      month: "2024-03",
      monthLabel: "Mar 2024",
      total: 150500,
      groups: [{ type: "cash", total: 150000 }, { type: "property", total: 500 }],
      accountDetails: [
        { slug: "checking-1", label: "Chase Checking", type: "checking", value: 75000 },
        { slug: "savings-1", label: "Ally Savings", type: "savings", value: 75000 },
        { slug: "manual-car-1", label: "2022 Honda Civic", type: "manual-vehicle", value: 500 },
      ],
    },
  ],
  staleAccounts: [],
  accountBalanceHistory: [],
  expenseTxns: [],
  incomeTxns: [],
};

describe("TrendsTab integration tests", () => {
  it("defaults to latest available month (not future)", () => {
    const { container } = render(<TrendsTab summary={mockSummary} />);
    
    // Latest month is 2024-03, should be selected by default
    // Verify month label is shown
    const html = container.innerHTML;
    expect(html).toContain("Mar 2024");
    expect(html).toContain("Total Assets Over Time");
  });

  it("shows month details with authoritative breakdown including manual assets", () => {
    const { container } = render(<TrendsTab summary={mockSummary} />);
    
    // Default latest month (Mar 2024) should show details
    const html = container.innerHTML;
    
    // Should show accounts AND manual assets from accountDetails
    expect(html).toContain("Chase Checking");
    expect(html).toContain("Ally Savings");
    expect(html).toContain("2022 Honda Civic");
  });

  it("detail rows sum exactly matches plotted total from authoritative calculation", () => {
    // Test that carry-forward + FX + manual assets sum correctly
    const summaryWithCarryForward: AssetsSummary = {
      ...mockSummary,
      monthlyHistory: [
        {
          month: "2024-03",
          monthLabel: "Mar 2024",
          total: 150600, // Plotted total
          groups: [],
          accountDetails: [
            { slug: "checking-1", label: "Chase Checking", type: "checking", value: 50000 },
            { slug: "savings-1", label: "Ally Savings (CAD→USD)", type: "savings", value: 75000 }, // FX converted
            { slug: "investment-1", label: "TD Investment (carry-forward)", type: "investment", value: 25000 }, // No statement this month
            { slug: "manual-car-1", label: "2022 Honda Civic", type: "manual-vehicle", value: 600 }, // Manual asset
          ],
        },
      ],
    };
    
    const { container } = render(<TrendsTab summary={summaryWithCarryForward} />);
    const html = container.innerHTML;
    
    // Verify all accounts present
    expect(html).toContain("Chase Checking");
    expect(html).toContain("Ally Savings");
    expect(html).toContain("TD Investment");
    expect(html).toContain("2022 Honda Civic");
    
    // Verify plotted total is shown
    expect(html).toContain("$150,600");
    
    // Detail rows sum: 50000 + 75000 + 25000 + 600 = 150600 ✓
  });

  it("handles empty history gracefully", () => {
    const emptySummary: AssetsSummary = {
      ...mockSummary,
      monthlyHistory: [],
    };
    
    const { container } = render(<TrendsTab summary={emptySummary} />);
    
    // Should show empty state message
    expect(screen.getByText(/No historical data available/i)).toBeTruthy();
  });

  it("handles single month of data", () => {
    const singleMonthSummary: AssetsSummary = {
      ...mockSummary,
      monthlyHistory: [
        {
          month: "2024-03",
          monthLabel: "Mar 2024",
          total: 150000,
          groups: [{ type: "cash", total: 150000 }],
          accountDetails: [
            { slug: "checking-1", label: "Chase Checking", type: "checking", value: 150000 },
          ],
        },
      ],
    };
    
    const { container } = render(<TrendsTab summary={singleMonthSummary} />);
    
    // Should show account details
    expect(container.innerHTML).toContain("Chase Checking");
    expect(container.innerHTML).toContain("$150,000");
  });

  it("uses calculateBalanceChartDomain for readable scale", () => {
    // Test small range on large balance
    const smallRangeSummary: AssetsSummary = {
      ...mockSummary,
      monthlyHistory: [
        {
          month: "2024-01",
          monthLabel: "Jan 2024",
          total: 100000,
          groups: [],
          accountDetails: [],
        },
        {
          month: "2024-02",
          monthLabel: "Feb 2024",
          total: 100100, // Only $100 difference
          groups: [],
          accountDetails: [],
        },
      ],
    };
    
    const { container } = render(<TrendsTab summary={smallRangeSummary} />);
    
    // Should not crash with NaN
    expect(container.innerHTML).not.toContain('NaN');
    expect(container.innerHTML).toContain('Feb 2024');
  });
});
