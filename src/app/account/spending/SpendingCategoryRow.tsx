"use client";

import { ResponsiveContainer, ComposedChart, Line } from "recharts";
import { formatCurrency } from "@/lib/currencyUtils";
import { getCanonicalLineColor } from "@/lib/canonicalChartConfig";
import {
  SPENDING_CATEGORY_AMOUNT_CLASS,
  SPENDING_CATEGORY_AMOUNT_COL_CLASS,
  SPENDING_CATEGORY_NAME_CLASS,
  SPENDING_CATEGORY_ROW_CLASS,
  SPENDING_CATEGORY_SPARKLINE_CLASS,
  SPENDING_CATEGORY_TREND_CLASS,
} from "./spendingReadLayout";

export interface SpendingCategoryRowItem {
  name: string;
  slug: string;
  subLabel?: string;
  monthlySeries: { amount: number }[];
  displayShare: number;
  displayTotal: number;
  trend: number;
}

export function SpendingCategoryRow({
  item,
  currency,
  selectedMonth,
  onClick,
}: {
  item: SpendingCategoryRowItem;
  currency: string;
  selectedMonth?: string | null;
  onClick?: () => void;
}) {
  const isOther = item.slug === "other";
  const isDebt = item.slug === "debt";
  const isClickable = !isOther;

  return (
    <div
      className={`${SPENDING_CATEGORY_ROW_CLASS} ${
        isClickable ? "hover:bg-neutral-50 cursor-pointer" : "cursor-default"
      }`}
      onClick={() => isClickable && onClick?.()}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <div className="min-w-0">
            <div className={SPENDING_CATEGORY_NAME_CLASS} title={item.name}>{item.name}</div>
            {item.subLabel && (
              <div className="text-xs text-neutral-500" style={{ fontSize: "12px" }}>
                {item.subLabel}
              </div>
            )}
          </div>
          {!selectedMonth && item.monthlySeries.length > 0 && !isOther && (
            <div className={SPENDING_CATEGORY_SPARKLINE_CLASS} style={{ width: "60px", height: "20px" }}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={item.monthlySeries.map((m) => ({ amount: m.amount }))} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
                  <Line type="monotone" dataKey="amount" stroke={getCanonicalLineColor("spending")} strokeWidth={1} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
        <div className="w-full bg-neutral-100 rounded-full h-1.5 mb-1">
          <div
            className="bg-emerald-500 h-1.5 rounded-full"
            style={{ width: `${Math.min(item.displayShare * 100, 100)}%` }}
          ></div>
        </div>
      </div>

      <div className={SPENDING_CATEGORY_AMOUNT_COL_CLASS}>
        <div className="text-right">
          <div className={SPENDING_CATEGORY_AMOUNT_CLASS}>
            {formatCurrency(item.displayTotal, currency)}
          </div>
          {!selectedMonth && !isDebt && item.trend !== 0 && Math.round(Math.abs(item.trend)) !== 0 && (
            <div className={`${SPENDING_CATEGORY_TREND_CLASS} ${item.trend > 0 ? "text-red-600" : "text-green-600"}`}>
              {item.trend > 0 ? "↑" : "↓"} {formatCurrency(Math.abs(item.trend), currency)}/mo vs avg
            </div>
          )}
          {isDebt && item.subLabel && (
            <div className="whitespace-nowrap text-xs text-neutral-500">
              {item.subLabel}
            </div>
          )}
        </div>

        {isClickable && (
          <svg className="w-5 h-5 shrink-0 text-neutral-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        )}
      </div>
    </div>
  );
}
