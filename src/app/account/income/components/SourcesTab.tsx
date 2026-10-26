"use client";

import { useState } from "react";
import type { IncomeSummary, IncomeSource } from "@/lib/incomeSummary";
import { formatDate } from "@/lib/dateFormatting";
import { formatCurrency } from "@/lib/currencyUtils";
import { INCOME_CATEGORIES, FREQUENCY_CONFIG, type Frequency } from "@/lib/incomeEngine";

interface SourcesTabProps {
  summary: IncomeSummary;
  token: string | null;
  onUpdate?: () => void;
}

export function SourcesTab({ summary, token, onUpdate }: SourcesTabProps) {
  const [expandedSources, setExpandedSources] = useState<Set<string>>(new Set());
  const [cashIncomeExpanded, setCashIncomeExpanded] = useState(false);
  const [byCategoryExpanded, setByCategoryExpanded] = useState(false);
  
  const toggleSource = (sourceName: string) => {
    setExpandedSources(prev => {
      const next = new Set(prev);
      if (next.has(sourceName)) {
        next.delete(sourceName);
      } else {
        next.add(sourceName);
      }
      return next;
    });
  };
  
  // Group sources by type
  const { regularSources, oneOffSources, transferSources } = summary;
  
  // Filter to show only last 3 complete months
  const last3Months = summary.last3Months;
  
  return (
    <div className="space-y-6">
      <div className="text-xs text-gray-500">
        Sources · last 3 complete months ({last3Months.map(m => m.split("-")[1]).join(", ")})
      </div>
      
      {/* Regular sources */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-6 py-3 border-b border-gray-100 bg-gray-50">
          <h3 className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Sources</h3>
        </div>
        
        <div className="divide-y divide-gray-100">
          {regularSources.map((source) => (
            <SourceRow
              key={source.description}
              source={source}
              isExpanded={expandedSources.has(source.description)}
              onToggle={() => toggleSource(source.description)}
              filteredMonths={last3Months}
              currency={summary.currency}
              token={token}
              onUpdate={onUpdate}
            />
          ))}
          
          {regularSources.length === 0 && (
            <div className="px-6 py-8 text-center text-sm text-gray-500">
              No regular income sources found
            </div>
          )}
        </div>
      </div>

      {/* One-off sources */}
      {oneOffSources.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-6 py-3 border-b border-gray-100 bg-amber-50">
            <h3 className="text-xs font-semibold text-amber-700 uppercase tracking-wide">One-time</h3>
          </div>
          
          <div className="divide-y divide-gray-100">
            {oneOffSources.map((source) => (
              <SourceRow
                key={source.description}
                source={source}
                isExpanded={expandedSources.has(source.description)}
                onToggle={() => toggleSource(source.description)}
                filteredMonths={last3Months}
                currency={summary.currency}
                token={token}
                onUpdate={onUpdate}
              />
            ))}
          </div>
        </div>
      )}

      {/* Transfer sources */}
      {transferSources.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-6 py-3 border-b border-gray-100 bg-gray-50">
            <h3 className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Transfers (excluded from totals)</h3>
          </div>
          
          <div className="divide-y divide-gray-100">
            {transferSources.map((source) => (
              <SourceRow
                key={source.description}
                source={source}
                isExpanded={expandedSources.has(source.description)}
                onToggle={() => toggleSource(source.description)}
                filteredMonths={last3Months}
                currency={summary.currency}
                token={token}
                onUpdate={onUpdate}
              />
            ))}
          </div>
        </div>
      )}

      {/* Cash income (collapsed by default) */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <button
          className="w-full px-6 py-3 flex items-center justify-between hover:bg-gray-50 transition"
          onClick={() => setCashIncomeExpanded(!cashIncomeExpanded)}
        >
          <h3 className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Cash income</h3>
          <svg
            className={`w-4 h-4 text-gray-400 transition-transform ${cashIncomeExpanded ? "rotate-180" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        
        {cashIncomeExpanded && (
          <div className="px-6 py-4 border-t border-gray-100 text-sm text-gray-500">
            Cash income entries will be shown here
          </div>
        )}
      </div>

      {/* By category (collapsed by default) */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <button
          className="w-full px-6 py-3 flex items-center justify-between hover:bg-gray-50 transition"
          onClick={() => setByCategoryExpanded(!byCategoryExpanded)}
        >
          <h3 className="text-xs font-semibold text-gray-700 uppercase tracking-wide">By category</h3>
          <svg
            className={`w-4 h-4 text-gray-400 transition-transform ${byCategoryExpanded ? "rotate-180" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        
        {byCategoryExpanded && (
          <div className="divide-y divide-gray-100">
            {INCOME_CATEGORIES.filter(c => c !== "Transfer").map(category => {
              const categorySources = regularSources.filter(s => s.category === category);
              const total = categorySources.reduce((sum, s) => s + s.total, 0);
              
              if (total === 0) return null;
              
              return (
                <div key={category} className="px-6 py-3 flex items-center justify-between">
                  <span className="text-sm text-gray-700">{category}</span>
                  <span className="text-sm font-semibold text-gray-900 tabular-nums">
                    {formatCurrency(total, summary.currency)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

interface SourceRowProps {
  source: IncomeSource;
  isExpanded: boolean;
  onToggle: () => void;
  filteredMonths: string[];
  currency: string;
  token: string | null;
  onUpdate?: () => void;
}

function SourceRow({ source, isExpanded, onToggle, filteredMonths, currency }: SourceRowProps) {
  // Filter transactions to the display window
  const visibleTransactions = source.transactions.filter(t => 
    filteredMonths.includes(t.date.slice(0, 7))
  );
  
  const visibleTotal = visibleTransactions.reduce((s, t) => s + t.amount, 0);
  
  // Frequency label
  const freqLabel = FREQUENCY_CONFIG[source.frequency as Frequency]?.label || source.frequency;
  
  return (
    <div>
      <button
        className="w-full px-6 py-4 flex items-center gap-4 hover:bg-gray-50 transition text-left"
        onClick={onToggle}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium text-gray-900 truncate">{source.description}</p>
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-purple-50 text-purple-700 uppercase tracking-wide">
              {freqLabel}
            </span>
          </div>
          <p className="text-xs text-gray-500 mt-0.5">
            {visibleTransactions.length} deposit{visibleTransactions.length !== 1 ? "s" : ""} · {Math.round(source.reliabilityScore)}% reliable
          </p>
        </div>
        
        <div className="flex items-center gap-3">
          <span className="text-base font-semibold text-gray-900 tabular-nums">
            {formatCurrency(visibleTotal, currency)}
          </span>
          <svg
            className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? "rotate-180" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>
      
      {isExpanded && visibleTransactions.length > 0 && (
        <div className="bg-gray-50 border-t border-gray-100">
          <div className="px-6 py-2 text-xs text-gray-500 uppercase tracking-wide">
            Actual deposits · tap to expand
          </div>
          <div className="divide-y divide-gray-100">
            {visibleTransactions
              .sort((a, b) => b.date.localeCompare(a.date))
              .map((txn, i) => (
                <div key={i} className="px-6 py-2 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-gray-500 w-20">{formatDate(txn.date)}</span>
                    {txn.accountLabel && (
                      <span className="text-xs text-gray-400">{txn.accountLabel}</span>
                    )}
                  </div>
                  <span className="text-sm font-semibold text-green-600 tabular-nums">
                    +{formatCurrency(txn.amount, currency)}
                  </span>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
