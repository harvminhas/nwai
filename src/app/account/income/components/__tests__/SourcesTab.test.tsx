/**
 * Income Sources: phone wraps names and keeps badge/meta/amount intact.
 * @vitest-environment jsdom
 */

import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SourcesTab } from "../SourcesTab";
import {
  SOURCE_ROW_ACTIONS_CLASS,
  SOURCE_ROW_BADGE_CLASS,
  SOURCE_ROW_META_PHONE_CLASS,
  SOURCE_ROW_NAME_PHONE_CLASS,
  SOURCE_ROW_PHONE_META_ROW_CLASS,
} from "../incomeReadLayout";
import type { IncomeSource, IncomeSummary } from "@/lib/incomeSummary";

function source(partial: Partial<IncomeSource> & Pick<IncomeSource, "description">): IncomeSource {
  return {
    canonicalName: partial.description,
    total: 13204,
    count: 4,
    transactions: [
      { source: partial.description, amount: 3301, date: "2026-08-15" },
      { source: partial.description, amount: 3301, date: "2026-09-15" },
      { source: partial.description, amount: 3301, date: "2026-10-15" },
      { source: partial.description, amount: 3301, date: "2026-10-29" },
    ],
    frequency: "bi-weekly",
    reliability: "stable",
    reliabilityScore: 70,
    category: "Salary",
    isTransfer: false,
    isOneOff: false,
    avgAmount: 3301,
    monthlyEquivalent: 4401,
    ...partial,
  };
}

function summary(regularSources: IncomeSource[]): IncomeSummary {
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
    sources: regularSources,
    transferSources: [],
    oneOffSources: [],
    regularSources,
    bonusTransactions: [],
    unreviewedDeposits: [],
    whatChanged: {},
    currency: "CAD",
    totalMonthsTracked: 3,
  };
}

describe("SourcesTab phone read layout", () => {
  it("renders full source names, nowrap badges, and a right-aligned amount cluster", () => {
    render(
      <SourcesTab
        token={null}
        summary={summary([
          source({
            description: "MOBILE DEPOSIT",
            frequency: "semi-annual",
            reliabilityScore: 3,
            total: 0,
            count: 0,
            transactions: [],
          }),
          source({ description: "MAM PAY", frequency: "bi-weekly", reliabilityScore: 80, total: 41807 }),
        ])}
      />
    );

    const name = screen.getAllByText("MOBILE DEPOSIT")[0];
    expect(name.className).toBe(SOURCE_ROW_NAME_PHONE_CLASS);
    expect(name.className).toContain("break-words");
    expect(name.className).toContain("lg:hidden");

    const badges = screen.getAllByText("semi-annual");
    const phoneMetaRow = badges.find((el) => el.parentElement?.className === SOURCE_ROW_PHONE_META_ROW_CLASS)?.parentElement as HTMLElement;
    expect(phoneMetaRow).toBeTruthy();
    expect(phoneMetaRow.className).toContain("lg:hidden");
    expect(badges[0].className).toBe(SOURCE_ROW_BADGE_CLASS);
    expect(badges[0].className).toContain("whitespace-nowrap");
    const metas = screen.getAllByText("0 deposits · 3% reliable");
    expect(metas.some((el) => el.className === SOURCE_ROW_META_PHONE_CLASS)).toBe(true);

    const amount = screen.getAllByText("CA$0")[0];
    expect(amount.parentElement?.className).toBe(SOURCE_ROW_ACTIONS_CLASS);
    expect(amount.parentElement?.className).toContain("shrink-0");
  });
});
