"use client";

import { WhatChangedPanel } from "@/components/WhatChangedPanel";
import type { AssetsSummary } from "@/lib/assetsSummary";
import type { TrendRangeKey } from "@/lib/trendRange";

interface WhatChangedTabProps {
  summary: AssetsSummary;
  range?: TrendRangeKey;
  onRangeChange?: (range: TrendRangeKey) => void;
}

export function WhatChangedTab({ summary, range, onRangeChange }: WhatChangedTabProps) {
  return (
    <WhatChangedPanel
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
