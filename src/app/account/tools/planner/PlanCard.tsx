"use client";

import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent, MouseEvent } from "react";
import type { Plan } from "@/app/api/user/plans/route";
import { formatCurrency } from "@/lib/currencyUtils";
import {
  formatPlanDateRange,
  isPlanCompleted,
  monthlySetAside,
  todayISO,
} from "./planList";

export function PlanCard({
  plan,
  onSelect,
  onDelete,
  onEdit,
  onMarkComplete,
  onUndoComplete,
  today = todayISO(),
}: {
  plan: Plan;
  onSelect: () => void;
  onDelete: () => void;
  onEdit?: () => void;
  onMarkComplete?: () => void;
  onUndoComplete?: () => void;
  today?: string;
}) {
  const spent =
    plan.linkedTransactions.reduce((sum, tx) => sum + tx.amount, 0) +
    plan.cashEntries.reduce((sum, entry) => sum + entry.amount, 0);
  const remaining = plan.budget - spent;
  const percentSpent = plan.budget > 0 ? (spent / plan.budget) * 100 : 0;
  const completed = isPlanCompleted(plan);
  const isPast = plan.endDate < today;
  const setAside = monthlySetAside(plan, spent, today);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function onDocClick(e: Event) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    function onKey(e: globalThis.KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

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

  function handleMenuToggle(e: MouseEvent<HTMLButtonElement>) {
    e.stopPropagation();
    setMenuOpen((open) => !open);
  }

  function handleDelete(e: MouseEvent<HTMLButtonElement>) {
    e.stopPropagation();
    setMenuOpen(false);
    onDelete();
  }

  function handleEdit(e: MouseEvent<HTMLButtonElement>) {
    e.stopPropagation();
    setMenuOpen(false);
    onEdit?.();
  }

  function handleUndo(e: MouseEvent<HTMLButtonElement>) {
    e.stopPropagation();
    setMenuOpen(false);
    onUndoComplete?.();
  }

  function handleMarkComplete(e: MouseEvent<HTMLButtonElement>) {
    e.stopPropagation();
    onMarkComplete?.();
  }

  return (
    <div
      onClick={onSelect}
      className={`min-w-0 cursor-pointer rounded-lg border border-gray-200 bg-white p-4 hover:border-gray-300 ${
        menuOpen ? "relative z-30" : ""
      }`}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <button
              type="button"
              onClick={handleTitleClick}
              onKeyDown={handleTitleKeyDown}
              className="min-w-0 text-left hover:text-purple-600"
            >
              <h3 className="break-words font-semibold text-gray-900">{plan.name}</h3>
            </button>
            {completed && (
              <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-500">
                Completed
              </span>
            )}
          </div>
          <p className="mt-0.5 break-words text-xs text-gray-500 sm:text-sm">
            {formatPlanDateRange(plan.startDate, plan.endDate)}
          </p>
        </div>

        <div className="shrink-0 pt-0.5 text-right">
          <p className="whitespace-nowrap text-xs tabular-nums text-gray-700 sm:text-sm">
            {formatCurrency(spent, "CAD")} of {formatCurrency(plan.budget, "CAD")}
          </p>
          <p
            className={`mt-0.5 whitespace-nowrap text-xs font-medium sm:text-sm ${
              remaining >= 0 ? "text-green-600" : "text-red-600"
            }`}
          >
            {remaining >= 0 ? "Under" : "Over"} {formatCurrency(Math.abs(remaining), "CAD")}
          </p>
        </div>

        <div ref={menuRef} className="relative shrink-0">
          <button
            type="button"
            aria-label="More actions"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={handleMenuToggle}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            ⋮
          </button>
          {menuOpen && (
            <div
              role="menu"
              onClick={(e) => e.stopPropagation()}
              className="absolute right-0 z-20 mt-1 w-36 rounded-lg border border-gray-200 bg-white py-1 shadow-lg"
            >
              {onEdit && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={handleEdit}
                  className="block w-full px-3 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-50"
                >
                  Edit
                </button>
              )}
              {completed && onUndoComplete && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={handleUndo}
                  className="block w-full px-3 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-50"
                >
                  Undo
                </button>
              )}
              <button
                type="button"
                role="menuitem"
                onClick={handleDelete}
                className="block w-full px-3 py-1.5 text-left text-sm text-red-600 hover:bg-red-50"
              >
                Delete
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-gray-200">
        <div
          className={`h-full transition-all ${
            percentSpent > 100 ? "bg-red-500" : percentSpent > 80 ? "bg-yellow-500" : "bg-green-500"
          }`}
          style={{ width: `${Math.min(percentSpent, 100)}%` }}
        />
      </div>

      {setAside != null && (
        <p className="mt-2 text-xs text-gray-500">
          Set aside {formatCurrency(setAside, "CAD")}/mo to be ready
        </p>
      )}

      {isPast && !completed && onMarkComplete && (
        <button
          type="button"
          onClick={handleMarkComplete}
          className="mt-2 text-sm font-medium text-purple-600 hover:text-purple-700"
        >
          Mark complete
        </button>
      )}
    </div>
  );
}
