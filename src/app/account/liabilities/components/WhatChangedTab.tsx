"use client";

import { WhatChangedPanel } from "@/components/WhatChangedPanel";
import type { DebtsSummary } from "@/lib/debtsSummary";

interface WhatChangedTabProps {
  summary: DebtsSummary;
}

export function WhatChangedTab({ summary }: WhatChangedTabProps) {
  return (
    <WhatChangedPanel
      kind="debt"
      months={summary.allMonthlyHistory ?? summary.monthlyHistory}
      expenseTxns={summary.expenseTxns}
      incomeTxns={summary.incomeTxns}
      currency={summary.currency}
    />
  );
}
