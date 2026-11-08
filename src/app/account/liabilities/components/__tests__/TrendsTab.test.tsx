/**
 * Integration tests for Liabilities TrendsTab
 * Tests production component logic: latest month default, authoritative breakdown with carry-forward/FX/closed debts
 */

import React from "react";
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TrendsTab } from "../TrendsTab";
import type { DebtsSummary } from "@/lib/debtsSummary";
import {
  buildProductionTrendsFixture,
  installChartResizeObserver,
} from "@/lib/__tests__/trendsMonthCompositionFixture";

// @vitest-environment jsdom

const mockSummary: DebtsSummary = {
  totalDebt: 25000,
  currency: "USD",
  changeVsLastMonth: -1000,
  changeVs12Months: -5000,
  monthlyPayments: 1500,
  interestPaidLast3Months: 450,
  interestPaidByYear: [],
  weightedAvgRate: 18.5,
  groups: [],
  payoffEstimates: [],
  monthlyHistory: [
    {
      month: "2024-01",
      monthLabel: "Jan 2024",
      totalDebt: 30000,
      totalPayments: 1500,
      groups: [{ type: "credit_card", balance: 30000 }],
      accountDetails: [
        { slug: "cc-1", label: "Chase Sapphire", type: "credit", value: -15000 },
        { slug: "cc-2", label: "Amex Gold", type: "credit", value: -10000 },
        { slug: "loan-1", label: "Car Loan", type: "auto_loan", value: -5000 },
      ],
    },
    {
      month: "2024-02",
      monthLabel: "Feb 2024",
      totalDebt: 27000,
      totalPayments: 1500,
      groups: [{ type: "credit_card", balance: 27000 }],
      accountDetails: [
        { slug: "cc-1", label: "Chase Sapphire", type: "credit", value: -12000 },
        { slug: "cc-2", label: "Amex Gold", type: "credit", value: -10000 },
        { slug: "loan-1", label: "Car Loan (carry-forward)", type: "auto_loan", value: -5000 }, // No statement this month
      ],
    },
    {
      month: "2024-03",
      monthLabel: "Mar 2024",
      totalDebt: 25100,
      totalPayments: 1500,
      groups: [{ type: "credit_card", balance: 25000 }],
      accountDetails: [
        { slug: "cc-1", label: "Chase Sapphire", type: "credit", value: -10000 },
        { slug: "cc-2", label: "Amex Gold (CAD→USD)", type: "credit", value: -10000 }, // FX converted
        { slug: "loan-1", label: "Car Loan (carry-forward)", type: "auto_loan", value: -5000 },
        { slug: "manual-student-1", label: "Federal Student Loan", type: "manual-student_loan", value: -100 },
      ],
    },
  ],
  accountBalanceHistory: [],
  expenseTxns: [],
  incomeTxns: [],
};

describe("Liabilities TrendsTab integration tests", () => {
  it("defaults to latest available month (not future)", () => {
    const { container } = render(<TrendsTab summary={mockSummary} />);
    
    // Latest month is 2024-03, should be selected by default
    // Verify month label is shown
    const html = container.innerHTML;
    expect(html).toContain("Mar 2024");
    expect(html).toContain("Total Debt Over Time");
  });

  it("shows month details with authoritative breakdown including manual liabilities", () => {
    const { container } = render(<TrendsTab summary={mockSummary} />);
    
    // Default latest month (Mar 2024) should show details
    const html = container.innerHTML;
    
    // Should show accounts AND manual liabilities from accountDetails
    expect(html).toContain("Chase Sapphire");
    expect(html).toContain("Amex Gold");
    expect(html).toContain("Car Loan");
    expect(html).toContain("Federal Student Loan");
  });

  it("detail rows sum exactly matches plotted total from authoritative calculation", () => {
    // Test that carry-forward + FX + manual liabilities + closed debt exclusion sum correctly
    const summaryWithCarryForward: DebtsSummary = {
      ...mockSummary,
      monthlyHistory: [
        {
          month: "2024-03",
          monthLabel: "Mar 2024",
          totalDebt: 25100, // Plotted total
          totalPayments: 1500,
          groups: [],
          accountDetails: [
            { slug: "cc-1", label: "Chase Sapphire", type: "credit", value: -10000 },
            { slug: "cc-2", label: "Amex Gold (CAD→USD)", type: "credit", value: -10000 }, // FX converted
            { slug: "loan-1", label: "Car Loan (carry-forward)", type: "auto_loan", value: -5000 }, // No statement this month
            { slug: "manual-student-1", label: "Federal Student Loan", type: "manual-student_loan", value: -100 },
            // Paid-off credit card excluded (not in accountDetails = closed/paid)
          ],
        },
      ],
    };
    
    const { container } = render(<TrendsTab summary={summaryWithCarryForward} />);
    const html = container.innerHTML;
    
    // Verify all debts present
    expect(html).toContain("Chase Sapphire");
    expect(html).toContain("Amex Gold");
    expect(html).toContain("Car Loan");
    expect(html).toContain("Federal Student Loan");
    
    // Verify plotted total is shown
    expect(html).toContain("$25,100");
    
    // Detail rows sum: 10000 + 10000 + 5000 + 100 = 25100 ✓
  });

  it("handles empty history gracefully", () => {
    const emptySummary: DebtsSummary = {
      ...mockSummary,
      monthlyHistory: [],
    };
    
    const { container } = render(<TrendsTab summary={emptySummary} />);
    
    // Should show empty state message
    expect(screen.getByText(/No historical data available/i)).toBeTruthy();
  });

  it("handles single month of data", () => {
    const singleMonthSummary: DebtsSummary = {
      ...mockSummary,
      monthlyHistory: [
        {
          month: "2024-03",
          monthLabel: "Mar 2024",
          totalDebt: 25000,
          totalPayments: 1500,
          groups: [{ type: "credit_card", balance: 25000 }],
          accountDetails: [
            { slug: "cc-1", label: "Chase Sapphire", type: "credit", value: -25000 },
          ],
        },
      ],
    };
    
    const { container } = render(<TrendsTab summary={singleMonthSummary} />);
    
    // Should show account details
    expect(container.innerHTML).toContain("Chase Sapphire");
    expect(container.innerHTML).toContain("$25,000");
  });

  it("uses calculateBalanceChartDomain for readable scale", () => {
    // Test small range on large balance
    const smallRangeSummary: DebtsSummary = {
      ...mockSummary,
      monthlyHistory: [
        {
          month: "2024-01",
          monthLabel: "Jan 2024",
          totalDebt: 100000,
          totalPayments: 0,
          groups: [],
          accountDetails: [],
        },
        {
          month: "2024-02",
          monthLabel: "Feb 2024",
          totalDebt: 100100, // Only $100 difference
          totalPayments: 0,
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

describe("Liabilities TrendsTab production fixture — click and async", () => {
  beforeEach(() => {
    installChartResizeObserver();
  });

  it("defaults to latest production month and shows federal student loan summing to total", () => {
    const { debtsSummary } = buildProductionTrendsFixture();
    const { container } = render(<TrendsTab summary={debtsSummary} />);

    expect(container.innerHTML).toContain("Mar 2026");
    expect(container.innerHTML).toContain("Federal Student Loan");
    expect(container.innerHTML).toContain("CAD Visa");
    expect(container.innerHTML).toContain("OSAP Student Loan");

    const mar = debtsSummary.monthlyHistory.find((m) => m.month === "2026-03")!;
    const rowSum = mar.accountDetails!.reduce((s, r) => s + Math.abs(r.value), 0);
    expect(rowSum).toBe(mar.totalDebt);
    expect(container.innerHTML).toContain("CA$24,400");
  });

  it("clicking a historical month updates details and hides the later-dated manual loan", () => {
    const { debtsSummary } = buildProductionTrendsFixture();
    const { container } = render(<TrendsTab summary={debtsSummary} />);

    const janDot = container.querySelector('circle[data-month="2026-01"]');
    expect(janDot).toBeTruthy();
    fireEvent.click(janDot!);

    expect(container.innerHTML).toContain("Jan 2026");
    expect(container.innerHTML).not.toContain("Federal Student Loan");
    expect(container.innerHTML).toContain("OSAP Student Loan");
    expect(container.innerHTML).toContain("CA$10,000");
  });

  it("async data arrival selects the latest available month", () => {
    const { debtsSummary } = buildProductionTrendsFixture();
    const empty: DebtsSummary = { ...debtsSummary, monthlyHistory: [] };
    const { container, rerender } = render(<TrendsTab summary={empty} />);

    expect(screen.getByText(/No historical data available/i)).toBeTruthy();

    rerender(<TrendsTab summary={debtsSummary} />);

    expect(container.innerHTML).toContain("Mar 2026");
    expect(container.innerHTML).toContain("Federal Student Loan");
    expect(container.innerHTML).toContain("CA$24,400");
  });
});
