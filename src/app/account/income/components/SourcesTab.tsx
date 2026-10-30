"use client";

import { useState } from "react";
import type { IncomeSummary, IncomeSource } from "@/lib/incomeSummary";
import { formatDate } from "@/lib/dateFormatting";
import { formatCurrency } from "@/lib/currencyUtils";
import { INCOME_CATEGORIES, FREQUENCY_CONFIG, type Frequency, type IncomeCategory } from "@/lib/incomeEngine";
import { useConfirm } from "@/components/useConfirm";
import { useToast } from "@/components/useToast";

interface SourcesTabProps {
  summary: IncomeSummary;
  token: string | null;
  onUpdate?: () => void;
}

export function SourcesTab({ summary, token, onUpdate }: SourcesTabProps) {
  const { confirm, ConfirmDialog } = useConfirm();
  const { error, Toast } = useToast();
  const [expandedSources, setExpandedSources] = useState<Set<string>>(new Set());
  const [cashIncomeExpanded, setCashIncomeExpanded] = useState(false);
  const [byCategoryExpanded, setByCategoryExpanded] = useState(false);
  const [editingSource, setEditingSource] = useState<string | null>(null);
  const [newSourceName, setNewSourceName] = useState("");
  const [saving, setSaving] = useState(false);
  
  // Build sets for quick lookup of bonus and unreviewed transactions
  const bonusTxnIds = new Set(
    summary.bonusTransactions.map(t => `${t.date}:${t.source}:${t.amount}:${t.accountSlug || 'unknown'}`)
  );
  const unreviewedTxnIds = new Set(
    summary.unreviewedDeposits.map(d => d.txId)
  );
  
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
  
  const handleRename = async (oldName: string, newName: string) => {
    if (!token || !newName.trim() || newName === oldName) {
      setEditingSource(null);
      return;
    }
    
    setSaving(true);
    try {
      const res = await fetch("/api/user/income-source-rename", {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ oldName, newName: newName.trim() }),
      });
      
      if (res.ok) {
        setEditingSource(null);
        setNewSourceName("");
        onUpdate?.();
      } else {
        error("Failed to rename source");
      }
    } finally {
      setSaving(false);
    }
  };
  
  const handleMarkAsTransfer = async (sourceName: string) => {
    if (!token) return;
    
    setSaving(true);
    try {
      const res = await fetch("/api/user/income-category-rules", {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ 
          source: sourceName, 
          category: "Transfer"
        }),
      });
      
      if (res.ok) {
        onUpdate?.();
      } else {
        error("Failed to mark as transfer");
      }
    } finally {
      setSaving(false);
    }
  };
  
  const handleExclude = async (sourceName: string) => {
    if (!token) return;
    
    const confirmed = await confirm({
      title: `Exclude "${sourceName}"?`,
      message: "This will hide all income from this source from your totals.",
      confirmLabel: "Exclude",
      variant: "danger",
    });
    if (!confirmed) return;
    
    setSaving(true);
    try {
      const res = await fetch("/api/user/income-source-exclude", {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ source: sourceName, excluded: true }),
      });
      
      if (res.ok) {
        onUpdate?.();
      } else {
        error("Failed to exclude source");
      }
    } finally {
      setSaving(false);
    }
  };
  
  const handleCategoryChange = async (sourceName: string, category: IncomeCategory) => {
    if (!token) return;
    
    setSaving(true);
    try {
      const res = await fetch("/api/user/income-category-rules", {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ source: sourceName, category }),
      });
      
      if (res.ok) {
        onUpdate?.();
      } else {
        error("Failed to update category");
      }
    } finally {
      setSaving(false);
    }
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
              onRename={(newName) => handleRename(source.canonicalName, newName)}
              onMarkAsTransfer={() => handleMarkAsTransfer(source.canonicalName)}
              onExclude={() => handleExclude(source.canonicalName)}
              onCategoryChange={(cat) => handleCategoryChange(source.canonicalName, cat)}
              isEditing={editingSource === source.description}
              onStartEdit={() => {
                setEditingSource(source.description);
                setNewSourceName(source.canonicalName);
              }}
              onCancelEdit={() => setEditingSource(null)}
              newName={editingSource === source.description ? newSourceName : ""}
              onNameChange={setNewSourceName}
              saving={saving}
              bonusTxnIds={bonusTxnIds}
              unreviewedTxnIds={unreviewedTxnIds}
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
                onRename={(newName) => handleRename(source.canonicalName, newName)}
                onMarkAsTransfer={() => handleMarkAsTransfer(source.canonicalName)}
                onExclude={() => handleExclude(source.canonicalName)}
                onCategoryChange={(cat) => handleCategoryChange(source.canonicalName, cat)}
                isEditing={editingSource === source.description}
                onStartEdit={() => {
                  setEditingSource(source.description);
                  setNewSourceName(source.canonicalName);
                }}
                onCancelEdit={() => setEditingSource(null)}
                newName={editingSource === source.description ? newSourceName : ""}
                onNameChange={setNewSourceName}
                saving={saving}
                bonusTxnIds={bonusTxnIds}
                unreviewedTxnIds={unreviewedTxnIds}
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
                onRename={(newName) => handleRename(source.canonicalName, newName)}
                onMarkAsTransfer={() => handleMarkAsTransfer(source.canonicalName)}
                onExclude={() => handleExclude(source.canonicalName)}
                onCategoryChange={(cat) => handleCategoryChange(source.canonicalName, cat)}
                isEditing={editingSource === source.description}
                onStartEdit={() => {
                  setEditingSource(source.description);
                  setNewSourceName(source.canonicalName);
                }}
                onCancelEdit={() => setEditingSource(null)}
                newName={editingSource === source.description ? newSourceName : ""}
                onNameChange={setNewSourceName}
                saving={saving}
                bonusTxnIds={bonusTxnIds}
                unreviewedTxnIds={unreviewedTxnIds}
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
              const total = categorySources.reduce((sum, s) => sum + s.total, 0);
              
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
  onRename: (newName: string) => void;
  onMarkAsTransfer: () => void;
  onExclude: () => void;
  onCategoryChange: (category: IncomeCategory) => void;
  isEditing: boolean;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  newName: string;
  onNameChange: (name: string) => void;
  saving: boolean;
  bonusTxnIds: Set<string>;
  unreviewedTxnIds: Set<string>;
}

function SourceRow({
  source,
  isExpanded,
  onToggle,
  filteredMonths,
  currency,
  onRename,
  onMarkAsTransfer,
  onExclude,
  onCategoryChange,
  isEditing,
  onStartEdit,
  onCancelEdit,
  newName,
  onNameChange,
  saving,
  bonusTxnIds,
  unreviewedTxnIds
}: SourceRowProps) {
  const [showActions, setShowActions] = useState(false);
  
  // Filter transactions to the display window
  const visibleTransactions = source.transactions.filter(t => 
    filteredMonths.includes(t.date.slice(0, 7))
  );
  
  const visibleTotal = visibleTransactions.reduce((s, t) => s + t.amount, 0);
  
  // Frequency label
  const freqLabel = FREQUENCY_CONFIG[source.frequency as Frequency]?.label || source.frequency;
  
  return (
    <div>
      <div className="px-6 py-4 flex items-center gap-4 hover:bg-gray-50 transition">
        <button
          className="flex-1 flex items-center gap-2 text-left"
          onClick={onToggle}
        >
          <div className="flex-1 min-w-0">
            {isEditing ? (
              <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => onNameChange(e.target.value)}
                  className="flex-1 px-2 py-1 text-sm border border-purple-300 rounded focus:outline-none focus:ring-2 focus:ring-purple-500"
                  disabled={saving}
                />
                <button
                  onClick={() => onRename(newName)}
                  disabled={saving}
                  className="text-xs px-2 py-1 bg-purple-600 text-white rounded hover:bg-purple-700 disabled:opacity-50"
                >
                  Save
                </button>
                <button
                  onClick={onCancelEdit}
                  disabled={saving}
                  className="text-xs px-2 py-1 border border-gray-300 rounded hover:bg-gray-100 disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-gray-900 truncate">{source.description}</p>
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-purple-50 text-purple-700 uppercase tracking-wide">
                    {freqLabel}
                  </span>
                </div>
                <p className="text-xs text-gray-500 mt-0.5">
                  {visibleTransactions.length} deposit{visibleTransactions.length !== 1 ? "s" : ""} · {Math.round(source.reliabilityScore)}% reliable
                </p>
              </>
            )}
          </div>
        </button>
        
        <div className="flex items-center gap-3">
          <span className="text-base font-semibold text-gray-900 tabular-nums">
            {formatCurrency(visibleTotal, currency)}
          </span>
          
          {/* Actions menu */}
          <div className="relative">
            <button
              onClick={() => setShowActions(!showActions)}
              className="p-1 text-gray-400 hover:text-gray-600 rounded hover:bg-gray-100"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
              </svg>
            </button>
            
            {showActions && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowActions(false)} />
                <div className="absolute right-0 mt-2 w-48 bg-white rounded-lg shadow-lg border border-gray-200 z-20 py-1">
                  <button
                    onClick={() => { onStartEdit(); setShowActions(false); }}
                    className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
                  >
                    Rename
                  </button>
                  <button
                    onClick={() => { onMarkAsTransfer(); setShowActions(false); }}
                    className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
                  >
                    Mark as transfer
                  </button>
                  <button
                    onClick={() => { onExclude(); setShowActions(false); }}
                    className="w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50"
                  >
                    Exclude
                  </button>
                  
                  <div className="border-t border-gray-100 my-1" />
                  <div className="px-4 py-1 text-xs font-semibold text-gray-500 uppercase">Category</div>
                  
                  {INCOME_CATEGORIES.filter(c => c !== "Transfer").map(cat => (
                    <button
                      key={cat}
                      onClick={() => { onCategoryChange(cat); setShowActions(false); }}
                      className={`w-full px-4 py-2 text-left text-sm hover:bg-gray-50 ${
                        source.category === cat ? "text-purple-600 font-medium" : "text-gray-700"
                      }`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          
          <button onClick={onToggle} className="p-1">
            <svg
              className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? "rotate-180" : ""}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        </div>
      </div>
      
      {isExpanded && visibleTransactions.length > 0 && (
        <div className="bg-gray-50 border-t border-gray-100">
          <div className="px-6 py-2 text-xs text-gray-500 uppercase tracking-wide">
            Actual deposits
          </div>
          <div className="divide-y divide-gray-100">
            {visibleTransactions
              .sort((a, b) => b.date.localeCompare(a.date))
              .map((txn, i) => {
                const txnId = `${txn.date}:${txn.source}:${txn.amount}:${txn.accountSlug || 'unknown'}`;
                const isBonus = bonusTxnIds.has(txnId);
                const needsReview = unreviewedTxnIds.has(txnId);
                
                return (
                  <div key={i} className="px-6 py-2 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-gray-500 w-20">{formatDate(txn.date)}</span>
                      {txn.accountLabel && (
                        <span className="text-xs text-gray-400">{txn.accountLabel}</span>
                      )}
                      {isBonus && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-50 text-amber-700 uppercase tracking-wide">
                          Bonus
                        </span>
                      )}
                      {needsReview && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-orange-50 text-orange-700 uppercase tracking-wide">
                          Needs review
                        </span>
                      )}
                    </div>
                    <span className="text-sm font-semibold text-green-600 tabular-nums">
                      +{formatCurrency(txn.amount, currency)}
                    </span>
                  </div>
                );
              })}
          </div>
        </div>
      )}
      
    </div>
  );
}
