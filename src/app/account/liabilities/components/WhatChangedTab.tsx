"use client";

import { WhatChangedPanel } from "@/components/WhatChangedPanel";
import type { DebtsSummary } from "@/lib/debtsSummary";
import type { TrendRangeKey } from "@/lib/trendRange";

interface WhatChangedTabProps {
  summary: DebtsSummary;
  range?: TrendRangeKey;
  onRangeChange?: (range: TrendRangeKey) => void;
}

export function WhatChangedTab({ summary, range, onRangeChange }: WhatChangedTabProps) {
  return (
    <WhatChangedPanel
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
