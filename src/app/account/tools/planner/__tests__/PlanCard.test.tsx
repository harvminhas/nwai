/**
 * Plan cards: click body opens the plan; Delete does not.
 * @vitest-environment jsdom
 */

import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PlanCard } from "../PlanCard";
import type { Plan } from "@/app/api/user/plans/route";

function plan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: "plan-1",
    name: "Europe Trip",
    startDate: "2026-12-01",
    endDate: "2026-12-20",
    budget: 5000,
    linkedTransactions: [],
    cashEntries: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("PlanCard click target", () => {
  it("opens the plan when the card body is clicked, and does not open when Delete is clicked", () => {
    const onSelect = vi.fn();
    const onDelete = vi.fn();
    render(<PlanCard plan={plan()} onSelect={onSelect} onDelete={onDelete} />);

    fireEvent.click(screen.getByText("CA$0 of CA$5,000"));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onDelete).not.toHaveBeenCalled();

    onSelect.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("opens on Enter and Space only when the event target is the card itself", () => {
    const onSelect = vi.fn();
    const onDelete = vi.fn();
    render(<PlanCard plan={plan()} onSelect={onSelect} onDelete={onDelete} />);

    const card = screen.getByRole("button", { name: "Europe Trip" });
    fireEvent.keyDown(card, { key: "Enter" });
    fireEvent.keyDown(card, { key: " " });
    expect(onSelect).toHaveBeenCalledTimes(2);

    onSelect.mockClear();
    const deleteButton = screen.getByRole("button", { name: "Delete" });
    fireEvent.keyDown(deleteButton, { key: "Enter" });
    fireEvent.keyDown(deleteButton, { key: " " });
    expect(onSelect).not.toHaveBeenCalled();
  });
});
