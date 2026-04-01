"use client";

import { useState } from "react";
import { getCurrencySymbol } from "@/lib/currencyUtils";
import {
  ResponsiveContainer,
  LineChart,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Line,
} from "recharts";

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

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD",
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(value);
}

function formatAxis(v: number): string {
  const sym = getCurrencySymbol();
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}${sym}${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}${sym}${Math.round(abs / 1_000)}k`;
  return formatCurrency(v);
}

// Each point has a solid value and an optional estimatedNetWorth for dotted rendering
type Point = {
  yearMonth: string;
  label: string;
  netWorth: number;
  netWorthSolid: number | null;    // null for estimated points (breaks solid line)
  netWorthDotted: number | null;   // null for real points (breaks dotted line)
  isEstimate: boolean;
};

const RANGES = [
  { label: "3M", months: 3 },
  { label: "6M", months: 6 },
  { label: "All", months: 0 },
];

// Standalone clickable dot component — defined outside render to avoid Recharts re-mount issues
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
      r={isSelected ? 7 : 4}
      fill={isSelected ? "rgb(124 58 237)" : "#fff"}
      stroke="rgb(124 58 237)"
      strokeWidth={isSelected ? 2 : 1.5}
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
}: {
  history: { yearMonth: string; netWorth: number; expensesTotal?: number; isEstimate?: boolean }[];
  isDebt?: boolean;
}) {
  const [range, setRange] = useState(3);
  const [selectedYm, setSelectedYm] = useState<string | null>(null);

  // Onboarding: first 3 real months of data — avoid alarming red colours
  const realPoints = history.filter((h) => !h.isEstimate);
  const isOnboarding = realPoints.length <= 3;

  const allPoints: Point[] = history.map(({ yearMonth, netWorth, isEstimate }) => ({
    yearMonth,
    label: shortMonthLabel(yearMonth),
    netWorth,
    netWorthSolid: isEstimate ? null : netWorth,
    netWorthDotted: isEstimate ? netWorth : null,
    isEstimate: isEstimate ?? false,
  }));

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
  });

  const data = range === 0 ? connected : connected.slice(-range);
  const hasEstimates = data.some((p) => p.isEstimate);

  // Month detail for the selected point
  const selIdx   = selectedYm ? data.findIndex((p) => p.yearMonth === selectedYm) : -1;
  const selPt    = selIdx >= 0 ? data[selIdx] : null;
  const prevPt   = selIdx > 0  ? data[selIdx - 1] : null;
  const selDelta = selPt && prevPt ? selPt.netWorth - prevPt.netWorth : null;
  const deltaGood = selDelta !== null ? (isDebt ? selDelta < 0 : selDelta > 0) : null;

  // A jump is "large" when it's >25% of the previous value — likely a new account being added
  const baseline = prevPt ? Math.abs(prevPt.netWorth) || Math.abs(selPt?.netWorth ?? 0) : 0;
  const isLargeJump = selDelta !== null && baseline > 0 && Math.abs(selDelta) / baseline > 0.25;

  function handleSelect(ym: string) {
    setSelectedYm((prev) => prev === ym ? null : ym);
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:p-6">
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
          <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 11, fill: "#9ca3af" }}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              tickFormatter={formatAxis}
              tick={{ fontSize: 11, fill: "#9ca3af" }}
              tickLine={false}
              axisLine={false}
              width={56}
            />
            <Tooltip
              formatter={(value, name) => {
                if (typeof value !== "number") return [String(value), "Balance"];
                const label = name === "netWorthDotted" ? "Balance (estimated)" : "Balance";
                return [formatCurrency(value), label];
              }}
              contentStyle={{
                borderRadius: "8px",
                border: "1px solid #e5e7eb",
                boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.08)",
                fontSize: "13px",
              }}
              labelStyle={{ fontWeight: 600, color: "#111827" }}
            />
            {/* Solid line — real data */}
            <Line
              type="monotone"
              dataKey="netWorthSolid"
              stroke="rgb(124 58 237)"
              strokeWidth={2}
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
              activeDot={false}
              connectNulls={false}
              name="netWorthSolid"
              legendType="none"
            />
            {/* Dotted line — estimated data */}
            <Line
              type="monotone"
              dataKey="netWorthDotted"
              stroke="rgb(124 58 237)"
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
              name="netWorthDotted"
              legendType="none"
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <p className="mt-2 mb-1 text-xs text-gray-400">Click a point to see details</p>

      {hasEstimates && (
        <p className="mt-1 text-xs text-gray-400">
          <span className="inline-block w-5 border-t-2 border-dashed border-purple-400 opacity-50 align-middle mr-1" />
          Dashed = estimated from last uploaded balance · Upload a statement to make it solid
        </p>
      )}

      {/* Month detail panel */}
      {selPt && (
        <div className="mt-4 rounded-lg border border-purple-100 bg-purple-50/40 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-800">{longMonthLabel(selPt.yearMonth)}</p>
              <p className="mt-0.5 text-xs text-gray-400">
                Balance:{" "}
                <span className="font-semibold text-gray-700">{formatCurrency(selPt.netWorth)}</span>
                {selPt.isEstimate && (
                  <span className="ml-2 rounded-full bg-amber-50 border border-amber-200 px-1.5 py-0.5 text-[10px] font-medium text-amber-600">
                    ~ estimated
                  </span>
                )}
              </p>
              {selDelta !== null && prevPt ? (
                <>
                  <p className={`mt-1 text-xs font-semibold ${
                    isOnboarding
                      ? "text-gray-500"                                     // muted during onboarding
                      : deltaGood ? "text-green-600" : "text-amber-600"    // amber, not red
                  }`}>
                    {selDelta > 0 ? "↑ " : "↓ "}{formatCurrency(Math.abs(selDelta))} vs {shortMonthLabel(prevPt.yearMonth)}
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
