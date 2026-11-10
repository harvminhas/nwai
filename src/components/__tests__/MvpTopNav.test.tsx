/**
 * Mobile header net worth + drawer TLC.
 * @vitest-environment jsdom
 */

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MvpTopNav } from "../MvpTopNav";
import {
  DESKTOP_NET_WORTH_PILL_CLASS,
  DRAWER_FOOTER_CLASS,
  DRAWER_HEADER_CLASS,
  MOBILE_NET_WORTH_LINK_CLASS,
  MOBILE_NET_WORTH_SKELETON_CLASS,
  drawerLinkClass,
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
  }: {
    children: React.ReactNode;
    href: string;
    className?: string;
    "aria-label"?: string;
    onClick?: () => void;
  }) => (
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
    const desktopLabel = screen.getByText((_, el) =>
      el?.tagName === "SPAN" && el.textContent === "Net worth" && el.className.includes("uppercase")
    );
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
    expect(section("Tools")?.className).toContain("uppercase");
    expect(section("Account")?.className).toContain("uppercase");

    const footer = drawer.lastElementChild as HTMLElement;
    expect(footer.className).toBe(DRAWER_FOOTER_CLASS);
    expect(footer.textContent).toContain("Privacy & Terms");
    expect(footer.textContent).toContain("Sign out");
    expect(drawer.querySelector('a[href="/account/tools/planner"]')).toBeTruthy();
    expect(drawer.querySelector('a[href="/account/tools/debt-payoff"]')).toBeTruthy();
  });
});
