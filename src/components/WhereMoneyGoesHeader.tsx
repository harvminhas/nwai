"use client";

import { RangeSwitch } from "@/components/RangeSwitch";
import { MonthDropdown } from "@/components/MonthDropdown";
import type { TimeRange } from "@/lib/rangeUtils";
import type { SelectableMonth } from "@/lib/rangeUtils";

export const MONEY_GOES_HEADER_CLASS =
  "mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between";
export const MONEY_GOES_CONTROLS_CLASS =
  "flex min-w-0 flex-wrap items-center gap-2 lg:flex-nowrap";

interface WhereMoneyGoesHeaderProps {
  hasMissingStatements: boolean;
  onOpenMissingStatements: () => void;
  range: TimeRange;
  onRangeChange: (range: TimeRange) => void;
  selectableMonths: SelectableMonth[];
}

/**
 * "Where Your Money Goes" heading + range controls.
 * Phone: title on its own row; 3mo/12mo/This year and month selector on the next.
 * Desktop (>=1024): original single row, title left, controls right.
 */
export function WhereMoneyGoesHeader({
  hasMissingStatements,
  onOpenMissingStatements,
  range,
  onRangeChange,
  selectableMonths,
}: WhereMoneyGoesHeaderProps) {
  return (
    <div className={MONEY_GOES_HEADER_CLASS}>
      <div className="flex min-w-0 items-center gap-2">
        <h2 className="text-lg font-semibold text-gray-900">Where Your Money Goes</h2>
        {hasMissingStatements && (
          <button
            type="button"
            onClick={onOpenMissingStatements}
            className="text-amber-600 hover:text-amber-700 transition-colors"
            title="Statements missing for this period"
            aria-label="View missing statements"
          >
            <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        )}
      </div>
      <div className={MONEY_GOES_CONTROLS_CLASS}>
        <RangeSwitch value={range} onChange={onRangeChange} />
        <MonthDropdown
          months={selectableMonths}
          selectedMonth={range.startsWith("month:") ? range.substring(6) : null}
          onChange={onRangeChange}
        />
      </div>
    </div>
  );
}
