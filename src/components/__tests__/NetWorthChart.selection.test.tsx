/**
 * Debt follow-selection: Latest reset visibility. Range math is unit-tested
 * in chartMonthSelection.test.ts.
 * @vitest-environment jsdom
 */

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import NetWorthChart from "../NetWorthChart";

const history = [
  { yearMonth: "2026-05", netWorth: -20000 },
  { yearMonth: "2026-06", netWorth: -19000 },
  { yearMonth: "2026-07", netWorth: -18000 },
  { yearMonth: "2026-08", netWorth: -17000 },
  { yearMonth: "2026-09", netWorth: -16000 },
  { yearMonth: "2026-10", netWorth: -15000 },
];

beforeEach(() => {
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

describe("NetWorthChart followSelection", () => {
  it("shows Latest when the selected month is not the most recent", () => {
    render(
      <NetWorthChart
        history={history}
        isDebt
        followSelection
        selectedYearMonth="2026-08"
        onPointSelect={vi.fn()}
        showMonthDetail={false}
      />
    );
    expect(screen.getByText("Latest")).toBeTruthy();
  });

  it("hides Latest on the most recent month", () => {
    render(
      <NetWorthChart
        history={history}
        isDebt
        followSelection
        selectedYearMonth="2026-10"
        onPointSelect={vi.fn()}
        showMonthDetail={false}
      />
    );
    expect(screen.queryByText("Latest")).toBeNull();
  });

  it("does not show Latest on non-debt charts", () => {
    render(
      <NetWorthChart
        history={history}
        selectedYearMonth="2026-08"
        onPointSelect={vi.fn()}
        showMonthDetail={false}
      />
    );
    expect(screen.queryByText("Latest")).toBeNull();
  });

  it("Latest calls onPointSelect with the most recent month", () => {
    const onPointSelect = vi.fn();
    render(
      <NetWorthChart
        history={history}
        isDebt
        followSelection
        selectedYearMonth="2026-08"
        onPointSelect={onPointSelect}
        showMonthDetail={false}
      />
    );
    screen.getByText("Latest").click();
    expect(onPointSelect).toHaveBeenCalledWith("2026-10");
  });

  it("snaps back to the latest month when 3M hides the selection", () => {
    const onPointSelect = vi.fn();
    render(
      <NetWorthChart
        history={history}
        isDebt
        followSelection
        selectedYearMonth="2026-05"
        onPointSelect={onPointSelect}
        showMonthDetail={false}
      />
    );
    screen.getByRole("button", { name: "3M" }).click();
    expect(onPointSelect).toHaveBeenCalledWith("2026-10");
  });
});
