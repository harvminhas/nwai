/**
 * @vitest-environment jsdom
 */
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import GrowthTab from "../GrowthTab";
import type { MonthGrowthBreakdown } from "@/lib/netWorthGrowth";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

const breakdown: MonthGrowthBreakdown = {
  yearMonth: "2026-10",
  netWorthChange: 1500,
  hasPreviousMonth: true,
  income: 5000,
  spending: 3000,
  grossSavings: 2000,
  savingsRate: 0.4,
  interestAndFees: 0,
  interestAndFeesIdentifiable: false,
  interestAndFeesMissingNote: true,
  netSavings: null,
  debtPaydown: 200,
  debtAccounts: [{
    slug: "visa",
    label: "Visa",
    type: "credit",
    amount: 200,
    paid: 500,
    newCharges: 300,
    interestAndFees: 0,
    paydown: 200,
    usedActivity: true,
  }],
  investmentDelta: 300,
  investmentContributions: 0,
  investmentWithdrawals: 0,
  investmentMarketGrowth: 0,
  investmentUnsplit: 300,
  investmentAccounts: [{
    slug: "tfsa",
    label: "TFSA",
    type: "investment",
    amount: 300,
    delta: 300,
    contributions: null,
    withdrawals: null,
    marketGrowth: null,
    split: "unsplit",
  }],
  otherAssetChanges: 0,
  otherAssets: [],
  savingsForReconciliation: 2000,
  unexplained: -1000,
};

describe("GrowthTab", () => {
  it("shows gross savings, unsplit investment, and unexplained remainder", () => {
    render(
      <GrowthTab
        breakdown={breakdown}
        currency="CAD"
        scope="month"
        onScopeChange={vi.fn()}
        monthLabel="Oct 2026"
        rangeLabel="Aug 2026 – Oct 2026"
      />,
    );
    expect(screen.getByText("Gross savings")).toBeTruthy();
    expect(screen.getByText(/40% savings rate/)).toBeTruthy();
    expect(screen.getByText("Debt paydown")).toBeTruthy();
    expect(screen.getByText(/Unsplit/)).toBeTruthy();
    expect(screen.getByText("Other / unexplained")).toBeTruthy();
    expect(screen.getByText("Total (matches What Changed)")).toBeTruthy();
  });

  it("toggles This month vs Chart range", () => {
    const onScopeChange = vi.fn();
    render(
      <GrowthTab
        breakdown={breakdown}
        currency="CAD"
        scope="month"
        onScopeChange={onScopeChange}
        monthLabel="Oct 2026"
        rangeLabel="Aug 2026 – Oct 2026"
      />,
    );
    screen.getByRole("button", { name: "Chart range" }).click();
    expect(onScopeChange).toHaveBeenCalledWith("range");
  });
});
