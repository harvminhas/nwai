"use client";

import { useState } from "react";
import {
  ResponsiveContainer,
  LineChart,
  XAxis,
  YAxis,
  Line,
  Tooltip,
  CartesianGrid,
} from "recharts";

function shortMonthLabel(yearMonth: string): string {
  const [y, m] = yearMonth.split("-");
  if (!m) return yearMonth;
  const date = new Date(parseInt(y, 10), parseInt(m, 10) - 1, 1);
  return date.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

function formatAxis(v: number): string {
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${Math.round(abs / 1_000)}k`;
  return formatCurrency(v);
}

type Point = { yearMonth: string; label: string; netWorth: number };

const RANGES = [
  { label: "3M", months: 3 },
  { label: "6M", months: 6 },
  { label: "All", months: 0 },
];

export default function NetWorthChart({
  history,
}: {
  history: { yearMonth: string; netWorth: number }[];
}) {
  const [range, setRange] = useState(3);

  const allPoints: Point[] = history.map(({ yearMonth, netWorth }) => ({
    yearMonth,
    label: shortMonthLabel(yearMonth),
    netWorth,
  }));

  const data = range === 0 ? allPoints : allPoints.slice(-range);

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:p-6">
      <div className="mb-4 flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">
          Net Worth Over Time
        </p>
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
              formatter={(value) =>
                typeof value === "number"
                  ? [formatCurrency(value), "Net worth"]
                  : [String(value), "Net worth"]
              }
              contentStyle={{
                borderRadius: "8px",
                border: "1px solid #e5e7eb",
                boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.08)",
                fontSize: "13px",
              }}
              labelStyle={{ fontWeight: 600, color: "#111827" }}
            />
            <Line
              type="monotone"
              dataKey="netWorth"
              stroke="rgb(124 58 237)"
              strokeWidth={2}
              dot={{ fill: "rgb(124 58 237)", strokeWidth: 0, r: 3 }}
              activeDot={{ r: 5, fill: "rgb(124 58 237)", stroke: "#fff", strokeWidth: 2 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
