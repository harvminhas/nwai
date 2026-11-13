/**
 * Cash flow page copy and metric layout.
 * @vitest-environment jsdom
 */

import React from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { buildCashFlowSummary, buildCashFlowView } from "@/lib/cashFlowSummary";
import { CashFlowView } from "../CashFlowView";
import {
  CASH_FLOW_METRICS_GRID_CLASS,
  CASH_FLOW_RATE_SENTENCE_CLASS,
} from "../cashFlowReadLayout";

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: true,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  });
});

vi.mock("recharts", () => {
  const Passthrough = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  return {
    ResponsiveContainer: Passthrough,
    ComposedChart: Passthrough,
    Bar: () => null,
    Line: () => null,
    XAxis: () => null,
    YAxis: () => null,
    CartesianGrid: () => null,
    Tooltip: () => null,
    Legend: () => null,
  };
});

const summary = buildCashFlowSummary({
  expenseTxns: [
    {
      date: "2026-10-04",
      txMonth: "2026-10",
      amount: 6700,
      merchant: "Loblaws",
      category: "Groceries",
      accountSlug: "checking_1234",
      accountLabel: "Checking",
    },
  ],
  incomeTxns: [
    {
      date: "2026-10-15",
      txMonth: "2026-10",
      amount: 8200,
      source: "Acme Corp",
      description: "Acme Corp",
      accountSlug: "checking_1234",
      category: "Salary",
    },
  ],
  homeCurrency: "CAD",
});

describe("CashFlowView", () => {
  it("shows money in, money out, left over, and the kept-percent sentence", () => {
    const view = buildCashFlowView(summary, "1Y", "2026-10");
    const { container } = render(
      <CashFlowView
        currency="CAD"
        view={view}
        range="1Y"
        onRangeChange={() => {}}
        onSelectMonth={() => {}}
      />,
    );

    expect(screen.getByRole("heading", { name: "Cash flow" })).toBeTruthy();
    expect(screen.getByText("Money in")).toBeTruthy();
    expect(screen.getByText("Money out")).toBeTruthy();
    expect(screen.getAllByText("Left over").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("You kept 18% of what you earned")).toBeTruthy();
    expect(screen.getByText(/Transfers between your own accounts/)).toBeTruthy();
    expect(screen.getByText("Where it went")).toBeTruthy();
    expect(screen.getByText("Where it came from")).toBeTruthy();
    expect(screen.getByText("Month at a glance")).toBeTruthy();
    expect(screen.getByText("Acme Corp")).toBeTruthy();
    expect(screen.getAllByText("Groceries").length).toBeGreaterThanOrEqual(1);

    const grid = container.querySelector(`.${CASH_FLOW_METRICS_GRID_CLASS.split(" ")[0]}`);
    expect(grid?.className).toBe(CASH_FLOW_METRICS_GRID_CLASS);
    expect(screen.getByText("You kept 18% of what you earned").className).toBe(
      CASH_FLOW_RATE_SENTENCE_CLASS,
    );
  });

  it("offers 6M/YTD/1Y/3Y/All range buttons", () => {
    const view = buildCashFlowView(summary, "1Y", null);
    render(
      <CashFlowView
        currency="CAD"
        view={view}
        range="1Y"
        onRangeChange={() => {}}
        onSelectMonth={() => {}}
      />,
    );
    for (const label of ["6M", "YTD", "1Y", "3Y", "All"]) {
      expect(screen.getByRole("button", { name: label })).toBeTruthy();
    }
  });
});
