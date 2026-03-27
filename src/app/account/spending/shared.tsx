"use client";

import { useEffect, useState, useRef } from "react";
import { createPortal } from "react-dom";

// ── Category colors & helpers ─────────────────────────────────────────────────

export const CATEGORY_COLORS: Record<string, string> = {
  housing: "#3b82f6",
  groceries: "#22c55e",
  dining: "#fb923c",
  transportation: "#f59e0b",
  shopping: "#a855f7",
  entertainment: "#ec4899",
  subscriptions: "#94a3b8",
  healthcare: "#14b8a6",
  fees: "#f97316",
  "debt payments": "#ef4444",
  "investments & savings": "#10b981",
  "transfers": "#06b6d4",
  "transfers & payments": "#06b6d4", // legacy
  "cash & atm": "#f87171",
  other: "#d1d5db",
};

export function categoryColor(name: string): string {
  return CATEGORY_COLORS[name.toLowerCase()] ?? "#a855f7";
}

export const ALL_CATEGORIES = [
  "Housing",
  "Groceries",
  "Dining",
  "Transportation",
  "Shopping",
  "Entertainment",
  "Healthcare",
  "Subscriptions",
  "Fees",
  "Debt Payments",
  "Investments & Savings",
  "Transfers",
  "Transfers & Payments", // legacy — old statements
  "Cash & ATM",
  "Other",
] as const;

export type CashFrequency = "weekly" | "biweekly" | "monthly" | "quarterly" | "annual" | "once";

// ── RecurringIcon ─────────────────────────────────────────────────────────────

export function RecurringIcon({ active }: { active: boolean }) {
  return (
    <svg className={`h-3.5 w-3.5 ${active ? "text-purple-600" : "text-gray-300"}`}
      fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round"
        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
  );
}

// ── CategoryPicker (portal, fixed-position) ───────────────────────────────────

interface CategoryPickerProps {
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  current: string;
  onSelect: (cat: string) => void;
  onClose: () => void;
}

export function CategoryPicker({ anchorRef, current, onSelect, onClose }: CategoryPickerProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<React.CSSProperties>({ visibility: "hidden" });

  useEffect(() => {
    if (!anchorRef.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    const menuHeight = 340;
    const spaceBelow = window.innerHeight - rect.bottom;
    const top = spaceBelow >= menuHeight ? rect.bottom + 6 : rect.top - menuHeight - 6;
    setStyle({
      position: "fixed", top,
      left: Math.min(rect.left, window.innerWidth - 216),
      width: 208, zIndex: 9999, visibility: "visible",
    });
  }, [anchorRef]);

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (
        menuRef.current && !menuRef.current.contains(e.target as Node) &&
        anchorRef.current && !anchorRef.current.contains(e.target as Node)
      ) onClose();
    }
    function onScroll() { onClose(); }
    document.addEventListener("mousedown", handle);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", handle);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [onClose, anchorRef]);

  return createPortal(
    <div ref={menuRef} style={style}
      className="rounded-xl border border-gray-200 bg-white py-1 shadow-xl ring-1 ring-black/5">
      <p className="px-3 pb-1.5 pt-2 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
        Change category · saves as rule
      </p>
      {ALL_CATEGORIES.map((cat) => {
        const color = categoryColor(cat.toLowerCase());
        const isActive = cat.toLowerCase() === current.toLowerCase();
        return (
          <button key={cat} onClick={() => onSelect(cat)}
            className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition hover:bg-gray-50 ${
              isActive ? "font-semibold text-gray-900" : "text-gray-700"
            }`}>
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
            {cat}
            {isActive && <span className="ml-auto text-xs text-gray-400">current</span>}
          </button>
        );
      })}
    </div>,
    document.body
  );
}
