"use client";

import { useState } from "react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Line, ComposedChart } from "recharts";
import type { IncomeSummary } from "@/lib/incomeSummary";
import { formatMonth, formatMonthYear } from "@/lib/dateFormatting";
import { formatCurrency, getCurrencySymbol } from "@/lib/currencyUtils";
import { getSignColor } from "@/lib/colorHelpers";

type TimeWindow = "12month" | "ytd" | "last3";

interface TrendsTabProps {
  summary: IncomeSummary;
}

export function TrendsTab({ summary }: TrendsTabProps) {
  const [timeWindow, setTimeWindow] = useState<TimeWindow>("12month");
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  const { monthlyHistory, currency, yoy } = summary;
  
  // Filter months based on window
  const currentYear = new Date().getFullYear();
  const currentMonth = summary.currentMonth;
  
  let filteredMonths = monthlyHistory;
  let windowLabel = "12 months";
  
  if (timeWindow === "ytd") {
    filteredMonths = monthlyHistory.filter(m => m.yearMonth >= `${currentYear}-01`);
    windowLabel = "Year to date";
  } else if (timeWindow === "last3") {
    filteredMonths = monthlyHistory.filter(m => summary.last3Months.includes(m.yearMonth));
    windowLabel = "Last 3 complete months";
  } else {
    // 12 months - take last 12 complete months (excluding current)
    const completeMonths = monthlyHistory.filter(m => m.yearMonth < currentMonth);
    filteredMonths = completeMonths.slice(-12);
  }
  
  // Compute totals and regular/one-off split
  const totalIncome = filteredMonths.reduce((s, m) => s + m.total, 0);
  const regularIncome = filteredMonths.reduce((s, m) => s + m.regular, 0);
  const oneOffIncome = filteredMonths.reduce((s, m) => s + m.oneOff, 0);
  
  // Prepare chart data
  const chartData = filteredMonths.map(m => {
    // Find same month last year for comparison
    const [year, month] = m.yearMonth.split("-");
    const lastYearMonth = `${parseInt(year) - 1}-${month}`;
    const lastYearData = monthlyHistory.find(h => h.yearMonth === lastYearMonth);
    
    return {
      month: formatMonth(m.yearMonth),
      yearMonth: m.yearMonth,
      regular: Math.round(m.regular),
      oneOff: Math.round(m.oneOff),
      total: Math.round(m.total),
      lastYear: lastYearData ? Math.round(lastYearData.regular) : null
    };
  });
  
  // Currency formatter for axis
  const fmtAxis = (v: number) => {
    const sym = getCurrencySymbol(currency);
    const abs = Math.abs(v);
    if (abs >= 1_000_000) return `${sym}${(abs / 1_000_000).toFixed(1)}M`;
    if (abs >= 1_000) return `${sym}${Math.round(abs / 1_000)}k`;
    return v === 0 ? `${sym}0` : formatCurrency(v, currency, undefined, true);
  };
  
  // Per-source breakdown with sparklines
  const sourceBreakdown = summary.regularSources
    .filter(s => !s.isTransfer)
    .slice(0, 10) // Top 10 sources
    .map(source => {
      // Get monthly amounts for this source
      const sourceMonthly = filteredMonths.map(m => {
        const sourceInMonth = m.sources.find(s => s.source === source.description);
        return sourceInMonth?.amount || 0;
      });
      
      // Compare to previous period
      const currentTotal = sourceMonthly.reduce((s, a) => s + a, 0);
      const prevPeriodMonths = monthlyHistory
        .filter(m => {
          if (timeWindow === "ytd") {
            const prevYear = currentYear - 1;
            return m.yearMonth >= `${prevYear}-01` && m.yearMonth <= `${prevYear}-12`;
          } else if (timeWindow === "last3") {
            const [year, month] = summary.last3Months[0].split("-");
            const prevStart = new Date(parseInt(year), parseInt(month) - 1 - 3, 1);
            const prevEnd = new Date(parseInt(year), parseInt(month) - 1, 0);
            return m.yearMonth >= `${prevStart.getFullYear()}-${String(prevStart.getMonth() + 1).padStart(2, "0")}`
              && m.yearMonth < summary.last3Months[0];
          } else {
            // 12 month - compare to previous 12
            const earliestMonth = filteredMonths[0]?.yearMonth;
            if (!earliestMonth) return false;
            const [year, month] = earliestMonth.split("-");
            const prevStart = new Date(parseInt(year), parseInt(month) - 1 - 12, 1);
            return m.yearMonth >= `${prevStart.getFullYear()}-${String(prevStart.getMonth() + 1).padStart(2, "0")}`
              && m.yearMonth < earliestMonth;
          }
        });
      
      const prevTotal = prevPeriodMonths.reduce((s, m) => {
        const sourceInMonth = m.sources.find(src => src.source === source.description);
        return s + (sourceInMonth?.amount || 0);
      }, 0);
      
      const changePct = prevTotal > 0 ? ((currentTotal - prevTotal) / prevTotal) * 100 : 0;
      
      return {
        name: source.description,
        total: currentTotal,
        sparkline: sourceMonthly,
        changePct,
        isNew: prevTotal === 0 && currentTotal > 0
      };
    });

  return (
    <div className="space-y-6">
      {/* Window selector */}
      <div className="flex items-center justify-between">
        <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden text-xs font-semibold">
          <button
            className={`px-4 py-2 transition ${timeWindow === "12month" ? "bg-purple-600 text-white" : "text-gray-600 hover:bg-gray-50"}`}
            onClick={() => setTimeWindow("12month")}
          >
            12 months
          </button>
          <button
            className={`px-4 py-2 border-l border-gray-200 transition ${timeWindow === "ytd" ? "bg-purple-600 text-white" : "text-gray-600 hover:bg-gray-50"}`}
            onClick={() => setTimeWindow("ytd")}
          >
            Year to date
          </button>
          <button
            className={`px-4 py-2 border-l border-gray-200 transition ${timeWindow === "last3" ? "bg-purple-600 text-white" : "text-gray-600 hover:bg-gray-50"}`}
            onClick={() => setTimeWindow("last3")}
          >
            Last 3 complete months
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-xs text-gray-500 mb-1">TOTAL RECEIVED</p>
          <p className="text-3xl font-bold text-gray-900 tabular-nums">
            {formatCurrency(totalIncome, currency, undefined, true)}
          </p>
          <p className="text-xs text-gray-400 mt-1">Average {formatCurrency(totalIncome / filteredMonths.length, currency, undefined, true)}/month (average of {filteredMonths.length} complete months)</p>
        </div>
        
        {yoy && timeWindow === "12month" && (
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <p className="text-xs text-gray-500 mb-1">VS SAME PERIOD LAST YEAR</p>
            <div className="flex items-baseline gap-2">
              <span className={`text-3xl font-bold tabular-nums ${yoy.changePercent >= 0 ? "text-green-600" : "text-red-600"}`}>
                {yoy.changePercent >= 0 ? "+" : ""}{yoy.changePercent.toFixed(1)}%
              </span>
              <svg className={`w-5 h-5 ${yoy.changePercent >= 0 ? "text-green-600" : "text-red-600 rotate-180"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 10l7-7m0 0l7 7m-7-7v18" />
              </svg>
            </div>
            <p className="text-xs text-gray-400 mt-1">
              {formatCurrency(yoy.previous, currency, undefined, true)} → {formatCurrency(yoy.current, currency, undefined, true)}
            </p>
          </div>
        )}
        
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-xs text-gray-500 mb-1">REGULAR VS ONE-OFF</p>
          <div className="flex items-center gap-3">
            <div>
              <p className="text-sm text-gray-600">Regular</p>
              <p className="text-xl font-bold text-purple-600 tabular-nums">
                {formatCurrency(regularIncome, currency, undefined, true)}
              </p>
            </div>
            <div className="text-gray-300">/</div>
            <div>
              <p className="text-sm text-gray-600">One-off</p>
              <p className="text-xl font-bold text-amber-600 tabular-nums">
                {formatCurrency(oneOffIncome, currency, undefined, true)}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Monthly income chart */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h3 className="text-sm font-semibold text-gray-900 mb-4">Monthly income</h3>
        
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
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
                      <p className="text-xs text-purple-600">Regular: {formatCurrency(data.regular, currency)}</p>
                      {data.oneOff > 0 && (
                        <p className="text-xs text-amber-600">One-off: {formatCurrency(data.oneOff, currency)}</p>
                      )}
                      <p className="text-xs text-gray-900 font-medium">Total: {formatCurrency(data.total, currency)}</p>
                      {data.lastYear && (
                        <p className="text-xs text-gray-500 mt-1">Last year: {formatCurrency(data.lastYear, currency)}</p>
                      )}
                    </div>
                  );
                }}
              />
              <Bar dataKey="regular" stackId="a" fill="#7c3aed" radius={[0, 0, 0, 0]} onClick={(data: any) => data?.payload?.yearMonth && setSelectedMonth(data.payload.yearMonth)} cursor="pointer" />
              <Bar dataKey="oneOff" stackId="a" fill="#fbbf24" radius={[4, 4, 0, 0]} onClick={(data: any) => data?.payload?.yearMonth && setSelectedMonth(data.payload.yearMonth)} cursor="pointer" />
              {chartData.some(d => d.lastYear) && (
                <Line type="monotone" dataKey="lastYear" stroke="#9ca3af" strokeWidth={2} strokeDasharray="4 4" dot={false} />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        
        <div className="flex items-center justify-center gap-6 mt-4 text-xs">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-purple-600 rounded"></div>
            <span className="text-gray-600">Regular</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-amber-400 rounded"></div>
            <span className="text-gray-600">One-off</span>
          </div>
          {chartData.some(d => d.lastYear) && (
            <div className="flex items-center gap-2">
              <div className="w-4 h-0.5 bg-gray-400" style={{ borderTop: "2px dashed currentColor" }}></div>
              <span className="text-gray-600">Same month last year</span>
            </div>
          )}
        </div>
      </div>

      {/* By source */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-900">By source</h3>
          <p className="text-xs text-gray-500">Change vs prior period</p>
        </div>
        
        <div className="divide-y divide-gray-100">
          {sourceBreakdown.map((source, i) => (
            <div key={i} className="px-6 py-4 flex items-center gap-4">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">{source.name}</p>
                <p className="text-xs text-gray-500">
                  {formatCurrency(source.total, currency)} in {windowLabel.toLowerCase()}
                </p>
              </div>
              
              {/* Mini sparkline */}
              <div className="w-20 h-8">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={source.sparkline.map((v, i) => ({ v, i }))} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
                    <Bar dataKey="v" fill={source.changePct >= 0 ? "#7c3aed" : "#9ca3af"} radius={[1, 1, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              
              {/* Change indicator */}
              <div className="w-20 text-right">
                {source.isNew ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-50 text-green-700 text-xs font-semibold">
                    New
                  </span>
                ) : (
                  <span className={`text-sm font-semibold tabular-nums ${source.changePct >= 0 ? "text-green-600" : "text-red-600"}`}>
                    {source.changePct >= 0 ? "+" : ""}{Math.round(source.changePct)}%
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Month Detail Drawer */}
      {selectedMonth && (() => {
        const monthData = monthlyHistory.find(m => m.yearMonth === selectedMonth);
        if (!monthData) return null;
        
        const typicalMonthly = summary.typicalMonthly;
        const vsTypical = typicalMonthly > 0 ? ((monthData.total - typicalMonthly) / typicalMonthly) * 100 : 0;
        
        // Group sources by type
        const regularSources = monthData.sources.filter(s => {
          const sourceDef = summary.regularSources.find(src => src.description === s.source);
          return sourceDef && !sourceDef.isTransfer && !s.isOneOff;
        });
        
        const oneOffSources = monthData.sources.filter(s => s.isOneOff);
        
        const transferSources = monthData.sources.filter(s => {
          const sourceDef = summary.regularSources.find(src => src.description === s.source) 
            || summary.oneOffSources.find(src => src.description === s.source);
          return sourceDef?.isTransfer;
        });
        
        return (
          <>
            {/* Backdrop */}
            <div 
              className="fixed inset-0 bg-black/20 z-40"
              onClick={() => setSelectedMonth(null)}
            />
            
            {/* Drawer */}
            <div className="fixed right-0 top-0 h-full w-full max-w-lg bg-white shadow-2xl z-50 flex flex-col overflow-hidden">
              {/* Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-purple-600">Income Detail</p>
                  <h2 className="text-lg font-bold text-gray-900 mt-0.5">{formatMonthYear(selectedMonth)}</h2>
                </div>
                <button
                  onClick={() => setSelectedMonth(null)}
                  className="rounded-full p-2 text-gray-400 hover:bg-gray-100 transition"
                  aria-label="Close"
                >
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              
              {/* Content */}
              <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
                {/* Total */}
                <div className="text-center">
                  <p className="text-sm font-medium uppercase tracking-wide text-gray-500">Total Income</p>
                  <p className={`mt-2 text-4xl font-bold ${getSignColor(monthData.total)}`}>
                    {formatCurrency(monthData.total, currency)}
                  </p>
                  {typicalMonthly > 0 && (
                    <p className={`mt-1 text-sm ${getSignColor(vsTypical)}`}>
                      {vsTypical >= 0 ? '+' : ''}{vsTypical.toFixed(0)}% vs typical month
                    </p>
                  )}
                </div>
                
                {/* Income Sources */}
                <IncomeSourcesSection 
                  title="Regular Income"
                  icon="💼"
                  sources={regularSources}
                  summary={summary}
                  currency={currency}
                />
                
                {oneOffSources.length > 0 && (
                  <IncomeSourcesSection 
                    title="One-Off Income"
                    icon="✨"
                    sources={oneOffSources}
                    summary={summary}
                    currency={currency}
                  />
                )}
                
                {transferSources.length > 0 && (
                  <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                    <div className="flex items-center gap-2 text-xs text-gray-500 mb-2">
                      <span>🔄</span>
                      <span className="font-semibold uppercase tracking-wide">Transfers (excluded)</span>
                    </div>
                    <p className="text-xs text-gray-600 leading-relaxed">
                      {transferSources.length} transfer{transferSources.length !== 1 ? 's' : ''} totaling{' '}
                      {formatCurrency(transferSources.reduce((s, src) => s + src.amount, 0), currency)}{' '}
                      excluded from income totals
                    </p>
                  </div>
                )}
              </div>
            </div>
          </>
        );
      })()}
    </div>
  );
}

// Source section with expandable transactions
function IncomeSourcesSection({
  title,
  icon,
  sources,
  summary,
  currency
}: {
  title: string;
  icon: string;
  sources: Array<{ source: string; amount: number; isOneOff: boolean }>;
  summary: IncomeSummary;
  currency: string;
}) {
  const [expandedSources, setExpandedSources] = useState<Set<string>>(new Set());
  
  const toggleSource = (source: string) => {
    setExpandedSources(prev => {
      const next = new Set(prev);
      if (next.has(source)) {
        next.delete(source);
      } else {
        next.add(source);
      }
      return next;
    });
  };
  
  if (sources.length === 0) return null;
  
  const total = sources.reduce((s, src) => s + src.amount, 0);
  
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-base">{icon}</span>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-700">{title}</h3>
          <span className="text-xs text-gray-500">({sources.length})</span>
        </div>
        <span className={`text-sm font-bold ${getSignColor(total)}`}>
          {formatCurrency(total, currency)}
        </span>
      </div>
      
      <div className="space-y-2">
        {sources.map((src) => {
          const sourceDef = summary.regularSources.find(s => s.description === src.source)
            || summary.oneOffSources.find(s => s.description === src.source);
          const isExpanded = expandedSources.has(src.source);
          
          return (
            <div key={src.source} className="rounded-lg border border-gray-200 bg-white overflow-hidden">
              {/* Source header - clickable */}
              <button
                onClick={() => toggleSource(src.source)}
                className="w-full flex items-center justify-between p-3 text-left hover:bg-gray-50 transition"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{src.source}</p>
                  {sourceDef && (
                    <p className="text-xs text-gray-500">
                      {sourceDef.transactions.length} transaction{sourceDef.transactions.length !== 1 ? 's' : ''}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-gray-900 tabular-nums">
                    {formatCurrency(src.amount, currency)}
                  </span>
                  <svg
                    className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </button>
              
              {/* Transactions - expandable */}
              {isExpanded && sourceDef && (
                <div className="border-t border-gray-100 bg-gray-50 p-3 space-y-2">
                  {sourceDef.transactions.map((txn, idx) => (
                    <div key={idx} className="flex items-start justify-between text-xs">
                      <div className="flex-1 min-w-0">
                        <p className="text-gray-600">{new Date(txn.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</p>
                        {txn.accountLabel && (
                          <p className="text-gray-500 truncate">{txn.accountLabel}</p>
                        )}
                      </div>
                      <span className="text-gray-900 font-medium tabular-nums ml-2">
                        {formatCurrency(txn.amount, currency)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
