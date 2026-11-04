"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ResponsiveContainer, ComposedChart, Line, Area, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";
import { formatCurrency, getCurrencySymbol } from "@/lib/currencyUtils";
import { ReviewList } from "@/components/ReviewList";
import { MergeMerchantsPanel } from "./MergeMerchantsPanel";

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
  extras?: Array<{ yearMonth: string; amount: number }>;
  kind?: "loan" | "card";
  category?: string;
  txCount?: number;
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

interface DebtExcluded {
  inactiveAccounts: number;
}

interface DebtGroup {
  key: string;
  label: string;
  counted: boolean;
  total: number;
  subLabel: string;
  items: RankedItem[];
}

interface DrilldownData {
  level: "all" | "category" | "merchant" | "search";
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
  basis?: "actual";
  excluded?: DebtExcluded;
  currency: string;
  groups?: DebtGroup[];
  oneOffTotal?: number;
  oneOffLabel?: string;
  query?: string;
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
  const [showMergePanel, setShowMergePanel] = useState(false);
  const [mergeFor, setMergeFor] = useState<{ name: string; slug: string; total: number; txCount: number; category: string } | null>(null);

  const category = searchParams.get("category") || "";
  const merchant = searchParams.get("merchant") || "";
  const searchQuery = searchParams.get("q") || "";
  
  const level = merchant ? "merchant" : category ? "category" : searchQuery ? "search" : "all";
  
  const [searchInput, setSearchInput] = useState(searchQuery);

  // silent: refresh the numbers without unmounting the page. A merge panel on
  // top of the page must survive its own refresh, otherwise it remounts and
  // reopens on the merchant that was just merged.
  const loadData = async (options?: { silent?: boolean }) => {
    const silent = options?.silent === true;
    if (!silent) {
      setLoading(true);
      setError(null);
    }

    try {
      const params = new URLSearchParams({ level });
      if (category) params.set("category", category);
      if (merchant) params.set("merchant", merchant);
      if (searchQuery) params.set("q", searchQuery);

      const res = await fetch(`/api/user/spending/drilldown?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({ error: "Failed to load data" }));
        throw new Error(errorData.error || "Failed to load data");
      }

      const result = await res.json();
      setData(result);
    } catch (err) {
      if (!silent) setError(err instanceof Error ? err.message : "Failed to load data");
    } finally {
      if (!silent) setLoading(false);
    }
  };

  const handleReviewComplete = async () => {
    // Refetch data after user classifies a debt payment
    await loadData();
  };

  useEffect(() => {
    loadData();
  }, [token, level, category, merchant, searchQuery]);

  // Keep searchInput in sync with URL query changes
  useEffect(() => {
    setSearchInput(searchQuery);
  }, [searchQuery]);

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
    } else if (level === "search" && item.category) {
      // From search results, navigate to merchant detail with both category and merchant
      router.push(`/account/spending?category=${encodeURIComponent(item.category)}&merchant=${encodeURIComponent(item.slug)}`);
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
        .filter(item => item.displayTotal > 0 || item.slug === "debt")
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

  // Debt groups, narrowed to the selected month when one is picked
  const groupsForDisplay = (data.groups || []).map((group) => {
    if (!selectedMonth) return group;
    const items = group.items
      .map((item) => {
        const monthAmount = item.monthlySeries.find((m) => m.yearMonth === selectedMonth)?.amount || 0;
        return { ...item, total: monthAmount };
      })
      .filter((item) => item.total > 0);
    const total = items.reduce((sum, item) => sum + item.total, 0);
    return {
      ...group,
      total,
      items: items.map((item) => ({ ...item, share: total > 0 ? item.total / total : 0 })),
    };
  });

  const debtPeriodLabel = selectedMonth ? "that month" : "the last 12 months";
  const debtLoanShown = groupsForDisplay.find((g) => g.key === "loans")?.total || 0;
  const debtCardShown = groupsForDisplay.find((g) => g.key === "cards")?.total || 0;
  const debtOneOffShown = groupsForDisplay.reduce((sum, g) => {
    return sum + g.items.reduce((s2, item) => {
      const extras = item.extras || [];
      const filtered = selectedMonth ? extras.filter((e) => e.yearMonth === selectedMonth) : extras;
      return s2 + filtered.reduce((s3, e) => s3 + e.amount, 0);
    }, 0);
  }, 0);

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
      </div>

      {/* Merchant Search (All spending and search levels) */}
      {(data.level === "all" || data.level === "search") && (
        <div className="mb-6 flex items-center justify-between gap-4">
          <div className="relative w-full max-w-sm">
            <input
              type="text"
              aria-label="Search merchants"
              placeholder="Search merchants"
              autoComplete="off"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && searchInput.trim().length >= 2) {
                  const url = new URL(window.location.href);
                  url.searchParams.set("q", searchInput.trim());
                  router.push(url.pathname + url.search);
                } else if (e.key === "Escape") {
                  setSearchInput("");
                  const url = new URL(window.location.href);
                  url.searchParams.delete("q");
                  router.push(url.pathname + url.search);
                }
              }}
              className="w-full rounded-full border border-neutral-300 bg-white py-2 pl-9 pr-8 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-purple-500"
            />
            <svg
              className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 transform text-neutral-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
            {searchInput && (
              <button
                onClick={() => {
                  setSearchInput("");
                  const url = new URL(window.location.href);
                  url.searchParams.delete("q");
                  router.push(url.pathname + url.search);
                }}
                className="absolute right-2 top-1/2 -translate-y-1/2 transform text-neutral-400 hover:text-neutral-600"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
          <button
            onClick={() => {
              setMergeFor(null);
              setShowMergePanel(true);
            }}
            className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-sm font-medium text-neutral-600 hover:text-purple-700"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 7h12m0 0l-3-3m3 3l-3 3M16 17H4m0 0l3-3m-3 3l3 3" />
            </svg>
            Find duplicates
          </button>
        </div>
      )}

      {/* Debt Payment Review List */}
      <div className="mb-6">
        <ReviewList
          token={token}
          reviewType="debt_payment"
          onReviewComplete={handleReviewComplete}
        />
      </div>

      {/* Header Card */}
      {data.level === "search" ? (
        // Search results header (no chart)
        <div className="bg-white rounded-2xl border border-neutral-200 p-6 mb-6 shadow-sm">
          <div className="text-lg font-semibold text-neutral-900 mb-1">
            {data.rankedItems.length} merchant{data.rankedItems.length !== 1 ? 's' : ''} match "{data.query}"
          </div>
          {data.rankedItems.length > 0 && (
            <div className="text-sm text-neutral-600">
              Combined total: {formatCurrency(data.total, data.currency)} across 12 months
            </div>
          )}
        </div>
      ) : (
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

        {/* Debt level 2 caption */}
        {data.kind === "debt" && data.level === "category" && data.basis === "actual" && (
          <div className="text-xs text-neutral-500 mt-1">
            What you actually paid in regular monthly payments. One-off payments are shown below and not included.
          </div>
        )}

        {/* Level 1 (All spending) caption */}
        {data.level === "all" && (
          <div className="text-xs text-neutral-500 mt-1">
            Purchases plus loan payments. Card payments and one-off payments are shown inside Debt and not added.
          </div>
        )}

        {/* Two-box strip for Debt level 2 */}
        {data.kind === "debt" && data.level === "category" && data.groups && (
          <div className="flex gap-2 mt-3">
            <div className="flex-1 border border-green-200 bg-green-50 rounded-lg p-3">
              <div className="text-xs text-green-700 font-medium mb-1">Regular payments</div>
              <div className="text-lg font-semibold text-green-900 tabular-nums">
                {formatCurrency(selectedMonth ? debtLoanShown : data.total, data.currency)}
              </div>
              <div className="text-xs text-green-700 mt-1 leading-snug">
                Loan payments, counted in spending.
              </div>
              {debtCardShown > 0 && (
                <div className="text-xs text-neutral-600 mt-1 leading-snug">
                  Credit cards add {formatCurrency(debtCardShown, data.currency)} of estimated payments, shown below. Those purchases are already counted, so they are not added again.
                </div>
              )}
            </div>
            <div className="flex-1 border border-neutral-200 bg-neutral-50 rounded-lg p-3">
              <div className="text-xs text-neutral-700 font-medium mb-1">One-off payments</div>
              <div className="text-lg font-semibold text-neutral-700 tabular-nums">
                {formatCurrency(debtOneOffShown, data.currency)}
              </div>
              <div className="text-xs text-neutral-600 mt-1 leading-snug">
                Not counted over {debtPeriodLabel} — already in your spending.
              </div>
            </div>
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
      )}

      {/* Ranked List Card */}
      <div className="bg-white rounded-2xl border border-neutral-200 p-6 mb-6 shadow-sm">
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-neutral-900">
            {level === "all" 
              ? "Categories" 
              : level === "category" 
                ? (data.kind === "debt" ? "Debt accounts" : "Merchants")
                : level === "search"
                  ? "Merchants"
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
        
        {level === "merchant" && data.kind === "debt" ? (
          // Monthly schedule for a single debt account (regular payments + one-offs)
          <div className="space-y-1">
            <div className="flex items-center gap-3 px-2 pb-2 text-xs uppercase tracking-wide text-neutral-500">
              <div className="w-24">Month</div>
              <div className="flex-1">Regular payment</div>
              <div className="w-32 text-right">Amount</div>
            </div>
            {data.rankedItems.map((item, idx) => (
              <div key={idx}>
                <div className="flex items-center gap-3 p-2 rounded-lg hover:bg-neutral-50">
                  <div className="text-sm text-neutral-600 w-24">{item.name}</div>
                  <div className="flex-1 text-xs text-neutral-500">{item.subLabel || "Regular payment"}</div>
                  <div className="text-sm font-semibold text-neutral-900 tabular-nums w-32 text-right">
                    {formatCurrency(item.total, data.currency)}
                  </div>
                </div>
                {item.extras && item.extras.map((extra) => (
                  <div key={`${idx}-${extra.yearMonth}`} className="ml-8 flex items-center gap-2 px-2 py-1.5 text-xs text-neutral-500">
                    <div>{item.name} · extra</div>
                    <div className="flex-1"></div>
                    <div className="px-2 py-0.5 bg-neutral-100 rounded text-neutral-600 text-[11px]">once</div>
                    <div className="tabular-nums font-medium w-32 text-right">{formatCurrency(extra.amount, data.currency)}</div>
                  </div>
                ))}
              </div>
            ))}
            <div className="mt-3 p-3 bg-neutral-50 rounded-lg text-sm text-neutral-600">
              Only the regular payment is counted. One-off payments appear here and in the Debt list, and never add to the total.
            </div>
          </div>
        ) : level === "merchant" ? (
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
        ) : data.groups ? (
          // Grouped view for Debt level 2
          <div className="space-y-6">
            {groupsForDisplay.map((group) => (
              <div key={group.key}>
                <div className="mb-3 flex items-center gap-2">
                  <div className="text-xs uppercase tracking-wide font-semibold text-neutral-700">
                    {group.label}
                  </div>
                  <div className="text-xs text-neutral-500">· {group.subLabel}</div>
                </div>
                
                <div className="space-y-2">
                  {group.items.map((item) => {
                    const isCounted = group.counted;
                    const textColor = isCounted ? "text-neutral-900" : "text-neutral-500";
                    const barColor = isCounted ? "bg-emerald-500" : "bg-neutral-300";
                    
                    return (
                      <div key={item.slug}>
                        <div
                          className={`flex items-center gap-3 p-3 rounded-lg transition-colors ${
                            isCounted ? "hover:bg-neutral-50 cursor-pointer" : "hover:bg-neutral-50 cursor-pointer opacity-75"
                          }`}
                          onClick={() => handleItemClick(item)}
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <div>
                                <div className={`font-medium ${textColor}`}>{item.name}</div>
                                {item.subLabel && (
                                  <div className="text-xs text-neutral-400" style={{ fontSize: "12px" }}>
                                    {item.subLabel}
                                  </div>
                                )}
                              </div>
                            </div>
                            <div className="w-full bg-neutral-100 rounded-full h-1.5 mb-1">
                              <div 
                                className={`${barColor} h-1.5 rounded-full`}
                                style={{ width: `${Math.min(item.share * 100, 100)}%` }}
                              ></div>
                            </div>
                          </div>
                          
                          <div className="flex items-center gap-3">
                            <div className="text-right">
                              <div className={`font-semibold ${textColor} tabular-nums`}>
                                {formatCurrency(item.total, data.currency)}
                              </div>
                            </div>
                            
                            <svg className="w-5 h-5 text-neutral-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                            </svg>
                          </div>
                        </div>
                        
                        {/* Extras as indented sub-rows */}
                        {item.extras && item.extras.length > 0 && item.extras.map((extra) => {
                          const [year, month] = extra.yearMonth.split("-");
                          const monthLabel = new Date(parseInt(year), parseInt(month) - 1).toLocaleDateString("en-US", { 
                            month: "short", 
                            year: "numeric" 
                          });
                          
                          return (
                            <div key={extra.yearMonth} className="ml-8 flex items-center gap-2 p-2 text-xs text-neutral-500">
                              <div>{monthLabel} · extra</div>
                              <div className="flex-1"></div>
                              <div className="px-2 py-0.5 bg-neutral-100 rounded text-neutral-600 text-[11px]">once</div>
                              <div className="tabular-nums font-medium w-20 text-right">{formatCurrency(extra.amount, data.currency)}</div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
                
                {/* Group subtotal */}
                <div className="mt-3 pt-2 border-t border-neutral-100 text-xs text-neutral-600 flex justify-between">
                  <div>{group.counted ? (selectedMonth ? "Loans that month, added" : "Loans added to spending") : (selectedMonth ? "Cards that month, not added" : "Cards, not added")}</div>
                  <div className="font-semibold tabular-nums">{formatCurrency(group.total, data.currency)}</div>
                </div>
              </div>
            ))}
            
            {/* Info note for cards */}
            <div className="flex gap-3 p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <svg className="w-5 h-5 text-blue-600 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
              </svg>
              <div className="text-sm text-blue-900">
                Card payments are estimated from what you actually paid. Their purchases are already counted under Groceries, Dining and the rest, so the payment itself is not added again.
              </div>
            </div>
            
            {/* One-off total line */}
            {data.oneOffTotal && data.oneOffTotal > 0 && (
              <div className="flex justify-between items-center p-3 bg-neutral-50 rounded-lg">
                <div className="text-sm text-neutral-700">{data.oneOffLabel || "One-off payments"}</div>
                <div className="font-semibold text-neutral-900 tabular-nums">{formatCurrency(data.oneOffTotal, data.currency)}</div>
              </div>
            )}
          </div>
        ) : data.level === "search" ? (
          // Search results view (no bar, no sparkline)
          data.rankedItems.length === 0 ? (
            <div className="text-center py-8 text-neutral-500">
              No merchants match "{data.query}".
            </div>
          ) : (
            <div className="space-y-2">
              {data.rankedItems.map((item) => (
                <div
                  key={`${item.category}-${item.slug}`}
                  className="flex items-center gap-3 p-3 rounded-lg transition-colors hover:bg-neutral-50 cursor-pointer"
                  onClick={() => handleItemClick(item)}
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-neutral-900">{item.name}</div>
                    <div className="text-xs text-neutral-500" style={{ fontSize: "12px" }}>
                      {item.subLabel ?? `${item.category} · ${item.txCount} transaction${item.txCount !== 1 ? "s" : ""}`}
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <div className="font-semibold text-neutral-900 tabular-nums">
                        {formatCurrency(item.total, data.currency)}
                      </div>
                    </div>

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setMergeFor({
                          name: item.name,
                          slug: item.slug,
                          total: item.total,
                          txCount: item.txCount ?? 0,
                          category: item.category ?? "",
                        });
                        setShowMergePanel(true);
                      }}
                      className="rounded-md border border-neutral-200 px-2 py-1 text-xs font-medium text-neutral-600 hover:border-purple-300 hover:text-purple-700"
                    >
                      Merge
                    </button>

                    <svg className="w-5 h-5 text-neutral-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                </div>
              ))}
            </div>
          )
        ) : (
          // Regular ranked items view
          <div className="space-y-2">
            {displayedItems.map((item, idx) => {
              const isOther = item.slug === "other";
              const isDebt = item.slug === "debt";
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
                      {!selectedMonth && !isDebt && item.trend !== 0 && Math.round(Math.abs(item.trend)) !== 0 && (
                        <div className={`text-xs tabular-nums ${item.trend > 0 ? "text-red-600" : "text-green-600"}`}>
                          {item.trend > 0 ? "↑" : "↓"} {formatCurrency(Math.abs(item.trend), data.currency)}/mo vs avg
                        </div>
                      )}
                      {isDebt && item.subLabel && (
                        <div className="text-xs text-neutral-500">
                          {item.subLabel}
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
            
            {/* Note under level 1 (All spending) */}
            {data.level === "all" && (
              <div className="mt-4 p-3 bg-neutral-50 rounded-lg text-sm text-neutral-600">
                The Debt row is loan payments only — mortgage, car, home equity line. Card payments sit inside it as information, because those purchases already appear in the category rows above. One-off payments are listed inside Debt too and never add to the total.
              </div>
            )}
          </div>
        )}
      </div>

      {/* Merge Merchants Panel */}
      {showMergePanel && (
        <MergeMerchantsPanel
          token={token}
          initialMerchant={mergeFor}
          onClose={() => {
            setShowMergePanel(false);
            setMergeFor(null);
          }}
          onMergeComplete={() => {
            // Forget the row that opened the panel, so it can never reopen
            // scoped to a merchant that has just been merged.
            setMergeFor(null);
            // Refresh in place; a full reload would remount the panel
            loadData({ silent: true });
          }}
          currency={data?.currency || "usd"}
        />
      )}
    </div>
  );
}
