import { describe, it, expect } from "vitest";
import {
  monthFromRechartsClick,
  monthFromNearestPlotX,
  monthFromChartInteraction,
} from "../chartMonthClick";

const chartData = [
  { month: "2026-01", label: "Jan" },
  { month: "2026-02", label: "Feb" },
  { month: "2026-03", label: "Mar" },
];

describe("monthFromRechartsClick", () => {
  it("uses activeIndex, not a hardcoded first/latest month", () => {
    expect(monthFromRechartsClick({ activeIndex: "1" }, chartData)).toBe("2026-02");
    expect(monthFromRechartsClick({ activeIndex: 0 }, chartData)).toBe("2026-01");
    expect(monthFromRechartsClick({ activeIndex: 2 }, chartData)).toBe("2026-03");
  });

  it("prefers payload.month when present (Recharts 2 shape)", () => {
    expect(
      monthFromRechartsClick(
        { activeIndex: "0", activePayload: [{ payload: { month: "2026-02" } }] },
        chartData
      )
    ).toBe("2026-02");
  });

  it("does not treat colliding short labels as unique", () => {
    const colliding = [
      { month: "2025-01", label: "Jan" },
      { month: "2026-01", label: "Jan" },
    ];
    expect(monthFromRechartsClick({ activeLabel: "Jan" }, colliding)).toBeNull();
    expect(monthFromRechartsClick({ activeLabel: "2026-01" }, colliding)).toBe("2026-01");
  });

  it("returns null when the click has no chart target", () => {
    expect(monthFromRechartsClick(null, chartData)).toBeNull();
    expect(monthFromRechartsClick({ activeIndex: null }, chartData)).toBeNull();
    expect(monthFromRechartsClick({ activeIndex: "" }, chartData)).toBeNull();
  });

  it("picks the nearest plot x, not index 0", () => {
    const dots = [
      { month: "2026-01", cx: 80 },
      { month: "2026-02", cx: 400 },
      { month: "2026-03", cx: 720 },
    ];
    expect(monthFromNearestPlotX(390, dots)).toBe("2026-02");
    expect(monthFromNearestPlotX(80, dots)).toBe("2026-01");
  });

  it("falls back to Recharts state when the pointer has no plot target", () => {
    expect(
      monthFromChartInteraction({ activeIndex: 1 }, { clientX: 400 }, chartData)
    ).toBe("2026-02");
  });
});
