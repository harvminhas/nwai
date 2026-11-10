import { describe, it, expect } from "vitest";
import {
  INCOME_SO_FAR_HEADER_CLASS,
  INCOME_SO_FAR_PERIOD_CLASS,
  INCOME_SO_FAR_TYPICAL_CLASS,
  SOURCE_ROW_ACTIONS_CLASS,
  SOURCE_ROW_AMOUNT_CLASS,
  SOURCE_ROW_BADGE_CLASS,
  SOURCE_ROW_DESKTOP_NAME_BADGE_CLASS,
  SOURCE_ROW_META_DESKTOP_CLASS,
  SOURCE_ROW_META_PHONE_CLASS,
  SOURCE_ROW_NAME_DESKTOP_CLASS,
  SOURCE_ROW_NAME_PHONE_CLASS,
  SOURCE_ROW_PHONE_META_ROW_CLASS,
} from "../incomeReadLayout";

describe("income phone read layout", () => {
  it("stacks the so-far period above the typical-month line on phone and restores the desktop row at lg", () => {
    expect(INCOME_SO_FAR_HEADER_CLASS).toContain("flex-col");
    expect(INCOME_SO_FAR_HEADER_CLASS).toContain("lg:flex-row");
    expect(INCOME_SO_FAR_HEADER_CLASS).toContain("lg:items-baseline");
    expect(INCOME_SO_FAR_HEADER_CLASS).toContain("lg:justify-between");
    expect(INCOME_SO_FAR_PERIOD_CLASS).toContain("whitespace-nowrap");
    expect(INCOME_SO_FAR_TYPICAL_CLASS).toContain("text-sm");
  });

  it("lets source names wrap on phone and truncates them again at lg", () => {
    expect(SOURCE_ROW_NAME_PHONE_CLASS).toContain("break-words");
    expect(SOURCE_ROW_NAME_PHONE_CLASS).toContain("lg:hidden");
    expect(SOURCE_ROW_NAME_DESKTOP_CLASS).toContain("truncate");
    expect(SOURCE_ROW_DESKTOP_NAME_BADGE_CLASS).toContain("hidden");
    expect(SOURCE_ROW_DESKTOP_NAME_BADGE_CLASS).toContain("lg:flex");
  });

  it("puts the badge and reliability meta on one nowrap phone row and restores desktop meta", () => {
    expect(SOURCE_ROW_PHONE_META_ROW_CLASS).toContain("lg:hidden");
    expect(SOURCE_ROW_PHONE_META_ROW_CLASS).toContain("items-center");
    expect(SOURCE_ROW_BADGE_CLASS).toContain("whitespace-nowrap");
    expect(SOURCE_ROW_META_PHONE_CLASS).toContain("whitespace-nowrap");
    expect(SOURCE_ROW_META_DESKTOP_CLASS).toContain("hidden");
    expect(SOURCE_ROW_META_DESKTOP_CLASS).toContain("lg:block");
  });

  it("keeps the amount plus kebab/chevron in a non-wrapping right cluster", () => {
    expect(SOURCE_ROW_ACTIONS_CLASS).toContain("shrink-0");
    expect(SOURCE_ROW_AMOUNT_CLASS).toContain("whitespace-nowrap");
    expect(SOURCE_ROW_AMOUNT_CLASS).toContain("tabular-nums");
  });
});
