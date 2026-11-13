import { describe, it, expect } from "vitest";
import {
  NET_WORTH_CARD_CLASS,
  NET_WORTH_CHANGE_LINE_CLASS,
  NET_WORTH_HEADER_STACK_CLASS,
  NET_WORTH_HEADER_VALUE_CLASS,
  NET_WORTH_LABEL_CLASS,
  NET_WORTH_MONTH_DESKTOP_CLASS,
  NET_WORTH_MONTH_MOBILE_CLASS,
  NET_WORTH_TAB_BUTTON_BASE,
  NET_WORTH_TABS_ROW_CLASS,
} from "../netWorthReadLayout";
import { INTACT_AMOUNT_CLASS } from "../IntactAmount";

describe("net worth mobile read layout", () => {
  it("stacks the header on phone and restores the desktop row at lg", () => {
    expect(NET_WORTH_HEADER_STACK_CLASS).toContain("flex-col");
    expect(NET_WORTH_HEADER_STACK_CLASS).toContain("lg:flex-row");
    expect(NET_WORTH_HEADER_STACK_CLASS).toContain("lg:items-end");
    expect(NET_WORTH_HEADER_STACK_CLASS).toContain("lg:justify-between");
    expect(NET_WORTH_HEADER_VALUE_CLASS).toBe("lg:text-right");
  });

  it("keeps the change line on one line", () => {
    expect(NET_WORTH_CHANGE_LINE_CLASS).toContain("whitespace-nowrap");
  });

  it("puts the month on its own phone row and restores it on the tab row at lg", () => {
    expect(NET_WORTH_MONTH_MOBILE_CLASS).toContain("lg:hidden");
    expect(NET_WORTH_MONTH_DESKTOP_CLASS).toContain("hidden");
    expect(NET_WORTH_MONTH_DESKTOP_CLASS).toContain("lg:block");
    expect(NET_WORTH_MONTH_DESKTOP_CLASS).toContain("whitespace-nowrap");
    expect(NET_WORTH_TAB_BUTTON_BASE).toContain("whitespace-nowrap");
    expect(NET_WORTH_TAB_BUTTON_BASE).toContain("lg:px-4");
    expect(NET_WORTH_TABS_ROW_CLASS).toContain("lg:gap-4");
    expect(NET_WORTH_TABS_ROW_CLASS).toContain("flex-wrap");
    expect(NET_WORTH_TABS_ROW_CLASS).toContain("lg:flex-nowrap");
  });

  it("restores card padding at lg", () => {
    expect(NET_WORTH_CARD_CLASS).toContain("p-4");
    expect(NET_WORTH_CARD_CLASS).toContain("lg:p-6");
  });

  it("lets labels wrap and keeps amounts intact", () => {
    expect(NET_WORTH_LABEL_CLASS).toContain("min-w-0");
    expect(NET_WORTH_LABEL_CLASS).toContain("break-words");
    expect(INTACT_AMOUNT_CLASS).toContain("whitespace-nowrap");
    expect(INTACT_AMOUNT_CLASS).toContain("shrink-0");
  });
});
