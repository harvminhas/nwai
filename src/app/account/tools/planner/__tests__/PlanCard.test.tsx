/**
 * Plan cards: click body opens the plan; title Enter opens it; Delete does not.
 * @vitest-environment jsdom
 */

import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PlanCard } from "../PlanCard";
import type { Plan } from "@/app/api/user/plans/route";
import { formatCurrency } from "@/lib/currencyUtils";

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
    render(<PlanCard plan={item} onSelect={onSelect} onDelete={onDelete} />);

    fireEvent.click(
      screen.getByText(`${formatCurrency(0, "CAD")} of ${formatCurrency(item.budget, "CAD")}`)
    );
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onDelete).not.toHaveBeenCalled();

    onSelect.mockClear();
    fireEvent.keyDown(screen.getByRole("button", { name: item.name }), { key: "Enter" });
    expect(onSelect).toHaveBeenCalledTimes(1);

    onSelect.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });
});
