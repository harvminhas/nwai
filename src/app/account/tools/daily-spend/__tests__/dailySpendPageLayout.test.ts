import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  COLUMNS_CLASS,
  HEADER_CLASS,
  MODAL_BODY_CLASS,
  MODAL_FOOTER_CLASS,
  MODAL_HANDLE_CLASS,
  MODAL_PANEL_CLASS,
  PAGE_CLASS,
  PAGE_INNER_CLASS,
  THEME_AMOUNT_CLASS,
  THEME_CHEVRON_CLASS,
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
    expect(THEME_ROW_CLASS).toContain("w-full");
    expect(THEME_CHEVRON_CLASS).toContain("shrink-0");
    expect(page).toContain("THEME_CHEVRON_CLASS");
    expect(page).toContain('aria-haspopup="dialog"');
    expect(page).toContain("ThemeDetailModal");
    expect(MODAL_PANEL_CLASS).toContain("lg:max-w-[560px]");
    expect(MODAL_PANEL_CLASS).toContain("max-lg:h-[90%]");
    expect(MODAL_PANEL_CLASS).toContain("max-w-full");
    expect(MODAL_HANDLE_CLASS).toContain("lg:hidden");
    expect(MODAL_BODY_CLASS).toContain("overflow-x-hidden");
    expect(MODAL_FOOTER_CLASS).toContain("shrink-0");
  });

  it("shows a muted no-spend line and the fully-saved wording", () => {
    expect(page).toContain("NO_SPEND_THIS_MONTH_MESSAGE");
    expect(page).toContain("hasEverydaySpend");
    expect(page).toContain("fullySavedSoonerLabel(sooner)");
    expect(page).not.toContain("Reaches it");
  });

  it("returns focus to the theme row when the modal closes", () => {
    expect(page).toContain("themeRowRefs.current[closedId]?.focus()");
  });
});
