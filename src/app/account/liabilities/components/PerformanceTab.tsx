"use client";

import { CategoryPerformancePanel } from "@/components/CategoryTrendCards";
import type { DebtsSummary } from "@/lib/debtsSummary";
import type { TrendRangeKey } from "@/lib/trendRange";

interface PerformanceTabProps {
  summary: DebtsSummary;
  range?: TrendRangeKey;
  onRangeChange?: (range: TrendRangeKey) => void;
}

export function PerformanceTab({ summary, range, onRangeChange }: PerformanceTabProps) {
  return (
    <CategoryPerformancePanel
      kind="debt"
      months={summary.allMonthlyHistory ?? summary.monthlyHistory}
      expenseTxns={summary.expenseTxns}
      incomeTxns={summary.incomeTxns}
      currency={summary.currency}
      range={range}
      onRangeChange={onRangeChange}
    />
  );
}
