import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";

const growthSrc = readFileSync(
  resolve(__dirname, "../GrowthTab.tsx"),
  "utf8",
);
const pageSrc = readFileSync(
  resolve(__dirname, "../page.tsx"),
  "utf8",
);

describe("Growth tab read layout", () => {
  it("wraps the this-month / chart-range toggle instead of truncating", () => {
    expect(growthSrc).toContain("flex flex-wrap items-center gap-1");
    expect(growthSrc).not.toContain("truncate");
  });

  it("lets labels wrap and keeps amounts intact", () => {
    expect(growthSrc).toContain("NET_WORTH_LABEL_CLASS");
    expect(growthSrc).toContain("IntactAmount");
    expect(growthSrc).toContain("break-words");
  });

  it("is wired as a fourth tab on the net worth page", () => {
    expect(pageSrc).toContain("Growth");
    expect(pageSrc).toContain('setActiveTab("growth")');
    expect(pageSrc).toContain("<GrowthTab");
    expect(growthSrc).toContain("This month");
    expect(growthSrc).toContain("Chart range");
    expect(growthSrc).toContain("Where your savings went");
    expect(growthSrc).toContain("Invested (net)");
    expect(pageSrc).toContain("formatGrowthChartTitle");
    expect(pageSrc).toContain("priorMonth");
    expect(pageSrc).not.toContain("12-Month Trend");
  });

  it("places the unsplit investment row outside the reconciling list", () => {
    const unexplained = growthSrc.indexOf('title="Other / unexplained"');
    const total = growthSrc.indexOf("Total (matches What Changed)");
    const unsplit = growthSrc.indexOf("Investment change, not split");
    const savingsWent = growthSrc.lastIndexOf("Where your savings went");
    expect(unexplained).toBeGreaterThan(-1);
    expect(total).toBeGreaterThan(unexplained);
    expect(unsplit).toBeGreaterThan(total);
    expect(savingsWent).toBeGreaterThan(unsplit);
    expect(growthSrc).not.toContain("of which");
    expect(growthSrc).not.toContain("sits in unexplained");
    expect(growthSrc).toContain("May include contributions and market growth; not added to the total.");
    expect(growthSrc).toContain("counted as spending");
  });

  it("does not add a public dev route", () => {
    expect(pageSrc).not.toContain("/api/dev");
    expect(pageSrc).not.toMatch(/dev-only|debug.*route/i);
  });
});
