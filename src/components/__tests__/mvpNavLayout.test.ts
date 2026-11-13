import { describe, it, expect } from "vitest";
import {
  DESKTOP_NET_WORTH_PILL_CLASS,
  DESKTOP_NET_WORTH_SKELETON_CLASS,
  DRAWER_FOOTER_CLASS,
  DRAWER_HEADER_CLASS,
  DRAWER_PANEL_CLASS,
  DRAWER_SECTION_LABEL_CLASS,
  MOBILE_NET_WORTH_LINK_CLASS,
  MOBILE_NET_WORTH_SKELETON_CLASS,
  MOBILE_NET_WORTH_VALUE_CLASS,
  NET_WORTH_NAV_ITEMS,
  drawerLinkClass,
  dropdownLinkClass,
  isMvpNavActive,
} from "../mvpNavLayout";

describe("mobile header and drawer layout", () => {
  it("shows a compact net worth control only below lg and restores the desktop pill at lg", () => {
    expect(MOBILE_NET_WORTH_LINK_CLASS).toContain("lg:hidden");
    expect(MOBILE_NET_WORTH_VALUE_CLASS).toContain("whitespace-nowrap");
    expect(MOBILE_NET_WORTH_VALUE_CLASS).toContain("tabular-nums");
    expect(DESKTOP_NET_WORTH_PILL_CLASS).toContain("hidden");
    expect(DESKTOP_NET_WORTH_PILL_CLASS).toContain("lg:flex");
    expect(DESKTOP_NET_WORTH_SKELETON_CLASS).toContain("hidden");
    expect(DESKTOP_NET_WORTH_SKELETON_CLASS).toContain("lg:block");
    expect(MOBILE_NET_WORTH_SKELETON_CLASS).toContain("lg:hidden");
    expect(MOBILE_NET_WORTH_SKELETON_CLASS).toContain("animate-pulse");
  });

  it("pins the drawer footer and aligns the header row", () => {
    expect(DRAWER_PANEL_CLASS).toContain("flex-col");
    expect(DRAWER_HEADER_CLASS).toContain("items-center");
    expect(DRAWER_HEADER_CLASS).toContain("justify-between");
    expect(DRAWER_FOOTER_CLASS).toContain("mt-auto");
    expect(DRAWER_SECTION_LABEL_CLASS).toContain("uppercase");
    expect(DRAWER_SECTION_LABEL_CLASS).toContain("tracking-[0.16em]");
  });

  it("gives drawer rows a 44px tap target and a clear active state", () => {
    expect(drawerLinkClass(false)).toContain("min-h-11");
    expect(drawerLinkClass(true)).toContain("bg-violet-50");
    expect(drawerLinkClass(true)).toContain("text-violet-700");
    expect(drawerLinkClass(false)).not.toContain("bg-violet-50");
  });

  it("lists Net Worth first in the net-worth group and highlights only that route", () => {
    expect(NET_WORTH_NAV_ITEMS.map(({ href, label }) => ({ href, label }))).toEqual([
      { href: "/account/net-worth", label: "Net Worth" },
      { href: "/account/assets", label: "Assets" },
      { href: "/account/liabilities", label: "Debts" },
    ]);

    expect(isMvpNavActive("/account/net-worth", "/account/net-worth")).toBe(true);
    expect(isMvpNavActive("/account/assets", "/account/net-worth")).toBe(false);
    expect(isMvpNavActive("/account/liabilities", "/account/net-worth")).toBe(false);
    expect(isMvpNavActive("/account/assets", "/account/assets")).toBe(true);
    expect(isMvpNavActive("/account/net-worth", "/account/assets")).toBe(false);

    expect(dropdownLinkClass(true)).toContain("bg-violet-50 font-semibold text-violet-700");
    expect(dropdownLinkClass(false)).not.toContain("font-semibold");
    expect(dropdownLinkClass(false)).toContain("hover:bg-violet-50");
  });
});
