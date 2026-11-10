import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import {
  SPENDING_CATEGORY_AMOUNT_CLASS,
  SPENDING_CATEGORY_AMOUNT_COL_CLASS,
  SPENDING_CATEGORY_NAME_CLASS,
  SPENDING_CATEGORY_SPARKLINE_CLASS,
  SPENDING_CATEGORY_TREND_CLASS,
} from "../spendingReadLayout";

describe("spending category phone read layout", () => {
  it("hides the inline sparkline below lg and restores it on desktop", () => {
    expect(SPENDING_CATEGORY_SPARKLINE_CLASS).toContain("hidden");
    expect(SPENDING_CATEGORY_SPARKLINE_CLASS).toContain("lg:block");
  });

  it("keeps the category name, amount, and vs-avg line on one line each", () => {
    expect(SPENDING_CATEGORY_NAME_CLASS).toContain("whitespace-nowrap");
    expect(SPENDING_CATEGORY_AMOUNT_CLASS).toContain("whitespace-nowrap");
    expect(SPENDING_CATEGORY_AMOUNT_CLASS).toContain("tabular-nums");
    expect(SPENDING_CATEGORY_TREND_CLASS).toContain("whitespace-nowrap");
    expect(SPENDING_CATEGORY_AMOUNT_COL_CLASS).toContain("shrink-0");
  });

  it("is wired into the spending category list", () => {
    const row = readFileSync(resolve(__dirname, "../SpendingCategoryRow.tsx"), "utf8");
    const view = readFileSync(resolve(__dirname, "../DrilldownView.tsx"), "utf8");
    expect(row).toContain("SPENDING_CATEGORY_SPARKLINE_CLASS");
    expect(row).toContain("SPENDING_CATEGORY_NAME_CLASS");
    expect(row).toContain("SPENDING_CATEGORY_AMOUNT_COL_CLASS");
    expect(view).toContain("SpendingCategoryRow");
  });
});
