"use client";

import { useState, useEffect } from "react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell } from "recharts";
import type { SpendingSummary } from "@/lib/spendingSummary";
import { formatMonth, formatMonthYear } from "@/lib/dateFormatting";
import { formatCurrency, getCurrencySymbol } from "@/lib/currencyUtils";
import { getSignColor } from "@/lib/colorHelpers";

interface TrendsTabProps {
  summary: SpendingSummary;
}

export function TrendsTab({ summary }: TrendsTabProps) {
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [selected3MonthCategory, setSelected3MonthCategory] = useState<string | null>(null);
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

  // Handle bar click - multiple handlers for reliability
  const handleBarClick = (data: any) => {
    // Chart-level onClick provides activeLabel
    const month = data?.activeLabel;
    if (month) {
      const matchedData = chartData.find(d => d.month === month);
      if (matchedData) {
        if (matchedData.yearMonth === selectedMonth) {
          setSelectedMonth(null);
        } else {
          setSelectedMonth(matchedData.yearMonth);
          setExpandedCategories(new Set());
        }
        return;
      }
    }
    
    // Fallback to activePayload
    if (!data || !data.activePayload || !data.activePayload[0]) return;
    const yearMonth = data.activePayload[0].payload.yearMonth;
    if (yearMonth === selectedMonth) {
      setSelectedMonth(null);
    } else {
      setSelectedMonth(yearMonth);
      setExpandedCategories(new Set());
    }
  };
  
  // Individual bar click handler
  const handleBarCellClick = (entry: any) => {
    if (!entry || !entry.yearMonth) return;
    if (entry.yearMonth === selectedMonth) {
      setSelectedMonth(null);
    } else {
      setSelectedMonth(entry.yearMonth);
      setExpandedCategories(new Set());
    }
  };
  
  // Keyboard handler for Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && selectedMonth) {
        setSelectedMonth(null);
      }
    };
    
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [selectedMonth]);

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
              onClick={handleBarClick}
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
              <Bar dataKey="fixed" stackId="a" fill="#7c3aed" radius={[0, 0, 0, 0]} cursor="pointer" onClick={handleBarCellClick}>
                {chartData.map((entry, index) => (
                  <Cell key={`cell-fixed-${index}`} opacity={selectedMonth && entry.yearMonth !== selectedMonth ? 0.3 : 1} />
                ))}
              </Bar>
              <Bar dataKey="essentials" stackId="a" fill="#2563eb" radius={[0, 0, 0, 0]} cursor="pointer" onClick={handleBarCellClick}>
                {chartData.map((entry, index) => (
                  <Cell key={`cell-ess-${index}`} opacity={selectedMonth && entry.yearMonth !== selectedMonth ? 0.3 : 1} />
                ))}
              </Bar>
              <Bar dataKey="flexible" stackId="a" fill="#16a34a" radius={[4, 4, 0, 0]} cursor="pointer" onClick={handleBarCellClick}>
                {chartData.map((entry, index) => (
                  <Cell key={`cell-flex-${index}`} opacity={selectedMonth && entry.yearMonth !== selectedMonth ? 0.3 : 1} />
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
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm"
            onClick={() => setSelectedMonth(null)}
          />

          {/* Drawer */}
          <div className="fixed right-0 top-0 z-50 h-full w-full max-w-2xl overflow-y-auto bg-white shadow-2xl sm:w-[640px]">
            {/* Header */}
            <div className="sticky top-0 border-b border-gray-200 bg-white px-6 py-4">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-bold text-gray-900">{formatMonthYear(selectedMonth)}</h2>
                <button
                  onClick={() => setSelectedMonth(null)}
                  className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600 focus:outline-none"
                >
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Content */}
            <div className="p-6 space-y-6">
              {/* Total vs typical */}
              <div>
                <div className="text-3xl font-bold text-gray-900 mb-2">
                  {formatCurrency(selectedData.total, currency)}
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-gray-600">vs typical</span>
                  <span className="font-medium text-gray-900">{formatCurrency(summary.typicalMonthly, currency)}</span>
                  {(() => {
                    const diff = selectedData.total - summary.typicalMonthly;
                    const pct = summary.typicalMonthly > 0 ? (diff / summary.typicalMonthly) * 100 : 0;
                    if (Math.abs(pct) < 5) return null;
                    return (
                      <span className={`text-xs font-semibold ${getSignColor(diff)}`}>
                        {diff > 0 ? "+" : ""}{pct.toFixed(0)}%
                      </span>
                    );
                  })()}
                </div>
              </div>

              {/* Bucket breakdown */}
              <div>
                <h3 className="text-sm font-semibold text-gray-900 mb-3">By bucket</h3>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 bg-purple-600 rounded"></div>
                      <span className="text-sm font-medium text-gray-900">Fixed</span>
                    </div>
                    <span className="text-sm font-semibold text-gray-900">{formatCurrency(selectedData.fixed, currency)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 bg-blue-600 rounded"></div>
                      <span className="text-sm font-medium text-gray-900">Essentials</span>
                    </div>
                    <span className="text-sm font-semibold text-gray-900">{formatCurrency(selectedData.essentials, currency)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 bg-green-600 rounded"></div>
                      <span className="text-sm font-medium text-gray-900">Flexible</span>
                    </div>
                    <span className="text-sm font-semibold text-gray-900">{formatCurrency(selectedData.flexible, currency)}</span>
                  </div>
                </div>
              </div>

              {/* Categories with transactions */}
              <div>
                <h3 className="text-sm font-semibold text-gray-900 mb-3">By category</h3>
                <div className="space-y-1">
                  {selectedData.categories.sort((a, b) => b.amount - a.amount).map(cat => {
                    const categoryMerchants = summary.merchants.filter(m => m.category === cat.category);
                    const expanded = expandedCategories.has(cat.category);
                    
                    const bucketColors: Record<string, string> = {
                      fixed: "bg-purple-600",
                      essentials: "bg-blue-600",
                      flexible: "bg-green-600",
                    };
                    const barColor = bucketColors[cat.bucket] || "bg-gray-400";
                    
                    const dotColorMap: Record<string, string> = {
                      "bg-purple-600": "text-purple-600",
                      "bg-blue-600": "text-blue-600",
                      "bg-green-600": "text-green-600",
                    };
                    const dotColor = dotColorMap[barColor] || "text-gray-500";
                    
                    // Calculate share for bar width
                    const maxAmount = Math.max(...selectedData.categories.map(c => c.amount));
                    const share = maxAmount > 0 ? cat.amount / maxAmount : 0;
                    
                    return (
                      <div key={cat.category} className="border-b border-gray-100 last:border-0">
                        <button
                          onClick={() => {
                            const newExpanded = new Set(expandedCategories);
                            if (expanded) {
                              newExpanded.delete(cat.category);
                            } else {
                              newExpanded.add(cat.category);
                            }
                            setExpandedCategories(newExpanded);
                          }}
                          className="w-full hover:bg-gray-50 transition-colors focus:outline-none py-3 group"
                        >
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <span className={`text-xl ${dotColor}`}>•</span>
                              <span className="text-sm font-medium text-gray-900">{cat.category}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-semibold text-gray-900 whitespace-nowrap">{formatCurrency(cat.amount, currency)}</span>
                              <svg className={`h-4 w-4 text-gray-400 group-hover:text-gray-600 transition-transform ${expanded ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                              </svg>
                            </div>
                          </div>
                          <div className="relative w-full h-2 bg-gray-100 rounded overflow-hidden">
                            <div
                              className={`absolute h-full ${barColor} rounded`}
                              style={{ width: `${Math.min(100, share * 100)}%` }}
                            />
                          </div>
                        </button>
                        
                        {expanded && categoryMerchants.length > 0 && (
                          <div className="pl-4 pb-3 space-y-2">
                            {categoryMerchants.map(merchant => {
                              const monthTxns = merchant.transactions.filter(t => t.txMonth === selectedMonth);
                              if (monthTxns.length === 0) return null;
                              const monthTotal = monthTxns.reduce((s, t) => s + t.amount, 0);
                              
                              return (
                                <div key={merchant.merchantSlug} className="text-xs">
                                  <div className="flex items-center justify-between text-gray-700">
                                    <span>{merchant.merchant}</span>
                                    <span className="font-medium">{formatCurrency(monthTotal, currency)}</span>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Category list - 3-month averages */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-900">By category</h3>
          <p className="text-xs text-gray-500">3-month average</p>
        </div>

        <div className="divide-y divide-gray-100">
          {summary.categories
            .map(cat => {
              // Get last 3 months
              const last3 = monthlyHistory.slice(-3);
              const last3Total = last3.reduce((s, m) => {
                const c = m.categories.find(c => c.category === cat.category);
                return s + (c?.amount || 0);
              }, 0);
              const avg3Month = last3Total / 3;
              
              return { ...cat, avg3Month, last3Total };
            })
            .filter(cat => cat.avg3Month > 0)
            .sort((a, b) => b.avg3Month - a.avg3Month)
            .slice(0, 10)
            .map(cat => {
              const bucketColors: Record<string, string> = {
                fixed: "bg-purple-600",
                essentials: "bg-blue-600",
                flexible: "bg-green-600",
              };
              const barColor = bucketColors[cat.bucket] || "bg-gray-400";
              
              const dotColorMap: Record<string, string> = {
                "bg-purple-600": "text-purple-600",
                "bg-blue-600": "text-blue-600",
                "bg-green-600": "text-green-600",
              };
              const dotColor = dotColorMap[barColor] || "text-gray-500";
              
              // Calculate share for bar width
              const maxAmount = Math.max(...summary.categories.map(c => {
                const last3 = monthlyHistory.slice(-3);
                return last3.reduce((s, m) => {
                  const found = m.categories.find(mc => mc.category === c.category);
                  return s + (found?.amount || 0);
                }, 0) / 3;
              }));
              const share = maxAmount > 0 ? cat.avg3Month / maxAmount : 0;

              const isExpanded = selected3MonthCategory === cat.category;
              const categoryMerchants = summary.merchants.filter(m => m.category === cat.category);
              const last3Months = monthlyHistory.slice(-3);
              
              return (
                <div key={cat.category} className="border-b border-gray-100 last:border-0">
                  <button
                    onClick={() => {
                      setSelected3MonthCategory(isExpanded ? null : cat.category);
                    }}
                    className="w-full px-6 py-3 text-left hover:bg-gray-50 transition-colors group"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className={`text-xl ${dotColor}`}>•</span>
                        <span className="text-sm font-medium text-gray-900">{cat.category}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-gray-900 whitespace-nowrap">
                          {formatCurrency(cat.avg3Month, currency)}/mo
                        </span>
                        <svg className={`h-4 w-4 text-gray-400 group-hover:text-gray-600 transition-transform ${isExpanded ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </div>
                    </div>
                    <div className="relative w-full h-2 bg-gray-100 rounded overflow-hidden">
                      <div
                        className={`absolute h-full ${barColor} rounded`}
                        style={{ width: `${Math.min(100, share * 100)}%` }}
                      />
                    </div>
                  </button>
                  
                  {isExpanded && categoryMerchants.length > 0 && (
                    <div className="px-6 pb-3 space-y-2">
                      <p className="text-xs text-gray-500 mb-2">Last 3 months</p>
                      {categoryMerchants.map(merchant => {
                        const last3Txns = merchant.transactions.filter(t => 
                          last3Months.some(m => m.yearMonth === t.txMonth)
                        );
                        if (last3Txns.length === 0) return null;
                        const total = last3Txns.reduce((s, t) => s + t.amount, 0);
                        
                        return (
                          <div key={merchant.merchantSlug} className="text-xs">
                            <div className="flex items-center justify-between text-gray-700">
                              <span>{merchant.merchant}</span>
                              <span className="font-medium">{formatCurrency(total, currency)}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
        </div>
      </div>
    </div>
  );
}
