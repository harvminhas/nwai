export const TREND_RANGES = ["6M", "YTD", "1Y", "3Y", "All"] as const;
export type TrendRangeKey = (typeof TREND_RANGES)[number];

export function sliceMonthsByTrendRange<T extends { month: string }>(
  months: T[],
  range: TrendRangeKey,
): T[] {
  const sorted = [...months].sort((a, b) => a.month.localeCompare(b.month));
  if (sorted.length === 0) return [];
  if (range === "All") return sorted;
  const endYm = sorted[sorted.length - 1].month;
  if (range === "YTD") {
    const year = endYm.slice(0, 4);
    return sorted.filter((m) => m.month.startsWith(`${year}-`));
  }
  const n = range === "6M" ? 6 : range === "1Y" ? 12 : 36;
  return sorted.slice(-n);
}

/** Ending snapshot of the month immediately before `ranged[0]`, if history has one. */
export function priorMonthBeforeRange<T extends { month: string }>(
  allMonths: T[],
  ranged: T[],
): T | null {
  if (ranged.length === 0) return null;
  const sorted = [...allMonths].sort((a, b) => a.month.localeCompare(b.month));
  const idx = sorted.findIndex((m) => m.month === ranged[0].month);
  return idx > 0 ? sorted[idx - 1] : null;
}
