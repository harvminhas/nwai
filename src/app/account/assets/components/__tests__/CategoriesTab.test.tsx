/**
 * Assets Accounts tab: category expand, concise labels, manual vs imported rows.
 */

import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CategoriesTab } from "../CategoriesTab";
import type { AssetsSummary, AssetAccount, AssetGroup } from "@/lib/assetsSummary";
import type { ManualAsset } from "@/lib/types";

// @vitest-environment jsdom

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => ({ get: () => null }),
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...rest
  }: {
    children: React.ReactNode;
    href: string;
    title?: string;
    className?: string;
    "aria-label"?: string;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

function account(
  partial: Pick<AssetAccount, "slug" | "bankName" | "accountName" | "balance"> &
    Partial<Pick<AssetAccount, "lastTransactionDate">>
): AssetAccount {
  return {
    accountType: "checking",
    currency: "CAD",
    statementMonth: "2026-03",
    isStale: false,
    daysOld: 1,
    ...partial,
  };
}

function group(partial: Pick<AssetGroup, "type" | "label" | "total" | "accounts"> & { manualAssets?: ManualAsset[] }): AssetGroup {
  return { manualAssets: [], ...partial };
}

function summary(groups: AssetGroup[]): AssetsSummary {
  return {
    totalAssets: groups.reduce((s, g) => s + g.total, 0),
    currency: "CAD",
    changeVsLastMonth: 0,
    changeVs12Months: 0,
    groups,
    monthlyHistory: [],
    staleAccounts: [],
    accountBalanceHistory: [],
    expenseTxns: [],
    incomeTxns: [],
  };
}

const cash = group({
  type: "cash",
  label: "Cash",
  total: 5000,
  accounts: [account({ slug: "checking-1", bankName: "Chase", accountName: "Checking", balance: 5000 })],
});

const investments = group({
  type: "investments",
  label: "Investments",
  total: 8000,
  accounts: [account({ slug: "broker-1", bankName: "Vanguard", accountName: "Brokerage", balance: 8000 })],
});

const hpeName = "HPE Hewlett Packard Enterprise 401(k) Plan";
const registered = group({
  type: "registered",
  label: "Registered (RRSP/TFSA)",
  total: 419778,
  accounts: [
    account({
      slug: "questrade-rrsp-8044",
      bankName: "Questrade",
      accountName: "Individual Registered Retirement Savings Plan (RRSP)",
      balance: 196263,
    }),
    account({
      slug: "hpe-401k-s3tw",
      bankName: hpeName,
      accountName: hpeName,
      balance: 100306,
    }),
    account({
      slug: "ws-lira-6cad",
      bankName: "Wealthsimple Investments Inc.",
      accountName: "Order Execution Only LIRA Account",
      balance: 123209,
      lastTransactionDate: "2026-03-12",
    }),
  ],
});

const property = group({
  type: "property",
  label: "Property",
  total: 1300000,
  accounts: [],
  manualAssets: [
    {
      id: "house-1",
      label: "2 Bettey",
      category: "property",
      value: 1300000,
      updatedAt: "2026-03-01T00:00:00Z",
    },
  ],
});

describe("Assets Accounts tab category expand", () => {
  it("expands every category group by default so accounts are reachable", () => {
    render(<CategoriesTab summary={summary([cash, investments])} />);

    expect(screen.getByRole("link", { name: /Chase · Checking/ })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Vanguard · Brokerage/ })).toBeTruthy();
  });

  it("keeps a user-collapsed group closed after async new categories arrive", () => {
    const { rerender } = render(<CategoriesTab summary={summary([cash])} />);

    expect(screen.getByRole("link", { name: /Chase · Checking/ })).toBeTruthy();
    fireEvent.click(screen.getByText("Cash"));
    expect(screen.queryByRole("link", { name: /Chase · Checking/ })).toBeNull();

    rerender(<CategoriesTab summary={summary([cash, investments])} />);

    expect(screen.queryByRole("link", { name: /Chase · Checking/ })).toBeNull();
    expect(screen.getByRole("link", { name: /Vanguard · Brokerage/ })).toBeTruthy();
  });

  it("collapses from the keyboard without losing the row", () => {
    render(<CategoriesTab summary={summary([cash])} />);
    const header = screen.getByRole("button", { expanded: true });
    fireEvent.keyDown(header, { key: "Enter" });
    expect(screen.queryByRole("link", { name: /Chase · Checking/ })).toBeNull();
    fireEvent.keyDown(screen.getByRole("button", { expanded: false }), { key: " " });
    expect(screen.getByRole("link", { name: /Chase · Checking/ })).toBeTruthy();
  });
});

describe("Assets Accounts tab labels and density", () => {
  it("does not repeat a duplicated institution and account name", () => {
    const { container } = render(<CategoriesTab summary={summary([registered])} />);
    const matches = container.textContent?.match(/HPE Hewlett Packard Enterprise 401\(k\) Plan/g) ?? [];
    expect(matches).toHaveLength(1);
    expect(container.textContent).not.toContain(`${hpeName} · ${hpeName}`);
  });

  it("shows a concise account name with institution in subdued metadata", () => {
    render(<CategoriesTab summary={summary([registered])} />);
    expect(screen.getByText("Individual Registered Retirement Savings Plan (RRSP)")).toBeTruthy();
    expect(screen.getByText(/Questrade/)).toBeTruthy();
    expect(
      screen.queryByText("Questrade · Individual Registered Retirement Savings Plan (RRSP)")
    ).toBeNull();
  });

  it("truncates long labels and keeps the full name on the row", () => {
    render(<CategoriesTab summary={summary([registered])} />);
    const long = screen.getByText("Individual Registered Retirement Savings Plan (RRSP)");
    expect(long.className).toContain("truncate");
    expect(
      screen.getByRole("link", {
        name: /Questrade · Individual Registered Retirement Savings Plan \(RRSP\)/,
      })
    ).toBeTruthy();
  });

  it("shows manual assets without a badge pill, still linked", () => {
    const { container } = render(<CategoriesTab summary={summary([property])} />);
    expect(screen.getByRole("link", { name: /2 Bettey/ }).getAttribute("href")).toBe(
      "/account/assets/house-1"
    );
    expect(screen.getByText("2 Bettey")).toBeTruthy();
    expect(screen.getByText("Manual")).toBeTruthy();
    expect(container.innerHTML).not.toContain("bg-blue-50");
  });

  it("does not render category progress bars or percents", () => {
    const { container } = render(<CategoriesTab summary={summary([registered])} />);
    expect(container.textContent).not.toContain("%");
    expect(container.querySelector("[style*='width']")).toBeNull();
  });

  it("keeps category totals on the header", () => {
    render(<CategoriesTab summary={summary([property, registered])} />);
    expect(screen.getByText("Property")).toBeTruthy();
    expect(screen.getAllByText("CA$1,300,000").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("CA$419,778").length).toBeGreaterThanOrEqual(1);
  });
});
