/**
 * Income Overview: phone stacks the so-far period above the typical-month line.
 * @vitest-environment jsdom
 */

import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { OverviewTab } from "../OverviewTab";
import {
  INCOME_SO_FAR_HEADER_CLASS,
  INCOME_SO_FAR_PERIOD_CLASS,
} from "../incomeReadLayout";
import type { IncomeSummary } from "@/lib/incomeSummary";

function summary(overrides: Partial<IncomeSummary> = {}): IncomeSummary {
  return {
    currentMonth: "2026-11",
    currentMonthTotal: 0,
    currentMonthRegular: 0,
    currentMonthOneOff: 0,
    currentMonthBonus: 0,
    last3Months: ["2026-08", "2026-09", "2026-10"],
    typicalMonthly: 27486,
    last3MonthsTotal: 82458,
    last3MonthsBonus: 0,
    allMonths: ["2026-08", "2026-09", "2026-10"],
    monthlyHistory: [],
    sources: [],
    transferSources: [],
    oneOffSources: [],
    regularSources: [],
    bonusTransactions: [],
    unreviewedDeposits: [],
    whatChanged: {},
    currency: "CAD",
    totalMonthsTracked: 3,
    ...overrides,
  };
}

describe("OverviewTab phone read layout", () => {
  it("puts the period label on its own line above the typical-month comparison", () => {
    const { container } = render(<OverviewTab summary={summary()} />);
    const period = screen.getByText("Nov 2026 SO FAR");
    expect(period.className).toBe(INCOME_SO_FAR_PERIOD_CLASS);
    expect(period.className).toContain("whitespace-nowrap");

    const typical = screen.getByText(/of ~CA\$27,486 in a typical month/);
    expect(typical.parentElement?.className).toBe(INCOME_SO_FAR_HEADER_CLASS);
    expect(container.textContent).toContain("No Nov 2026 statements yet");
  });

  it("does not change the so-far amount or average copy", () => {
    render(<OverviewTab summary={summary()} />);
    expect(screen.getByText("CA$0")).toBeTruthy();
    expect(screen.getByText("CA$27,486")).toBeTruthy();
    expect(screen.getByText("CA$82,458 total")).toBeTruthy();
  });
});
