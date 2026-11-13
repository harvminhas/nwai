import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";

const src = readFileSync(resolve(__dirname, "../WhatChangedPanel.tsx"), "utf8");

describe("WhatChangedPanel layout", () => {
  it("puts the label and amount on one row with the bar underneath", () => {
    expect(src).toContain("flex items-baseline justify-between");
    expect(src).toContain("h-1.5 w-full rounded-full bg-gray-100");
    expect(src).toContain("row.barPct != null");
  });

  it("shows Manual badges and the shared range selector", () => {
    expect(src).toContain("Manual");
    expect(src).toContain("TrendRangeSelector");
    expect(src).toContain('useState<TrendRangeKey>("1Y")');
    expect(src).toContain("model.title");
    expect(src).toContain("buildWhatChanged");
  });
});
