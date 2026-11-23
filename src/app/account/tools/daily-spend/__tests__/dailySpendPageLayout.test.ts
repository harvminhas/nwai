import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  COLUMNS_CLASS,
  HEADER_CLASS,
  PAGE_CLASS,
  PAGE_INNER_CLASS,
  THEME_AMOUNT_CLASS,
  THEME_NAME_CLASS,
  THEME_ROW_CLASS,
} from "../dailySpendReadLayout";

const page = readFileSync(resolve(__dirname, "../page.tsx"), "utf8");
const layout = readFileSync(resolve(__dirname, "../dailySpendReadLayout.ts"), "utf8");

describe("daily spend page layout", () => {
  it("keeps the page from overflowing on a 390px phone", () => {
    expect(layout).toContain("overflow-x-hidden");
    expect(layout).toContain("min-w-0");
    expect(layout).toContain("grid-cols-1");
    expect(page).toContain("PAGE_CLASS");
    expect(page).toContain("COLUMNS_CLASS");
    expect(PAGE_CLASS).toContain("overflow-x-hidden");
    expect(PAGE_INNER_CLASS).toContain("min-w-0");
    expect(HEADER_CLASS).toContain("flex-wrap");
    expect(COLUMNS_CLASS).toContain("grid-cols-1");
    expect(THEME_ROW_CLASS).toContain("min-w-0");
    expect(THEME_NAME_CLASS).toContain("break-words");
    expect(THEME_AMOUNT_CLASS).toContain("shrink-0");
    expect(THEME_AMOUNT_CLASS).toContain("tabular-nums");
  });
});
