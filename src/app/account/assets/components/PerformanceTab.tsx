"use client";

import { CategoryPerformancePanel } from "@/components/CategoryTrendCards";
import type { AssetsSummary } from "@/lib/assetsSummary";
import type { TrendRangeKey } from "@/lib/trendRange";

interface PerformanceTabProps {
  summary: AssetsSummary;
  range?: TrendRangeKey;
  onRangeChange?: (range: TrendRangeKey) => void;
}

export function PerformanceTab({ summary, range, onRangeChange }: PerformanceTabProps) {
  return (
    <CategoryPerformancePanel
      kind="asset"
      months={summary.allMonthlyHistory ?? summary.monthlyHistory}
      expenseTxns={summary.expenseTxns}
      incomeTxns={summary.incomeTxns}
      currency={summary.currency}
      manualAssets={summary.groups.flatMap((g) => g.manualAssets)}
      range={range}
      onRangeChange={onRangeChange}
    />
  );
}
