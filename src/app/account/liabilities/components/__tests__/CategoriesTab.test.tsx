/**
 * Debts Accounts tab: category groups expanded by default,
 * new async groups expanded, user collapse survives rerender.
 */

import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CategoriesTab } from "../CategoriesTab";
import type { DebtsSummary, DebtAccount, DebtGroup } from "@/lib/debtsSummary";

// @vitest-environment jsdom

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

function account(partial: Pick<DebtAccount, "slug" | "bankName" | "accountName" | "balance">): DebtAccount {
  return {
    accountType: "credit",
    currency: "USD",
    interestRate: 20,
    statementMonth: "2026-03",
    monthlyPayment: 200,
    minPayment: 50,
    ...partial,
  };
}

function group(partial: Pick<DebtGroup, "type" | "label" | "totalBalance" | "accounts">): DebtGroup {
  return { manualLiabilities: [], ...partial };
}

function summary(groups: DebtGroup[]): DebtsSummary {
  return {
    totalDebt: groups.reduce((s, g) => s + Math.abs(g.totalBalance), 0),
    currency: "USD",
    changeVsLastMonth: 0,
    changeVs12Months: 0,
    monthlyPayments: 0,
    interestPaidLast3Months: 0,
    interestPaidByYear: [],
    weightedAvgRate: null,
    groups,
    payoffEstimates: [],
    monthlyHistory: [],
    accountBalanceHistory: [],
    expenseTxns: [],
    incomeTxns: [],
  };
}

const cards = group({
  type: "credit_card",
  label: "Credit Cards",
  totalBalance: -15000,
  accounts: [account({ slug: "cc-1", bankName: "Chase", accountName: "Sapphire", balance: -15000 })],
});

const mortgage = group({
  type: "mortgage",
  label: "Mortgage",
  totalBalance: -200000,
  accounts: [account({ slug: "mtg-1", bankName: "Wells Fargo", accountName: "Home Loan", balance: -200000 })],
});

describe("Debts Accounts tab category expand", () => {
  it("expands every category group by default so accounts are visible", () => {
    render(<CategoriesTab summary={summary([cards, mortgage])} />);

    expect(screen.getByText("Chase · Sapphire")).toBeTruthy();
    expect(screen.getByText("Wells Fargo · Home Loan")).toBeTruthy();
  });

  it("keeps a user-collapsed group closed after async new categories arrive", () => {
    const { rerender } = render(<CategoriesTab summary={summary([cards])} />);

    expect(screen.getByText("Chase · Sapphire")).toBeTruthy();
    fireEvent.click(screen.getByText("Credit Cards"));
    expect(screen.queryByText("Chase · Sapphire")).toBeNull();

    rerender(<CategoriesTab summary={summary([cards, mortgage])} />);

    expect(screen.queryByText("Chase · Sapphire")).toBeNull();
    expect(screen.getByText("Wells Fargo · Home Loan")).toBeTruthy();
  });
});
