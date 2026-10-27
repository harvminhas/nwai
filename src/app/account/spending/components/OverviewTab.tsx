import type { SpendingSummary } from "@/lib/spendingSummary";
import { formatMonthYear, formatMonth } from "@/lib/dateFormatting";
import { formatCurrency } from "@/lib/currency";
import { getSignColor } from "@/lib/colorHelpers";
import { ReviewList } from "@/components/ReviewList";
import Link from "next/link";

interface OverviewTabProps {
  summary: SpendingSummary;
  token: string | null;
}

export function OverviewTab({ summary, token }: OverviewTabProps) {
  const lastMonth = summary.lastCompleteMonth;
  const lastMonthData = summary.monthlyHistory.find(m => m.yearMonth === lastMonth);
  
  if (!lastMonthData) {
    return <div className="text-neutral-500">No data for {formatMonthYear(lastMonth)}</div>;
  }

  const bucketLabels = {
    fixed: "Fixed",
    essentials: "Essentials",
    flexible: "Flexible",
  };

  const bucketColors = {
    fixed: "bg-purple-600",
    essentials: "bg-blue-600",
    flexible: "bg-green-600",
  };

  return (
    <div className="space-y-6">
      {/* Month comparison */}
      <div>
        <div className="flex items-baseline gap-2 mb-3">
          <h2 className="text-lg font-semibold text-neutral-900">
            {formatMonthYear(lastMonth)}
          </h2>
          <span className="text-sm text-neutral-500">vs typical month</span>
        </div>

        <div className="flex items-center gap-4 mb-2">
          <div className="text-3xl font-semibold text-neutral-900">
            {formatCurrency(lastMonthData.total, summary.currency)}
          </div>
          {summary.vsTypical !== 0 && (
            <div className={`text-sm font-medium ${getSignColor(summary.vsTypical)}`}>
              {summary.vsTypical > 0 ? "+" : ""}
              {formatCurrency(summary.vsTypical, summary.currency)}
              {" "}
              ({summary.vsTypicalPct > 0 ? "+" : ""}
              {summary.vsTypicalPct.toFixed(0)}%)
            </div>
          )}
        </div>

        {/* Stacked bar */}
        <div className="relative w-full h-8 bg-neutral-100 rounded overflow-hidden">
          {["fixed", "essentials", "flexible"].map((bucket, idx) => {
            const bucketData = summary.buckets.find(b => b.bucket === bucket);
            if (!bucketData || bucketData.share === 0) return null;
            
            const widthPct = (bucketData.share * 100).toFixed(1);
            return (
              <div
                key={bucket}
                className={`absolute h-full ${bucketColors[bucket as keyof typeof bucketColors]}`}
                style={{
                  left: idx === 0 
                    ? "0%" 
                    : idx === 1 
                      ? `${(summary.buckets.find(b => b.bucket === "fixed")?.share || 0) * 100}%`
                      : `${((summary.buckets.find(b => b.bucket === "fixed")?.share || 0) + (summary.buckets.find(b => b.bucket === "essentials")?.share || 0)) * 100}%`,
                  width: `${widthPct}%`,
                }}
              />
            );
          })}
        </div>

        {/* Bucket legend */}
        <div className="flex gap-4 mt-2 text-sm">
          {summary.buckets.map(b => (
            <div key={b.bucket} className="flex items-center gap-2">
              <div className={`w-3 h-3 rounded-sm ${bucketColors[b.bucket]}`} />
              <span className="text-neutral-700">{bucketLabels[b.bucket]}</span>
              <span className="text-neutral-900 font-medium">
                {formatCurrency(b.total, summary.currency)}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Top categories */}
      <div>
        <h3 className="text-base font-semibold text-neutral-900 mb-3">Top categories</h3>
        <div className="space-y-3">
          {summary.topCategories.map(cat => {
            // Find change vs typical (average of last 3 months before last)
            const last3 = summary.monthlyHistory.slice(-4, -1);
            const priorAvg = last3.reduce((sum, m) => {
              const c = m.categories.find(c => c.category === cat.category);
              return sum + (c?.amount || 0);
            }, 0) / (last3.length || 1);
            
            const lastMonthCat = lastMonthData.categories.find(c => c.category === cat.category);
            const lastMonthAmt = lastMonthCat?.amount || 0;
            const change = lastMonthAmt - priorAvg;
            const changePct = priorAvg > 0 ? (change / priorAvg) * 100 : 0;

            return (
              <div key={cat.category}>
                <div className="flex items-center justify-between mb-1">
                  <div className="text-sm font-medium text-neutral-900">{cat.category}</div>
                  <div className="flex items-center gap-2">
                    <div className="text-sm text-neutral-900">
                      {formatCurrency(lastMonthAmt, summary.currency)}
                    </div>
                    {Math.abs(changePct) >= 5 && (
                      <div className={`text-xs ${getSignColor(change)}`}>
                        {change > 0 ? "+" : ""}
                        {changePct.toFixed(0)}%
                      </div>
                    )}
                  </div>
                </div>
                <div className="relative w-full h-2 bg-neutral-100 rounded overflow-hidden">
                  <div
                    className="absolute h-full bg-purple-600 rounded"
                    style={{ width: `${Math.min(100, (cat.share * 100))}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Insights */}
      {summary.insights.length > 0 && (
        <div>
          <h3 className="text-base font-semibold text-neutral-900 mb-3">Worth knowing</h3>
          <div className="space-y-2">
            {summary.insights.map((insight, idx) => (
              <div key={idx} className="text-sm text-neutral-700 bg-neutral-50 rounded p-3">
                {insight.message}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Subscriptions summary - placeholder for now */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base font-semibold text-neutral-900">Subscriptions</h3>
          <Link
            href="/account/spending?tab=subscriptions"
            className="text-sm text-purple-600 hover:text-purple-700 font-medium"
          >
            See all →
          </Link>
        </div>
        <div className="bg-neutral-50 rounded p-4 text-center text-sm text-neutral-500">
          Subscription tracking coming in next stage
        </div>
      </div>

      {/* Review list */}
      {token && (
        <div>
          <ReviewList token={token} onComplete={() => window.location.reload()} />
        </div>
      )}
    </div>
  );
}
