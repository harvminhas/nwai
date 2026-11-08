import { describe, it, expect } from "vitest";
import {
  ACCOUNT_CATEGORY_AMOUNT,
  ACCOUNT_CATEGORY_PRIMARY,
  ACCOUNT_COMPARISON_ROW,
  ACCOUNT_DETAIL_LABEL,
  ACCOUNT_DETAIL_PCT,
  ACCOUNT_PAGE_SHELL,
  ACCOUNT_PAGE_TAB_BASE,
  ACCOUNT_SWITCHER_MENU,
  PHONE_CHART_HEIGHT,
  PHONE_YAXIS_WIDTH,
  accountPageTabClass,
} from "../accountSectionLayout";
import { CANONICAL_CHART_HEIGHT } from "../canonicalChartConfig";
import {
  ACCOUNT_SECTION_TABS,
  DEFAULT_ACCOUNT_SECTION_TAB,
} from "../accountSectionTabs";

describe("Assets/Debts phone layout tokens", () => {
  it("keeps Overview first and default", () => {
    expect(ACCOUNT_SECTION_TABS.map((t) => t.id)).toEqual(["overview", "accounts", "trends"]);
    expect(DEFAULT_ACCOUNT_SECTION_TAB).toBe("overview");
  });

  it("gives phone tabs 44px targets and restores desktop tabs at lg", () => {
    expect(ACCOUNT_PAGE_TAB_BASE).toContain("min-h-11");
    expect(ACCOUNT_PAGE_TAB_BASE).toContain("flex-1");
    expect(ACCOUNT_PAGE_TAB_BASE).toContain("lg:min-h-0");
    expect(ACCOUNT_PAGE_TAB_BASE).toContain("lg:flex-none");
    expect(accountPageTabClass(true)).toContain("border-purple-600");
  });

  it("clips horizontal overflow on the page shell", () => {
    expect(ACCOUNT_PAGE_SHELL).toContain("overflow-x-clip");
    expect(ACCOUNT_PAGE_SHELL).toContain("max-w-5xl");
  });

  it("stacks comparison stats on phone and restores the desktop row at lg", () => {
    expect(ACCOUNT_COMPARISON_ROW).toContain("flex-col");
    expect(ACCOUNT_COMPARISON_ROW).toContain("lg:flex-row");
    expect(ACCOUNT_COMPARISON_ROW).toContain("lg:gap-4");
  });

  it("wraps long account names on phone and truncates again at lg", () => {
    expect(ACCOUNT_CATEGORY_PRIMARY).toContain("break-words");
    expect(ACCOUNT_CATEGORY_PRIMARY).toContain("lg:truncate");
    expect(ACCOUNT_DETAIL_LABEL).toContain("break-words");
  });

  it("drops the fixed 7.25rem amount column on phone and restores it at lg", () => {
    expect(ACCOUNT_CATEGORY_AMOUNT).not.toMatch(/(?:^|\s)w-\[7\.25rem\]/);
    expect(ACCOUNT_CATEGORY_AMOUNT).toContain("lg:w-[7.25rem]");
    expect(ACCOUNT_CATEGORY_AMOUNT).toContain("tabular-nums");
  });

  it("puts trend percents under the amount on phone and inline at lg", () => {
    expect(ACCOUNT_DETAIL_PCT).toContain("block");
    expect(ACCOUNT_DETAIL_PCT).toContain("lg:inline");
  });

  it("caps the switcher menu so it cannot overflow a 320px viewport", () => {
    expect(ACCOUNT_SWITCHER_MENU).toContain("w-80");
    expect(ACCOUNT_SWITCHER_MENU).toContain("max-w-[calc(100vw-2rem)]");
  });

  it("uses a shorter phone chart while keeping canonical desktop height", () => {
    expect(PHONE_CHART_HEIGHT).toBeLessThan(CANONICAL_CHART_HEIGHT);
    expect(PHONE_CHART_HEIGHT).toBeGreaterThanOrEqual(200);
    expect(PHONE_YAXIS_WIDTH).toBeLessThan(60);
    expect(CANONICAL_CHART_HEIGHT).toBe(340);
  });
});
