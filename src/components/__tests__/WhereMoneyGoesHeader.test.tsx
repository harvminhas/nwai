/**
 * Where Your Money Goes header: phone stacked rows, desktop original row.
 * @vitest-environment jsdom
 */

import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  WhereMoneyGoesHeader,
  MONEY_GOES_HEADER_CLASS,
  MONEY_GOES_CONTROLS_CLASS,
} from "../WhereMoneyGoesHeader";
import type { SelectableMonth } from "@/lib/rangeUtils";

const months: SelectableMonth[] = [
  { yearMonth: "2026-10", label: "Oct 2026", isComplete: true, missingAccounts: [] },
  { yearMonth: "2026-09", label: "Sep 2026", isComplete: true, missingAccounts: [] },
];

describe("WhereMoneyGoesHeader", () => {
  it("does not rename the heading", () => {
    render(
      <WhereMoneyGoesHeader
        hasMissingStatements={false}
        onOpenMissingStatements={() => {}}
        range="3mo"
        onRangeChange={() => {}}
        selectableMonths={months}
      />
    );
    expect(screen.getByRole("heading", { name: "Where Your Money Goes" })).toBeTruthy();
  });

  it("stacks title then controls on phone and restores the desktop row at lg", () => {
    const { container } = render(
      <WhereMoneyGoesHeader
        hasMissingStatements={false}
        onOpenMissingStatements={() => {}}
        range="3mo"
        onRangeChange={() => {}}
        selectableMonths={months}
      />
    );
    const header = container.firstElementChild as HTMLElement;
    expect(header.className).toBe(MONEY_GOES_HEADER_CLASS);
    expect(MONEY_GOES_HEADER_CLASS).toContain("flex-col");
    expect(MONEY_GOES_HEADER_CLASS).toContain("lg:flex-row");
    expect(MONEY_GOES_HEADER_CLASS).toContain("lg:items-center");
    expect(MONEY_GOES_HEADER_CLASS).toContain("lg:justify-between");
    expect(MONEY_GOES_CONTROLS_CLASS).toContain("flex-wrap");
    expect(MONEY_GOES_CONTROLS_CLASS).toContain("lg:flex-nowrap");
  });

  it("keeps 3mo / 12mo / This year and the month selector on the controls row", () => {
    const onRangeChange = vi.fn();
    render(
      <WhereMoneyGoesHeader
        hasMissingStatements={false}
        onOpenMissingStatements={() => {}}
        range="3mo"
        onRangeChange={onRangeChange}
        selectableMonths={months}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "12mo" }));
    expect(onRangeChange).toHaveBeenCalledWith("12mo");
    fireEvent.click(screen.getByRole("button", { name: "This year" }));
    expect(onRangeChange).toHaveBeenCalledWith("ytd");
    expect(screen.getByRole("button", { name: /Month/ })).toBeTruthy();
  });

  it("keeps the missing-statements control on the title row", () => {
    const onOpen = vi.fn();
    render(
      <WhereMoneyGoesHeader
        hasMissingStatements
        onOpenMissingStatements={onOpen}
        range="3mo"
        onRangeChange={() => {}}
        selectableMonths={months}
      />
    );
    fireEvent.click(screen.getByLabelText("View missing statements"));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});
