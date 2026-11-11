import { describe, it, expect } from "vitest";
import {
  latestSelectableMonth,
  selectionAfterRangeChange,
  sliceHistoryByRange,
} from "../chartMonthSelection";

const months = [
  { yearMonth: "2026-05", isEstimate: false },
  { yearMonth: "2026-06", isEstimate: false },
  { yearMonth: "2026-07", isEstimate: true },
  { yearMonth: "2026-08", isEstimate: false },
  { yearMonth: "2026-09", isEstimate: false },
  { yearMonth: "2026-10", isEstimate: false },
];

describe("sliceHistoryByRange", () => {
  it("returns the last 3 months for 3M", () => {
    expect(sliceHistoryByRange(months, 3).map((m) => m.yearMonth)).toEqual([
      "2026-08", "2026-09", "2026-10",
    ]);
  });

  it("returns the full series for All (0)", () => {
    expect(sliceHistoryByRange(months, 0)).toHaveLength(6);
  });
});

describe("latestSelectableMonth", () => {
  it("skips trailing estimates", () => {
    expect(latestSelectableMonth([
      { yearMonth: "2026-09", isEstimate: false },
      { yearMonth: "2026-10", isEstimate: true },
    ])).toBe("2026-09");
  });

  it("uses the last point when every month is estimated", () => {
    expect(latestSelectableMonth([
      { yearMonth: "2026-09", isEstimate: true },
      { yearMonth: "2026-10", isEstimate: true },
    ])).toBe("2026-10");
  });
});

describe("selectionAfterRangeChange", () => {
  it("keeps the selection when it is still visible", () => {
    const visible = sliceHistoryByRange(months, 3);
    expect(selectionAfterRangeChange("2026-08", visible)).toBe("2026-08");
  });

  it("resets to the most recent month when the selection falls out of the window", () => {
    const visible = sliceHistoryByRange(months, 3);
    expect(selectionAfterRangeChange("2026-05", visible)).toBe("2026-10");
  });

  it("defaults to the most recent month when nothing is selected", () => {
    expect(selectionAfterRangeChange(null, months)).toBe("2026-10");
  });
});
