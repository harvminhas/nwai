/**
 * Shared Assets/Debts chrome: Overview default, phone tap targets, desktop restore.
 * @vitest-environment jsdom
 */

import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AccountSectionFrame } from "../AccountSectionFrame";

vi.mock("next/navigation", () => ({
  usePathname: () => "/account/assets",
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...rest
  }: {
    children: React.ReactNode;
    href: string;
    className?: string;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("@/components/AccountSwitcher", () => ({
  default: () => <button type="button">Accounts</button>,
}));

describe("AccountSectionFrame", () => {
  it("renders Overview / Accounts / Trends with Overview selected by default caller", () => {
    render(
      <AccountSectionFrame title="Assets" activeTab="overview" onTabChange={() => {}}>
        <p>overview body</p>
      </AccountSectionFrame>
    );
    expect(screen.getByRole("heading", { name: "Assets" })).toBeTruthy();
    const nav = screen.getByRole("navigation", { name: "Account section" });
    const [overview, accounts, trends] = Array.from(nav.querySelectorAll("button"));
    expect(overview.className).toContain("text-purple-600");
    expect(accounts.className).not.toContain("text-purple-600");
    expect(trends.textContent).toBe("Trends");
  });

  it("phone tab buttons are 44px and restore desktop sizing at lg", () => {
    render(
      <AccountSectionFrame title="Debts" activeTab="accounts" onTabChange={() => {}}>
        body
      </AccountSectionFrame>
    );
    const nav = screen.getByRole("navigation", { name: "Account section" });
    const accounts = nav.querySelector("button:nth-child(2)") as HTMLButtonElement;
    expect(accounts.textContent).toBe("Accounts");
    expect(accounts.className).toContain("min-h-11");
    expect(accounts.className).toContain("lg:min-h-0");
    expect(accounts.className).toContain("lg:flex-none");
  });

  it("notifies tab changes without changing default Overview order", () => {
    const onTabChange = vi.fn();
    render(
      <AccountSectionFrame title="Assets" activeTab="overview" onTabChange={onTabChange}>
        body
      </AccountSectionFrame>
    );
    const nav = screen.getByRole("navigation", { name: "Account section" });
    const tabs = Array.from(nav.querySelectorAll("button")).map((el) => el.textContent);
    expect(tabs).toEqual(["Overview", "Accounts", "Trends"]);
    fireEvent.click(screen.getByRole("button", { name: "Trends" }));
    expect(onTabChange).toHaveBeenCalledWith("trends");
  });
});
