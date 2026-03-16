"use client";

import { useState } from "react";
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

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD",
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(value);
}

function formatAxis(v: number): string {
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${Math.round(abs / 1_000)}k`;
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

export default function NetWorthChart({
  history,
}: {
  history: { yearMonth: string; netWorth: number; expensesTotal?: number; isEstimate?: boolean }[];
}) {
  const [range, setRange] = useState(3);

  const allPoints: Point[] = history.map(({ yearMonth, netWorth, isEstimate }) => ({
    yearMonth,
    label: shortMonthLabel(yearMonth),
    netWorth,
    // Solid line: real points + one connector point adjacent to estimated runs
    netWorthSolid: isEstimate ? null : netWorth,
    // Dotted line: estimated points + one connector on each side for visual continuity
    netWorthDotted: isEstimate ? netWorth : null,
    isEstimate: isEstimate ?? false,
  }));

  // Add connector points: when transitioning real→estimate or estimate→real,
  // include the adjacent real value on the dotted series (and vice versa) so
  // the lines visually connect.
  const connected = allPoints.map((pt, i) => {
    const prev = allPoints[i - 1];
    const next = allPoints[i + 1];
    let solid = pt.netWorthSolid;
    let dotted = pt.netWorthDotted;

    if (!pt.isEstimate) {
      // Real point: also draw on dotted line if adjacent to an estimated point
      if (prev?.isEstimate || next?.isEstimate) dotted = pt.netWorth;
    } else {
      // Estimated point: also draw on solid line if adjacent to a real point
      if (prev && !prev.isEstimate) solid = pt.netWorth;
      if (next && !next.isEstimate) solid = pt.netWorth;
    }

    return { ...pt, netWorthSolid: solid, netWorthDotted: dotted };
  });

  const data = range === 0 ? connected : connected.slice(-range);
  const hasEstimates = data.some((p) => p.isEstimate);

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:p-6">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">
            Net Worth Over Time
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
                if (typeof value !== "number") return [String(value), "Net worth"];
                const label = name === "netWorthDotted" ? "Net worth (estimated)" : "Net worth";
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
                const { cx, cy, payload } = props as { cx: number; cy: number; payload: Point };
                if (payload.netWorthSolid == null) return <g key={`dot-solid-${payload.yearMonth}`} />;
                return (
                  <circle
                    key={`dot-solid-${payload.yearMonth}`}
                    cx={cx} cy={cy} r={3}
                    fill="rgb(124 58 237)" stroke="none"
                  />
                );
              }}
              activeDot={{ r: 5, fill: "rgb(124 58 237)", stroke: "#fff", strokeWidth: 2 }}
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
                const { cx, cy, payload } = props as { cx: number; cy: number; payload: Point };
                if (payload.netWorthDotted == null) return <g key={`dot-dotted-${payload.yearMonth}`} />;
                return (
                  <circle
                    key={`dot-dotted-${payload.yearMonth}`}
                    cx={cx} cy={cy} r={3}
                    fill="rgb(124 58 237)" stroke="#fff" strokeWidth={1.5}
                    fillOpacity={0.45}
                  />
                );
              }}
              connectNulls={false}
              name="netWorthDotted"
              legendType="none"
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {hasEstimates && (
        <p className="mt-2 text-xs text-gray-400">
          <span className="inline-block w-5 border-t-2 border-dashed border-purple-400 opacity-50 align-middle mr-1" />
          Dashed = estimated from last uploaded balance · Upload a statement to make it solid
        </p>
      )}
    </div>
  );
}
