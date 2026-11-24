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
  PACE_PANEL_CLASS,
  THEME_AMOUNT_CLASS,
  THEME_CHEVRON_CLASS,
  THEME_NAME_CLASS,
  THEME_ROW_CLASS,
} from "../dailySpendReadLayout";

const page = readFileSync(resolve(__dirname, "../page.tsx"), "utf8");
const layout = readFileSync(resolve(__dirname, "../dailySpendReadLayout.ts"), "utf8");
const modal = readFileSync(resolve(__dirname, "../ThemeDetailModal.tsx"), "utf8");
const tracker = readFileSync(resolve(__dirname, "../TrackerCard.tsx"), "utf8");
const history = readFileSync(resolve(__dirname, "../history/page.tsx"), "utf8");

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

  it("shows a muted no-spend line and a target tracker instead of a plan picker", () => {
    expect(page).toContain("NO_SPEND_THIS_MONTH_MESSAGE");
    expect(page).toContain("hasEverydaySpend");
    expect(page).toContain("Start tracking");
    expect(page).toContain("TrackerCard");
    expect(page).toContain("HOUSING_EXCLUDED_FROM_TARGET_NOTE");
    expect(page).not.toContain("fullySavedSoonerLabel");
    expect(page).not.toContain("Put it toward a plan");
    expect(page).not.toContain("/api/user/plans");
    expect(page).not.toContain("Reaches it");
  });

  it("returns focus to the theme row when the modal closes", () => {
    expect(page).toContain("themeRowRefs.current[closedId]?.focus()");
  });

  it("stacks the tracker card on phone in the existing right column", () => {
    expect(COLUMNS_CLASS).toContain("grid-cols-1");
    expect(COLUMNS_CLASS).toContain("lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]");
    expect(PACE_PANEL_CLASS).toContain("border-dashed");
    expect(PACE_PANEL_CLASS).toContain("amber");
    expect(tracker).toContain("PACE_PANEL_CLASS");
    expect(tracker).toContain("Stop tracking");
    expect(tracker).toContain("See month-by-month history");
    expect(tracker).toContain("HOUSING_EXCLUDED_FROM_TARGET_NOTE");
    expect(history).toContain("Month-by-month history");
    expect(history).toContain("/api/user/daily-spend/tracker");
    expect(history).not.toContain("/api/user/plans");
  });

  it("splits Food merchants and keeps a mixed list for other themes", () => {
    expect(modal).toContain("TOP_GROCERY_STORES_HEADING");
    expect(modal).toContain("TOP_EAT_OUT_PLACES_HEADING");
    expect(modal).toContain("TOP_MERCHANTS_HEADING");
    expect(modal).toContain("split.groceryMerchants");
    expect(modal).toContain("split.eatingOutMerchants");
    expect(modal).toContain("{!split && (");
  });
});
