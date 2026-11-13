import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";

const src = readFileSync(resolve(__dirname, "../TrendsTab.tsx"), "utf8");

describe("Assets TrendsTab layout", () => {
  it("wires a 6M/YTD/1Y/3Y/All selector and category cards from prior-month start", () => {
    expect(src).toContain("TrendRangeSelector");
    expect(src).toContain('useState<TrendRangeKey>("1Y")');
    expect(src).toContain("CategoryTrendCardGrid");
    expect(src).toContain("priorMonthBeforeRange");
    expect(src).toContain('kind: "asset"');
    expect(src).toContain("data-testid=\"trends-month-detail\"");
    expect(src).not.toContain("@testing-library/react");
  });
});
