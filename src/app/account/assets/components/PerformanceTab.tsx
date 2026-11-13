"use client";

import { CategoryPerformancePanel } from "@/components/CategoryTrendCards";
import type { AssetsSummary } from "@/lib/assetsSummary";

interface PerformanceTabProps {
  summary: AssetsSummary;
}

export function PerformanceTab({ summary }: PerformanceTabProps) {
  return (
    <CategoryPerformancePanel
      kind="asset"
      months={summary.allMonthlyHistory ?? summary.monthlyHistory}
      expenseTxns={summary.expenseTxns}
      incomeTxns={summary.incomeTxns}
      currency={summary.currency}
      manualAssets={summary.groups.flatMap((g) => g.manualAssets)}
    />
  );
}
