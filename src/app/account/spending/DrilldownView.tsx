"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ResponsiveContainer, ComposedChart, Line, Area, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";
import { formatCurrency, getCurrencySymbol } from "@/lib/currencyUtils";

interface MonthlySeries {
  yearMonth: string;
  amount: number;
}

interface RankedItem {
  name: string;
  slug: string;
  total: number;
  share: number;
  trend: number;
  monthlySeries: MonthlySeries[];
}

interface CadenceStats {
  dayOfWeek?: { day: string; count: number }[];
  dayOfMonth?: { day: number; count: number }[];
  sentence?: string;
}

interface DrilldownData {
  level: "all" | "category" | "merchant";
  breadcrumb: { label: string; href?: string }[];
  total: number;
  avgPerMonth: number;
  monthlySeries: MonthlySeries[];
  comparisonSeries?: MonthlySeries[];
  rankedItems: RankedItem[];
  cadence?: CadenceStats;
  currency: string;
}

function formatMonthLabel(yearMonth: string): string {
  const [year, month] = yearMonth.split("-");
  return new Date(parseInt(year), parseInt(month) - 1).toLocaleDateString("en-US", { month: "short" });
}

interface DrilldownViewProps {
  token: string;
}

export function DrilldownView({ token }: DrilldownViewProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [data, setData] = useState<DrilldownData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);

  const category = searchParams.get("category") || "";
  const merchant = searchParams.get("merchant") || "";
  
  const level = merchant ? "merchant" : category ? "category" : "all";

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams({ level });
        if (category) params.set("category", category);
        if (merchant) params.set("merchant", merchant);

        const res = await fetch(`/api/user/spending/drilldown?${params}`, {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (!res.ok) {
          const errorData = await res.json().catch(() => ({ error: "Failed to load data" }));
          throw new Error(errorData.error || "Failed to load data");
        }

        const result = await res.json();
        setData(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load data");
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [token, level, category, merchant]);

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-purple-600 border-t-transparent" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="mx-auto max-w-5xl px-4 pt-4 pb-8 sm:py-8">
        <p className="text-red-600">{error || "Failed to load data"}</p>
      </div>
    );
  }

  const handleItemClick = (item: RankedItem) => {
    if (level === "all") {
      router.push(`/account/spending?category=${encodeURIComponent(item.name)}`);
    } else if (level === "category") {
      router.push(`/account/spending?category=${encodeURIComponent(category)}&merchant=${encodeURIComponent(item.slug)}`);
    }
  };

  // Filter ranked items by selected month if active
  const filteredItems = selectedMonth
    ? data.rankedItems.filter(item => {
        if (level === "merchant") return true; // Don't filter transactions
        const monthData = item.monthlySeries.find(m => m.yearMonth === selectedMonth);
        return monthData && monthData.amount > 0;
      })
    : data.rankedItems;

  // Chart data
  const chartData = data.monthlySeries.map((m, idx) => ({
    month: formatMonthLabel(m.yearMonth),
    yearMonth: m.yearMonth,
    amount: m.amount,
    comparison: data.comparisonSeries?.[idx]?.amount || 0,
  }));

  const maxValue = Math.max(...data.monthlySeries.map(m => m.amount));
  const yAxisDomain: [number, number] = [0, Math.ceil(maxValue * 1.1 / 1000) * 1000];

  return (
    <div className="mx-auto max-w-5xl px-4 pt-4 pb-8 sm:py-8">
      {/* Breadcrumb */}
      <div className="mb-6">
        <div className="flex items-center gap-2 text-sm mb-2">
          <Link href="/account" className="text-neutral-500 hover:text-neutral-700">
            ←
          </Link>
          {data.breadcrumb.map((crumb, idx) => (
            <div key={idx} className="flex items-center gap-2">
              {idx > 0 && <span className="text-neutral-400">/</span>}
              {crumb.href ? (
                <Link href={crumb.href} className="text-neutral-600 hover:text-neutral-900 font-medium">
                  {crumb.label}
                </Link>
              ) : (
                <span className="text-neutral-900 font-semibold">{crumb.label}</span>
              )}
            </div>
          ))}
        </div>
        <Link href="/account/spending?view=classic" className="text-xs text-neutral-500 hover:text-neutral-700 ml-7">
          Classic view →
        </Link>
      </div>

      {/* Header Card */}
      <div className="bg-white rounded-2xl border border-neutral-200 p-6 mb-6 shadow-sm">
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="text-3xl font-bold text-neutral-900 mb-1">
              {formatCurrency(data.total, data.currency)}
            </div>
            <div className="text-sm text-neutral-500">
              {formatCurrency(data.avgPerMonth, data.currency)}/mo average
            </div>
          </div>
          {selectedMonth && (
            <button
              onClick={() => setSelectedMonth(null)}
              className="flex items-center justify-center w-7 h-7 rounded-md text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100"
              title="Back to all months"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
          )}
        </div>

        <div style={{ height: "200px" }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={chartData}
              onClick={(e: any) => {
                if (e?.activeLabel) {
                  const month = e.activeLabel;
                  const matchedData = chartData.find(d => d.month === month);
                  if (matchedData) {
                    if (selectedMonth === matchedData.yearMonth) {
                      setSelectedMonth(null);
                    } else {
                      setSelectedMonth(matchedData.yearMonth);
                    }
                  }
                }
              }}
              margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
            >
              <defs>
                <linearGradient id="amountGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.15}/>
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0.02}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
              <XAxis 
                dataKey="month" 
                tick={{ fontSize: 11, fill: "#6b7280" }}
                axisLine={{ stroke: "#e5e7eb" }}
                tickLine={false}
              />
              <YAxis 
                domain={yAxisDomain}
                tick={{ fontSize: 11, fill: "#6b7280" }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(value: number) => {
                  const sym = getCurrencySymbol(data.currency);
                  const abs = Math.abs(value);
                  if (abs >= 1_000_000) return `${sym}${(value / 1_000_000).toFixed(1)}M`;
                  if (abs >= 1_000) return `${sym}${(value / 1_000).toFixed(1)}k`;
                  return `${sym}${value}`;
                }}
              />
              <Tooltip 
                content={({ active, payload }) => {
                  if (active && payload && payload[0]) {
                    const data = payload[0].payload;
                    return (
                      <div className="bg-white border border-neutral-200 rounded-lg shadow-lg px-3 py-2">
                        <p className="text-xs text-neutral-600 mb-1">{data.month}</p>
                        <p className="text-sm font-semibold text-neutral-900">
                          {formatCurrency(data.amount, "CAD")}
                        </p>
                      </div>
                    );
                  }
                  return null;
                }}
              />
              {data.comparisonSeries && (
                <Line 
                  type="monotone" 
                  dataKey="comparison" 
                  stroke="#d1d5db" 
                  strokeWidth={1}
                  strokeDasharray="3 3"
                  dot={false}
                />
              )}
              <Area 
                type="monotone" 
                dataKey="amount" 
                fill="url(#amountGradient)" 
                stroke="none"
              />
              <Line 
                type="monotone" 
                dataKey="amount" 
                stroke="#10b981" 
                strokeWidth={2}
                dot={(props: any) => {
                  const isSelected = selectedMonth === props.payload.yearMonth;
                  return (
                    <circle
                      cx={props.cx}
                      cy={props.cy}
                      r={isSelected ? 5 : 3}
                      fill={isSelected ? "#059669" : "#10b981"}
                      stroke="#fff"
                      strokeWidth={2}
                      style={{ cursor: "pointer" }}
                    />
                  );
                }}
                activeDot={{ r: 5 }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {data.comparisonSeries && (
          <div className="mt-3 flex items-center gap-4 text-xs">
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-0.5 bg-emerald-500"></div>
              <span className="text-neutral-600">{level === "category" ? category : data.breadcrumb[1]?.label}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-0.5 bg-neutral-300 border-dashed border-t"></div>
              <span className="text-neutral-400">{level === "category" ? "All spending" : category}</span>
            </div>
          </div>
        )}
      </div>

      {/* Ranked List Card */}
      <div className="bg-white rounded-2xl border border-neutral-200 p-6 mb-6 shadow-sm">
        <h2 className="text-lg font-semibold text-neutral-900 mb-4">
          {level === "all" ? "Categories" : level === "category" ? "Merchants" : "Transactions"}
          {selectedMonth && (
            <span className="ml-2 text-sm font-normal text-neutral-500">
              in {formatMonthLabel(selectedMonth)}
            </span>
          )}
        </h2>
        
        <div className="space-y-2">
          {filteredItems.map((item, idx) => (
            <div
              key={item.slug}
              className={`flex items-center gap-3 p-3 rounded-lg hover:bg-neutral-50 transition-colors ${
                level !== "merchant" ? "cursor-pointer" : ""
              }`}
              onClick={() => level !== "merchant" && handleItemClick(item)}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-medium text-neutral-900">{item.name}</span>
                  {level !== "merchant" && item.monthlySeries.length > 0 && (
                    <div className="flex-shrink-0" style={{ width: "60px", height: "20px" }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={item.monthlySeries.map(m => ({ amount: m.amount }))}>
                          <Line type="monotone" dataKey="amount" stroke="#10b981" strokeWidth={1} dot={false} />
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </div>
                {level !== "merchant" && (
                  <div className="w-full bg-neutral-100 rounded-full h-1.5 mb-1">
                    <div 
                      className="bg-emerald-500 h-1.5 rounded-full" 
                      style={{ width: `${Math.min(item.share * 100, 100)}%` }}
                    ></div>
                  </div>
                )}
              </div>
              
              <div className="flex items-center gap-3">
                <div className="text-right">
                  <div className="font-semibold text-neutral-900 tabular-nums">
                    {formatCurrency(item.total, data.currency)}
                  </div>
                  {level !== "merchant" && item.trend !== 0 && (
                    <div className={`text-xs tabular-nums ${item.trend > 0 ? "text-red-600" : "text-green-600"}`}>
                      {item.trend > 0 ? "+" : "−"}{formatCurrency(Math.abs(item.trend), data.currency)}/mo
                    </div>
                  )}
                </div>
                
                {level !== "merchant" && (
                  <svg className="w-5 h-5 text-neutral-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* When Strip */}
      {data.cadence && level !== "all" && (
        <div className="bg-white rounded-2xl border border-neutral-200 p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-neutral-900 mb-3">When</h2>
          
          {data.cadence?.sentence && (
            <p className="text-sm text-neutral-600 mb-3">{data.cadence.sentence}</p>
          )}
          
          {data.cadence?.dayOfWeek && (
            <div className="flex gap-2">
              {data.cadence.dayOfWeek.map(d => {
                const maxCount = Math.max(...(data.cadence?.dayOfWeek || []).map(dow => dow.count));
                const intensity = maxCount > 0 ? d.count / maxCount : 0;
                return (
                  <div key={d.day} className="flex-1 text-center">
                    <div 
                      className="h-8 rounded flex items-center justify-center text-xs font-medium"
                      style={{
                        backgroundColor: intensity > 0 ? `rgba(16, 185, 129, ${0.2 + intensity * 0.6})` : "#f3f4f6",
                        color: intensity > 0.3 ? "#fff" : "#6b7280",
                      }}
                    >
                      {d.day[0]}
                    </div>
                    <div className="text-xs text-neutral-400 mt-1">{d.count}</div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
