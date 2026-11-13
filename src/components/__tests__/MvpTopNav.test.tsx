/**
 * Mobile header net worth + drawer TLC.
 * @vitest-environment jsdom
 */

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MvpTopNav } from "../MvpTopNav";
import {
  CASH_FLOW_NAV_ITEMS,
  DESKTOP_NET_WORTH_PILL_CLASS,
  DRAWER_FOOTER_CLASS,
  DRAWER_HEADER_CLASS,
  MOBILE_NET_WORTH_LINK_CLASS,
  MOBILE_NET_WORTH_SKELETON_CLASS,
  NET_WORTH_NAV_ITEMS,
  drawerLinkClass,
  dropdownLinkClass,
} from "../mvpNavLayout";

const pathname = vi.fn(() => "/account/income");

vi.mock("next/navigation", () => ({
  usePathname: () => pathname(),
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...rest
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("firebase/auth", () => ({
  onAuthStateChanged: (_auth: unknown, cb: (user: null) => void) => {
    cb(null);
    return () => {};
  },
  signOut: vi.fn(),
}));

vi.mock("@/lib/firebase", () => ({
  getFirebaseClient: () => ({ auth: {} }),
}));

const netWorthData = {
  netWorth: 1222583,
  monthlyChange: -41122,
  currency: "CAD",
};

function isDesktopNetWorthLabel(_content: string, el: Element | null): boolean {
  return (
    el instanceof HTMLElement &&
    el.tagName === "SPAN" &&
    el.textContent === "Net worth" &&
    el.className.includes("uppercase")
  );
}

function drawerGroupLinks(drawer: HTMLElement, sectionName: string): HTMLAnchorElement[] {
  const section = Array.from(drawer.querySelectorAll("h6")).find(
    (node) => node.textContent === sectionName,
  );
  const groupLinks: HTMLAnchorElement[] = [];
  for (
    let el: Element | null = section?.nextElementSibling ?? null;
    el && el.tagName !== "H6";
    el = el.nextElementSibling
  ) {
    if (el instanceof HTMLAnchorElement) groupLinks.push(el);
  }
  return groupLinks;
}

describe("MvpTopNav phone header and drawer", () => {
  beforeEach(() => {
    pathname.mockReturnValue("/account/income");
  });

  it("shows a compact net worth value left of the hamburger, linking to /account/net-worth", () => {
    render(<MvpTopNav netWorthData={netWorthData} />);
    const compact = screen.getByLabelText("Net worth");
    expect(compact.getAttribute("href")).toBe("/account/net-worth");
    expect(compact.className).toBe(MOBILE_NET_WORTH_LINK_CLASS);
    expect(compact.textContent).toContain("CA$1,222,583");
    expect(compact.textContent).toContain("CA$41,122");
    expect(screen.getByLabelText("Menu")).toBeTruthy();
  });

  it("keeps the desktop pill as lg-only and does not wrap the compact value", () => {
    render(<MvpTopNav netWorthData={netWorthData} />);
    const desktopLabel = screen.getByText(isDesktopNetWorthLabel);
    const desktop = desktopLabel.closest("a");
    expect(desktop?.className).toBe(DESKTOP_NET_WORTH_PILL_CLASS);
    expect(desktop?.className).toContain("lg:flex");
    expect(desktop?.className).not.toContain("sm:flex");
  });

  it("reserves space while loading and shows nothing extra when data is missing", () => {
    const { container } = render(<MvpTopNav />);
    const skeleton = container.querySelector("[aria-hidden]") as HTMLElement;
    expect(skeleton.className).toBe(MOBILE_NET_WORTH_SKELETON_CLASS);
    expect(screen.queryByLabelText("Net worth")).toBeNull();
    expect(screen.queryByText("CA$0")).toBeNull();
  });

  it("opens a drawer with aligned header, active Income row, section labels, and pinned footer", () => {
    const { container } = render(<MvpTopNav netWorthData={netWorthData} />);
    fireEvent.click(screen.getByLabelText("Menu"));

    const drawer = container.querySelector("aside") as HTMLElement;
    expect(drawer).toBeTruthy();

    const close = screen.getByLabelText("Close");
    expect(close.parentElement?.className).toBe(DRAWER_HEADER_CLASS);

    const income = drawer.querySelector('a[href="/account/income"]') as HTMLElement;
    expect(income.className).toBe(drawerLinkClass(true));
    const spending = drawer.querySelector('a[href="/account/spending"]') as HTMLElement;
    expect(spending.className).toBe(drawerLinkClass(false));

    const section = (name: string) =>
      Array.from(drawer.querySelectorAll("h6")).find((el) => el.textContent === name);
    expect(section("Cash flow")?.className).toContain("uppercase");
    expect(section("Net worth")?.className).toContain("uppercase");
    expect(section("Tools")?.className).toContain("uppercase");
    expect(section("Account")?.className).toContain("uppercase");

    const footer = drawer.lastElementChild as HTMLElement;
    expect(footer.className).toBe(DRAWER_FOOTER_CLASS);
    expect(footer.textContent).toContain("Privacy & Terms");
    expect(footer.textContent).toContain("Sign out");
    expect(drawer.querySelector('a[href="/account/tools/planner"]')).toBeTruthy();
    expect(drawer.querySelector('a[href="/account/tools/trackers"]')).toBeTruthy();
    expect(drawer.querySelector('a[href="/account/tools/debt-payoff"]')).toBeTruthy();
  });

  it("puts Cash Flow first in the cash-flow group and highlights only /account/cash-flow", () => {
    pathname.mockReturnValue("/account/cash-flow");
    const { container } = render(<MvpTopNav netWorthData={netWorthData} />);
    fireEvent.click(screen.getByLabelText("Menu"));

    const drawer = container.querySelector("aside") as HTMLElement;
    const groupLinks = drawerGroupLinks(drawer, "Cash flow");

    expect(groupLinks.map((link) => link.getAttribute("href"))).toEqual(
      CASH_FLOW_NAV_ITEMS.map((item) => item.href),
    );
    expect(groupLinks[0].textContent).toBe("Cash Flow");
    expect(groupLinks[0].className).toBe(drawerLinkClass(true));
    expect(groupLinks[1].className).toBe(drawerLinkClass(false));
    expect(groupLinks[2].className).toBe(drawerLinkClass(false));

    const desktopCashFlow = Array.from(container.querySelectorAll('a[href="/account/cash-flow"]')).find(
      (el) => el instanceof HTMLAnchorElement && el.textContent === "Cash Flow",
    );
    expect(desktopCashFlow?.className).toBe(dropdownLinkClass(true));
    const desktopIncome = Array.from(container.querySelectorAll('a[href="/account/income"]')).find(
      (el) => el instanceof HTMLAnchorElement && !drawer.contains(el),
    );
    expect(desktopIncome?.className).toBe(dropdownLinkClass(false));
  });

  it("does not highlight the Cash Flow item on Income or Spending pages", () => {
    pathname.mockReturnValue("/account/income");
    const { container, unmount } = render(<MvpTopNav netWorthData={netWorthData} />);
    fireEvent.click(screen.getByLabelText("Menu"));
    const drawer = container.querySelector("aside") as HTMLElement;
    const cashFlow = drawer.querySelector('a[href="/account/cash-flow"]') as HTMLElement;
    const income = drawer.querySelector('a[href="/account/income"]') as HTMLElement;
    expect(cashFlow.className).toBe(drawerLinkClass(false));
    expect(income.className).toBe(drawerLinkClass(true));
    unmount();

    pathname.mockReturnValue("/account/spending");
    const second = render(<MvpTopNav netWorthData={netWorthData} />);
    fireEvent.click(screen.getByLabelText("Menu"));
    const drawer2 = second.container.querySelector("aside") as HTMLElement;
    expect(drawer2.querySelector('a[href="/account/cash-flow"]')?.className).toBe(
      drawerLinkClass(false),
    );
    expect(drawer2.querySelector('a[href="/account/spending"]')?.className).toBe(
      drawerLinkClass(true),
    );
  });

  it("puts Net Worth first in the net-worth group and highlights only /account/net-worth", () => {
    pathname.mockReturnValue("/account/net-worth");
    const { container } = render(<MvpTopNav netWorthData={netWorthData} />);
    fireEvent.click(screen.getByLabelText("Menu"));

    const drawer = container.querySelector("aside") as HTMLElement;
    const groupLinks = drawerGroupLinks(drawer, "Net worth");

    expect(groupLinks.map((link) => link.getAttribute("href"))).toEqual(
      NET_WORTH_NAV_ITEMS.map((item) => item.href),
    );
    expect(groupLinks[0].textContent).toBe("Net Worth");
    expect(groupLinks[0].className).toBe(drawerLinkClass(true));
    expect(groupLinks[1].className).toBe(drawerLinkClass(false));
    expect(groupLinks[2].className).toBe(drawerLinkClass(false));

    const desktopNetWorth = Array.from(container.querySelectorAll('a[href="/account/net-worth"]')).find(
      (el) => el instanceof HTMLAnchorElement && el.textContent === "Net Worth",
    );
    expect(desktopNetWorth?.className).toBe(dropdownLinkClass(true));
    const desktopAssets = Array.from(container.querySelectorAll('a[href="/account/assets"]')).find(
      (el) => el instanceof HTMLAnchorElement && !drawer.contains(el),
    );
    expect(desktopAssets?.className).toBe(dropdownLinkClass(false));
  });

  it("does not highlight the Net Worth item on Assets or Debts pages", () => {
    pathname.mockReturnValue("/account/assets");
    const { container, unmount } = render(<MvpTopNav netWorthData={netWorthData} />);
    fireEvent.click(screen.getByLabelText("Menu"));
    const drawer = container.querySelector("aside") as HTMLElement;
    const netWorth = drawer.querySelector('a[href="/account/net-worth"]') as HTMLElement;
    const assets = drawer.querySelector('a[href="/account/assets"]') as HTMLElement;
    expect(netWorth.className).toBe(drawerLinkClass(false));
    expect(assets.className).toBe(drawerLinkClass(true));
    unmount();

    pathname.mockReturnValue("/account/liabilities");
    const second = render(<MvpTopNav netWorthData={netWorthData} />);
    fireEvent.click(screen.getByLabelText("Menu"));
    const drawer2 = second.container.querySelector("aside") as HTMLElement;
    expect(drawer2.querySelector('a[href="/account/net-worth"]')?.className).toBe(
      drawerLinkClass(false),
    );
    expect(drawer2.querySelector('a[href="/account/liabilities"]')?.className).toBe(
      drawerLinkClass(true),
    );
  });
});
