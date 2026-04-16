"use client";

import { useState } from "react";
import type { DayStat } from "@/app/api/user/spending/account-cashflow/route";
import { fmt } from "@/lib/currencyUtils";

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}

function monthLabel(ym: string): string {
  if (!ym) return "";
  return new Date(ym + "-01T12:00:00Z").toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

interface Props {
  days: DayStat[];
  month: string;
  currency: string;
}

export default function CashflowHeatmap({ days, month, currency }: Props) {
  const [hovered, setHovered] = useState<number | null>(null);

  const maxIncome  = Math.max(...days.map(d => d.income),  1);
  const maxExpense = Math.max(...days.map(d => d.expense), 1);
  const hasAnyData = days.some(d => d.income > 0 || d.expense > 0);

  const hoveredDay = hovered != null ? days.find(d => d.day === hovered) : null;

  // Build insight pills: top income days + top expense days
  const topExpenseDays = [...days]
    .filter(d => d.expense > 0)
    .sort((a, b) => b.expense - a.expense)
    .slice(0, 3);
  const topIncomeDays = [...days]
    .filter(d => d.income > 0)
    .sort((a, b) => b.income - a.income)
    .slice(0, 2);

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-gray-800">Cash Flow Heatmap</h3>
          <p className="text-xs text-gray-400 mt-0.5">
            {month ? monthLabel(month) : "This month"} · by day
          </p>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-gray-500">
          <span className="flex items-center gap-1">
            <span className="inline-block w-2.5 h-2.5 rounded-sm bg-emerald-400" />
            In
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-2.5 h-2.5 rounded-sm bg-rose-400" />
            Out
          </span>
        </div>
      </div>

      {!hasAnyData ? (
        <p className="text-xs text-gray-400 py-6 text-center">No transactions in this month.</p>
      ) : (
        <>
          {/* Grid: 31 day cells */}
          <div className="grid grid-cols-[repeat(31,minmax(0,1fr))] gap-[3px]">
            {days.map((d) => {
              const incH = d.income  > 0 ? Math.max(4, Math.round((d.income  / maxIncome)  * 44)) : 0;
              const expH = d.expense > 0 ? Math.max(4, Math.round((d.expense / maxExpense) * 44)) : 0;
              const hasActivity = incH > 0 || expH > 0;
              const isHovered = hovered === d.day;

              return (
                <div
                  key={d.day}
                  className={`group relative flex flex-col items-center cursor-default select-none transition-opacity ${
                    hovered != null && !isHovered ? "opacity-40" : "opacity-100"
                  }`}
                  onMouseEnter={() => setHovered(d.day)}
                  onMouseLeave={() => setHovered(null)}
                >
                  {/* Bar area */}
                  <div className="relative w-full flex items-end justify-center gap-[1px]" style={{ height: 48 }}>
                    <div
                      className="w-[45%] rounded-t-sm bg-emerald-400 transition-all duration-150"
                      style={{ height: incH, opacity: incH > 0 ? 1 : 0 }}
                    />
                    <div
                      className="w-[45%] rounded-t-sm bg-rose-400 transition-all duration-150"
                      style={{ height: expH, opacity: expH > 0 ? 1 : 0 }}
                    />
                    {!hasActivity && (
                      <div className="absolute bottom-0 w-full h-[2px] rounded-full bg-gray-100" />
                    )}
                    {isHovered && hasActivity && (
                      <div className="absolute inset-0 rounded-sm ring-1 ring-gray-400 ring-offset-1 pointer-events-none" />
                    )}
                  </div>
                  <span className={`mt-1 text-[9px] leading-none font-medium ${
                    hasActivity ? (isHovered ? "text-gray-800" : "text-gray-500") : "text-gray-300"
                  }`}>
                    {d.day}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Hover tooltip */}
          {hoveredDay && (hoveredDay.income > 0 || hoveredDay.expense > 0) && (
            <div className="mt-3 rounded-lg bg-gray-50 border border-gray-200 p-3 text-xs">
              <p className="font-semibold text-gray-800 mb-1.5">{ordinal(hoveredDay.day)}</p>
              <div className="flex gap-4">
                {hoveredDay.income > 0 && (
                  <div>
                    <p className="text-gray-400 text-[10px] uppercase tracking-wide">In</p>
                    <p className="font-semibold text-emerald-600">{fmt(hoveredDay.income, currency)}</p>
                  </div>
                )}
                {hoveredDay.expense > 0 && (
                  <div>
                    <p className="text-gray-400 text-[10px] uppercase tracking-wide">Out</p>
                    <p className="font-semibold text-rose-600">{fmt(hoveredDay.expense, currency)}</p>
                    {hoveredDay.topMerchants.length > 0 && (
                      <p className="text-gray-500 mt-0.5 text-[10px]">
                        {hoveredDay.topMerchants.map(m => m.name).join(", ")}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Insight pills */}
          {(topIncomeDays.length > 0 || topExpenseDays.length > 0) && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {topIncomeDays.map(d => (
                <span key={`inc-${d.day}`}
                  className="inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                  {ordinal(d.day)}: {fmt(d.income, currency)}
                </span>
              ))}
              {topExpenseDays.map(d => (
                <span key={`exp-${d.day}`}
                  className="inline-flex items-center gap-1 rounded-full bg-rose-50 border border-rose-200 px-2 py-0.5 text-[10px] font-medium text-rose-700">
                  <span className="w-1.5 h-1.5 rounded-full bg-rose-400 shrink-0" />
                  {ordinal(d.day)}
                  {d.topMerchants[0] ? `: ${d.topMerchants[0].name}` : ""} · {fmt(d.expense, currency)}
                </span>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
