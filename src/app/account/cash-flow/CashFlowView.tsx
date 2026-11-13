"use client";

import { IntactAmount } from "@/components/IntactAmount";
import { TrendRangeSelector } from "@/components/CategoryTrendCards";
import { monthFromChartInteraction } from "@/lib/chartMonthClick";
import { calculateBalanceChartDomain, formatChartAxisValue } from "@/lib/chartDomain";
import {
  CANONICAL_CHART_HEIGHT,
  CANONICAL_CHART_MARGIN,
  CANONICAL_GRID_CONFIG,
  CANONICAL_XAXIS_CONFIG,
  CANONICAL_YAXIS_CONFIG,
} from "@/lib/canonicalChartConfig";
import {
  CASH_FLOW_TRANSFER_NOTE,
  formatCashFlowMonthLabel,
  type CashFlowCategory,
  type CashFlowSelectedView,
  type CashFlowSource,
} from "@/lib/cashFlowSummary";
import { getSignColor } from "@/lib/colorHelpers";
import { formatCurrency, getCurrencySymbol } from "@/lib/currencyUtils";
import { useLgUp } from "@/lib/useLgUp";
import type { TrendRangeKey } from "@/lib/trendRange";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  CASH_FLOW_CARD_CLASS,
  CASH_FLOW_GLANCE_LEGEND_CLASS,
  CASH_FLOW_HEADER_CLASS,
  CASH_FLOW_METRIC_CARD_CLASS,
  CASH_FLOW_METRIC_LABEL_CLASS,
  CASH_FLOW_METRIC_VALUE_CLASS,
  CASH_FLOW_METRICS_GRID_CLASS,
  CASH_FLOW_NOTE_CLASS,
  CASH_FLOW_PAGE_CLASS,
  CASH_FLOW_PILL_CLASS,
  CASH_FLOW_RATE_SENTENCE_CLASS,
  CASH_FLOW_ROW_AMOUNT_CLASS,
  CASH_FLOW_ROW_CLASS,
  CASH_FLOW_ROW_NAME_CLASS,
  CASH_FLOW_SECTION_GRID_CLASS,
} from "./cashFlowReadLayout";

const MONEY_IN_COLOR = "#10b981";
const MONEY_OUT_COLOR = "#f43f5e";
const LEFTOVER_COLOR = "#2563eb";

type ChartPoint = {
  month: string;
  yearMonth: string;
  label: string;
  moneyIn: number;
  moneyOut: number;
  leftover: number;
};

export function CashFlowView({
  currency,
  view,
  range,
  onRangeChange,
  onSelectMonth,
}: {
  currency: string;
  view: CashFlowSelectedView;
  range: TrendRangeKey;
  onRangeChange: (range: TrendRangeKey) => void;
  onSelectMonth: (yearMonth: string) => void;
}) {
  const isLgUp = useLgUp();
  const selectedYm = view.selected?.yearMonth ?? null;
  const longRange = view.visibleMonths.length > 12;
  const chartData: ChartPoint[] = view.visibleMonths.map((m) => ({
    month: m.yearMonth,
    yearMonth: m.yearMonth,
    label: formatCashFlowMonthLabel(m.yearMonth, { short: !longRange }),
    moneyIn: m.moneyIn,
    moneyOut: m.moneyOut,
    leftover: m.leftover,
  }));

  const domain = calculateBalanceChartDomain(
    chartData.flatMap((d) => [d.moneyIn, d.moneyOut, d.leftover]),
  );

  const money = (amount: number) => formatCurrency(amount, currency, undefined, true);

  return (
    <div className={CASH_FLOW_PAGE_CLASS}>
      <div className={CASH_FLOW_HEADER_CLASS}>
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-gray-900 lg:text-3xl">Cash flow</h1>
          <p className="mt-1 break-words text-sm text-gray-500">
            {view.selected
              ? formatCashFlowMonthLabel(view.selected.yearMonth)
              : "Money in, money out, and what is left"}
          </p>
        </div>
        <TrendRangeSelector value={range} onChange={onRangeChange} />
      </div>

      <div className={CASH_FLOW_METRICS_GRID_CLASS}>
        <MetricCard label="Money in" value={money(view.selected?.moneyIn ?? 0)} />
        <MetricCard label="Money out" value={money(view.selected?.moneyOut ?? 0)} />
        <MetricCard
          label="Left over"
          value={money(view.selected?.leftover ?? 0)}
          valueClass={getSignColor(view.selected?.leftover ?? 0)}
        />
        <div className={CASH_FLOW_METRIC_CARD_CLASS}>
          <p className={CASH_FLOW_METRIC_LABEL_CLASS}>Saved</p>
          <p className={CASH_FLOW_RATE_SENTENCE_CLASS}>
            {view.savingsRateSentence ?? "No earnings this month to measure from"}
          </p>
        </div>
      </div>

      <div className={CASH_FLOW_CARD_CLASS}>
        <h2 className="mb-1 text-lg font-semibold text-gray-900">Month by month</h2>
        <p className={`${CASH_FLOW_NOTE_CLASS} mb-4`}>Tap a month to see the details below.</p>
        {chartData.length === 0 ? (
          <p className="text-sm text-gray-500">No months in this range yet.</p>
        ) : (
          <div className="relative" style={{ height: isLgUp ? CANONICAL_CHART_HEIGHT : 260 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={chartData}
                margin={CANONICAL_CHART_MARGIN}
                onClick={(state, event) => {
                  const ym = monthFromChartInteraction(state, event, chartData);
                  if (ym) onSelectMonth(ym);
                }}
              >
                <CartesianGrid {...CANONICAL_GRID_CONFIG} />
                <XAxis
                  dataKey="yearMonth"
                  {...CANONICAL_XAXIS_CONFIG}
                  interval={longRange ? "preserveStartEnd" : 0}
                  tickFormatter={(ym: string) =>
                    formatCashFlowMonthLabel(ym, { short: !longRange })
                  }
                />
                <YAxis
                  domain={[domain.min, domain.max]}
                  {...CANONICAL_YAXIS_CONFIG}
                  {...(!isLgUp ? { tickCount: 4, width: 56, interval: 0 } : {})}
                  tickFormatter={(value: number) =>
                    isLgUp
                      ? formatAxis(value, currency)
                      : formatChartAxisValue(value, getCurrencySymbol(currency), {
                          precision: "distinct",
                          domain,
                        })
                  }
                />
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.[0]) return null;
                    const row = payload[0].payload as ChartPoint;
                    return (
                      <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 shadow-lg">
                        <p className="mb-1 text-xs font-semibold text-gray-900">
                          {formatCashFlowMonthLabel(row.yearMonth)}
                        </p>
                        <p className="text-xs" style={{ color: MONEY_IN_COLOR }}>
                          Money in {money(row.moneyIn)}
                        </p>
                        <p className="text-xs" style={{ color: MONEY_OUT_COLOR }}>
                          Money out {money(row.moneyOut)}
                        </p>
                        <p className="text-xs" style={{ color: LEFTOVER_COLOR }}>
                          Left over {money(row.leftover)}
                        </p>
                      </div>
                    );
                  }}
                />
                <Legend
                  wrapperStyle={{ fontSize: 12 }}
                  formatter={(value) =>
                    value === "moneyIn" ? "Money in" : value === "moneyOut" ? "Money out" : "Left over"
                  }
                />
                <Bar
                  dataKey="moneyIn"
                  fill={MONEY_IN_COLOR}
                  radius={[4, 4, 0, 0]}
                  maxBarSize={28}
                  onClick={(d: { payload?: ChartPoint }) => {
                    if (d?.payload?.yearMonth) onSelectMonth(d.payload.yearMonth);
                  }}
                />
                <Bar
                  dataKey="moneyOut"
                  fill={MONEY_OUT_COLOR}
                  radius={[4, 4, 0, 0]}
                  maxBarSize={28}
                  onClick={(d: { payload?: ChartPoint }) => {
                    if (d?.payload?.yearMonth) onSelectMonth(d.payload.yearMonth);
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="leftover"
                  stroke={LEFTOVER_COLOR}
                  strokeWidth={2}
                  dot={(props: {
                    cx?: number;
                    cy?: number;
                    payload?: ChartPoint;
                  }) => {
                    const ym = props.payload?.yearMonth;
                    const selected = ym === selectedYm;
                    return (
                      <circle
                        cx={props.cx}
                        cy={props.cy}
                        r={selected ? 6 : 4}
                        fill={selected ? "#1d4ed8" : LEFTOVER_COLOR}
                        stroke="#fff"
                        strokeWidth={selected ? 3 : 2}
                        data-month={ym}
                        style={{ cursor: "pointer" }}
                      />
                    );
                  }}
                  activeDot={{ r: 6, fill: "#1d4ed8", stroke: "#fff", strokeWidth: 2 }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <div className={CASH_FLOW_CARD_CLASS}>
        <p className="break-words text-sm text-gray-700">{view.summarySentence}</p>
        <p className={`${CASH_FLOW_NOTE_CLASS} mt-2`}>{CASH_FLOW_TRANSFER_NOTE}</p>
      </div>

      <div className={CASH_FLOW_SECTION_GRID_CLASS}>
        <div className={CASH_FLOW_CARD_CLASS}>
          <h2 className="mb-3 text-lg font-semibold text-gray-900">Where it went</h2>
          {view.categories.length === 0 ? (
            <p className={CASH_FLOW_NOTE_CLASS}>
              No spending categories for this month. Transfers and credit card payments are left out.
            </p>
          ) : (
            <ul>
              {view.categories.map((cat) => (
                <CategoryRow key={cat.name} category={cat} currency={currency} />
              ))}
            </ul>
          )}
        </div>
        <div className={CASH_FLOW_CARD_CLASS}>
          <h2 className="mb-3 text-lg font-semibold text-gray-900">Where it came from</h2>
          {view.sources.length === 0 ? (
            <p className={CASH_FLOW_NOTE_CLASS}>No earnings recorded for this month.</p>
          ) : (
            <ul>
              {view.sources.map((src) => (
                <SourceRow key={src.name} source={src} currency={currency} />
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className={CASH_FLOW_CARD_CLASS}>
        <h2 className="mb-1 text-lg font-semibold text-gray-900">Month at a glance</h2>
        <p className={`${CASH_FLOW_NOTE_CLASS} mb-4`}>
          How money in for this month split across spending and what was left over.
        </p>
        {view.glance.length === 0 ? (
          <p className={CASH_FLOW_NOTE_CLASS}>Nothing to split for this month.</p>
        ) : (
          <>
            <div className="flex h-3 overflow-hidden rounded-full bg-gray-100">
              {view.glance
                .filter((seg) => seg.amount > 0)
                .map((seg) => (
                <div
                  key={seg.name}
                  className="h-full min-w-[3px]"
                  style={{
                    width: `${Math.max(seg.share * 100, 0)}%`,
                    backgroundColor: seg.color,
                  }}
                  title={`${seg.name} ${money(seg.amount)}`}
                />
              ))}
            </div>
            <ul className={CASH_FLOW_GLANCE_LEGEND_CLASS}>
              {view.glance.map((seg) => (
                <li key={seg.name} className={CASH_FLOW_ROW_CLASS}>
                  <span
                    className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: seg.color }}
                  />
                  <span className={CASH_FLOW_ROW_NAME_CLASS}>
                    {seg.isLeftover ? "Left over" : seg.name}
                  </span>
                  <IntactAmount className={CASH_FLOW_ROW_AMOUNT_CLASS}>
                    {money(seg.amount)}
                  </IntactAmount>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  valueClass = "text-gray-900",
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className={CASH_FLOW_METRIC_CARD_CLASS}>
      <p className={CASH_FLOW_METRIC_LABEL_CLASS}>{label}</p>
      <IntactAmount className={`${CASH_FLOW_METRIC_VALUE_CLASS} ${valueClass}`}>
        {value}
      </IntactAmount>
    </div>
  );
}

function CategoryRow({
  category,
  currency,
}: {
  category: CashFlowCategory;
  currency: string;
}) {
  const pill = vsAvgPill(category.vsAvgPct);
  return (
    <li className={CASH_FLOW_ROW_CLASS}>
      <span
        className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full"
        style={{ backgroundColor: category.color }}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-3">
          <p className={CASH_FLOW_ROW_NAME_CLASS}>{category.name}</p>
          <IntactAmount className={CASH_FLOW_ROW_AMOUNT_CLASS}>
            {formatCurrency(category.amount, currency, undefined, true)}
          </IntactAmount>
        </div>
        {pill && (
          <span className={`${CASH_FLOW_PILL_CLASS} ${pill.className}`}>{pill.label}</span>
        )}
      </div>
    </li>
  );
}

function SourceRow({
  source,
  currency,
}: {
  source: CashFlowSource;
  currency: string;
}) {
  return (
    <li className={CASH_FLOW_ROW_CLASS}>
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className={CASH_FLOW_ROW_NAME_CLASS}>{source.name}</p>
            {source.accountLabel ? (
              <p className="mt-0.5 break-words text-xs text-gray-500">{source.accountLabel}</p>
            ) : null}
          </div>
          <IntactAmount className={CASH_FLOW_ROW_AMOUNT_CLASS}>
            {formatCurrency(source.amount, currency, undefined, true)}
          </IntactAmount>
        </div>
      </div>
    </li>
  );
}

function vsAvgPill(vsAvgPct: number | null): { label: string; className: string } | null {
  if (vsAvgPct === null || !Number.isFinite(vsAvgPct)) return null;
  const rounded = Math.round(vsAvgPct);
  if (rounded === 0) {
    return { label: "About average", className: "bg-gray-100 text-gray-600" };
  }
  if (rounded > 0) {
    return { label: `+${rounded}% vs avg`, className: "bg-red-50 text-red-700" };
  }
  return { label: `${rounded}% vs avg`, className: "bg-green-50 text-green-700" };
}

function formatAxis(value: number, currency: string): string {
  const sym = getCurrencySymbol(currency);
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}${sym}${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}${sym}${Math.round(abs / 1_000)}k`;
  return `${sign}${sym}${Math.round(abs)}`;
}
