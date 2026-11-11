/**
 * Tracker cards: click body opens the tracker; title Enter opens it; Delete does not.
 * @vitest-environment jsdom
 */

import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TrackerCard } from "../TrackerCard";
import type { Tracker } from "@/app/api/user/trackers/route";
import { formatCurrency } from "@/lib/currencyUtils";

function tracker(overrides: Partial<Tracker> = {}): Tracker {
  return {
    id: "tracker-1",
    name: "Work Expenses",
    description: "Lunches and gas",
    defaultFilter: "spending",
    linkedTransactions: [
      {
        txFingerprint: "lunch",
        merchant: "Cafe",
        date: "2026-06-01",
        amount: 18,
        category: "Dining",
        kind: "expense",
      },
    ],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("TrackerCard click target", () => {
  it("opens the tracker from the card body and title Enter, and Delete does not open it", () => {
    const onSelect = vi.fn();
    const onDelete = vi.fn();
    const item = tracker();
    render(<TrackerCard tracker={item} onSelect={onSelect} onDelete={onDelete} />);

    fireEvent.click(screen.getByText(item.description));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onDelete).not.toHaveBeenCalled();

    onSelect.mockClear();
    fireEvent.click(screen.getByText(`Spending ${formatCurrency(18, "CAD")}`));
    expect(onSelect).toHaveBeenCalledTimes(1);

    onSelect.mockClear();
    fireEvent.keyDown(screen.getByRole("button", { name: item.name }), { key: "Enter" });
    expect(onSelect).toHaveBeenCalledTimes(1);

    onSelect.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });
});
