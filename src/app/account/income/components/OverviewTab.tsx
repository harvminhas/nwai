"use client";

import type { IncomeSummary } from "@/lib/incomeSummary";
import { formatMonthYear, formatDate } from "@/lib/dateFormatting";
import { formatCurrency } from "@/lib/currencyUtils";

interface OverviewTabProps {
  summary: IncomeSummary;
  onReviewComplete?: () => void;
}

export function OverviewTab({ summary }: OverviewTabProps) {
  const { currentMonth, currentMonthRegular, currentMonthBonus, typicalMonthly, whatChanged, currency, last3Months } = summary;
  
  const hasCurrentMonthData = currentMonthRegular > 0 || currentMonthBonus > 0;
  const currentMonthTotal = currentMonthRegular + currentMonthBonus;
  const progressPercent = typicalMonthly > 0 && hasCurrentMonthData
    ? Math.min(100, Math.round((currentMonthTotal / typicalMonthly) * 100))
    : 0;
  
  const currentMonthLabel = formatMonthYear(currentMonth);
  const isOnTrack = progressPercent >= 80;
  const progressColor = progressPercent >= 100 ? "#10b981" : progressPercent >= 80 ? "#7c3aed" : "#f59e0b";
  
  // Format last 3 months for label
  const last3MonthsFormatted = last3Months
    .map(m => formatMonthYear(m).split(" ")[0])
    .join("–");
  const last3Year = last3Months.length > 0 
    ? formatMonthYear(last3Months[last3Months.length - 1]).split(" ")[1]
    : new Date().getFullYear();
  
  
  // What changed items (1-3 items)
  const whatChangedItems: { type: "late" | "new" | "change"; text: string; detail: string }[] = [];
  
  if (whatChanged.lateMissing) {
    whatChangedItems.push({
      type: "late",
      text: `${whatChanged.lateMissing.source} hasn't paid yet`,
      detail: `Usually by ${formatDate(whatChanged.lateMissing.expectedBy)} — ${formatCurrency(whatChanged.lateMissing.amount, currency)}`
    });
  }
  
  if (whatChanged.newSource && whatChangedItems.length < 3) {
    whatChangedItems.push({
      type: "new",
      text: `New source: ${whatChanged.newSource.source}`,
      detail: `${formatCurrency(whatChanged.newSource.amount, currency)} on ${formatDate(whatChanged.newSource.firstDate)}`
    });
  }
  
  if (whatChanged.notableChange && whatChangedItems.length < 3) {
    const { source, oldAmount, newAmount, changePercent } = whatChanged.notableChange;
    const isIncrease = changePercent > 0;
    whatChangedItems.push({
      type: "change",
      text: `${source} ${isIncrease ? "up" : "down"} ${Math.abs(Math.round(changePercent))}%`,
      detail: `${formatCurrency(oldAmount, currency)} → ${formatCurrency(newAmount, currency)}`
    });
  }

  return (
    <div className="space-y-6">
      {/* Current month progress */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-baseline justify-between mb-2">
          <h3 className="text-sm font-medium text-gray-500">{currentMonthLabel} SO FAR</h3>
          <p className="text-sm text-gray-400">
            of ~{formatCurrency(typicalMonthly, currency)} in a typical month
          </p>
        </div>
        
        {hasCurrentMonthData ? (
          <>
            <div className="flex items-baseline gap-2 mb-3">
              <span className="text-4xl font-bold text-gray-900 tabular-nums">
                {formatCurrency(currentMonthTotal, currency, undefined, true)}
              </span>
            </div>
            
            {/* Progress bar */}
            <div className="h-3 bg-gray-100 rounded-full overflow-hidden mb-2">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{ width: `${progressPercent}%`, backgroundColor: progressColor }}
              />
            </div>
            
            <p className="text-xs text-gray-500">
              {isOnTrack 
                ? `${progressPercent}% received · average monthly income from ${last3MonthsFormatted} ${last3Year}`
                : `${progressPercent}% received · still below typical month`}
            </p>
          </>
        ) : (
          <>
            <div className="flex items-baseline gap-2 mb-3">
              <span className="text-4xl font-bold text-gray-400 tabular-nums">
                {formatCurrency(0, currency, undefined, true)}
              </span>
            </div>
            
            {/* Muted progress bar */}
            <div className="h-3 bg-gray-100 rounded-full overflow-hidden mb-2">
              <div className="h-full rounded-full bg-gray-200" style={{ width: "0%" }} />
            </div>
            
            <p className="text-xs text-gray-500">
              No {currentMonthLabel} statements yet
            </p>
          </>
        )}
      </div>

      {/* Average per month */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h3 className="text-sm font-medium text-gray-500 mb-4">
          AVERAGE MONTHLY INCOME ({last3MonthsFormatted} {last3Year})
        </h3>
        
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-gray-400 mb-1">Last 3 complete months</p>
            <p className="text-2xl font-bold text-gray-900 tabular-nums">
              {formatCurrency(typicalMonthly, currency, undefined, true)}
            </p>
          </div>
          
          <div className="text-right">
            <p className="text-xs text-gray-400 mb-1">
              {summary.last3Months.map(m => formatMonthYear(m).split(" ")[0]).join(", ")} {last3Year}
            </p>
            <p className="text-sm text-gray-600">
              {formatCurrency(summary.last3MonthsTotal, currency, undefined, true)} total
            </p>
          </div>
        </div>
      </div>

      {/* What changed */}
      {whatChangedItems.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100">
            <h3 className="text-sm font-semibold text-gray-900">What changed</h3>
          </div>
          
          <div className="divide-y divide-gray-100">
            {whatChangedItems.map((item, i) => {
              const iconConfig = {
                late: { color: "text-amber-600", bg: "bg-amber-50", icon: "M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" },
                new: { color: "text-green-600", bg: "bg-green-50", icon: "M12 4v16m8-8H4" },
                change: { color: "text-blue-600", bg: "bg-blue-50", icon: "M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" }
              }[item.type];
              
              return (
                <div key={i} className={`px-6 py-4 flex items-start gap-3 ${iconConfig.bg}`}>
                  <div className={`flex-shrink-0 w-5 h-5 rounded-full ${iconConfig.bg} flex items-center justify-center`}>
                    <svg className={`w-3 h-3 ${iconConfig.color}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d={iconConfig.icon} />
                    </svg>
                  </div>
                  
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900">{item.text}</p>
                    <p className="text-xs text-gray-600 mt-0.5">{item.detail}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Review cards section - placeholder */}
      {/* Will be populated by ReviewList component in parent */}
    </div>
  );
}
