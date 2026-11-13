import { describe, it, expect } from "vitest";
import {
  ACCOUNT_SECTION_TABS,
  DEFAULT_ACCOUNT_SECTION_TAB,
  resolveAccountSectionTab,
} from "../accountSectionTabs";

describe("account section tab intent", () => {
  it("lists Overview first so default navigation opens Overview, not Trends", () => {
    expect(ACCOUNT_SECTION_TABS.map((t) => t.id)).toEqual([
      "overview",
      "accounts",
      "trends",
      "performance",
      "what-changed",
    ]);
    expect(ACCOUNT_SECTION_TABS[0]).toEqual({ id: "overview", label: "Overview" });
    expect(DEFAULT_ACCOUNT_SECTION_TAB).toBe("overview");
  });

  it("main Assets/Debts nav (no query) opens Overview", () => {
    expect(resolveAccountSectionTab(null)).toBe("overview");
    expect(resolveAccountSectionTab(undefined)).toBe("overview");
    expect(resolveAccountSectionTab("")).toBe("overview");
  });

  it("preserves explicit Accounts tab from account-detail breadcrumbs", () => {
    expect(resolveAccountSectionTab("accounts")).toBe("accounts");
  });

  it("honors explicit overview, trends, performance, and what-changed query values", () => {
    expect(resolveAccountSectionTab("overview")).toBe("overview");
    expect(resolveAccountSectionTab("trends")).toBe("trends");
    expect(resolveAccountSectionTab("performance")).toBe("performance");
    expect(resolveAccountSectionTab("what-changed")).toBe("what-changed");
  });

  it("ignores unknown query tabs such as insights ?tab=payoff", () => {
    expect(resolveAccountSectionTab("payoff")).toBe("overview");
    expect(resolveAccountSectionTab("debts")).toBe("overview");
  });
});
