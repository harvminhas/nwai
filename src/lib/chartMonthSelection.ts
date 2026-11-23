/**
 * Visible-window helpers for the account Balance Over Time chart.
 * Range (3M/6M/All) only slices which points are drawn; it does not aggregate
 * Paid / New charges. If the selected month is no longer visible, snap back
 * to the most recent selectable (non-estimated) month in the new window.
 */

export type ChartMonthPoint = {
  yearMonth: string;
  isEstimate?: boolean;
  /** Current calendar month with data — selectable, labelled In progress. */
  isInProgress?: boolean;
};

export function sliceHistoryByRange<T>(history: T[], rangeMonths: number): T[] {
  if (rangeMonths === 0) return history;
  return history.slice(-rangeMonths);
}

/** Most recent selectable month: in-progress current month, else a real (non-estimated) month. */
export function latestSelectableMonth(visible: ChartMonthPoint[]): string | null {
  for (let i = visible.length - 1; i >= 0; i--) {
    if (visible[i].isInProgress) return visible[i].yearMonth;
    if (!visible[i].isEstimate) return visible[i].yearMonth;
  }
  return visible[visible.length - 1]?.yearMonth ?? null;
}

/**
 * Keep the current selection when it is still in the visible window;
 * otherwise the most recent month in that window.
 */
export function selectionAfterRangeChange(
  selectedYm: string | null,
  visible: ChartMonthPoint[],
): string | null {
  if (selectedYm && visible.some((p) => p.yearMonth === selectedYm)) return selectedYm;
  return latestSelectableMonth(visible);
}
