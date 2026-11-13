"use client";

import { useMemo, useState } from "react";
import { IntactAmount } from "@/components/IntactAmount";
import { TrendRangeSelector } from "@/components/CategoryTrendCards";
import { formatCurrency } from "@/lib/currencyUtils";
import {
  buildWhatChanged,
  type WaterfallRow,
  type WhatChangedModel,
} from "@/lib/whatChanged";
import type { CategoryTrendKind, CategoryTrendMonth, CategoryTrendTxn } from "@/lib/categoryTrends";
import { priorMonthBeforeRange, sliceMonthsByTrendRange, type TrendRangeKey } from "@/lib/trendRange";
import type { ManualAsset } from "@/lib/types";

function signedAmount(amount: number, currency: string): string {
  const abs = formatCurrency(Math.abs(amount), currency);
  if (amount > 0.5) return `+${abs}`;
  if (amount < -0.5) return `−${abs}`;
  return abs;
}

function amountClass(row: WaterfallRow): string {
  if (row.kind !== "driver") return "text-gray-900";
  if (row.tone === "up") return "text-green-700";
  if (row.tone === "down") return "text-red-700";
  return "text-gray-700";
}

function barClass(row: WaterfallRow): string {
  if (row.tone === "up") return "bg-green-500";
  if (row.tone === "down") return "bg-red-400";
  return "bg-gray-400";
}

function WaterfallList({ model }: { model: WhatChangedModel }) {
  return (
    <div className="rounded-lg border border-gray-200 p-4 space-y-3">
      <h2 className="text-lg font-semibold text-gray-900">{model.title}</h2>
      <p className="text-sm text-gray-600 break-words">{model.summary}</p>
      <div className="space-y-2.5 pt-1">
        {model.rows.map((row) => (
          <div
            key={row.key}
            className={row.kind === "end" ? "border-t border-gray-100 pt-2.5" : undefined}
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="min-w-0 break-words text-sm text-gray-800">
                {row.label}
                {row.badge === "Manual" && (
                  <span className="ml-1.5 inline-block rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-gray-600">
                    Manual
                  </span>
                )}
              </span>
              <IntactAmount
                className={`shrink-0 tabular-nums text-sm ${
                  row.kind === "start" || row.kind === "end" ? "font-semibold" : "font-medium"
                } ${amountClass(row)}`}
              >
                {row.kind === "driver"
                  ? signedAmount(row.amount, model.currency)
                  : formatCurrency(row.amount, model.currency)}
              </IntactAmount>
            </div>
            {row.barPct != null && (
              <div className="mt-1 h-1.5 w-full rounded-full bg-gray-100">
                <div
                  className={`h-1.5 rounded-full ${barClass(row)}`}
                  style={{ width: `${Math.min(100, row.barPct)}%` }}
                />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export function WhatChangedPanel({
  kind,
  months,
  expenseTxns,
  incomeTxns,
  currency,
  manualAssets,
  range: rangeProp,
  onRangeChange,
}: {
  kind: CategoryTrendKind;
  months: CategoryTrendMonth[];
  expenseTxns: CategoryTrendTxn[];
  incomeTxns: CategoryTrendTxn[];
  currency: string;
  manualAssets?: ManualAsset[];
  range?: TrendRangeKey;
  onRangeChange?: (range: TrendRangeKey) => void;
}) {
  const [innerRange, setInnerRange] = useState<TrendRangeKey>("1Y");
  const range = rangeProp ?? innerRange;
  const setRange = (next: TrendRangeKey) => {
    setInnerRange(next);
    onRangeChange?.(next);
  };
  const sortedHistory = useMemo(
    () => [...months].sort((a, b) => a.month.localeCompare(b.month)),
    [months],
  );
  const rangedHistory = useMemo(
    () => sliceMonthsByTrendRange(sortedHistory, range),
    [sortedHistory, range],
  );
  const priorMonth = useMemo(
    () => priorMonthBeforeRange(sortedHistory, rangedHistory),
    [sortedHistory, rangedHistory],
  );
  const model = useMemo(
    () =>
      buildWhatChanged({
        kind,
        months: rangedHistory,
        priorMonth,
        expenseTxns,
        incomeTxns,
        currency,
        range,
        manualAssets,
      }),
    [kind, rangedHistory, priorMonth, expenseTxns, incomeTxns, currency, range, manualAssets],
  );

  if (months.length === 0 || !model) {
    return (
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-8 text-center">
        <p className="text-gray-600">No historical data available yet.</p>
        <p className="text-sm text-gray-500 mt-2">
          Upload more statements to see what changed.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <TrendRangeSelector value={range} onChange={setRange} />
      <p className="text-sm text-gray-500">{model.header}</p>
      <WaterfallList model={model} />
    </div>
  );
}
