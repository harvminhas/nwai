"use client";

import { CategoryPerformancePanel } from "@/components/CategoryTrendCards";
import type { DebtsSummary } from "@/lib/debtsSummary";

interface PerformanceTabProps {
  summary: DebtsSummary;
}

export function PerformanceTab({ summary }: PerformanceTabProps) {
  return (
    <CategoryPerformancePanel
      kind="debt"
      months={summary.allMonthlyHistory ?? summary.monthlyHistory}
      expenseTxns={summary.expenseTxns}
      incomeTxns={summary.incomeTxns}
      currency={summary.currency}
    />
  );
}
