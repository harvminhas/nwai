"use client";

import { useState } from "react";
import { fmt } from "@/lib/currencyUtils";
import type { GapReconciliation } from "@/lib/gapReconciliation";

interface ReconciliationPanelProps {
  reconciliation: GapReconciliation;
  currency: string;
  rangeLabel: string;
}

export function ReconciliationPanel({ reconciliation, currency, rangeLabel }: ReconciliationPanelProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  
  const { income, fixed, essentials, flexible, expectedSavings, actualSavings, gap, components } = reconciliation;
  
  return (
    <div className="mt-6 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between text-left"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-gray-900">How this adds up</span>
          <span className="text-xs text-gray-500">· {rangeLabel}</span>
        </div>
        <svg
          className={`h-5 w-5 text-gray-400 transition-transform ${isExpanded ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7 7" />
        </svg>
      </button>
      
      {!isExpanded && (
        <div className="mt-3 text-xs text-gray-600">
          Income {fmt(income, currency)} − Fixed {fmt(fixed, currency)} − Essentials {fmt(essentials, currency)} − Flexible {fmt(flexible, currency)} = {fmt(expectedSavings, currency)} expected · Net Savings {fmt(actualSavings, currency)} actual · Gap {fmt(gap, currency)}
        </div>
      )}
      
      {isExpanded && (
        <div className="mt-4 space-y-4">
          {/* Formula breakdown */}
          <div className="rounded-lg bg-gray-50 p-4 font-mono text-sm">
            <div className="flex justify-between">
              <span className="text-gray-600">Income</span>
              <span className="font-semibold text-gray-900">{fmt(income, currency)}</span>
            </div>
            <div className="flex justify-between mt-1">
              <span className="text-gray-600">− Fixed</span>
              <span className="font-semibold text-gray-900">{fmt(fixed, currency)}</span>
            </div>
            <div className="flex justify-between mt-1">
              <span className="text-gray-600">− Essentials</span>
              <span className="font-semibold text-gray-900">{fmt(essentials, currency)}</span>
            </div>
            <div className="flex justify-between mt-1">
              <span className="text-gray-600">− Flexible</span>
              <span className="font-semibold text-gray-900">{fmt(flexible, currency)}</span>
            </div>
            <div className="flex justify-between mt-2 pt-2 border-t border-gray-300">
              <span className="text-gray-700 font-medium">= Expected savings</span>
              <span className="font-bold text-gray-900">{fmt(expectedSavings, currency)}</span>
            </div>
          </div>
          
          {/* Actual vs Expected */}
          <div className="rounded-lg bg-blue-50 p-4">
            <div className="flex justify-between items-center">
              <div>
                <div className="text-sm font-semibold text-gray-900">Net Savings (from balance changes)</div>
                <div className="text-xs text-gray-600 mt-0.5">Actual money added to accounts</div>
              </div>
              <div className="text-lg font-bold text-gray-900">{fmt(actualSavings, currency)}</div>
            </div>
          </div>
          
          {/* The Gap */}
          <div className={`rounded-lg p-4 ${Math.abs(gap) < 10 ? "bg-green-50" : gap > 0 ? "bg-amber-50" : "bg-red-50"}`}>
            <div className="flex justify-between items-center">
              <div>
                <div className="text-sm font-semibold text-gray-900">Gap to explain</div>
                <div className="text-xs text-gray-600 mt-0.5">
                  {gap > 0 ? "More savings than expected" : gap < 0 ? "Less savings than expected" : "Perfect match"}
                </div>
              </div>
              <div className={`text-lg font-bold ${gap > 0 ? "text-green-700" : gap < 0 ? "text-red-700" : "text-gray-900"}`}>
                {fmt(gap, currency)}
              </div>
            </div>
          </div>
          
          {/* Gap Components */}
          {components.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Gap breakdown</div>
              {components.map((comp, idx) => (
                <div key={idx} className="flex justify-between items-start rounded-lg bg-gray-50 p-3">
                  <div className="flex-1">
                    <div className="text-sm font-medium text-gray-900">{comp.name}</div>
                    <div className="text-xs text-gray-600 mt-0.5">{comp.description}</div>
                  </div>
                  <div className={`text-sm font-semibold tabular-nums ${comp.amount > 0 ? "text-green-700" : "text-red-700"}`}>
                    {comp.amount > 0 ? "+" : ""}{fmt(comp.amount, currency)}
                  </div>
                </div>
              ))}
              
              {/* Reconciliation status */}
              <div className="mt-4 pt-4 border-t border-gray-200">
                {reconciliation.reconciles ? (
                  <div className="flex items-center gap-2 text-xs text-green-700">
                    <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                    <span className="font-medium">Reconciled within $1</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-xs text-amber-700">
                    <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                    <span className="font-medium">Unexplained: {fmt(reconciliation.unexplained, currency)}</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
