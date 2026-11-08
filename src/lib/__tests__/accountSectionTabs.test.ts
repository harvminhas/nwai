import { describe, it, expect } from "vitest";
import {
  ACCOUNT_SECTION_TABS,
  DEFAULT_ACCOUNT_SECTION_TAB,
  resolveAccountSectionTab,
} from "../accountSectionTabs";

describe("account section tab intent", () => {
  it("lists Trends first so default navigation shows the redesigned chart", () => {
    expect(ACCOUNT_SECTION_TABS[0]).toEqual({ id: "trends", label: "Trends" });
    expect(DEFAULT_ACCOUNT_SECTION_TAB).toBe("trends");
  });

  it("main Assets/Debts nav (no query) opens Trends", () => {
    expect(resolveAccountSectionTab(null)).toBe("trends");
    expect(resolveAccountSectionTab(undefined)).toBe("trends");
    expect(resolveAccountSectionTab("")).toBe("trends");
  });

  it("preserves explicit Accounts tab from account-detail breadcrumbs", () => {
    expect(resolveAccountSectionTab("accounts")).toBe("accounts");
  });

  it("honors explicit overview and trends query values", () => {
    expect(resolveAccountSectionTab("overview")).toBe("overview");
    expect(resolveAccountSectionTab("trends")).toBe("trends");
  });

  it("ignores unknown query tabs such as insights ?tab=payoff", () => {
    expect(resolveAccountSectionTab("payoff")).toBe("trends");
    expect(resolveAccountSectionTab("debts")).toBe("trends");
  });
});
