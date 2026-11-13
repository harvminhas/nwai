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

  it("is wired as a fourth tab and shows three plain sections", () => {
    expect(pageSrc).toContain("Growth");
    expect(pageSrc).toContain('setActiveTab("growth")');
    expect(pageSrc).toContain("<GrowthTab");
    expect(growthSrc).toContain("This month");
    expect(growthSrc).toContain("Chart range");
    expect(growthSrc).toContain("Savings & cash");
    expect(growthSrc).toContain("Investments");
    expect(growthSrc).toContain("Debts");
    expect(pageSrc).toContain("formatGrowthChartTitle");
    expect(pageSrc).toContain("priorMonth");
    expect(pageSrc).not.toContain("12-Month Trend");
    expect(growthSrc).not.toContain("Gross savings");
    expect(growthSrc).not.toContain("Where your savings went");
    expect(growthSrc).not.toContain("unsplit");
    expect(growthSrc).not.toContain("unexplained");
    expect(growthSrc).not.toContain("Installment principal");
    expect(growthSrc).not.toContain("savings rate");
    expect(pageSrc).not.toContain("Net Worth Reconciliation");
  });

  it("does not add a public dev route", () => {
    expect(pageSrc).not.toContain("/api/dev");
    expect(pageSrc).not.toMatch(/dev-only|debug.*route/i);
  });
});
