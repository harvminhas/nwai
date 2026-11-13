/**
 * @vitest-environment jsdom
 */
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import GrowthTab from "../GrowthTab";
import type { PeriodGrowth } from "@/lib/netWorthGrowth";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

const emptySection = {
  start: 0,
  end: 0,
  change: 0,
  changePercent: null as number | null,
  accounts: [] as PeriodGrowth["cash"]["accounts"],
  putIn: null as number | null,
  marketChange: null as number | null,
};

const breakdown: PeriodGrowth = {
  yearMonth: "2026-10",
  startMonth: "2026-09",
  endMonth: "2026-10",
  hasPrevious: true,
  cash: {
    start: 8000,
    end: 9300,
    change: 1300,
    changePercent: 1300 / 8000,
    accounts: [
      { slug: "chk", label: "Chequing", type: "checking", start: 5000, end: 6200, change: 1200 },
      { slug: "sav", label: "Everyday Savings", type: "savings", start: 3000, end: 3100, change: 100 },
    ],
    putIn: null,
    marketChange: null,
  },
  investments: {
    start: 20000,
    end: 22100,
    change: 2100,
    changePercent: 2100 / 20000,
    accounts: [
      { slug: "tfsa", label: "TFSA", type: "investment", start: 20000, end: 22100, change: 2100 },
    ],
    putIn: 1500,
    marketChange: 600,
  },
  debts: {
    start: 212000,
    end: 211200,
    change: -800,
    changePercent: -800 / 212000,
    accounts: [
      { slug: "visa", label: "Visa", type: "credit", start: 2000, end: 1800, change: -200 },
    ],
    putIn: null,
    marketChange: null,
  },
  newAccounts: [
    { slug: "eq", label: "EQ Bank Savings", type: "savings", bucket: "cash", amount: 4000 },
  ],
  startAccounts: [],
  endAccounts: [],
  investmentFlows: [],
};

describe("GrowthTab", () => {
  it("shows three plain sections and not the old flow reconciliation", () => {
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
    expect(screen.getByText("Savings & cash")).toBeTruthy();
    expect(screen.getByText("Investments")).toBeTruthy();
    expect(screen.getByText("Debts")).toBeTruthy();
    expect(screen.getByText(/Your savings went up/)).toBeTruthy();
    expect(screen.getByText(/Your investments grew/)).toBeTruthy();
    expect(screen.getByText(/You put in/)).toBeTruthy();
    expect(screen.getByText(/You paid down/)).toBeTruthy();
    expect(screen.getByText(/New accounts added this period/)).toBeTruthy();
    expect(screen.queryByText("Gross savings")).toBeNull();
    expect(screen.queryByText("Where your savings went")).toBeNull();
    expect(screen.queryByText("Other / unexplained")).toBeNull();
    expect(screen.queryByText(/savings rate/i)).toBeNull();
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

  it("expands a section to the per-account list", () => {
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
    expect(screen.queryByText("Chequing")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "2 accounts" }));
    expect(screen.getByText("Chequing")).toBeTruthy();
    expect(screen.getByText("Everyday Savings")).toBeTruthy();
  });

  it("shows an overpaid card as a credit, not as debt owed", () => {
    render(
      <GrowthTab
        breakdown={{
          ...breakdown,
          cash: { ...emptySection },
          investments: { ...emptySection },
          debts: {
            start: -50,
            end: -50,
            change: 0,
            changePercent: null,
            accounts: [
              { slug: "visa", label: "Visa", type: "credit", start: -50, end: -50, change: 0 },
            ],
            putIn: null,
            marketChange: null,
          },
        }}
        currency="CAD"
        scope="month"
        onScopeChange={vi.fn()}
        monthLabel="Oct 2026"
        rangeLabel="Aug 2026 – Oct 2026"
      />,
    );
    expect(screen.getAllByText(/credit CA\$50/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "1 account" }));
    expect(screen.getByText("Visa")).toBeTruthy();
    expect(screen.getAllByText(/credit CA\$50/).length).toBeGreaterThan(1);
  });

  it("asks for another month when there is no previous snapshot", () => {
    render(
      <GrowthTab
        breakdown={{
          ...breakdown,
          hasPrevious: false,
          cash: emptySection,
          investments: emptySection,
          debts: emptySection,
          newAccounts: [],
        }}
        currency="CAD"
        scope="month"
        onScopeChange={vi.fn()}
        monthLabel="Oct 2026"
        rangeLabel="Aug 2026 – Oct 2026"
      />,
    );
    expect(screen.getByText(/Need another month of statements/)).toBeTruthy();
  });
});
