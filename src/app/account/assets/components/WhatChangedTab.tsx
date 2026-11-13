"use client";

import { WhatChangedPanel } from "@/components/WhatChangedPanel";
import type { AssetsSummary } from "@/lib/assetsSummary";

interface WhatChangedTabProps {
  summary: AssetsSummary;
}

export function WhatChangedTab({ summary }: WhatChangedTabProps) {
  return (
    <WhatChangedPanel
      kind="asset"
      months={summary.allMonthlyHistory ?? summary.monthlyHistory}
      expenseTxns={summary.expenseTxns}
      incomeTxns={summary.incomeTxns}
      currency={summary.currency}
      manualAssets={summary.groups.flatMap((g) => g.manualAssets)}
    />
  );
}
