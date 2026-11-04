"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ResponsiveContainer, ComposedChart, Line, Area, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";
import { formatCurrency, getCurrencySymbol } from "@/lib/currencyUtils";
import { ReviewList } from "@/components/ReviewList";

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
  subLabel?: string;
}

interface CadenceStats {
  dayOfWeek?: { day: string; count: number; amount: number }[];
  dayOfMonth?: { day: number; count: number }[];
  sentence?: string;
}

interface AccountBreakdown {
  label: string;
  slug: string;
  total: number;
  share: number;
  count: number;
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
  accounts?: AccountBreakdown[];
  otherCategoriesTotal?: number;
  kind?: "debt";
  actualPaidTotal?: number;
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

  const handleReviewComplete = async () => {
    // Refetch data after user classifies a debt payment
    await loadData();
  };

  useEffect(() => {
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

  // Consolidated month selection helper (toggles on re-click)
  const setMonthForYearMonth = (ym: string) => {
    if (selectedMonth === ym) {
      setSelectedMonth(null);
    } else {
      setSelectedMonth(ym);
    }
  };

  // When month is selected, show that month's values
  const displayedItems = selectedMonth && level !== "merchant"
    ? data.rankedItems
        .map(item => {
          const monthData = item.monthlySeries.find(m => m.yearMonth === selectedMonth);
          return {
            ...item,
            displayTotal: monthData?.amount || 0,
            displayShare: 0, // Will be computed after filtering
          };
        })
        .filter(item => item.displayTotal > 0)
        .sort((a, b) => b.displayTotal - a.displayTotal)
        .map((item, idx, arr) => {
          const monthTotal = arr.reduce((sum, i) => sum + i.displayTotal, 0);
          return {
            ...item,
            displayShare: monthTotal > 0 ? item.displayTotal / monthTotal : 0,
          };
        })
    : data.rankedItems.map(item => ({
        ...item,
        displayTotal: item.total,
        displayShare: item.share,
      }));

  // Chart data
  const chartData = data.monthlySeries.map((m, idx) => ({
    month: formatMonthLabel(m.yearMonth),
    yearMonth: m.yearMonth,
    amount: m.amount,
    comparison: data.comparisonSeries?.[idx]?.amount || 0,
  }));

  // Magnitude-aware 'nice' domain calculation
  const niceDomain = (values: number[]): [number, number] => {
    const max = Math.max(...values, 0);
    if (max === 0) return [0, 100];
    const min = Math.min(...values);
    const pad = Math.max((max - min) * 0.15, max * 0.08);
    const lo = Math.max(0, min - pad);
    const hi = max + pad;
    const rawStep = (hi - lo) / 4;
    const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
    const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= rawStep) ?? 10 * mag;
    return [Math.floor(lo / step) * step, Math.ceil(hi / step) * step];
  };
  
  const yAxisDomain = niceDomain(data.monthlySeries.map(m => m.amount));

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

      {/* Debt Payment Review List */}
      <div className="mb-6">
        <ReviewList
          token={token}
          reviewType="debt_payment"
          onReviewComplete={handleReviewComplete}
        />
      </div>

      {/* Header Card */}
      <div className="bg-white rounded-2xl border border-neutral-200 p-6 mb-6 shadow-sm">
        {/* Line 1: Total + period + reset */}
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-baseline gap-2">
            <div className="text-3xl font-bold text-neutral-900">
              {formatCurrency(data.total, data.currency)}
            </div>
            <div className="text-xs text-neutral-500">last 12 months</div>
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

        {/* Line 2: Stats row */}
        <div className="flex gap-6 mb-4">
          <div>
            <div className="text-xs uppercase text-neutral-500 mb-0.5">Average</div>
            <div className="text-sm text-neutral-900 tabular-nums">
              {formatCurrency(data.avgPerMonth, data.currency)}/mo
            </div>
          </div>
          <div>
            <div className="text-xs uppercase text-neutral-500 mb-0.5">
              {selectedMonth ? formatMonthLabel(selectedMonth) : "Last month"}
            </div>
            <div className="text-sm text-neutral-900 tabular-nums">
              {formatCurrency(
                selectedMonth
                  ? (chartData.find(d => d.yearMonth === selectedMonth)?.amount || 0)
                  : (data.monthlySeries[data.monthlySeries.length - 1]?.amount || 0),
                data.currency
              )}
            </div>
          </div>
          {data.level === "merchant" && data.otherCategoriesTotal && data.otherCategoriesTotal > 0 && (
            <div>
              <div className="text-xs uppercase text-neutral-500 mb-0.5">Other categories</div>
              <div className="text-sm text-neutral-900 tabular-nums">
                {formatCurrency(data.otherCategoriesTotal, data.currency)}
              </div>
            </div>
          )}
        </div>

        {/* Actual paid vs scheduled note for Debt */}
        {data.kind === "debt" && data.level === "merchant" && data.actualPaidTotal !== undefined && (
          <div className="text-xs text-neutral-500 mt-1">
            Actually paid {formatCurrency(data.actualPaidTotal, data.currency)} in these 12 months
          </div>
        )}

        <div 
          style={{ height: "200px", position: "relative" }}
          onClick={(e) => {
            // Only handle clicks that bubble up from chart (not from dots, which stopPropagation)
            const rect = e.currentTarget.getBoundingClientRect();
            const offsetX = e.clientX - rect.left;
            const chartWidth = rect.width;
            
            // Map click position to nearest month
            // Since ResponsiveContainer doesn't expose plot area bounds, we map across full width
            // and clamp the index (plot starts after y-axis, but clamping handles edge cases)
            const relativeX = offsetX / chartWidth;
            const index = Math.round(relativeX * (chartData.length - 1));
            const clampedIndex = Math.max(0, Math.min(chartData.length - 1, index));
            
            setMonthForYearMonth(chartData[clampedIndex].yearMonth);
          }}
        >
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={chartData}
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
                    const dataPoint = payload[0].payload;
                    return (
                      <div className="bg-white border border-neutral-200 rounded-lg shadow-lg px-3 py-2">
                        <p className="text-xs text-neutral-600 mb-1">{dataPoint.month}</p>
                        <p className="text-sm font-semibold text-neutral-900">
                          {formatCurrency(dataPoint.amount, data.currency)}
                        </p>
                      </div>
                    );
                  }
                  return null;
                }}
              />
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
                    <g
                      onClick={(e) => {
                        e.stopPropagation();
                        setMonthForYearMonth(props.payload.yearMonth);
                      }}
                      style={{ cursor: "pointer" }}
                    >
                      {/* Transparent hit area */}
                      <circle
                        cx={props.cx}
                        cy={props.cy}
                        r={10}
                        fill="transparent"
                      />
                      {/* Visible dot */}
                      <circle
                        cx={props.cx}
                        cy={props.cy}
                        r={isSelected ? 5 : 3}
                        fill={isSelected ? "#059669" : "#10b981"}
                        stroke="#fff"
                        strokeWidth={2}
                      />
                    </g>
                  );
                }}
                activeDot={{ r: 5 }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {/* Comparison caption */}
        {data.comparisonSeries && (
          <div className="mt-3 text-xs text-neutral-500">
            {level === "category" ? (
              <>
                {formatCurrency(data.total, data.currency)} is {((data.total / data.comparisonSeries.reduce((sum, m) => sum + m.amount, 0)) * 100).toFixed(1)}% of the {formatCurrency(data.comparisonSeries.reduce((sum, m) => sum + m.amount, 0), data.currency)} you spent in these 12 months.
              </>
            ) : (
              <>
                {formatCurrency(data.total, data.currency)} is {((data.total / data.comparisonSeries.reduce((sum, m) => sum + m.amount, 0)) * 100).toFixed(1)}% of your {formatCurrency(data.comparisonSeries.reduce((sum, m) => sum + m.amount, 0), data.currency)} in {data.breadcrumb[1]?.label}.
              </>
            )}
          </div>
        )}

        {/* When and Where - only at category and merchant levels */}
        {level !== "all" && (data.cadence?.dayOfWeek || data.accounts) && (
          <div className="mt-4 pt-4 border-t border-neutral-200">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 lg:divide-x divide-neutral-200">
              {/* When it's charged */}
              {data.cadence?.dayOfWeek && (
                <div className="lg:pr-6">
                  <div className="text-xs uppercase text-neutral-500 mb-3">When it&apos;s charged</div>
                  <div className="text-sm text-neutral-600 mb-3">
                    {data.cadence.sentence || ""}
                  </div>
                  <div className="flex gap-2">
                    {data.cadence.dayOfWeek.map(d => {
                      const maxCount = Math.max(...(data.cadence?.dayOfWeek || []).map(dow => dow.count));
                      const heightPercent = maxCount > 0 ? (d.count / maxCount) * 100 : 0;
                      const isBusiest = d.count === maxCount && maxCount > 0;
                      
                      // Full day name for tooltip
                      const fullDayNames: Record<string, string> = {
                        "Sun": "Sunday", "Mon": "Monday", "Tue": "Tuesday", "Wed": "Wednesday",
                        "Thu": "Thursday", "Fri": "Friday", "Sat": "Saturday"
                      };
                      const fullDay = fullDayNames[d.day] || d.day;
                      
                      // Tooltip text
                      const tooltipText = d.count === 0
                        ? `${fullDay} · no charges`
                        : d.count === 1
                          ? `${fullDay} · 1 charge · ${formatCurrency(d.amount, data.currency)}`
                          : `${fullDay} · ${d.count} charges · ${formatCurrency(d.amount, data.currency)}`;
                      
                      return (
                        <div 
                          key={d.day} 
                          className="flex-1 flex flex-col items-center gap-1 cursor-default"
                          title={tooltipText}
                        >
                          <div className="w-full h-12 bg-neutral-100 rounded-sm relative flex items-end">
                            <div 
                              className="w-full bg-emerald-500 rounded-sm"
                              style={{ height: `${heightPercent}%` }}
                            ></div>
                          </div>
                          <div className={`text-xs ${isBusiest ? "text-neutral-900 font-medium" : "text-neutral-500"}`} style={{ fontSize: "11px" }}>
                            {d.day[0]}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Where it was charged */}
              {data.accounts && data.accounts.length > 0 && (
                <div className="lg:pl-6">
                  <div className="text-xs uppercase text-neutral-500 mb-3">Where it was charged</div>
                  <div className="space-y-2.5">
                    {data.accounts.slice(0, 3).map((acc) => (
                      <div key={acc.slug}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm text-neutral-800 truncate flex-1">{acc.label}</span>
                          <div className="flex items-center gap-3 ml-3 tabular-nums">
                            <span className="text-sm text-neutral-900 w-20 text-right">
                              {formatCurrency(acc.total, data.currency)}
                            </span>
                            <span className="text-sm text-neutral-500 w-10 text-right">
                              {Math.round(acc.share * 100)}%
                            </span>
                          </div>
                        </div>
                        <div className="w-full bg-neutral-100 rounded-full h-[3px]">
                          <div 
                            className="bg-emerald-500 h-[3px] rounded-full"
                            style={{ width: `${acc.share * 100}%` }}
                          ></div>
                        </div>
                      </div>
                    ))}
                    {data.accounts.length > 3 && (
                      <div className="text-neutral-500 mt-1" style={{ fontSize: "11px" }}>
                        +{data.accounts.length - 3} more
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Ranked List Card */}
      <div className="bg-white rounded-2xl border border-neutral-200 p-6 mb-6 shadow-sm">
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-neutral-900">
            {level === "all" 
              ? "Categories" 
              : level === "category" 
                ? (data.kind === "debt" ? "Debt accounts" : "Merchants")
                : (data.kind === "debt" ? "Monthly schedule" : "Transactions")}
            {selectedMonth && level !== "merchant" && (
              <span className="ml-2 text-sm font-normal text-neutral-500">
                — {formatMonthLabel(selectedMonth)} only
              </span>
            )}
          </h2>
          {!selectedMonth && level !== "merchant" && data.rankedItems.some(item => item.trend !== 0 && Math.round(Math.abs(item.trend)) !== 0) && (
            <p className="text-xs text-neutral-500 mt-1">Trend compares the last 3 months with the 12-month average.</p>
          )}
        </div>
        
        {level === "merchant" ? (
          // Transaction list with columns
          <div className="space-y-1">
            {data.rankedItems.map((item, idx) => {
              const parts = item.name.split(" • ");
              const date = parts[0] || "";
              const account = parts[1] || "";
              return (
                <div
                  key={idx}
                  className="flex items-center gap-3 p-2 rounded-lg hover:bg-neutral-50"
                >
                  <div className="text-sm text-neutral-600 w-20">{date}</div>
                  <div className="flex-1 text-sm text-neutral-900">{data.breadcrumb[2]?.label}</div>
                  <div className="text-xs text-neutral-500 w-24 truncate">{account}</div>
                  <div className="text-sm font-semibold text-neutral-900 tabular-nums w-24 text-right">
                    {formatCurrency(item.total, data.currency)}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="space-y-2">
            {displayedItems.map((item, idx) => {
              const isOther = item.slug === "other";
              const isClickable = !isOther;
              
              return (
                <div
                  key={item.slug}
                  className={`flex items-center gap-3 p-3 rounded-lg transition-colors ${
                    isClickable ? "hover:bg-neutral-50 cursor-pointer" : "cursor-default"
                  }`}
                  onClick={() => isClickable && handleItemClick(item)}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <div>
                        <div className="font-medium text-neutral-900">{item.name}</div>
                        {item.subLabel && (
                          <div className="text-xs text-neutral-500" style={{ fontSize: "12px" }}>
                            {item.subLabel}
                          </div>
                        )}
                      </div>
                      {!selectedMonth && item.monthlySeries.length > 0 && !isOther && (
                        <div className="flex-shrink-0" style={{ width: "60px", height: "20px" }}>
                          <ResponsiveContainer width="100%" height="100%">
                            <ComposedChart data={item.monthlySeries.map(m => ({ amount: m.amount }))}>
                              <Line type="monotone" dataKey="amount" stroke="#10b981" strokeWidth={1} dot={false} />
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
                  
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <div className="font-semibold text-neutral-900 tabular-nums">
                        {formatCurrency(item.displayTotal, data.currency)}
                      </div>
                      {!selectedMonth && item.trend !== 0 && Math.round(Math.abs(item.trend)) !== 0 && (
                        <div className={`text-xs tabular-nums ${item.trend > 0 ? "text-red-600" : "text-green-600"}`}>
                          {item.trend > 0 ? "↑" : "↓"} {formatCurrency(Math.abs(item.trend), data.currency)}/mo vs avg
                        </div>
                      )}
                    </div>
                    
                    {isClickable && (
                      <svg className="w-5 h-5 text-neutral-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
