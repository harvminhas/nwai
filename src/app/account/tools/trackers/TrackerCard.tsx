"use client";

import type { KeyboardEvent, MouseEvent } from "react";
import type { Tracker } from "@/app/api/user/trackers/route";
import { formatCurrency } from "@/lib/currencyUtils";
import { computeTrackerTotals, defaultFilterLabel } from "./trackerTotals";

export function TrackerCard({
  tracker,
  onSelect,
  onDelete,
}: {
  tracker: Tracker;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const totals = computeTrackerTotals(tracker.linkedTransactions);
  const txCount = tracker.linkedTransactions.length;

  function handleTitleClick(e: MouseEvent<HTMLButtonElement>) {
    e.stopPropagation();
    onSelect();
  }

  function handleTitleKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    e.stopPropagation();
    onSelect();
  }

  function handleDelete(e: MouseEvent<HTMLButtonElement>) {
    e.stopPropagation();
    onDelete();
  }

  return (
    <div
      onClick={onSelect}
      className="cursor-pointer rounded-lg border border-gray-200 bg-white p-4 hover:border-gray-300"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={handleTitleClick}
            onKeyDown={handleTitleKeyDown}
            className="text-left hover:text-purple-600"
          >
            <h3 className="break-words font-semibold text-gray-900">{tracker.name}</h3>
          </button>
          {tracker.description ? (
            <p className="mt-1 break-words text-sm text-gray-600">{tracker.description}</p>
          ) : null}
          <p className="mt-1 text-sm text-gray-600">
            {defaultFilterLabel(tracker.defaultFilter)} · {txCount} transaction{txCount !== 1 ? "s" : ""}
          </p>

          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
            <span className="text-gray-700">
              Income {formatCurrency(totals.incomeIn, "CAD")}
            </span>
            <span className="text-gray-700">
              Spending {formatCurrency(totals.spendingOut, "CAD")}
            </span>
            <span className={totals.net >= 0 ? "font-medium text-green-600" : "font-medium text-red-600"}>
              Net {formatCurrency(totals.net, "CAD")}
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={handleDelete}
          className="shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50"
        >
          Delete
        </button>
      </div>
    </div>
  );
}
