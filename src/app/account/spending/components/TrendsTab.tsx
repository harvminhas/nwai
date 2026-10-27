"use client";

import { useState } from "react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell } from "recharts";
import type { SpendingSummary } from "@/lib/spendingSummary";
import { formatMonth, formatMonthYear, formatDate } from "@/lib/dateFormatting";
import { formatCurrency, getCurrencySymbol } from "@/lib/currencyUtils";
import { getSignColor } from "@/lib/colorHelpers";

interface TrendsTabProps {
  summary: SpendingSummary;
}

export function TrendsTab({ summary }: TrendsTabProps) {
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  const { monthlyHistory, currency } = summary;

  // Chart data
  const chartData = monthlyHistory.map(m => ({
    month: formatMonth(m.yearMonth),
    yearMonth: m.yearMonth,
    fixed: Math.round(m.fixed),
    essentials: Math.round(m.essentials),
    flexible: Math.round(m.flexible),
    total: Math.round(m.total),
  }));

  // Axis formatter
  const fmtAxis = (v: number) => {
    const sym = getCurrencySymbol(currency);
    const abs = Math.abs(v);
    if (abs >= 1_000_000) return `${sym}${(abs / 1_000_000).toFixed(1)}M`;
    if (abs >= 1_000) return `${sym}${Math.round(abs / 1_000)}k`;
    return v === 0 ? `${sym}0` : formatCurrency(v, currency, undefined, true);
  };

  // Get selected month data
  const selectedData = selectedMonth ? monthlyHistory.find(m => m.yearMonth === selectedMonth) : null;

  // Category sparklines with 3-month comparison
  const categorySparklines = selectedMonth
    ? (() => {
        const selectedIdx = monthlyHistory.findIndex(m => m.yearMonth === selectedMonth);
        const last3Before = monthlyHistory.slice(Math.max(0, selectedIdx - 3), selectedIdx);
        
        const categoryMap = new Map<string, { amounts: number[]; lastMonth: number; prior3Avg: number }>();
        
        // Gather all categories from selected month
        if (selectedData) {
          selectedData.categories.forEach(c => {
            const prior3 = last3Before.map(m => {
              const cat = m.categories.find(mc => mc.category === c.category);
              return cat?.amount || 0;
            });
            const prior3Avg = prior3.length > 0 ? prior3.reduce((s, a) => s + a, 0) / prior3.length : 0;
            
            categoryMap.set(c.category, {
              amounts: [...prior3, c.amount],
              lastMonth: c.amount,
              prior3Avg,
            });
          });
        }
        
        return Array.from(categoryMap.entries())
          .map(([category, data]) => ({
            category,
            lastMonth: data.lastMonth,
            prior3Avg: data.prior3Avg,
            change: data.prior3Avg > 0 ? ((data.lastMonth - data.prior3Avg) / data.prior3Avg) * 100 : 0,
            sparkline: data.amounts,
          }))
          .sort((a, b) => b.lastMonth - a.lastMonth);
      })()
    : [];

  return (
    <div className="space-y-6">
      {/* 12-month chart */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h3 className="text-sm font-semibold text-gray-900 mb-4">Monthly spending</h3>

        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={chartData}
              margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
              onClick={(data) => {
                if (data?.activePayload?.[0]?.payload?.yearMonth) {
                  setSelectedMonth(data.activePayload[0].payload.yearMonth);
                }
              }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#9ca3af" }} tickLine={false} axisLine={false} />
              <YAxis tickFormatter={fmtAxis} tick={{ fontSize: 11, fill: "#9ca3af" }} tickLine={false} axisLine={false} width={60} />
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const data = payload[0].payload;
                  return (
                    <div className="bg-white border border-gray-200 rounded-lg shadow-lg px-3 py-2">
                      <p className="text-xs font-semibold text-gray-900 mb-1">{formatMonthYear(data.yearMonth)}</p>
                      <p className="text-xs text-purple-600">Fixed: {formatCurrency(data.fixed, currency)}</p>
                      <p className="text-xs text-blue-600">Essentials: {formatCurrency(data.essentials, currency)}</p>
                      <p className="text-xs text-green-600">Flexible: {formatCurrency(data.flexible, currency)}</p>
                      <p className="text-xs text-gray-900 font-medium mt-1">Total: {formatCurrency(data.total, currency)}</p>
                    </div>
                  );
                }}
              />
              <Bar dataKey="fixed" stackId="a" fill="#7c3aed" radius={[0, 0, 0, 0]} cursor="pointer">
                {chartData.map((entry, index) => (
                  <Cell key={`cell-${index}`} opacity={selectedMonth && entry.yearMonth !== selectedMonth ? 0.4 : 1} />
                ))}
              </Bar>
              <Bar dataKey="essentials" stackId="a" fill="#2563eb" radius={[0, 0, 0, 0]} cursor="pointer">
                {chartData.map((entry, index) => (
                  <Cell key={`cell-${index}`} opacity={selectedMonth && entry.yearMonth !== selectedMonth ? 0.4 : 1} />
                ))}
              </Bar>
              <Bar dataKey="flexible" stackId="a" fill="#16a34a" radius={[4, 4, 0, 0]} cursor="pointer">
                {chartData.map((entry, index) => (
                  <Cell key={`cell-${index}`} opacity={selectedMonth && entry.yearMonth !== selectedMonth ? 0.4 : 1} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="flex items-center justify-center gap-6 mt-4 text-xs">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-purple-600 rounded"></div>
            <span className="text-gray-600">Fixed</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-blue-600 rounded"></div>
            <span className="text-gray-600">Essentials</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-green-600 rounded"></div>
            <span className="text-gray-600">Flexible</span>
          </div>
        </div>
      </div>

      {/* Month detail drawer */}
      {selectedMonth && selectedData && (
        <div className="bg-purple-50 border border-purple-200 rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-semibold text-gray-900">{formatMonthYear(selectedMonth)}</h3>
            <button
              onClick={() => setSelectedMonth(null)}
              className="text-sm text-purple-600 hover:text-purple-700 font-medium"
            >
              Close
            </button>
          </div>

          <div className="mb-6">
            <div className="text-2xl font-semibold text-gray-900 mb-2">
              {formatCurrency(selectedData.total, currency)}
            </div>
            <div className="flex gap-3 text-sm">
              <span className="text-purple-700">Fixed: {formatCurrency(selectedData.fixed, currency)}</span>
              <span className="text-blue-700">Essentials: {formatCurrency(selectedData.essentials, currency)}</span>
              <span className="text-green-700">Flexible: {formatCurrency(selectedData.flexible, currency)}</span>
            </div>
          </div>

          {/* Category breakdown */}
          <div>
            <h4 className="text-sm font-semibold text-gray-900 mb-3">By category</h4>
            <div className="space-y-3">
              {categorySparklines.map(cat => (
                <div key={cat.category}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="text-sm font-medium text-gray-900">{cat.category}</div>
                    <div className="flex items-center gap-2">
                      <div className="text-sm text-gray-900">
                        {formatCurrency(cat.lastMonth, currency)}
                      </div>
                      {Math.abs(cat.change) >= 5 && (
                        <div className={`text-xs ${getSignColor(cat.change)}`}>
                          {cat.change > 0 ? "+" : ""}
                          {cat.change.toFixed(0)}%
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 relative h-2 bg-gray-200 rounded overflow-hidden">
                      <div
                        className="absolute h-full bg-purple-600 rounded"
                        style={{
                          width: `${Math.min(100, (cat.lastMonth / selectedData.total) * 100)}%`,
                        }}
                      />
                    </div>
                    <div className="w-16 h-6">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={cat.sparkline.map((v, i) => ({ v, i }))} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
                          <Bar dataKey="v" fill="#9ca3af" radius={[1, 1, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Category list with sparklines */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-900">By category</h3>
          <p className="text-xs text-gray-500">Last 3 months vs prior 3 months</p>
        </div>

        <div className="divide-y divide-gray-100">
          {summary.categories.slice(0, 10).map(cat => {
            // Get last 3 and prior 3 months
            const last3 = monthlyHistory.slice(-3);
            const prior3 = monthlyHistory.slice(-6, -3);
            
            const last3Total = last3.reduce((s, m) => {
              const c = m.categories.find(c => c.category === cat.category);
              return s + (c?.amount || 0);
            }, 0);
            
            const prior3Total = prior3.reduce((s, m) => {
              const c = m.categories.find(c => c.category === cat.category);
              return s + (c?.amount || 0);
            }, 0);
            
            const change = prior3Total > 0 ? ((last3Total - prior3Total) / prior3Total) * 100 : 0;
            
            const sparklineData = last3.map(m => {
              const c = m.categories.find(c => c.category === cat.category);
              return c?.amount || 0;
            });

            return (
              <div key={cat.category} className="px-6 py-4 flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900">{cat.category}</p>
                  <p className="text-xs text-gray-500">
                    {formatCurrency(last3Total, currency)} in last 3 months
                  </p>
                </div>

                <div className="w-20 h-8">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={sparklineData.map((v, i) => ({ v, i }))} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
                      <Bar dataKey="v" fill={change >= 0 ? "#9ca3af" : "#7c3aed"} radius={[1, 1, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                <div className="w-20 text-right">
                  {Math.abs(change) < 5 ? (
                    <span className="text-sm text-gray-400">—</span>
                  ) : (
                    <span className={`text-sm font-semibold tabular-nums ${getSignColor(change)}`}>
                      {change > 0 ? "+" : ""}
                      {Math.round(change)}%
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
