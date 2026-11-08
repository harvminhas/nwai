/**
 * Debts Accounts tab: category expand, concise labels, manual vs imported rows.
 */

import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CategoriesTab } from "../CategoriesTab";
import type { DebtsSummary, DebtAccount, DebtGroup } from "@/lib/debtsSummary";
import type { ManualLiability } from "@/lib/types";

// @vitest-environment jsdom

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
  partial: Pick<DebtAccount, "slug" | "bankName" | "accountName" | "balance">
): DebtAccount {
  return {
    accountType: "credit",
    currency: "CAD",
    interestRate: 20,
    statementMonth: "2026-03",
    monthlyPayment: 200,
    minPayment: 50,
    ...partial,
  };
}

function group(
  partial: Pick<DebtGroup, "type" | "label" | "totalBalance" | "accounts"> & {
    manualLiabilities?: ManualLiability[];
  }
): DebtGroup {
  return { manualLiabilities: [], ...partial };
}

function summary(groups: DebtGroup[]): DebtsSummary {
  return {
    totalDebt: groups.reduce((s, g) => s + Math.abs(g.totalBalance), 0),
    currency: "CAD",
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

const duplicateLoanName = "Federal Student Loan Direct";
const other = group({
  type: "other",
  label: "Other Loans",
  totalBalance: -22000,
  accounts: [
    account({
      slug: "osap-7788",
      bankName: duplicateLoanName,
      accountName: duplicateLoanName,
      balance: -7800,
    }),
  ],
  manualLiabilities: [
    {
      id: "student-1",
      label: "Federal Student Loan",
      category: "student_loan",
      balance: 15000,
      updatedAt: "2026-02-15T00:00:00Z",
    },
  ],
});

describe("Debts Accounts tab category expand", () => {
  it("expands every category group by default so accounts are reachable", () => {
    render(<CategoriesTab summary={summary([cards, mortgage])} />);

    expect(screen.getByRole("link", { name: /Chase · Sapphire/ })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Wells Fargo · Home Loan/ })).toBeTruthy();
  });

  it("keeps a user-collapsed group closed after async new categories arrive", () => {
    const { rerender } = render(<CategoriesTab summary={summary([cards])} />);

    expect(screen.getByRole("link", { name: /Chase · Sapphire/ })).toBeTruthy();
    fireEvent.click(screen.getByText("Credit Cards"));
    expect(screen.queryByRole("link", { name: /Chase · Sapphire/ })).toBeNull();

    rerender(<CategoriesTab summary={summary([cards, mortgage])} />);

    expect(screen.queryByRole("link", { name: /Chase · Sapphire/ })).toBeNull();
    expect(screen.getByRole("link", { name: /Wells Fargo · Home Loan/ })).toBeTruthy();
  });
});

describe("Debts Accounts tab labels and density", () => {
  it("does not repeat a duplicated loan name", () => {
    const { container } = render(<CategoriesTab summary={summary([other])} />);
    const matches = container.textContent?.match(/Federal Student Loan Direct/g) ?? [];
    expect(matches).toHaveLength(1);
  });

  it("keeps imported and manual debts distinct and reachable", () => {
    render(<CategoriesTab summary={summary([other])} />);
    expect(
      screen.getByRole("link", { name: /Federal Student Loan Direct/ }).getAttribute("href")
    ).toBe("/account/accounts/osap-7788");
    expect(screen.getByText("Federal Student Loan")).toBeTruthy();
    expect(screen.getByText("Manual")).toBeTruthy();
  });

  it("truncates long labels", () => {
    render(
      <CategoriesTab
        summary={summary([
          group({
            type: "credit_card",
            label: "Credit Cards",
            totalBalance: -100,
            accounts: [
              account({
                slug: "long-cc",
                bankName: "Very Long Bank Name International Holdings",
                accountName: "Platinum Rewards World Elite Mastercard Ending In Extra Words",
                balance: -100,
              }),
            ],
          }),
        ])}
      />
    );
    const primary = screen.getByText("Platinum Rewards World Elite Mastercard Ending In Extra Words");
    expect(primary.className).toContain("truncate");
  });

  it("does not render category progress bars and keeps the header total", () => {
    const { container } = render(<CategoriesTab summary={summary([mortgage])} />);
    expect(container.textContent).not.toContain("%");
    expect(screen.getAllByText("CA$200,000").length).toBeGreaterThanOrEqual(1);
  });
});
