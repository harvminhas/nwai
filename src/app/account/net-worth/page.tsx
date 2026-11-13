"use client";

import { useEffect, useState, Suspense } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseClient } from "@/lib/firebase";
import { formatCurrency, formatCurrencyWithCents, getCurrencySymbol } from "@/lib/currencyUtils";
import type { MonthNetWorthSummary } from "@/lib/netWorthChanges";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Area, ComposedChart, Dot } from "recharts";
import { calculateBalanceChartDomain, formatChartAxisValue } from "@/lib/chartDomain";
import { useLgUp } from "@/lib/useLgUp";
import { IntactAmount } from "@/components/IntactAmount";
import {
  NET_WORTH_CARD_CLASS,
  NET_WORTH_CHANGE_LINE_CLASS,
  NET_WORTH_HEADER_STACK_CLASS,
  NET_WORTH_HEADER_VALUE_CLASS,
  NET_WORTH_LABEL_CLASS,
  NET_WORTH_MONTH_DESKTOP_CLASS,
  NET_WORTH_MONTH_MOBILE_CLASS,
  NET_WORTH_TAB_BUTTON_BASE,
  NET_WORTH_TABS_ROW_CLASS,
} from "@/components/netWorthReadLayout";
import { netWorthAccountRow } from "@/lib/accountDetailHref";
import {
  latestSelectableMonth,
  selectionAfterRangeChange,
  sliceHistoryByRange,
} from "@/lib/chartMonthSelection";

const CHART_RANGES = [
  { label: "3M", months: 3 },
  { label: "6M", months: 6 },
  { label: "All", months: 0 },
] as const;

interface MonthlyNetWorthData {
  yearMonth: string;
  netWorth: number;
  totalAssets: number;
  totalDebts: number;
  change: number | null;
  changePercent: number | null;
  items: MonthNetWorthSummary["items"];
  byAccount: Array<{
    slug: string;
    label: string;
    type: string;
    value: number;
  }>;
}

function NetWorthPageContent() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<MonthlyNetWorthData[]>([]);
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  const [viewMonth, setViewMonth] = useState<string | null>(null); // For interactive header
  const [currency, setCurrency] = useState<string>("CAD");
  const [activeTab, setActiveTab] = useState<"changes" | "assets" | "debts">("changes");
  const [chartRange, setChartRange] = useState(0); // All — preserves the existing 12-month window
  const [priorMonth, setPriorMonth] = useState<MonthlyNetWorthData | null>(null);
  const isLgUp = useLgUp();

  const loadData = async (tok: string) => {
    try {
      // Fetch net worth data from same source as nav pill (getFinancialProfile)
      const summaryRes = await fetch("/api/user/net-worth-summary", {
        headers: { Authorization: `Bearer ${tok}` },
      });

      if (!summaryRes.ok) {
        const errorData = await summaryRes.json().catch(() => ({ error: "Failed to load net worth data" }));
        throw new Error(errorData.error || "Failed to load net worth data");
      }

      const summary = await summaryRes.json();
      const monthlyHistory = (summary.monthlyHistory || []) as Array<{ 
        yearMonth: string; 
        netWorth: number;
        totalAssets: number;
        totalDebts: number;
        byAccount: Array<{ slug: string; label: string; type: string; value: number }>;
      }>;
      const prior = summary.priorMonth as {
        yearMonth: string;
        netWorth: number;
        totalAssets?: number;
        totalDebts?: number;
        byAccount?: Array<{ slug: string; label: string; type: string; value: number }>;
      } | null;
      setCurrency(summary.currency || "CAD");
      setPriorMonth(
        prior
          ? {
              yearMonth: prior.yearMonth,
              netWorth: prior.netWorth,
              totalAssets: prior.totalAssets ?? 0,
              totalDebts: prior.totalDebts ?? 0,
              change: null,
              changePercent: null,
              items: [],
              byAccount: prior.byAccount || [],
            }
          : null,
      );

      if (monthlyHistory.length === 0) {
        setError("No net worth data available yet. Upload some statements to get started.");
        setLoading(false);
        return;
      }

      const changesRes = await fetch("/api/user/net-worth-changes", {
        headers: { Authorization: `Bearer ${tok}` },
      });

      const changesData = await changesRes.json().catch(() => ({ changes: [] }));
      const changes = (changesData.changes || []) as MonthNetWorthSummary[];

      // Build change items map by month
      const changesByMonth = new Map<string, MonthNetWorthSummary["items"]>();
      for (const change of changes) {
        changesByMonth.set(change.month, change.items);
      }

      // Build final data structure: net worth values from profile, change items from feed
      const combinedData: MonthlyNetWorthData[] = monthlyHistory.map((month, idx) => {
        const prevMonth = idx > 0 ? monthlyHistory[idx - 1] : prior ?? null;
        const change = prevMonth ? month.netWorth - prevMonth.netWorth : null;
        const changePercent = prevMonth && prevMonth.netWorth !== 0 
          ? (change! / Math.abs(prevMonth.netWorth)) * 100 
          : null;

        return {
          yearMonth: month.yearMonth,
          netWorth: month.netWorth,
          totalAssets: month.totalAssets,
          totalDebts: month.totalDebts,
          change,
          changePercent,
          items: changesByMonth.get(month.yearMonth) || [],
          byAccount: month.byAccount || [],
        };
      });

      setData(combinedData);

      // Select most recent month by default (explicit max comparison, not array position)
      if (combinedData.length > 0 && !selectedMonth) {
        const latest = combinedData.reduce((max, m) => 
          m.yearMonth > max.yearMonth ? m : max
        );
        setSelectedMonth(latest.yearMonth);
      }

      // Update netWorthLastViewedAt to clear the badge count
      await fetch("/api/user/profile", {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${tok}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          netWorthLastViewedAt: new Date().toISOString(),
        }),
      }).catch(err => console.error("Failed to update netWorthLastViewedAt:", err));

      // Dispatch event to immediately clear nav badge
      window.dispatchEvent(new Event('networth-viewed'));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load net worth data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const { auth } = getFirebaseClient();
    return onAuthStateChanged(auth, async (user) => {
      if (!user) {
        router.push("/login");
        return;
      }

      setLoading(true);
      setError(null);
      const tok = await user.getIdToken();
      await loadData(tok);
    });
  }, [router]);

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-purple-600 border-t-transparent" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-5xl px-4 pt-4 pb-8 sm:py-8">
        <p className="text-red-600">{error}</p>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="mx-auto max-w-5xl px-4 pt-4 pb-8 sm:py-8">
        <p className="text-gray-600">No net worth data available yet. Upload some statements to get started.</p>
      </div>
    );
  }

  // Get latest month by explicit max yearMonth comparison (not array position)
  // Handles out-of-order history or cache inconsistencies
  const latestMonth = data.reduce((max, m) => 
    m.yearMonth > max.yearMonth ? m : max
  , data[0]);

  const sortedData = [...data].sort((a, b) => a.yearMonth.localeCompare(b.yearMonth));
  const chartData = sliceHistoryByRange(sortedData, chartRange);
  const latestVisibleYm = latestSelectableMonth(chartData);

  const handleChartRange = (months: number) => {
    setChartRange(months);
    const next = sliceHistoryByRange(sortedData, months);
    const nextYm = selectionAfterRangeChange(selectedMonth, next);
    if (nextYm && nextYm !== selectedMonth) {
      setSelectedMonth(nextYm);
      setViewMonth(nextYm);
    }
  };
  
  const viewData = viewMonth 
    ? data.find(d => d.yearMonth === viewMonth) || latestMonth 
    : latestMonth;
  const isViewingLatest = !viewMonth || viewMonth === latestMonth.yearMonth;
  const selectedData = data.find(d => d.yearMonth === selectedMonth) || latestMonth;
  const chartDomain = calculateBalanceChartDomain(chartData.map(d => d.netWorth));
  const breakdownPeriodLabel = formatMonthLabel(selectedData.yearMonth);

  // Helper to categorize items by filter type

  // Calculate breakdown using per-account contributions (byAccount)
  // This adds up EXACTLY by construction since it uses the same carry-forward logic
  const selectedIdx = data.findIndex(d => d.yearMonth === selectedMonth);
  const previousData = selectedIdx > 0 ? data[selectedIdx - 1] : selectedIdx === 0 ? priorMonth : null;
  
  interface BreakdownLine {
    category: "assets" | "debts";
    label: string;
    amount: number;
    href: string | null;
    isBaseline?: boolean; // First appearance of account (not a real change)
  }
  
  const breakdownLines: BreakdownLine[] = [];
  const baselineLines: BreakdownLine[] = [];
  
  if (previousData) {
    // Build maps of current and previous account values
    const currentBySlug = new Map(selectedData.byAccount.map(a => [a.slug, a]));
    const previousBySlug = new Map(previousData.byAccount.map(a => [a.slug, a]));
    
    // Get all account slugs from both months
    const allSlugs = new Set([...currentBySlug.keys(), ...previousBySlug.keys()]);
    
    for (const slug of allSlugs) {
      const current = currentBySlug.get(slug);
      const previous = previousBySlug.get(slug);
      
      const currentValue = current?.value ?? 0;
      const previousValue = previous?.value ?? 0;
      const change = currentValue - previousValue;
      
      // Skip zero changes
      if (Math.abs(change) < 0.01) continue;
      
      // Determine category (assets are positive, debts are negative)
      const category = currentValue >= 0 || previousValue >= 0 ? "assets" : "debts";
      
      // Check if this is a first appearance (baseline)
      const isBaseline = previous === undefined && current !== undefined;
      
      // Check if this is a new manual asset (from change items)
      const isNewAsset = selectedData.items.some(
        item => item.type === "new_asset" && item.accountSlug === slug
      );
      
      const row = netWorthAccountRow({
        slug,
        label: current?.label || previous?.label || slug,
        type: current?.type || previous?.type,
        side: category === "debts" ? "debt" : "asset",
        isBaseline,
        isNewAsset,
      });
      const line: BreakdownLine = {
        category,
        label: row.label,
        amount: change,
        href: row.href,
        isBaseline,
      };
      
      if (isBaseline) {
        baselineLines.push(line);
      } else {
        breakdownLines.push(line);
      }
    }
    
    // Verify the sum equals the net worth change (should be exact by construction)
    const realChangeTotal = breakdownLines.reduce((sum, line) => sum + line.amount, 0);
    const baselineTotal = baselineLines.reduce((sum, line) => sum + line.amount, 0);
    const computedTotal = realChangeTotal + baselineTotal;
    const actualChange = selectedData.change || 0;
    const roundingDiff = actualChange - computedTotal;
    
    // Only plug sub-$1 rounding differences
    if (Math.abs(roundingDiff) >= 1.0) {
      console.error(`What moved it breakdown doesn't add up: computed ${computedTotal}, actual ${actualChange}, diff ${roundingDiff}`);
    } else if (Math.abs(roundingDiff) > 0.01 && (breakdownLines.length > 0 || baselineLines.length > 0)) {
      // Apply sub-$1 rounding difference to largest line (prefer real changes over baselines)
      const allLines = [...breakdownLines, ...baselineLines];
      if (allLines.length > 0) {
        const largestLine = allLines.reduce((max, line) => 
          Math.abs(line.amount) > Math.abs(max.amount) ? line : max
        );
        largestLine.amount += roundingDiff;
      }
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-4 pt-4 pb-8 sm:py-8">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-1">
          <Link href="/account/overview" className="text-sm text-gray-500 hover:text-gray-700">
            Account
          </Link>
          <span className="text-gray-400">/</span>
          <span className="text-sm font-medium text-gray-900">Net Worth</span>
        </div>
        <div className={NET_WORTH_HEADER_STACK_CLASS}>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Net Worth</h1>
            <p className="text-sm text-gray-500 mt-1">
              Track your wealth over time
            </p>
          </div>
          <div className={NET_WORTH_HEADER_VALUE_CLASS}>
            <div className="flex items-center gap-2 mb-1 lg:justify-end">
              <div className="text-3xl font-bold text-gray-900 tabular-nums whitespace-nowrap">
                {formatCurrency(viewData.netWorth, currency)}
              </div>
              {!isViewingLatest && (
                <button
                  onClick={() => setViewMonth(null)}
                  className="flex items-center justify-center w-6 h-6 rounded-md text-purple-600 hover:text-purple-700 hover:bg-purple-50 transition-colors"
                  title="Back to latest"
                  aria-label="Back to latest"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                </button>
              )}
            </div>
            {!isViewingLatest && (
              <div className="text-xs text-gray-500 mb-1">
                as of {new Date(viewData.yearMonth + "-15").toLocaleDateString("en-US", { month: "short", year: "numeric" })}
              </div>
            )}
            {viewData.change !== null && (
              <div className={`${NET_WORTH_CHANGE_LINE_CLASS} ${
                viewData.change > 0 ? "text-green-600" : 
                viewData.change < 0 ? "text-red-600" : "text-gray-500"
              }`}>
                {viewData.change > 0 ? "+" : ""}
                {formatCurrency(viewData.change, currency)}
                {viewData.changePercent !== null && (
                  <span className="ml-1">
                    ({viewData.changePercent > 0 ? "+" : ""}
                    {viewData.changePercent.toFixed(1)}%)
                  </span>
                )}
                <span className="text-gray-400 ml-2">vs last month</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Trend chart */}
      <div className={NET_WORTH_CARD_CLASS}>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-gray-900">{formatNetWorthChartTitle(chartRange)}</h2>
          <div className="flex gap-1">
            {latestVisibleYm && selectedMonth && selectedMonth !== latestVisibleYm && (
              <button
                type="button"
                onClick={() => {
                  setSelectedMonth(latestVisibleYm);
                  setViewMonth(latestVisibleYm);
                }}
                className="rounded-full px-3 py-1 text-xs font-medium text-gray-400 hover:text-gray-600 transition"
              >
                Latest
              </button>
            )}
            {CHART_RANGES.map((r) => (
              <button
                key={r.label}
                type="button"
                onClick={() => handleChartRange(r.months)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                  chartRange === r.months
                    ? "bg-purple-100 text-purple-700"
                    : "text-gray-400 hover:text-gray-600"
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
        <div className="relative" style={{ height: "340px" }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={chartData.map(d => ({
                month: formatMonthLabel(d.yearMonth),
                yearMonth: d.yearMonth,
                netWorth: d.netWorth,
                hasPaidOff: d.items.some(i => i.type === "account_paid_off"),
                hasNewAccount: d.items.some(i => i.type === "account_added"),
                hasNewAsset: d.items.some(i => i.type === "new_asset"),
              }))}
              onClick={(e: any) => {
                if (e?.activeLabel) {
                  const month = e.activeLabel;
                  const matchedData = chartData.find(d => formatMonthLabel(d.yearMonth) === month);
                  if (matchedData) {
                    setSelectedMonth(matchedData.yearMonth);
                    setViewMonth(matchedData.yearMonth);
                  }
                }
              }}
              margin={{ top: 20, right: 10, left: 10, bottom: 0 }}
            >
              <defs>
                <linearGradient id="netWorthGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.15}/>
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0.02}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
              <XAxis 
                dataKey="month" 
                tick={{ fontSize: 12, fill: "#6b7280" }}
                axisLine={{ stroke: "#e5e7eb" }}
                tickLine={{ stroke: "#e5e7eb" }}
              />
              <YAxis 
                domain={[chartDomain.min, chartDomain.max]}
                tick={{ fontSize: 12, fill: "#6b7280" }}
                axisLine={{ stroke: "#e5e7eb" }}
                tickLine={{ stroke: "#e5e7eb" }}
                {...(!isLgUp ? { tickCount: 4, width: 80, interval: 0 } : {})}
                tickFormatter={(value: number) => {
                  if (isLgUp) {
                    const sym = getCurrencySymbol(currency);
                    const abs = Math.abs(value);
                    if (abs >= 1_000_000) return `${sym}${(value / 1_000_000).toFixed(1)}M`;
                    if (abs >= 1_000) return `${sym}${Math.round(value / 1_000)}k`;
                    return `${sym}${value}`;
                  }
                  return formatChartAxisValue(
                    value,
                    getCurrencySymbol(currency),
                    { precision: "distinct", domain: chartDomain }
                  );
                }}
              />
              <Tooltip 
                content={({ active, payload }) => {
                  if (active && payload && payload[0]) {
                    const data = payload[0].payload;
                    return (
                      <div className="bg-white border border-gray-200 rounded-lg shadow-lg px-3 py-2">
                        <p className="text-xs text-gray-600 mb-1">{data.month}</p>
                        <p className="text-sm font-semibold text-gray-900">
                          {formatCurrency(data.netWorth, currency)}
                        </p>
                        {(data.hasPaidOff || data.hasNewAccount || data.hasNewAsset) && (
                          <div className="mt-1 flex gap-2 text-xs">
                            {data.hasPaidOff && <span className="text-green-600">● Paid off</span>}
                            {data.hasNewAccount && <span className="text-blue-600">● New account</span>}
                            {data.hasNewAsset && <span className="text-purple-600">● New asset</span>}
                          </div>
                        )}
                      </div>
                    );
                  }
                  return null;
                }}
              />
              <Area 
                type="monotone" 
                dataKey="netWorth" 
                fill="url(#netWorthGradient)" 
                stroke="none"
              />
              <Line 
                type="monotone" 
                dataKey="netWorth" 
                stroke="#10b981" 
                strokeWidth={2}
                dot={(props: any) => {
                  const isSelected = viewMonth 
                    ? props.payload.yearMonth === viewMonth 
                    : props.payload.yearMonth === latestMonth.yearMonth;
                  return (
                    <circle
                      cx={props.cx}
                      cy={props.cy}
                      r={isSelected ? 6 : 4}
                      fill={isSelected ? "#059669" : "#10b981"}
                      stroke="#fff"
                      strokeWidth={isSelected ? 3 : 2}
                      style={{ cursor: "pointer" }}
                    />
                  );
                }}
                activeDot={{ r: 6, fill: "#059669", stroke: "#fff", strokeWidth: 2 }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Breakdown Section with Tabs */}
      <div className={NET_WORTH_CARD_CLASS}>
        {/* Tab Headers */}
        <div className="mb-4">
          <div className={NET_WORTH_TABS_ROW_CLASS}>
            <button
              onClick={() => setActiveTab("changes")}
              className={`${NET_WORTH_TAB_BUTTON_BASE} ${
                activeTab === "changes"
                  ? "border-purple-600 text-purple-600"
                  : "border-transparent text-gray-600 hover:text-gray-900"
              }`}
            >
              What Changed
            </button>
            <button
              onClick={() => setActiveTab("assets")}
              className={`${NET_WORTH_TAB_BUTTON_BASE} ${
                activeTab === "assets"
                  ? "border-purple-600 text-purple-600"
                  : "border-transparent text-gray-600 hover:text-gray-900"
              }`}
            >
              Assets
            </button>
            <button
              onClick={() => setActiveTab("debts")}
              className={`${NET_WORTH_TAB_BUTTON_BASE} ${
                activeTab === "debts"
                  ? "border-purple-600 text-purple-600"
                  : "border-transparent text-gray-600 hover:text-gray-900"
              }`}
            >
              Debts
            </button>
            <div className={NET_WORTH_MONTH_DESKTOP_CLASS}>
              {breakdownPeriodLabel}
            </div>
          </div>
          <div className={NET_WORTH_MONTH_MOBILE_CLASS}>
            {breakdownPeriodLabel}
          </div>
        </div>

        {/* What Changed Tab */}
        {activeTab === "changes" && (
          <div>
        
        {selectedData.change !== null && (
          <div className="mb-4 p-4 bg-gray-50 rounded-lg">
            <div className="flex items-center justify-between gap-3">
              <span className="min-w-0 text-sm font-medium text-gray-700">
                Total Change
                {baselineLines.length > 0 && (
                  <span className="ml-2 text-xs text-gray-500">(includes {baselineLines.length} baseline{baselineLines.length > 1 ? 's' : ''})</span>
                )}
              </span>
              <IntactAmount className={`text-lg font-bold ${
                selectedData.change > 0 ? "text-green-600" : 
                selectedData.change < 0 ? "text-red-600" : "text-gray-900"
              }`}>
                {selectedData.change > 0 ? "+" : ""}
                {formatCurrency(selectedData.change, currency)}
              </IntactAmount>
            </div>
          </div>
        )}

        {(breakdownLines.length > 0 || baselineLines.length > 0) ? (
          <div className="space-y-4">
            {/* Real changes */}
            {breakdownLines.length > 0 && (
              <div className="space-y-2">
                {breakdownLines.map((line, idx) => {
                  const accountPage = line.href;
                  
                  const lineContent = (
                    <div className="flex items-center justify-between gap-3 py-2 border-b border-gray-100 last:border-0">
                      <span className={NET_WORTH_LABEL_CLASS}>{line.label}</span>
                      <IntactAmount className={`text-sm font-semibold ${
                        line.amount > 0 ? "text-green-600" : line.amount < 0 ? "text-red-600" : "text-gray-900"
                      }`}>
                        {line.amount > 0 ? "+" : ""}
                        {formatCurrency(line.amount, currency)}
                      </IntactAmount>
                    </div>
                  );
                  
                  return accountPage ? (
                    <Link key={idx} href={accountPage} className="block hover:bg-gray-50 -mx-2 px-2 rounded transition-colors">
                      {lineContent}
                    </Link>
                  ) : (
                    <div key={idx}>{lineContent}</div>
                  );
                })}
              </div>
            )}

            {/* Real change subtotal (if baselines exist) */}
            {baselineLines.length > 0 && breakdownLines.length > 0 && (
              <div className="py-2 border-t-2 border-gray-300">
                <div className="flex items-center justify-between gap-3">
                  <span className="min-w-0 text-sm font-medium text-gray-700">Real Change</span>
                  <IntactAmount className={`text-sm font-bold ${
                    breakdownLines.reduce((sum, line) => sum + line.amount, 0) > 0 ? "text-green-600" : 
                    breakdownLines.reduce((sum, line) => sum + line.amount, 0) < 0 ? "text-red-600" : "text-gray-900"
                  }`}>
                    {breakdownLines.reduce((sum, line) => sum + line.amount, 0) > 0 ? "+" : ""}
                    {formatCurrency(breakdownLines.reduce((sum, line) => sum + line.amount, 0), currency)}
                  </IntactAmount>
                </div>
              </div>
            )}

            {/* Baseline section */}
            {baselineLines.length > 0 && (
              <div className="space-y-2 pt-2 border-t border-gray-200">
                <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">First Statements (Baseline)</div>
                {baselineLines.map((line, idx) => {
                  const accountPage = line.href;
                  
                  const lineContent = (
                    <div className="flex items-center justify-between gap-3 py-2 border-b border-gray-100 last:border-0">
                      <span className={`${NET_WORTH_LABEL_CLASS} text-gray-600 italic`}>{line.label}</span>
                      <IntactAmount className="text-sm text-gray-600 italic">
                        {line.amount > 0 ? "+" : ""}
                        {formatCurrency(line.amount, currency)}
                      </IntactAmount>
                    </div>
                  );
                  
                  return accountPage ? (
                    <Link key={idx} href={accountPage} className="block hover:bg-gray-50 -mx-2 px-2 rounded transition-colors">
                      {lineContent}
                    </Link>
                  ) : (
                    <div key={idx}>{lineContent}</div>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-gray-500 text-center py-4">
            No detailed breakdown available yet. Change items will appear here after processing statements.
          </p>
        )}
          </div>
        )}

        {/* Assets Tab */}
        {activeTab === "assets" && (
          <div>
            {selectedData.byAccount && selectedData.byAccount.length > 0 ? (
              <div className="space-y-2">
                {selectedData.byAccount
                  .filter((item) => item.value > 0)
                  .map((item, idx) => {
                    const isManual = item.slug.startsWith("manual-");
                    const row = netWorthAccountRow({
                      slug: item.slug,
                      label: item.label,
                      type: item.type,
                      side: "asset",
                    });
                    const accountPage = row.href;
                    const rowClass =
                      "flex items-center justify-between gap-3 py-2 border-b border-gray-100 last:border-0 -mx-2 px-2 rounded";
                    const lineContent = (
                      <>
                        <span className={NET_WORTH_LABEL_CLASS}>
                          {row.label}
                          {isManual && <span className="ml-2 text-xs text-gray-500">(manual)</span>}
                        </span>
                        <IntactAmount className="text-sm font-semibold text-gray-900">
                          {formatCurrencyWithCents(item.value, currency)}
                        </IntactAmount>
                      </>
                    );
                    return accountPage ? (
                      <Link
                        key={idx}
                        href={accountPage}
                        className={`${rowClass} hover:bg-gray-50 transition-colors`}
                      >
                        {lineContent}
                      </Link>
                    ) : (
                      <div key={idx} className={rowClass}>
                        {lineContent}
                      </div>
                    );
                  })}
                <div className="flex items-center justify-between gap-3 py-3 border-t-2 border-gray-300 mt-2">
                  <span className="min-w-0 text-sm font-bold text-gray-900">Total Assets</span>
                  <IntactAmount className="text-lg font-bold text-gray-900">
                    {formatCurrencyWithCents(selectedData.totalAssets, currency)}
                  </IntactAmount>
                </div>
              </div>
            ) : (
              <p className="text-sm text-gray-500 text-center py-8">No asset data available</p>
            )}
          </div>
        )}

        {/* Debts Tab */}
        {activeTab === "debts" && (
          <div>
            {selectedData.byAccount && selectedData.byAccount.length > 0 ? (
              <div className="space-y-2">
                {selectedData.byAccount
                  .filter((item) => item.value < 0)
                  .map((item, idx) => {
                    const row = netWorthAccountRow({
                      slug: item.slug,
                      label: item.label,
                      type: item.type,
                      side: "debt",
                    });
                    const accountPage = row.href;
                    const rowClass =
                      "flex items-center justify-between gap-3 py-2 border-b border-gray-100 last:border-0 -mx-2 px-2 rounded";
                    const lineContent = (
                      <>
                        <span className={NET_WORTH_LABEL_CLASS}>{row.label}</span>
                        <IntactAmount className="text-sm font-semibold text-red-600">
                          {formatCurrencyWithCents(Math.abs(item.value), currency)}
                        </IntactAmount>
                      </>
                    );
                    return accountPage ? (
                      <Link
                        key={idx}
                        href={accountPage}
                        className={`${rowClass} hover:bg-gray-50 transition-colors`}
                      >
                        {lineContent}
                      </Link>
                    ) : (
                      <div key={idx} className={rowClass}>
                        {lineContent}
                      </div>
                    );
                  })}
                <div className="flex items-center justify-between gap-3 py-3 border-t-2 border-gray-300 mt-2">
                  <span className="min-w-0 text-sm font-bold text-gray-900">Total Debts</span>
                  <IntactAmount className="text-lg font-bold text-red-600">
                    {formatCurrencyWithCents(selectedData.totalDebts, currency)}
                  </IntactAmount>
                </div>
              </div>
            ) : (
              <p className="text-sm text-gray-500 text-center py-8">No debt data</p>
            )}
          </div>
        )}

        {(activeTab === "assets" || activeTab === "debts") && selectedData.byAccount && (
          <div className="mt-4 pt-4 border-t-2 border-purple-200">
            <div className="flex items-center justify-between gap-3">
              <span className="min-w-0 text-base font-bold text-gray-900">Net Worth</span>
              <IntactAmount className="text-xl font-bold text-purple-600">
                {formatCurrencyWithCents(selectedData.netWorth, currency)}
              </IntactAmount>
            </div>
            <p className="text-xs text-gray-500 mt-1">
              <span className="whitespace-nowrap">Assets ({formatCurrencyWithCents(selectedData.totalAssets, currency)})</span>
              {" - "}
              <span className="whitespace-nowrap">Debts ({formatCurrencyWithCents(selectedData.totalDebts, currency)})</span>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function formatMonthLabel(month: string): string {
  const [year, monthNum] = month.split("-");
  const date = new Date(parseInt(year), parseInt(monthNum) - 1);
  return date.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

function formatNetWorthChartTitle(rangeMonths: number): string {
  if (rangeMonths === 3) return "3-Month Trend";
  if (rangeMonths === 6) return "6-Month Trend";
  return "All-time Trend";
}

export default function NetWorthPage() {
  return (
    <Suspense fallback={
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-purple-600 border-t-transparent" />
      </div>
    }>
      <NetWorthPageContent />
    </Suspense>
  );
}
