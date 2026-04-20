"use client";

import { useEffect, useState, useRef } from "react";
import { createPortal } from "react-dom";
import {
  CATEGORY_COLORS,
  categoryColor,
  CATEGORY_TAXONOMY,
  PARENT_CATEGORIES,
  PICKER_CATEGORIES,
  getParentCategory,
  isSubtype,
  PARENTS_WITH_SUBTYPES,
} from "@/lib/categoryTaxonomy";

// Re-export from taxonomy so existing imports keep working
export { CATEGORY_COLORS, categoryColor } from "@/lib/categoryTaxonomy";
export { getParentCategory, isSubtype } from "@/lib/categoryTaxonomy";

export type CashFrequency = "weekly" | "biweekly" | "monthly" | "quarterly" | "annual" | "once";

// Legacy ALL_CATEGORIES — kept for backwards compat. Use PICKER_CATEGORIES for new code.
export const ALL_CATEGORIES = [
  ...PARENT_CATEGORIES,
  // Income re-assignment
  "Income - Salary",
  "Income - Other",
] as const;

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

// ── CategoryPicker (portal, fixed-position, two-level accordion) ──────────────

interface CategoryPickerProps {
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  current: string;
  onSelect: (cat: string) => void;
  onClose: () => void;
}

export function CategoryPicker({ anchorRef, current, onSelect, onClose }: CategoryPickerProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<React.CSSProperties>({ visibility: "hidden" });

  // All parents collapsed by default; only pre-expand the current selection's parent
  const currentParent = getParentCategory(current).toLowerCase();
  const currentIsSubtype = current.toLowerCase() !== currentParent;
  const [expanded, setExpanded] = useState<Set<string>>(() =>
    // Only pre-expand if the current value is actually a subtype (not a parent)
    currentIsSubtype ? new Set([currentParent]) : new Set()
  );

  useEffect(() => {
    if (!anchorRef.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    const PADDING = 12;
    const spaceBelow = window.innerHeight - rect.bottom - PADDING;
    const spaceAbove = rect.top - PADDING;
    const openBelow = spaceBelow >= spaceAbove || spaceBelow >= 200;
    const maxHeight = Math.max(openBelow ? spaceBelow : spaceAbove, 160);

    setStyle({
      position: "fixed",
      top: openBelow ? rect.bottom + PADDING : undefined,
      bottom: openBelow ? undefined : window.innerHeight - rect.top + PADDING,
      left: Math.min(rect.left, window.innerWidth - 232),
      width: 224,
      maxHeight,
      zIndex: 9999,
      visibility: "visible",
    });
  }, [anchorRef]);

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (
        menuRef.current && !menuRef.current.contains(e.target as Node) &&
        anchorRef.current && !anchorRef.current.contains(e.target as Node)
      ) onClose();
    }
    function onScroll(e: Event) {
      if (menuRef.current && menuRef.current.contains(e.target as Node)) return;
      onClose();
    }
    document.addEventListener("mousedown", handle);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", handle);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [onClose, anchorRef]);

  const toggleExpand = (parent: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(parent)) next.delete(parent);
      else next.add(parent);
      return next;
    });
  };

  return createPortal(
    <div ref={menuRef} style={style}
      className="rounded-xl border border-gray-200 bg-white shadow-xl ring-1 ring-black/5 flex flex-col overflow-hidden">
      <p className="shrink-0 px-3 pb-1.5 pt-2 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
        Change category · saves as rule
      </p>
      <div className="overflow-y-auto flex-1">
        {/* ── Standard categories (two-level) ── */}
        {(Object.entries(CATEGORY_TAXONOMY) as [string, readonly string[]][]).map(([parent, subtypes]) => {
          const parentLower  = parent.toLowerCase();
          const color        = categoryColor(parentLower);
          const isActivePar  = current.toLowerCase() === parentLower;
          const hasExpanded  = expanded.has(parentLower);
          const hasSubs      = subtypes.length > 0;

          return (
            <div key={parent}>
              {/* Parent row */}
              <div className="flex items-center">
                <button
                  onClick={() => onSelect(parent)}
                  className={`flex flex-1 items-center gap-2.5 px-3 py-2 text-left text-sm transition hover:bg-gray-50 ${
                    isActivePar ? "font-semibold text-gray-900" : "text-gray-700"
                  }`}
                >
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
                  <span className="flex-1">{parent}</span>
                  {isActivePar && <span className="text-xs text-gray-400">current</span>}
                </button>
                {hasSubs && (
                  <button
                    onClick={() => toggleExpand(parentLower)}
                    className="shrink-0 px-2 py-2 text-gray-400 hover:text-gray-600 transition"
                    aria-label={hasExpanded ? "Collapse subtypes" : "Expand subtypes"}
                  >
                    <svg className={`h-3 w-3 transition-transform ${hasExpanded ? "rotate-180" : ""}`}
                      fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                )}
              </div>

              {/* Subtype rows (indented, visible when expanded) */}
              {hasSubs && hasExpanded && (
                <div className="border-l-2 ml-5 border-gray-100">
                  {subtypes.map((sub) => {
                    const subColor   = categoryColor(sub.toLowerCase());
                    const isActiveSub = current.toLowerCase() === sub.toLowerCase();
                    return (
                      <button
                        key={sub}
                        onClick={() => onSelect(sub)}
                        className={`flex w-full items-center gap-2.5 pl-3 pr-3 py-1.5 text-left text-[13px] transition hover:bg-gray-50 ${
                          isActiveSub ? "font-semibold text-gray-900" : "text-gray-600"
                        }`}
                      >
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: subColor }} />
                        <span className="flex-1">{sub}</span>
                        {isActiveSub && <span className="text-xs text-gray-400">current</span>}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}

        {/* ── Income re-assignment section ── */}
        <div className="mx-3 my-1 border-t border-gray-100 pt-1">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-green-600 pb-1">
            Move to Income
          </p>
        </div>
        {(["Income - Salary", "Income - Other"] as const).map((cat) => {
          const isActive = cat.toLowerCase() === current.toLowerCase();
          return (
            <button key={cat} onClick={() => onSelect(cat)}
              className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition hover:bg-gray-50 ${
                isActive ? "font-semibold text-green-700" : "text-green-700"
              }`}>
              <span className="h-2 w-2 shrink-0 rounded-full bg-green-400" />
              <span className="flex-1">{cat}</span>
              {isActive && <span className="text-xs text-gray-400">current</span>}
            </button>
          );
        })}
      </div>
    </div>,
    document.body
  );
}

// Silence unused-import warnings for consumers that import these from here
// (they're re-exported above)
void PARENTS_WITH_SUBTYPES;
void PICKER_CATEGORIES;
void isSubtype;
