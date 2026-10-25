"use client";

import { useEffect, useState } from "react";

export type DrawerType = "income" | "fixed" | "essentials" | "flexible" | "savings";

interface DrawerProps {
  type: DrawerType;
  isOpen: boolean;
  onClose: () => void;
  token: string | null;
  currency: string;
}

type TimeWindow = "last3" | "12month" | "ytd";

const WINDOW_LABELS: Record<TimeWindow, string> = {
  last3: "Last 3 months",
  "12month": "12-month avg",
  ytd: "This year",
};

export function Drawer({ type, isOpen, onClose, token, currency }: DrawerProps) {
  const [window, setWindow] = useState<TimeWindow>("last3");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isOpen || !token) return;

    setLoading(true);
    fetch(`/api/user/dashboard-drawers?window=${window}&bucket=${type}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => res.json())
      .then((d) => {
        setData(d);
        setLoading(false);
      })
      .catch((err) => {
        console.error("Drawer load error:", err);
        setLoading(false);
      });
  }, [isOpen, type, window, token]);

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Drawer */}
      <div className="fixed right-0 top-0 z-50 h-full w-full max-w-2xl overflow-y-auto bg-white shadow-2xl sm:w-[640px]">
        {/* Header */}
        <div className="sticky top-0 border-b border-gray-200 bg-white px-6 py-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold text-gray-900">
              {type === "income" && "Income"}
              {type === "fixed" && "Fixed costs"}
              {type === "essentials" && "Essentials"}
              {type === "flexible" && "Flexible spending"}
              {type === "savings" && "Savings & debt"}
            </h2>
            <button
              onClick={onClose}
              className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Basis Switch */}
          <div className="mt-4 flex gap-2">
            {(["last3", "12month", "ytd"] as TimeWindow[]).map((w) => (
              <button
                key={w}
                onClick={() => setWindow(w)}
                className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
                  window === w
                    ? "bg-purple-600 text-white"
                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                }`}
              >
                {WINDOW_LABELS[w]}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="px-6 py-6">
          {loading && (
            <div className="flex items-center justify-center py-12">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-purple-600" />
            </div>
          )}

          {!loading && data && type === "income" && (
            <IncomeDrawerContent data={data} currency={currency} />
          )}

          {!loading && data && type !== "income" && (
            <BucketDrawerContent data={data} currency={currency} type={type} />
          )}
        </div>
      </div>
    </>
  );
}

function IncomeDrawerContent({ data, currency }: { data: any; currency: string }) {
  const fmt = (amount: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency || "USD",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);

  const metrics = data.metrics;

  return (
    <div className="space-y-6">
      {/* Current Amount */}
      <div className="rounded-xl border border-gray-200 bg-gray-50 p-6">
        <p className="text-sm font-medium text-gray-600">Monthly take-home</p>
        <p className="mt-1 text-3xl font-bold text-gray-900">
          {fmt(metrics.windowAmount)}
        </p>
        <p className="mt-1 text-xs text-gray-500">
          Based on {metrics.windowLabel}
        </p>
      </div>

      {/* 12-Month Chart */}
      <div>
        <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-gray-500">
          Last 12 months
        </h3>
        <div className="space-y-2">
          {data.chartData.map((month: any) => {
            const monthLabel = new Date(month.month + "-15").toLocaleDateString("en-US", {
              month: "short",
              year: "2-digit",
            });
            const isInWindow = month.isInWindow;
            const isCurrent = month.isCurrentMonth;

            return (
              <div key={month.month} className="flex items-center gap-3">
                <span
                  className={`w-16 text-xs ${
                    isInWindow ? "font-semibold text-gray-900" : "text-gray-400"
                  }`}
                >
                  {monthLabel}
                </span>
                <div className="relative h-8 flex-1 rounded bg-gray-100">
                  <div
                    className={`h-full rounded ${
                      isCurrent
                        ? "bg-gradient-to-r from-green-400 to-green-600 bg-[length:200%_100%] animate-pulse"
                        : "bg-green-500"
                    }`}
                    style={{
                      width: `${Math.min(100, (month.regularIncome / Math.max(...data.chartData.map((m: any) => m.regularIncome))) * 100)}%`,
                    }}
                  />
                  {isInWindow && (
                    <div className="absolute inset-0 rounded border-2 border-purple-500" />
                  )}
                </div>
                <span className="w-20 text-right text-xs font-medium text-gray-900">
                  {fmt(month.regularIncome)}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Income Sources */}
      <div>
        <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-gray-500">
          Included sources
        </h3>
        <div className="space-y-2">
          {metrics.regularSources.map((source: any, idx: number) => (
            <div
              key={idx}
              className="flex items-center justify-between rounded-lg border border-gray-200 bg-white px-4 py-3"
            >
              <span className="text-sm font-medium text-gray-900">{source.source}</span>
              <span className="text-sm font-semibold text-gray-900">
                {fmt(source.amount)}/mo
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* One-Off Sources */}
      {metrics.oneOffSources.length > 0 && (
        <div>
          <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-gray-500">
            Kept separate (one-off)
          </h3>
          <div className="space-y-2">
            {metrics.oneOffSources.map((source: any, idx: number) => (
              <div
                key={idx}
                className="flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 px-4 py-3"
              >
                <span className="text-sm font-medium text-gray-900">{source.source}</span>
                <span className="text-sm font-semibold text-amber-900">
                  {fmt(source.amount)} (bonus)
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Year Summary */}
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-gray-500">
          This year
        </h3>
        <div className="grid grid-cols-3 gap-4 text-center">
          <div>
            <p className="text-xs text-gray-500">So far</p>
            <p className="mt-1 text-lg font-bold text-gray-900">{fmt(metrics.ytdTotal)}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Projected</p>
            <p className="mt-1 text-lg font-bold text-gray-900">
              {fmt(metrics.projectedFullYear)}
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Of which bonus</p>
            <p className="mt-1 text-lg font-bold text-amber-900">
              {fmt(metrics.ytdOneOff)}
            </p>
          </div>
        </div>
      </div>

      {/* Coach Note */}
      <div className="rounded-xl border border-purple-200 bg-purple-50 p-4">
        <p className="text-sm leading-relaxed text-purple-900">
          <strong>💡 Coach:</strong> Your take-home is based on {metrics.windowLabel}.{" "}
          {metrics.oneOffSources.length > 0 &&
            "We've excluded one-off bonuses from your monthly average to give you a more reliable baseline."}
        </p>
      </div>
    </div>
  );
}

function BucketDrawerContent({
  data,
  currency,
  type,
}: {
  data: any;
  currency: string;
  type: DrawerType;
}) {
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);

  const fmt = (amount: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency || "USD",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);

  const breakdown = data.breakdown;

  return (
    <div className="space-y-6">
      {/* Monthly Average */}
      <div className="rounded-xl border border-gray-200 bg-gray-50 p-6">
        <p className="text-sm font-medium text-gray-600">Monthly average</p>
        <p className="mt-1 text-3xl font-bold text-gray-900">
          {fmt(breakdown.monthlyAverage)}
        </p>
        <p className="mt-1 text-xs text-gray-500">{data.basisLabel}</p>
      </div>

      {/* 3-Month Trend Sparkline */}
      <div>
        <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-gray-500">
          Last 3 months
        </h3>
        <div className="flex items-end gap-2">
          {data.trend.values.map((value: number, idx: number) => {
            const maxValue = Math.max(...data.trend.values);
            const heightPct = maxValue > 0 ? (value / maxValue) * 100 : 0;

            return (
              <div key={idx} className="flex-1">
                <div
                  className="w-full rounded-t bg-purple-500"
                  style={{ height: `${Math.max(4, heightPct)}px` }}
                />
                <p className="mt-1 text-center text-xs text-gray-500">
                  {new Date(data.trend.months[idx] + "-15").toLocaleDateString("en-US", {
                    month: "short",
                  })}
                </p>
                <p className="text-center text-xs font-medium text-gray-900">{fmt(value)}</p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Category Breakdown */}
      <div>
        <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-gray-500">
          Breakdown by category
        </h3>
        <div className="space-y-2">
          {breakdown.categories.map((category: any, idx: number) => {
            const isExpanded = expandedCategory === category.category;

            return (
              <div key={idx} className="rounded-lg border border-gray-200 bg-white overflow-hidden">
                <button
                  onClick={() =>
                    setExpandedCategory(isExpanded ? null : category.category)
                  }
                  className="w-full px-4 py-3 text-left hover:bg-gray-50"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-gray-900">
                          {category.category}
                        </span>
                        {category.isScheduled && (
                          <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold text-blue-900">
                            scheduled
                          </span>
                        )}
                        {category.isEstimated && (
                          <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-600">
                            est.
                          </span>
                        )}
                      </div>
                      <div className="mt-1 h-1.5 w-full max-w-xs rounded-full bg-gray-100">
                        <div
                          className="h-full rounded-full bg-purple-500"
                          style={{ width: `${category.pctOfBucket}%` }}
                        />
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold text-gray-900">
                        {fmt(category.amount)}
                      </p>
                      <p className="text-xs text-gray-500">
                        {Math.round(category.pctOfBucket)}%
                      </p>
                    </div>
                  </div>
                </button>

                {/* Expanded Merchants */}
                {isExpanded && category.merchants.length > 0 && (
                  <div className="border-t border-gray-200 bg-gray-50 px-4 py-3">
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                      Top merchants
                    </p>
                    <div className="space-y-1">
                      {category.merchants.map((merchant: any, mIdx: number) => (
                        <div
                          key={mIdx}
                          className="flex items-center justify-between text-xs"
                        >
                          <span className="text-gray-700">{merchant.merchant}</span>
                          <span className="font-medium text-gray-900">
                            {fmt(merchant.amount)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Not Counted Here */}
      {breakdown.notCountedHere.length > 0 && (
        <div>
          <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-gray-500">
            Not counted here
          </h3>
          <div className="space-y-2">
            {breakdown.notCountedHere.map((item: any, idx: number) => (
              <div
                key={idx}
                className="rounded-lg border border-gray-300 bg-gray-50 px-4 py-3"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-700">{item.label}</p>
                    <p className="mt-0.5 text-xs text-gray-500">{item.reason}</p>
                  </div>
                  {item.amount !== undefined && (
                    <span className="text-sm font-semibold text-gray-600">
                      {fmt(item.amount)}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Coach Note */}
      <div className="rounded-xl border border-purple-200 bg-purple-50 p-4">
        <p className="text-sm leading-relaxed text-purple-900">
          <strong>💡 Coach:</strong> This shows your average spending over the selected time
          period. {type === "fixed" && "Fixed costs typically include rent, insurance, and scheduled debt payments."}{" "}
          {type === "essentials" && "Essentials cover necessities like groceries and transportation."}{" "}
          {type === "flexible" && "Flexible spending includes dining, shopping, and entertainment."}{" "}
          {type === "savings" && "This includes investments, extra debt payments beyond minimums, and savings contributions."}
        </p>
      </div>
    </div>
  );
}
