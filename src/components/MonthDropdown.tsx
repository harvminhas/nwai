"use client";

import { useState, useRef, useEffect } from "react";
import type { TimeRange } from "@/lib/rangeUtils";
import type { SelectableMonth } from "@/lib/rangeUtils";

interface MonthDropdownProps {
  months: SelectableMonth[];
  selectedMonth: string | null; // null when a range (3mo/12mo/ytd) is selected
  onChange: (range: TimeRange) => void;
}

export function MonthDropdown({ months, selectedMonth, onChange }: MonthDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isOpen]);

  // Find the selected month's label
  const selectedLabel = selectedMonth 
    ? months.find(m => m.yearMonth === selectedMonth)?.label || "Month"
    : "Month";

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`
          inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-lg transition-colors border
          ${selectedMonth 
            ? "bg-white text-gray-900 border-gray-300 shadow-sm" 
            : "bg-gray-100 text-gray-600 border-transparent hover:text-gray-900"
          }
        `}
      >
        {selectedLabel}
        <svg 
          className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none" 
          viewBox="0 0 24 24" 
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-64 bg-white rounded-lg shadow-lg border border-gray-200 py-2 z-50 max-h-80 overflow-y-auto">
          {months.map((month) => (
            <button
              key={month.yearMonth}
              onClick={() => {
                if (month.isComplete) {
                  onChange(`month:${month.yearMonth}`);
                  setIsOpen(false);
                }
              }}
              disabled={!month.isComplete}
              className={`
                w-full px-4 py-2 text-left text-sm transition-colors
                ${month.isComplete
                  ? "hover:bg-gray-50 text-gray-900 cursor-pointer"
                  : "text-gray-400 cursor-not-allowed"
                }
                ${selectedMonth === month.yearMonth ? "bg-purple-50 text-purple-700" : ""}
              `}
            >
              <div className="flex items-start justify-between gap-2">
                <span className={month.isComplete ? "font-medium" : ""}>{month.label}</span>
                {!month.isComplete && (
                  <span className="text-xs text-gray-500 flex-shrink-0">Incomplete</span>
                )}
              </div>
              {!month.isComplete && month.missingAccounts.length > 0 && (
                <div className="mt-1 text-xs text-gray-500">
                  Missing: {month.missingAccounts[0]}
                  {month.missingAccounts.length > 1 && ` +${month.missingAccounts.length - 1} more`}
                </div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
