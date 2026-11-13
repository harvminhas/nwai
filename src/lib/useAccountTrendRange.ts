"use client";

import { useEffect, useState } from "react";
import { isTrendRangeKey, type TrendRangeKey } from "./trendRange";

/** Shared 6M/YTD/1Y/3Y/All for Performance and What changed. Kept in the URL as `range`. */
export function useAccountTrendRange(searchParams: { get: (key: string) => string | null }) {
  const [range, setRange] = useState<TrendRangeKey>("1Y");

  useEffect(() => {
    const rangeParam = searchParams.get("range");
    if (isTrendRangeKey(rangeParam)) setRange(rangeParam);
  }, [searchParams]);

  const handleRangeChange = (next: TrendRangeKey) => {
    setRange(next);
    const url = new URL(window.location.href);
    url.searchParams.set("range", next);
    window.history.pushState({}, "", url);
  };

  return { range, handleRangeChange };
}
