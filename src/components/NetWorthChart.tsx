"use client";

import { ReactNode, useState } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Line,
} from "recharts";
import { calculateBalanceChartDomain } from "@/lib/chartDomain";
import {
  CANONICAL_CHART_MARGIN,
  CANONICAL_GRID_CONFIG,
  CANONICAL_XAXIS_CONFIG,
  CANONICAL_YAXIS_CONFIG,
  CANONICAL_LINE_CONFIG,
  CANONICAL_DOT_CONFIG,
  getCanonicalLineColor,
} from "@/lib/canonicalChartConfig";

function shortMonthLabel(yearMonth: string): string {
  const [y, m] = yearMonth.split("-");
  if (!m) return yearMonth;
  return new Date(parseInt(y, 10), parseInt(m, 10) - 1, 1)
    .toLocaleDateString("en-US", { month: "short", year: "2-digit" });
}

function longMonthLabel(yearMonth: string): string {
  const [y, m] = yearMonth.split("-");
  if (!m) return yearMonth;
  return new Date(parseInt(y, 10), parseInt(m, 10) - 1, 1)
    .toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

function formatCurrencyFor(value: number, ccy: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency: ccy,
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(value);
}

function formatAxisFor(v: number, ccy: string): string {
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  const sym = new Intl.NumberFormat("en-US", { style: "currency", currency: ccy, maximumFractionDigits: 0 })
    .formatToParts(0).find(p => p.type === "currency")?.value ?? "$";
  if (abs >= 1_000_000) return `${sign}${sym}${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}${sym}${Math.round(abs / 1_000)}k`;
  return formatCurrencyFor(abs, ccy);
}

// Each point has a solid value and an optional estimatedNetWorth for dotted rendering
type Point = {
  yearMonth: string;
  label: string;
  netWorth: number;
  totalAssets: number;
  totalDebts: number;
  netWorthSolid: number | null;    // null for estimated points (breaks solid line)
  netWorthDotted: number | null;   // null for real points (breaks dotted line)
  isEstimate: boolean;
};

const RANGES = [
  { label: "3M", months: 3 },
  { label: "6M", months: 6 },
  { label: "All", months: 0 },
];

// Standalone clickable dot component — canonical green emerald, r=6 selected / r=4 ordinary
function ChartDot({
  cx, cy, yearMonth, isVisible, isSelected, opacity,
  onSelect,
}: {
  cx?: number; cy?: number; yearMonth: string;
  isVisible: boolean; isSelected: boolean; opacity?: number;
  onSelect: (ym: string) => void;
}) {
  if (!isVisible || cx == null || cy == null) return <g />;
  return (
    <circle
      cx={cx} cy={cy}
      r={isSelected ? 6 : 4}
      fill={isSelected ? "#059669" : "#10b981"}
      stroke="#fff"
      strokeWidth={isSelected ? 3 : 2}
      fillOpacity={opacity ?? 1}
      style={{ cursor: "pointer", outline: "none" }}
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => { e.stopPropagation(); onSelect(yearMonth); }}
    />
  );
}

export default function NetWorthChart({
  history,
  isDebt = false,
  currency = "USD",
  onPointSelect,
  header,
  showMonthDetail = true,
}: {
  history: { yearMonth: string; netWorth: number; totalAssets?: number; totalDebts?: number; expensesTotal?: number; isEstimate?: boolean }[];
  isDebt?: boolean;
  currency?: string;
  /** Called when a real (non-estimated) month is picked, so a page can load that month. */
  onPointSelect?: (ym: string) => void;
  /** Optional headline block (balance, month, deltas) rendered above the chart. */
  header?: ReactNode;
  /** Show the click-a-point month detail panel. Off where the page has its own header. */
  showMonthDetail?: boolean;
}) {
  const [range, setRange] = useState(3);
  const [selectedYm, setSelectedYm] = useState<string | null>(null);

  // Onboarding: first 3 real months of data — avoid alarming red colours
  const realPoints = history.filter((h) => !h.isEstimate);
  const isOnboarding = realPoints.length <= 3;

  // For debt accounts show absolute (positive) balance values — avoids confusing
  // negative axis labels like "-CA$476k" when the balance is improving.
  const displayValue = (v: number) => isDebt ? Math.abs(v) : v;

  const allPoints: Point[] = history.map(({ yearMonth, netWorth, totalAssets, totalDebts, isEstimate }) => {
    const dv = displayValue(netWorth);
    return {
      yearMonth,
      label: shortMonthLabel(yearMonth),
      netWorth: dv,
      totalAssets: totalAssets ?? 0,
      totalDebts: totalDebts ?? 0,
      netWorthSolid: isEstimate ? null : dv,
      netWorthDotted: isEstimate ? dv : null,
      isEstimate: isEstimate ?? false,
    };
  });

  // Add connector points so solid and dotted lines visually connect at transitions
  const connected = allPoints.map((pt, i) => {
    const prev = allPoints[i - 1];
    const next = allPoints[i + 1];
    let solid = pt.netWorthSolid;
    let dotted = pt.netWorthDotted;

    if (!pt.isEstimate) {
      if (prev?.isEstimate || next?.isEstimate) dotted = pt.netWorth;
    } else {
      if (prev && !prev.isEstimate) solid = pt.netWorth;
      if (next && !next.isEstimate) solid = pt.netWorth;
    }

    return { ...pt, netWorthSolid: solid, netWorthDotted: dotted };
  });  const data = range === 0 ? connected : connected.slice(-range);
  const hasEstimates = data.some((p) => p.isEstimate);
  
  // Calculate adaptive domain for better visibility of changes
  const values = data.map(p => p.netWorth);
  const domain = calculateBalanceChartDomain(values);

  // Month detail for the selected point
  const selIdx   = selectedYm ? data.findIndex((p) => p.yearMonth === selectedYm) : -1;
  const selPt    = selIdx >= 0 ? data[selIdx] : null;
  const prevPt   = selIdx > 0  ? data[selIdx - 1] : null;
  const selDelta = selPt && prevPt ? selPt.netWorth - prevPt.netWorth : null;
  // For debt: absolute value going DOWN is good (paid down). For assets: going UP is good.
  const deltaGood = selDelta !== null ? (isDebt ? selDelta < 0 : selDelta > 0) : null;

  // A jump is "large" when it's >25% of the previous value — likely a new account being added
  const baseline = prevPt ? Math.abs(prevPt.netWorth) || Math.abs(selPt?.netWorth ?? 0) : 0;
  const isLargeJump = selDelta !== null && baseline > 0 && Math.abs(selDelta) / baseline > 0.25;

  function handleSelect(ym: string) {
    setSelectedYm((prev) => prev === ym ? null : ym);
    if (onPointSelect) {
      const pt = data.find((p) => p.yearMonth === ym);
      if (pt && !pt.isEstimate) onPointSelect(ym);
    }
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:p-6">
      {header}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">
            Balance Over Time
          </p>
          {hasEstimates && (
            <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-600">
              ~ some months estimated
            </span>
          )}
        </div>
        <div className="flex gap-1">
          {RANGES.map((r) => (
            <button
              key={r.label}
              onClick={() => setRange(r.months)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                range === r.months
                  ? "bg-purple-100 text-purple-700"
                  : "text-gray-400 hover:text-gray-600"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <div className="h-52 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={CANONICAL_CHART_MARGIN}>
            <defs>
              <linearGradient id="netWorthGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#10b981" stopOpacity={0.15}/>
                <stop offset="95%" stopColor="#10b981" stopOpacity={0.02}/>
              </linearGradient>
            </defs>
            <CartesianGrid {...CANONICAL_GRID_CONFIG} />
            <XAxis
              dataKey="label"
              {...CANONICAL_XAXIS_CONFIG}
            />
            <YAxis
              domain={[domain.min, domain.max]}
              tickFormatter={(v) => formatAxisFor(v, currency)}
              {...CANONICAL_YAXIS_CONFIG}
            />
            <Tooltip
              content={({ active, payload }) => {
                if (active && payload && payload[0]) {
                  const dataPoint = payload[0].payload;
                  return (
                    <div className="bg-white border border-gray-200 rounded-lg shadow-lg px-3 py-2">
                      <p className="text-xs text-gray-600 mb-1">{dataPoint.label}</p>
                      <p className="text-sm font-semibold text-gray-900">
                        {formatCurrencyFor(dataPoint.netWorth, currency)}
                      </p>
                    </div>
                  );
                }
                return null;
              }}
            />
            {/* Gradient area fill */}
            <Area 
              type="monotone" 
              dataKey="netWorth" 
              fill="url(#netWorthGradient)" 
              stroke="none"
            />
            {/* Solid line — real data */}
            <Line
              {...CANONICAL_LINE_CONFIG}
              dataKey="netWorthSolid"
              stroke={getCanonicalLineColor("balance")}
              dot={(props) => {
                const p = props as { cx?: number; cy?: number; payload: Point };
                return (
                  <ChartDot
                    key={`solid-${p.payload.yearMonth}`}
                    cx={p.cx} cy={p.cy}
                    yearMonth={p.payload.yearMonth}
                    isVisible={p.payload.netWorthSolid != null}
                    isSelected={p.payload.yearMonth === selectedYm}
                    onSelect={handleSelect}
                  />
                );
              }}
              name="netWorthSolid"
              connectNulls={false}
            />
            {/* Dotted line — estimated data */}
            <Line
              type="monotone"
              dataKey="netWorthDotted"
              stroke={getCanonicalLineColor("balance")}
              strokeWidth={2}
              strokeDasharray="5 4"
              strokeOpacity={0.45}
              dot={(props) => {
                const p = props as { cx?: number; cy?: number; payload: Point };
                return (
                  <ChartDot
                    key={`dotted-${p.payload.yearMonth}`}
                    cx={p.cx} cy={p.cy}
                    yearMonth={p.payload.yearMonth}
                    isVisible={p.payload.netWorthDotted != null}
                    isSelected={p.payload.yearMonth === selectedYm}
                    opacity={0.45}
                    onSelect={handleSelect}
                  />
                );
              }}
              activeDot={false}
              connectNulls={false}
              legendType="none"
              name="netWorthDotted"
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {showMonthDetail && (
        <p className="mt-2 mb-1 text-xs text-gray-400">Click a point to see details</p>
      )}

      {hasEstimates && (
        <p className="mt-1 text-xs text-gray-400">
          <span className="inline-block w-5 border-t-2 border-dashed border-purple-400 opacity-50 align-middle mr-1" />
          Dashed = estimated from last uploaded balance · Upload a statement to make it solid
        </p>
      )}

      {/* Month detail panel */}
      {showMonthDetail && selPt && (
        <div className="mt-4 rounded-lg border border-purple-100 bg-purple-50/40 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-800">{longMonthLabel(selPt.yearMonth)}</p>

              {/* Assets / Debts / Balance row */}
              {!isDebt && selPt.totalAssets > 0 && (
                <div className="mt-1.5 flex items-center gap-3 text-xs">
                  <span className="text-gray-500">
                    Assets: <span className="font-semibold text-gray-700">{formatCurrencyFor(selPt.totalAssets, currency)}</span>
                  </span>
                  {selPt.totalDebts > 0 && (
                    <span className="text-gray-500">
                      Debts: <span className="font-semibold text-gray-700">{formatCurrencyFor(selPt.totalDebts, currency)}</span>
                    </span>
                  )}
                  <span className="text-gray-500">
                    Balance: <span className="font-semibold text-gray-700">{formatCurrencyFor(selPt.netWorth, currency)}</span>
                    {selPt.isEstimate && (
                      <span className="ml-1.5 rounded-full bg-amber-50 border border-amber-200 px-1.5 py-0.5 text-[10px] font-medium text-amber-600">
                        ~ estimated
                      </span>
                    )}
                  </span>
                </div>
              )}

              {/* Debt-mode or no-breakdown fallback */}
              {(isDebt || selPt.totalAssets === 0) && (
                <p className="mt-0.5 text-xs text-gray-400">
                  Balance:{" "}
                  <span className="font-semibold text-gray-700">{formatCurrencyFor(selPt.netWorth, currency)}</span>
                  {selPt.isEstimate && (
                    <span className="ml-2 rounded-full bg-amber-50 border border-amber-200 px-1.5 py-0.5 text-[10px] font-medium text-amber-600">
                      ~ estimated
                    </span>
                  )}
                </p>
              )}

              {selDelta !== null && prevPt ? (
                <>
                  <p className={`mt-1 text-xs font-semibold ${
                    isOnboarding
                      ? "text-gray-500"                                     // muted during onboarding
                      : deltaGood ? "text-green-600" : "text-amber-600"    // amber, not red
                  }`}>
                    {selDelta > 0 ? "↑ " : "↓ "}{formatCurrencyFor(Math.abs(selDelta), currency)} vs {shortMonthLabel(prevPt.yearMonth)}
                    {isDebt && selDelta < 0 && <span className="ml-1 font-normal">(paid down)</span>}
                    {isDebt && selDelta > 0 && <span className="ml-1 font-normal">(increased)</span>}
                    {!isDebt && selDelta > 0 && <span className="ml-1 font-normal">(growth)</span>}
                    {!isDebt && selDelta < 0 && <span className="ml-1 font-normal">(change)</span>}
                  </p>
                  {/* Contextual note for large jumps — likely new account added */}
                  {isLargeJump && (
                    <p className="mt-1.5 text-[11px] text-gray-400 flex items-start gap-1">
                      <span className="shrink-0">ℹ️</span>
                      <span>
                        Large {selDelta! < 0 ? "drop" : "jump"} may reflect a new account being added.
                        {isOnboarding && " Normal during setup."}
                      </span>
                    </p>
                  )}
                  {isOnboarding && !isLargeJump && (
                    <p className="mt-1 text-[11px] text-gray-400">Still building your history</p>
                  )}
                </>
              ) : (
                <p className="mt-1 text-xs text-gray-400">First tracked month</p>
              )}
            </div>
            <button
              onClick={() => setSelectedYm(null)}
              className="shrink-0 rounded-full p-1 text-gray-400 hover:bg-purple-100 hover:text-gray-600"
              aria-label="Close"
            >
              <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 4l8 8M12 4l-8 8" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
