/**
 * Theme detail modal: open/close, Esc, backdrop, keyboard row.
 * @vitest-environment jsdom
 */

import React, { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    className,
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));
import { ThemeDetailModal } from "../ThemeDetailModal";
import type { DailySpendThemeRow } from "@/lib/dailySpend";
import { seeInSpendingLabel } from "@/lib/dailySpend";
import { THEME_CHEVRON_CLASS, THEME_ROW_CLASS } from "../dailySpendReadLayout";

const foodTheme: DailySpendThemeRow = {
  id: "food",
  label: "Food",
  color: "#22c55e",
  dailyRate: 12.5,
  priorDailyRate: 10,
  delta: 2.5,
  deltaKind: "up",
  share: 0.4,
  groceriesDaily: 8,
  eatingOutDaily: 4.5,
  detail: {
    subcategories: [
      { id: "groceries", label: "Groceries", dailyRate: 8, share: 0.64 },
      { id: "restaurants", label: "Restaurants", dailyRate: 4.5, share: 0.36 },
    ],
    foodSplit: {
      groceries: { id: "groceries", label: "Groceries", dailyRate: 8, share: 0.64 },
      eatingOut: { id: "eating-out", label: "Eating out", dailyRate: 4.5, share: 0.36 },
      eatingOutSubcategories: [
        { id: "restaurants", label: "Restaurants", dailyRate: 2, share: 0.44 },
        { id: "coffee-drinks", label: "Coffee & Drinks", dailyRate: 1, share: 0.22 },
        { id: "fast-food", label: "Fast Food", dailyRate: 1, share: 0.22 },
        { id: "food-delivery", label: "Food Delivery", dailyRate: 0.5, share: 0.11 },
      ],
    },
    merchants: [
      {
        slug: "loblaws",
        name: "Loblaws",
        dailyRate: 5,
        total: 460,
        count: 6,
        visitsPerMonth: 2,
      },
    ],
    series: [
      { yearMonth: "2026-06", dailyRate: 10, isInProgress: false },
      { yearMonth: "2026-07", dailyRate: 11, isInProgress: false },
      { yearMonth: "2026-08", dailyRate: 12, isInProgress: false },
      { yearMonth: "2026-09", dailyRate: 12, isInProgress: false },
      { yearMonth: "2026-10", dailyRate: 13, isInProgress: false },
      { yearMonth: "2026-11", dailyRate: 20, isInProgress: true },
    ],
    spendingHref: "/account/spending?category=Dining",
  },
};

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        className={THEME_ROW_CLASS}
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-label="Food details"
      >
        Food
        <svg className={THEME_CHEVRON_CLASS} aria-hidden viewBox="0 0 24 24">
          <path d="M9 5l7 7-7 7" />
        </svg>
      </button>
      <ThemeDetailModal
        theme={open ? foodTheme : null}
        currency="CAD"
        windowLabel="Aug–Oct 2026"
        onClose={() => setOpen(false)}
      />
    </div>
  );
}

describe("theme detail modal open and close", () => {
  it("opens from a collapsed chevron row and closes on X, Escape, and backdrop", () => {
    render(<Harness />);

    expect(screen.queryByRole("dialog")).toBeNull();
    const row = screen.getByRole("button", { name: "Food details" });
    expect(row.className).toContain("w-full");
    fireEvent.click(row);

    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeTruthy();
    expect(screen.getByText("Aug–Oct 2026 average")).toBeTruthy();
    expect(screen.getByText("Where eating out goes")).toBeTruthy();
    expect(screen.getByText("Top 5 merchants")).toBeTruthy();
    expect(screen.getByText("2 visits/mo")).toBeTruthy();
    expect(screen.getByText("In progress")).toBeTruthy();
    expect(screen.getByRole("link", { name: seeInSpendingLabel("Food") }).getAttribute("href")).toBe(
      "/account/spending?category=Dining",
    );

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(row);
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(row);
    fireEvent.click(screen.getByTestId("theme-detail-backdrop"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
