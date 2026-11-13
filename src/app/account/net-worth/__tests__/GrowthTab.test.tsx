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
  netWorthChange: 2100,
  hasPreviousMonth: true,
  income: 6000,
  spending: 4000,
  grossSavings: 2000,
  savingsRate: 2000 / 6000,
  interestFeesNotInSpending: 0,
  interestAndFeesIdentifiable: false,
  interestAndFeesMissingNote: false,
  netSavings: null,
  installmentPrincipalAddBack: 0,
  installmentAccounts: [],
  revolvingPaydown: 200,
  debtPaydown: 200,
  debtAccounts: [{
    slug: "visa",
    label: "Visa",
    type: "credit",
    amount: 200,
    kind: "revolving",
    paid: 1000,
    newCharges: 800,
    interestAndFees: 0,
    paydown: 200,
    principalChange: 200,
    usedActivity: true,
    isBaseline: false,
  }],
  investmentDelta: 600,
  investmentContributions: 500,
  investmentWithdrawals: 0,
  investmentMarketGrowth: 100,
  investmentUnsplit: 0,
  investmentAccounts: [{
    slug: "tfsa",
    label: "TFSA",
    type: "investment",
    amount: 600,
    delta: 600,
    contributions: 500,
    withdrawals: 0,
    marketGrowth: 100,
    split: "split",
    isBaseline: false,
  }],
  otherAssetChanges: 0,
  otherAssets: [],
  newAccountsTotal: 0,
  newAccounts: [],
  spendingInvestmentAddBack: 0,
  cashKept: 1300,
  investedFromSavings: 500,
  savingsForReconciliation: 2000,
  unexplained: 0,
};

describe("GrowthTab", () => {
  it("shows flow recon and a separate Where your savings went allocation", () => {
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
    expect(screen.getByText(/33% savings rate/)).toBeTruthy();
    expect(screen.getByText("Investment market growth")).toBeTruthy();
    expect(screen.getByText("Where your savings went")).toBeTruthy();
    expect(screen.getByText("Cash kept")).toBeTruthy();
    expect(screen.getByText("Debt paid down (cards / LOC)")).toBeTruthy();
    expect(screen.getByText("Invested")).toBeTruthy();
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
