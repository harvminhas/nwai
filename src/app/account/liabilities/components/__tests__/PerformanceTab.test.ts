import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";

const src = readFileSync(resolve(__dirname, "../PerformanceTab.tsx"), "utf8");
const cards = readFileSync(resolve(__dirname, "../../../../../components/CategoryTrendCards.tsx"), "utf8");

describe("Debts PerformanceTab", () => {
  it("wires a 6M/YTD/1Y/3Y/All selector and category cards from full history", () => {
    expect(src).toContain("CategoryPerformancePanel");
    expect(src).toContain('kind="debt"');
    expect(src).toContain("allMonthlyHistory");
    expect(cards).toContain("TrendRangeSelector");
    expect(cards).toContain('useState<TrendRangeKey>("1Y")');
    expect(cards).toContain("priorMonthBeforeRange");
    expect(cards).toContain("CategoryTrendCardGrid");
  });
});
