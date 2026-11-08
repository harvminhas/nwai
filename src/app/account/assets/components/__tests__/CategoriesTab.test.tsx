/**
 * Assets Accounts tab: category groups expanded by default,
 * new async groups expanded, user collapse survives rerender.
 */

import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CategoriesTab } from "../CategoriesTab";
import type { AssetsSummary, AssetAccount, AssetGroup } from "@/lib/assetsSummary";

// @vitest-environment jsdom

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => ({ get: () => null }),
}));

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

function account(partial: Pick<AssetAccount, "slug" | "bankName" | "accountName" | "balance">): AssetAccount {
  return {
    accountType: "checking",
    currency: "USD",
    statementMonth: "2026-03",
    isStale: false,
    daysOld: 1,
    ...partial,
  };
}

function group(partial: Pick<AssetGroup, "type" | "label" | "total" | "accounts">): AssetGroup {
  return { manualAssets: [], ...partial };
}

function summary(groups: AssetGroup[]): AssetsSummary {
  return {
    totalAssets: groups.reduce((s, g) => s + g.total, 0),
    currency: "USD",
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

describe("Assets Accounts tab category expand", () => {
  it("expands every category group by default so accounts are visible", () => {
    render(<CategoriesTab summary={summary([cash, investments])} />);

    expect(screen.getByText("Chase · Checking")).toBeTruthy();
    expect(screen.getByText("Vanguard · Brokerage")).toBeTruthy();
  });

  it("keeps a user-collapsed group closed after async new categories arrive", () => {
    const { rerender } = render(<CategoriesTab summary={summary([cash])} />);

    expect(screen.getByText("Chase · Checking")).toBeTruthy();
    fireEvent.click(screen.getByText("Cash"));
    expect(screen.queryByText("Chase · Checking")).toBeNull();

    rerender(<CategoriesTab summary={summary([cash, investments])} />);

    expect(screen.queryByText("Chase · Checking")).toBeNull();
    expect(screen.getByText("Vanguard · Brokerage")).toBeTruthy();
  });
});
