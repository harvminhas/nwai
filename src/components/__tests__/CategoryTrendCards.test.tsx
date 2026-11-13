import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { CategoryTrendCardGrid } from "../CategoryTrendCards";
import type { CategoryTrendCard } from "@/lib/categoryTrends";

// @vitest-environment jsdom

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

function card(partial: Partial<CategoryTrendCard> & Pick<CategoryTrendCard, "key" | "label" | "kind">): CategoryTrendCard {
  return {
    current: 0,
    start: 0,
    change: 0,
    changePercent: null,
    sparkline: [1, 2],
    subtitle: null,
    staleNote: null,
    accountCount: 2,
    href: "/account/assets",
    accounts: [],
    newAccountNote: null,
    ...partial,
  };
}

describe("CategoryTrendCardGrid", () => {
  it("shows Paid down in green and Grew in red for debts", () => {
    const { container } = render(
      <CategoryTrendCardGrid
        currency="CAD"
        cards={[
          card({
            key: "credit_card",
            label: "Credit Cards",
            kind: "debt",
            current: 1500,
            start: 2000,
            change: -500,
            accountCount: 1,
            href: "/account/accounts/visa",
          }),
          card({
            key: "mortgage",
            label: "Mortgage",
            kind: "debt",
            current: 400000,
            start: 398000,
            change: 2000,
            accountCount: 1,
            href: "/account/accounts/mtg",
          }),
        ]}
      />,
    );
    const html = container.innerHTML;
    expect(html).toContain("Paid down");
    expect(html).toContain("Grew");
    expect(html).toMatch(/bg-green-50 text-green-700[^>]*>[\s\S]*Paid down/);
    expect(html).toMatch(/bg-red-50 text-red-700[^>]*>[\s\S]*Grew/);
    expect(html).toContain("View account →");
  });

  it("stacks one card per row on mobile via grid-cols-1", () => {
    const { container } = render(
      <CategoryTrendCardGrid
        currency="CAD"
        cards={[card({ key: "cash", label: "Cash & Savings", kind: "asset", current: 100 })]}
      />,
    );
    expect(container.innerHTML).toContain("grid-cols-1");
    expect(container.innerHTML).toContain("By category");
  });
});
