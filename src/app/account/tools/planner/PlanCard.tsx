"use client";

import type { KeyboardEvent, MouseEvent } from "react";
import type { Plan } from "@/app/api/user/plans/route";
import { formatCurrency } from "@/lib/currencyUtils";

export function PlanCard({
  plan,
  onSelect,
  onDelete,
}: {
  plan: Plan;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const spent = plan.linkedTransactions.reduce((sum, tx) => sum + tx.amount, 0) +
                plan.cashEntries.reduce((sum, entry) => sum + entry.amount, 0);
  const remaining = plan.budget - spent;
  const percentSpent = plan.budget > 0 ? (spent / plan.budget) * 100 : 0;

  // Check if upcoming and calculate monthly savings needed
  const today = new Date().toISOString().split("T")[0];
  const isUpcoming = plan.startDate > today;
  const monthsUntilStart = isUpcoming ?
    Math.max(1, Math.ceil((new Date(plan.startDate).getTime() - new Date().getTime()) / (30 * 24 * 60 * 60 * 1000))) : 0;
  const monthlySavings = isUpcoming && monthsUntilStart > 0 ? remaining / monthsUntilStart : 0;

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr + "T00:00:00");
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  };

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if ((e.key !== "Enter" && e.key !== " ") || e.target !== e.currentTarget) return;
    e.preventDefault();
    onSelect();
  }

  function handleDelete(e: MouseEvent<HTMLButtonElement>) {
    e.stopPropagation();
    onDelete();
  }

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={plan.name}
      onClick={onSelect}
      onKeyDown={handleKeyDown}
      className="rounded-lg border border-gray-200 bg-white p-4 cursor-pointer hover:border-gray-300"
    >
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <h3 className="font-semibold text-gray-900">{plan.name}</h3>
          <p className="mt-1 text-sm text-gray-600">
            {formatDate(plan.startDate)} – {formatDate(plan.endDate)}
          </p>

          {/* Progress bar */}
          <div className="mt-3">
            <div className="flex items-center justify-between text-sm mb-1">
              <span className="text-gray-700">
                {formatCurrency(spent, "CAD")} of {formatCurrency(plan.budget, "CAD")}
              </span>
              <span className={remaining >= 0 ? "text-green-600 font-medium" : "text-red-600 font-medium"}>
                {remaining >= 0 ? "Under" : "Over"} {formatCurrency(Math.abs(remaining), "CAD")}
              </span>
            </div>
            <div className="h-2 w-full rounded-full bg-gray-200 overflow-hidden">
              <div
                className={`h-full transition-all ${
                  percentSpent > 100 ? "bg-red-500" : percentSpent > 80 ? "bg-yellow-500" : "bg-green-500"
                }`}
                style={{ width: `${Math.min(percentSpent, 100)}%` }}
              />
            </div>
          </div>

          {/* Upcoming savings recommendation */}
          {isUpcoming && monthlySavings > 0 && (
            <p className="mt-2 text-xs text-purple-600 font-medium">
              Set aside {formatCurrency(monthlySavings, "CAD")}/mo to be ready
            </p>
          )}
        </div>

        <button
          type="button"
          onClick={handleDelete}
          className="ml-4 rounded-lg px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50"
        >
          Delete
        </button>
      </div>
    </div>
  );
}
