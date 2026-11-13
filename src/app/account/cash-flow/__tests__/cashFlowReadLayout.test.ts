import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CASH_FLOW_GLANCE_LEGEND_CLASS,
  CASH_FLOW_METRICS_GRID_CLASS,
  CASH_FLOW_METRIC_CARD_CLASS,
  CASH_FLOW_METRIC_VALUE_CLASS,
  CASH_FLOW_NOTE_CLASS,
  CASH_FLOW_PILL_CLASS,
  CASH_FLOW_RATE_SENTENCE_CLASS,
  CASH_FLOW_ROW_AMOUNT_CLASS,
  CASH_FLOW_ROW_NAME_CLASS,
  CASH_FLOW_SECTION_GRID_CLASS,
} from "../cashFlowReadLayout";

describe("cash flow phone read layout", () => {
  it("stacks metric cards 2x2 below lg and four-up on desktop", () => {
    expect(CASH_FLOW_METRICS_GRID_CLASS).toContain("grid-cols-2");
    expect(CASH_FLOW_METRICS_GRID_CLASS).toContain("lg:grid-cols-4");
    expect(CASH_FLOW_METRIC_CARD_CLASS).toContain("min-w-0");
  });

  it("does not truncate metric values, category names, or the savings-rate sentence", () => {
    expect(CASH_FLOW_METRIC_VALUE_CLASS).toContain("tabular-nums");
    expect(CASH_FLOW_METRIC_VALUE_CLASS).not.toContain("truncate");
    expect(CASH_FLOW_RATE_SENTENCE_CLASS).toContain("break-words");
    expect(CASH_FLOW_RATE_SENTENCE_CLASS).not.toContain("truncate");
    expect(CASH_FLOW_ROW_NAME_CLASS).toContain("break-words");
    expect(CASH_FLOW_ROW_NAME_CLASS).not.toContain("truncate");
    expect(CASH_FLOW_ROW_AMOUNT_CLASS).toContain("whitespace-nowrap");
    expect(CASH_FLOW_ROW_AMOUNT_CLASS).toContain("shrink-0");
    expect(CASH_FLOW_PILL_CLASS).toContain("whitespace-nowrap");
    expect(CASH_FLOW_NOTE_CLASS).toContain("break-words");
    expect(CASH_FLOW_NOTE_CLASS).not.toContain("truncate");
  });

  it("stacks where-it-went / where-it-came-from below lg", () => {
    expect(CASH_FLOW_SECTION_GRID_CLASS).toContain("grid-cols-1");
    expect(CASH_FLOW_SECTION_GRID_CLASS).toContain("lg:grid-cols-2");
    expect(CASH_FLOW_GLANCE_LEGEND_CLASS).toContain("flex-col");
  });

  it("is wired into the cash flow view", () => {
    const view = readFileSync(resolve(__dirname, "../CashFlowView.tsx"), "utf8");
    expect(view).toContain("CASH_FLOW_METRICS_GRID_CLASS");
    expect(view).toContain("CASH_FLOW_ROW_NAME_CLASS");
    expect(view).toContain("CASH_FLOW_RATE_SENTENCE_CLASS");
    expect(view).not.toContain("truncate");
  });
});
