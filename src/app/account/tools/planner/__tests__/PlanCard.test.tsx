/**
 * Plan cards: click body opens the plan; title Enter opens it; menu Delete does not.
 * @vitest-environment jsdom
 */

import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PlanCard } from "../PlanCard";
import type { Plan } from "@/app/api/user/plans/route";
import { formatCurrency } from "@/lib/currencyUtils";

const TODAY = "2026-11-22";

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
  it("opens the plan from the card body and title Enter, and Delete does not open it", () => {
    const onSelect = vi.fn();
    const onDelete = vi.fn();
    const item = plan();
    render(
      <PlanCard
        plan={item}
        onSelect={onSelect}
        onDelete={onDelete}
        today={TODAY}
      />,
    );

    fireEvent.click(
      screen.getByText(`${formatCurrency(0, "CAD")} of ${formatCurrency(item.budget, "CAD")}`)
    );
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onDelete).not.toHaveBeenCalled();

    onSelect.mockClear();
    fireEvent.keyDown(screen.getByRole("button", { name: item.name }), { key: "Enter" });
    expect(onSelect).toHaveBeenCalledTimes(1);

    onSelect.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("shows Mark complete on past incomplete plans without opening the plan", () => {
    const onSelect = vi.fn();
    const onMarkComplete = vi.fn();
    render(
      <PlanCard
        plan={plan({ startDate: "2026-10-01", endDate: "2026-10-15" })}
        onSelect={onSelect}
        onDelete={vi.fn()}
        onMarkComplete={onMarkComplete}
        today={TODAY}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Mark complete" }));
    expect(onMarkComplete).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("shows a Completed badge and Undo in the menu", () => {
    const onUndoComplete = vi.fn();
    const onSelect = vi.fn();
    render(
      <PlanCard
        plan={plan({
          startDate: "2026-10-01",
          endDate: "2026-10-15",
          completedAt: "2026-10-16T00:00:00.000Z",
        })}
        onSelect={onSelect}
        onDelete={vi.fn()}
        onUndoComplete={onUndoComplete}
        today={TODAY}
      />,
    );
    expect(screen.getByText("Completed")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Mark complete" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Undo" }));
    expect(onUndoComplete).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });
});
