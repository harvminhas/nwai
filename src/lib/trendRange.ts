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
