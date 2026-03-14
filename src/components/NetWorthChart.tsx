"use client";

import {
  ResponsiveContainer,
  LineChart,
  XAxis,
  YAxis,
  Line,
  Tooltip,
  CartesianGrid,
} from "recharts";

function monthLabel(yearMonth: string): string {
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

type Point = { yearMonth: string; label: string; netWorth: number };

export default function NetWorthChart({
  history,
}: {
  history: { yearMonth: string; netWorth: number }[];
}) {
  const data: Point[] = history.map(({ yearMonth, netWorth }) => ({
    yearMonth,
    label: monthLabel(yearMonth),
    netWorth,
  }));

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:p-6">
      <h3 className="mb-4 font-semibold text-gray-900">Net worth over time</h3>
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={data}
            margin={{ top: 8, right: 8, left: 8, bottom: 8 }}
          >
            <CartesianGrid strokeDasharray="3 3" className="stroke-gray-100" />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 12, fill: "#6b7280" }}
              tickLine={false}
              axisLine={{ stroke: "#e5e7eb" }}
            />
            <YAxis
              tickFormatter={(v) => {
                const abs = Math.abs(v);
                const sign = v < 0 ? "-" : "";
                return abs >= 1000 ? `${sign}$${abs / 1000}k` : formatCurrency(v);
              }}
              tick={{ fontSize: 12, fill: "#6b7280" }}
              tickLine={false}
              axisLine={false}
              width={52}
            />
            <Tooltip
              formatter={(value) =>
                typeof value === "number" ? [formatCurrency(value), "Net worth"] : [String(value), "Net worth"]
              }
              contentStyle={{
                borderRadius: "8px",
                border: "1px solid #e5e7eb",
                boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)",
              }}
              labelStyle={{ fontWeight: 600 }}
            />
            <Line
              type="monotone"
              dataKey="netWorth"
              stroke="rgb(147 51 234)"
              strokeWidth={2}
              dot={{ fill: "rgb(147 51 234)", strokeWidth: 0, r: 4 }}
              activeDot={{ r: 6, fill: "rgb(147 51 234)", stroke: "#fff", strokeWidth: 2 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
