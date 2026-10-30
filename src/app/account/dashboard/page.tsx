"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseClient } from "@/lib/firebase";
import { useActiveProfile } from "@/contexts/ActiveProfileContext";
import { fmt } from "@/lib/currencyUtils";
import { getSignColor } from "@/lib/colorHelpers";
import { Drawer, type DrawerType } from "@/components/Drawer";
import { ReviewList } from "@/components/ReviewList";
import { RangeSwitch } from "@/components/RangeSwitch";
import type { TimeRange } from "@/lib/rangeUtils";
import type { GapReconciliation } from "@/lib/gapReconciliation";
import { AiAnswer } from "@/components/AiAnswer";

// Convert TimeRange to Drawer's TimeWindow format
function rangeToWindow(range: TimeRange): "last3" | "12month" | "ytd" {
  switch (range) {
    case "3mo": return "last3";
    case "12mo": return "12month";
    case "ytd": return "ytd";
  }
}

// ── Types ──────────────────────────────────────────────────────────────────────

interface MoneyCoachBucket {
  bucket: string;
  label: string;
  emoji: string;
  monthlyAverage: number;
  pctOfIncome: number;
  targetPct: number;
  advice: string;
  hasEstimates?: boolean;
}

interface MoneyCoachBreakdown {
  incomeAmount: number;
  incomeBasisLabel: string;
  rangeLabel: string;
  buckets: MoneyCoachBucket[];
  totalSpending: number;
  savingsRate: number;
  coverage: {
    monthsCovered: number;
    monthsSpan: number;
    coveragePct: number;
    missingMonths: string[];
  };
  homeCurrency?: string;
  gapReconciliation?: GapReconciliation;
}

// Note: AI answer rendering moved to shared AiAnswer component

// ── Components ─────────────────────────────────────────────────────────────────

function QuestionBox({ 
  onAsk, 
  loading,
  suggestions,
  usageStats,
  savedAnswersCount,
}: { 
  onAsk: (q: string) => void; 
  loading: boolean;
  suggestions: string[];
  usageStats?: { remaining: number; limit: number } | null;
  savedAnswersCount: number;
}) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = () => {
    if (query.trim() && !loading) {
      onAsk(query);
    }
  };

  const selectAllText = (input: HTMLInputElement) => {
    try {
      input.select();
    } catch {
      // Fallback for mobile
      input.setSelectionRange(0, input.value.length);
    }
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLInputElement>) => {
    if (document.activeElement !== e.currentTarget) {
      e.preventDefault();
      e.currentTarget.focus();
      selectAllText(e.currentTarget);
    }
  };

  const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    requestAnimationFrame(() => {
      if (inputRef.current) {
        selectAllText(inputRef.current);
      }
    });
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
          onMouseDown={handleMouseDown}
          onFocus={handleFocus}
          disabled={loading}
          placeholder="Ask about your spending, savings, or goals…"
          className="w-full rounded-2xl border-2 border-gray-200 px-6 py-5 pr-28 text-lg shadow-sm transition-all placeholder:text-gray-400 focus:border-purple-500 focus:shadow-lg focus:shadow-purple-100 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
        />
        <button
          onClick={handleSubmit}
          disabled={!query.trim() || loading}
          className="absolute right-3 top-1/2 -translate-y-1/2 rounded-xl bg-purple-600 px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-purple-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {loading ? (
            <span className="inline-flex items-center gap-1">
              <span className="animate-pulse">…</span>
            </span>
          ) : (
            "Ask"
          )}
        </button>
      </div>
      
      {/* Usage stats for free users */}
      {usageStats && usageStats.limit > 0 && (
        <div className="text-center text-xs text-gray-500">
          {usageStats.remaining} of {usageStats.limit} AI answers left this month
        </div>
      )}
      
      <div className="flex flex-wrap items-center justify-center gap-2">
        <span className="text-sm text-gray-500">Try asking:</span>
        {suggestions.slice(0, 3).map((q) => (
          <button
            key={q}
            onClick={() => onAsk(q)}
            disabled={loading}
            className="rounded-full border border-purple-200 bg-purple-50 px-4 py-2 text-sm font-medium text-purple-700 transition hover:border-purple-300 hover:bg-purple-100 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {q}
          </button>
        ))}
      </div>
      
      {/* Saved answers link */}
      {savedAnswersCount > 0 && (
        <div className="text-center">
          <Link
            href="/account/saved-answers"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-purple-600 hover:text-purple-700 transition"
          >
            <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M17 3H7c-1.1 0-2 .9-2 2v16l7-3 7 3V5c0-1.1-.9-2-2-2z"/>
            </svg>
            <span>Saved answers ({savedAnswersCount})</span>
          </Link>
        </div>
      )}
    </div>
  );
}

// Feature flag - set to true to show "Open in Chat" link in answer cards
const SHOW_OPEN_IN_CHAT = false;

function AnswerCard({ 
  question, 
  answer, 
  onClear,
  token,
}: { 
  question: string; 
  answer: string; 
  onClear: () => void;
  token: string | null;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  
  // Handle Escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClear();
      }
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [onClear]);
  
  const handleSave = async () => {
    if (!token || saving || saved) return;
    
    setSaving(true);
    try {
      const res = await fetch("/api/user/saved-answers", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ question, answer }),
      });
      
      if (res.ok) {
        setSaved(true);
      }
    } catch (error) {
      console.error("Failed to save answer:", error);
    } finally {
      setSaving(false);
    }
  };
  
  return (
    <div className="mx-auto max-w-3xl rounded-2xl border-2 border-purple-100 bg-purple-50/30 shadow-sm">
      {/* Sticky Header */}
      <div className="sticky top-0 z-10 flex items-start gap-3 border-b border-purple-100 bg-purple-50/90 p-4 backdrop-blur">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-purple-600 text-xs font-bold text-white">
          ?
        </div>
        <div className="min-w-0 flex-1">
          <h4 className="text-sm font-semibold text-purple-900">{question}</h4>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            onClick={handleSave}
            disabled={saving || saved}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-purple-600 hover:bg-purple-100 transition disabled:opacity-50 disabled:cursor-not-allowed"
            aria-label={saved ? "Saved" : "Save answer"}
            title={saved ? "Saved" : "Save answer"}
          >
            {saved ? (
              <svg className="h-4 w-4 fill-current" fill="currentColor" viewBox="0 0 24 24">
                <path d="M17 3H7c-1.1 0-2 .9-2 2v16l7-3 7 3V5c0-1.1-.9-2-2-2z"/>
              </svg>
            ) : (
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"/>
              </svg>
            )}
          </button>
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-purple-600 hover:bg-purple-100 transition"
            aria-label={collapsed ? "Show answer" : "Minimize"}
          >
            {collapsed ? (
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            ) : (
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
              </svg>
            )}
          </button>
          <button
            onClick={onClear}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-purple-600 hover:bg-purple-100 transition"
            aria-label="Close"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
      
      {/* Answer Content */}
      {!collapsed && (
        <div className="max-h-[320px] overflow-y-auto p-4">
          <div className="text-gray-700">
            <AiAnswer content={answer} />
          </div>
          <div className="mt-4 flex items-center gap-3 border-t border-purple-100 pt-3">
            <button
              onClick={onClear}
              className="text-sm font-medium text-gray-600 hover:text-gray-700"
            >
              Ask another question
            </button>
          </div>
        </div>
      )}
      
      {/* Collapsed state */}
      {collapsed && (
        <div className="p-4">
          <button
            onClick={() => setCollapsed(false)}
            className="text-sm font-medium text-purple-600 hover:text-purple-700"
          >
            Show answer
          </button>
        </div>
      )}
    </div>
  );
}

function WhereMoneyGoes({ 
  breakdown, 
  currency, 
  onOpenDrawer,
  unreviewedCount,
  range,
  onRangeChange,
  rangeLoading,
}: { 
  breakdown: MoneyCoachBreakdown; 
  currency: string;
  onOpenDrawer: (type: DrawerType) => void;
  unreviewedCount: number;
  range: TimeRange;
  onRangeChange: (range: TimeRange) => void;
  rangeLoading: boolean;
}) {
  const { coverage, incomeAmount, incomeBasisLabel, rangeLabel, buckets } = breakdown;
  const [showExternalAccountsPopover, setShowExternalAccountsPopover] = useState(false);
  
  // Calculate bucket percentages
  const fixedBucket = buckets.find(b => b.bucket === "fixed");
  const essentialsBucket = buckets.find(b => b.bucket === "essentials");
  const flexibleBucket = buckets.find(b => b.bucket === "flexible");
  const savingsBucket = buckets.find(b => b.bucket === "savings");

  const bucketColors: Record<string, string> = {
    fixed: "#7c3aed",
    essentials: "#0ea5e9",
    flexible: "#f59e0b",
    savings: "#10b981",
  };

  return (
    <section className="mt-10">
      {/* Section Header with Range Switch */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-900">Where Your Money Goes</h2>
        <RangeSwitch value={range} onChange={onRangeChange} />
      </div>
      
      {/* Coverage Note */}
      {coverage.coveragePct < 90 && (
        <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-900">
          <span>⚠</span>
          <span>
            Based on {coverage.monthsCovered} of {coverage.monthsSpan} months
            {coverage.missingMonths.length > 0 && `, missing ${coverage.missingMonths.slice(0, 2).join(", ")}`}
            {coverage.missingMonths.length > 2 && `, +${coverage.missingMonths.length - 2} more`}
          </span>
          <span>·</span>
          <Link href="/account/statements" className="font-semibold underline">
            Upload missing months
          </Link>
        </div>
      )}

      {/* Five Bucket Cards - with subtle loading state */}
      <div className={`grid gap-4 sm:grid-cols-2 lg:grid-cols-5 transition-opacity ${rangeLoading ? 'opacity-60' : 'opacity-100'}`}>
            {/* Income Card */}
            <button
              onClick={() => onOpenDrawer("income")}
              className="rounded-2xl border border-gray-200 bg-gradient-to-br from-purple-50 to-white p-5 shadow-sm transition hover:shadow-md hover:border-purple-300 text-left"
            >
              <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-gray-500">
                <span className="h-2.5 w-2.5 rounded" style={{ backgroundColor: "#9333ea" }} />
                Income
                <svg className="ml-auto h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </div>
              <p className="text-2xl font-bold tracking-tight text-gray-900">
                {fmt(incomeAmount, currency)}
                <span className="text-sm font-medium text-gray-400">/mo</span>
              </p>
              <p className="mt-1 text-xs text-gray-500">{rangeLabel} · take-home</p>
              
              <div className="mt-4 h-2 w-full rounded-full bg-gray-100">
                <div className="h-full w-full rounded-full bg-purple-600" />
              </div>
              <div className="mt-1 flex justify-between text-[11px] text-gray-400">
                <span>{coverage.monthsCovered} deposits avg.</span>
                <span>steady</span>
              </div>
              
              <span className="mt-3 inline-block rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-semibold text-green-800">
                Stable
              </span>
              <p className="mt-2 min-h-[2.5rem] text-xs leading-relaxed text-gray-700">
                Consistent pay — a solid base to plan around.
              </p>
              <p className="mt-2 text-xs text-purple-600 font-medium">
                How is this calculated? →
              </p>
            </button>

            {/* Other Buckets */}
            {buckets.filter(b => b.bucket !== "uncategorized").map((bucket) => {
              const diff = bucket.pctOfIncome - bucket.targetPct;
              const absDiff = Math.abs(diff);
              
              // Status badge logic
              let statusTag = "On track";
              let statusBgColor = "bg-green-50";
              let statusTextColor = "text-green-700";
              let statusBorderColor = "border-green-100";
              let dotColor = "#10b981"; // green
              let barColor = bucketColors[bucket.bucket as keyof typeof bucketColors];
              
              if (bucket.bucket === "savings") {
                // Savings uses actual value sign
                if (bucket.monthlyAverage < 0) {
                  statusTag = "Negative";
                  statusBgColor = "bg-red-50";
                  statusTextColor = "text-red-700";
                  statusBorderColor = "border-red-100";
                  dotColor = "#ef4444"; // red
                  barColor = "#ef4444"; // red bar
                } else if (diff < -3) {
                  statusTag = `Below target by ${Math.round(absDiff)} pts`;
                  statusBgColor = "bg-red-50";
                  statusTextColor = "text-red-700";
                  statusBorderColor = "border-red-100";
                  dotColor = "#ef4444"; // red
                  barColor = "#ef4444"; // red bar
                } else if (diff < 0 && diff >= -3) {
                  // Slightly below target (0-3 pts under)
                  statusTag = `${Math.round(absDiff)} pts below target`;
                  statusBgColor = "bg-amber-50";
                  statusTextColor = "text-amber-700";
                  statusBorderColor = "border-amber-100";
                  dotColor = "#f59e0b"; // amber
                  barColor = "#f59e0b"; // amber bar
                } else if (bucket.pctOfIncome >= bucket.targetPct) {
                  statusTag = "On track";
                  statusBgColor = "bg-green-50";
                  statusTextColor = "text-green-700";
                  statusBorderColor = "border-green-100";
                  dotColor = "#10b981"; // green
                }
              } else {
                // Other buckets: over target is bad, under is good
                if (diff > 3) {
                  statusTag = `${Math.round(absDiff)} pts over`;
                  statusBgColor = "bg-red-50";
                  statusTextColor = "text-red-700";
                  statusBorderColor = "border-red-100";
                  dotColor = "#ef4444"; // red
                  barColor = "#ef4444"; // red bar
                } else if (diff > 0 && diff <= 3) {
                  statusTag = `${Math.round(absDiff)} pts over`;
                  statusBgColor = "bg-amber-50";
                  statusTextColor = "text-amber-700";
                  statusBorderColor = "border-amber-100";
                  dotColor = "#f59e0b"; // amber
                  barColor = "#f59e0b"; // amber bar
                } else if (diff < -3) {
                  // Well under target for spending = good
                  statusTag = `${Math.round(absDiff)} pts under`;
                  statusBgColor = "bg-green-50";
                  statusTextColor = "text-green-700";
                  statusBorderColor = "border-green-100";
                  dotColor = "#10b981"; // green
                } else {
                  // On track
                  statusTag = "On track";
                  statusBgColor = "bg-green-50";
                  statusTextColor = "text-green-700";
                  statusBorderColor = "border-green-100";
                  dotColor = "#10b981"; // green
                }
              }
              
              // Calculate bar width - clamp negative values to 0 for savings
              let barWidth = bucket.bucket === "savings" && bucket.pctOfIncome < 0 
                ? 0 
                : Math.min(100, (bucket.pctOfIncome / 50) * 100);

              return (
                <button
                  key={bucket.bucket}
                  onClick={() => onOpenDrawer(bucket.bucket as DrawerType)}
                  className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm transition hover:shadow-md hover:border-purple-300 text-left"
                >
                  <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-gray-500">
                    <span 
                      className="h-2.5 w-2.5 rounded" 
                      style={{ backgroundColor: dotColor }}
                    />
                    {bucket.label}
                    {bucket.hasEstimates && (
                      <span className="ml-1 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold normal-case text-gray-600">
                        est.
                      </span>
                    )}
                    {bucket.bucket === "fixed" && unreviewedCount > 0 && (
                      <span className="ml-1 rounded-full bg-violet-600 px-2 py-0.5 text-[10px] font-bold normal-case text-white" style={{ fontFamily: "Inter, sans-serif" }}>
                        {unreviewedCount} to review
                      </span>
                    )}
                    <svg className="ml-auto h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <p className={`text-2xl font-bold tracking-tight whitespace-nowrap ${bucket.bucket === 'savings' ? getSignColor(bucket.monthlyAverage) : 'text-gray-900'}`}>
                        {fmt(bucket.monthlyAverage, currency)}
                        <span className="text-sm font-medium text-gray-400">/mo</span>
                      </p>
                      {bucket.bucket === "savings" && breakdown.gapReconciliation?.flaggedTransfers && breakdown.gapReconciliation.flaggedTransfers.length > 0 && (
                        <div className="relative flex-shrink-0">
                          <span
                            role="button"
                            tabIndex={0}
                            onMouseEnter={() => setShowExternalAccountsPopover(true)}
                            onMouseLeave={() => setShowExternalAccountsPopover(false)}
                            onClick={(e) => {
                              e.stopPropagation();
                              setShowExternalAccountsPopover(!showExternalAccountsPopover);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.stopPropagation();
                                e.preventDefault();
                                setShowExternalAccountsPopover(!showExternalAccountsPopover);
                              }
                            }}
                            className="flex h-4 w-4 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-600 cursor-pointer"
                          >
                            <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                            </svg>
                          </span>
                          {showExternalAccountsPopover && (
                            <div className="absolute right-0 top-full z-[100] mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-lg border border-gray-200 bg-white p-3 shadow-xl">
                              <div className="text-xs font-semibold text-gray-900 break-words">Includes transfers to accounts not in the app</div>
                              <div className="mt-3 space-y-2.5">
                                {breakdown.gapReconciliation.flaggedTransfers.map((transfer, idx) => (
                                  <div key={idx} className="text-xs">
                                    <div className="flex items-baseline justify-between gap-2">
                                      <div className="font-medium text-gray-900">{transfer.date}</div>
                                      <div className="font-mono font-semibold text-gray-900 tabular-nums whitespace-nowrap">
                                        {fmt(transfer.amount, currency)}
                                      </div>
                                    </div>
                                    <div className="text-gray-600 break-words mt-0.5">
                                      From {transfer.fromAccount} to account ending in {transfer.destinationNumber?.slice(-4) || transfer.destinationNumber || "unknown"}
                                    </div>
                                  </div>
                                ))}
                                <div className="flex items-center justify-between border-t border-gray-200 pt-2 text-xs font-semibold">
                                  <span className="text-gray-700">Total</span>
                                  <span className="font-mono text-gray-900 tabular-nums whitespace-nowrap">
                                    {fmt(breakdown.gapReconciliation.flaggedTransfers.reduce((sum, t) => sum + t.amount, 0), currency)}
                                  </span>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                  <p className="mt-1 text-xs text-gray-500">
                    {rangeLabel} · {Math.round(bucket.pctOfIncome)}% of take-home
                    {bucket.bucket === "savings" && ` · target ${bucket.targetPct}%`}
                  </p>
                  
                  <div className="relative mt-4 h-2 w-full rounded-full bg-gray-100">
                    <div 
                      className="h-full rounded-full" 
                      style={{ 
                        width: `${barWidth}%`,
                        backgroundColor: barColor
                      }}
                    />
                    {/* Target marker - only show for savings */}
                    {bucket.bucket === "savings" && (
                      <div 
                        className="absolute top-[-3px] h-4 w-0.5 rounded-full bg-gray-900"
                        style={{ left: `${Math.min(100, (bucket.targetPct / 50) * 100)}%` }}
                      />
                    )}
                  </div>
                  <div className="mt-1 flex justify-between text-[11px] text-gray-400">
                    <span>0%</span>
                    {bucket.bucket === "savings" && <span>target {bucket.targetPct}%</span>}
                    <span>{bucket.bucket === "fixed" ? "50%" : bucket.bucket === "essentials" ? "25%" : bucket.bucket === "flexible" ? "40%" : "30%"}</span>
                  </div>
                  
                  <span className={`mt-3 inline-block rounded-full border px-2 py-0.5 text-[11px] font-semibold ${statusBgColor} ${statusTextColor} ${statusBorderColor}`}>
                    {statusTag}
                  </span>
                  <p className="mt-2 min-h-[2.5rem] text-xs leading-relaxed text-gray-700">
                    {bucket.advice}
                  </p>
                  <p className="mt-2 text-xs text-purple-600 font-medium">
                    See breakdown →
                  </p>
                </button>
              );
            })}
          </div>
    </section>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────

// ── V2 Dashboard ───────────────────────────────────────────────────────────────

function DashboardV2() {
  const router = useRouter();
  const { buildHeaders } = useActiveProfile();
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [netWorth, setNetWorth] = useState<number>(0);
  const [monthlyChange, setMonthlyChange] = useState<number>(0);
  const [currency, setCurrency] = useState("CAD");
  const [currentMonthData, setCurrentMonthData] = useState<{
    income: number;
    fixed: number;
    essentials: number;
    flexible: number;
    savings: number;
    yearMonth: string;
  } | null>(null);
  const [subscriptions, setSubscriptions] = useState<{
    noRecentCharge: Array<{ merchant: string; lastDate: string; amount: number }>;
    upcomingRenewals: Array<{ merchant: string; nextDate: string; amount: number }>;
  }>({ noRecentCharge: [], upcomingRenewals: [] });
  const [debtPlan, setDebtPlan] = useState<{ interestSaved: number; progressPct: number } | null>(null);
  const [flaggedTransfers, setFlaggedTransfers] = useState<{ total: number; count: number }>({ total: 0, count: 0 });
  const [unreviewedCount, setUnreviewedCount] = useState(0);

  useEffect(() => {
    const { auth } = getFirebaseClient();
    return onAuthStateChanged(auth, async (user) => {
      if (!user) {
        router.push("/login");
        return;
      }
      const tok = await user.getIdToken();
      setToken(tok);
    });
  }, [router]);

  useEffect(() => {
    if (!token) return;

    const loadDashboardData = async () => {
      setLoading(true);
      try {
        const headers = buildHeaders(token);
        
        // Parallel fetch all data
        const [netWorthRes, moneyCoachRes, subscriptionsRes, debtPlansRes, anomaliesRes] = await Promise.all([
          fetch("/api/user/net-worth-summary", { headers }),
          fetch("/api/user/money-coach?range=3mo", { headers }),
          fetch("/api/user/subscriptions", { headers }),
          fetch("/api/user/debt-plans", { headers }),
          fetch("/api/user/debt-payment-anomalies", { headers }),
        ]);

        // Net worth data
        if (netWorthRes.ok) {
          const data = await netWorthRes.json();
          setNetWorth(data.netWorth || 0);
          setMonthlyChange(data.monthlyChange || 0);
          setCurrency(data.currency || "CAD");
        }

        // Money coach data (for cash flow)
        if (moneyCoachRes.ok) {
          const data = await moneyCoachRes.json();
          setCurrency(data.homeCurrency || currency);
          
          // Extract current month data from buckets
          const fixedBucket = data.buckets.find((b: { bucket: string }) => b.bucket === "fixed");
          const essentialsBucket = data.buckets.find((b: { bucket: string }) => b.bucket === "essentials");
          const flexibleBucket = data.buckets.find((b: { bucket: string }) => b.bucket === "flexible");
          const savingsBucket = data.buckets.find((b: { bucket: string }) => b.bucket === "savings");

          setCurrentMonthData({
            income: data.incomeAmount || 0,
            fixed: fixedBucket?.monthlyAverage || 0,
            essentials: essentialsBucket?.monthlyAverage || 0,
            flexible: flexibleBucket?.monthlyAverage || 0,
            savings: savingsBucket?.monthlyAverage || 0,
            yearMonth: new Date().toISOString().slice(0, 7),
          });

          // Flagged transfers
          if (data.gapReconciliation?.flaggedTransfers) {
            const transfers = data.gapReconciliation.flaggedTransfers;
            const total = transfers.reduce((sum: number, t: { amount: number }) => sum + t.amount, 0);
            setFlaggedTransfers({ total, count: transfers.length });
          }
        }

        // Subscriptions data
        if (subscriptionsRes.ok) {
          const data = await subscriptionsRes.json();
          const noRecentCharge = (data.confirmedActive || [])
            .filter((s: { noRecentCharge?: boolean }) => s.noRecentCharge)
            .map((s: { merchant: string; lastDate: string; amount: number }) => ({
              merchant: s.merchant,
              lastDate: s.lastDate,
              amount: s.amount,
            }));

          // Calculate upcoming renewals (next 30 days)
          const today = new Date();
          const thirtyDaysLater = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);
          const upcomingRenewals = (data.confirmedActive || [])
            .filter((s: { nextDate: string | null }) => {
              if (!s.nextDate) return false;
              const nextDate = new Date(s.nextDate);
              return nextDate >= today && nextDate <= thirtyDaysLater;
            })
            .map((s: { merchant: string; nextDate: string; amount: number }) => ({
              merchant: s.merchant,
              nextDate: s.nextDate,
              amount: s.amount,
            }));

          setSubscriptions({ noRecentCharge, upcomingRenewals });
        }

        // Debt plans data
        if (debtPlansRes.ok) {
          const data = await debtPlansRes.json();
          if (data.plans && data.plans.length > 0) {
            const activePlan = data.plans.find((p: { status: string }) => p.status === "active");
            if (activePlan) {
              setDebtPlan({
                interestSaved: activePlan.interestSaved || 0,
                progressPct: activePlan.progressPct || 0,
              });
            }
          }
        }

        // Debt payment anomalies
        if (anomaliesRes.ok) {
          const data = await anomaliesRes.json();
          setUnreviewedCount(data.anomalies?.length || 0);
        }

      } catch (error) {
        console.error("Failed to load dashboard data:", error);
      } finally {
        setLoading(false);
      }
    };

    loadDashboardData();
  }, [token, buildHeaders, currency, router]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-purple-600 border-t-transparent" />
      </div>
    );
  }

  const totalActions = 
    subscriptions.noRecentCharge.length +
    subscriptions.upcomingRenewals.length +
    (debtPlan ? 1 : 0) +
    (flaggedTransfers.count > 0 ? 1 : 0) +
    unreviewedCount;

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-white pb-12">
      <div className="mx-auto max-w-6xl px-4 py-8">
        
        {/* Hero - Net Worth */}
        <div className="mb-8 rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-500 uppercase tracking-wide">Net Worth</p>
              <p className="mt-2 text-5xl font-bold tracking-tight text-gray-900">
                {fmt(netWorth, currency)}
              </p>
            </div>
            <div className={`flex items-center gap-2 rounded-xl px-4 py-2 ${monthlyChange >= 0 ? "bg-green-50" : "bg-red-50"}`}>
              {monthlyChange >= 0 ? (
                <svg className="h-5 w-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 10l7-7m0 0l7 7m-7-7v18" />
                </svg>
              ) : (
                <svg className="h-5 w-5 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                </svg>
              )}
              <span className={`text-lg font-semibold ${monthlyChange >= 0 ? "text-green-700" : "text-red-700"}`}>
                {fmt(Math.abs(monthlyChange), currency)} this month
              </span>
            </div>
          </div>
        </div>

        {/* Monthly Cash Flow Strip */}
        {currentMonthData && (
          <div className="mb-8 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">
                {new Date(currentMonthData.yearMonth + "-01").toLocaleDateString("en-US", { month: "long", year: "numeric" })} Cash Flow
              </h2>
              <Link 
                href="/account/spending"
                className="text-sm font-medium text-purple-600 hover:text-purple-700 transition"
              >
                See full breakdown →
              </Link>
            </div>
            
            {/* Flow bars */}
            <div className="space-y-3">
              <div className="flex items-center gap-4">
                <div className="w-24 text-sm font-medium text-gray-600">Income</div>
                <div className="flex-1">
                  <div className="h-10 rounded-lg bg-purple-100 flex items-center px-3">
                    <span className="text-sm font-semibold text-purple-900">
                      {fmt(currentMonthData.income, currency)}
                    </span>
                  </div>
                </div>
              </div>
              
              <div className="flex items-center gap-4">
                <div className="w-24 text-sm font-medium text-gray-600">Spending</div>
                <div className="flex-1 flex gap-1">
                  {/* Fixed */}
                  <Link 
                    href="/account/spending#fixed"
                    className="h-10 rounded-l-lg flex items-center justify-center px-3 hover:opacity-80 transition"
                    style={{ 
                      backgroundColor: "#7c3aed",
                      width: `${(currentMonthData.fixed / currentMonthData.income) * 100}%`
                    }}
                    title={`Fixed: ${fmt(currentMonthData.fixed, currency)}`}
                  >
                    <span className="text-xs font-semibold text-white whitespace-nowrap">
                      Fixed {fmt(currentMonthData.fixed, currency)}
                    </span>
                  </Link>
                  
                  {/* Essentials */}
                  <Link 
                    href="/account/spending#essentials"
                    className="h-10 flex items-center justify-center px-3 hover:opacity-80 transition"
                    style={{ 
                      backgroundColor: "#0ea5e9",
                      width: `${(currentMonthData.essentials / currentMonthData.income) * 100}%`
                    }}
                    title={`Essentials: ${fmt(currentMonthData.essentials, currency)}`}
                  >
                    <span className="text-xs font-semibold text-white whitespace-nowrap">
                      Essentials {fmt(currentMonthData.essentials, currency)}
                    </span>
                  </Link>
                  
                  {/* Flexible */}
                  <Link 
                    href="/account/spending#flexible"
                    className="h-10 rounded-r-lg flex items-center justify-center px-3 hover:opacity-80 transition"
                    style={{ 
                      backgroundColor: "#f59e0b",
                      width: `${(currentMonthData.flexible / currentMonthData.income) * 100}%`
                    }}
                    title={`Flexible: ${fmt(currentMonthData.flexible, currency)}`}
                  >
                    <span className="text-xs font-semibold text-white whitespace-nowrap">
                      Flexible {fmt(currentMonthData.flexible, currency)}
                    </span>
                  </Link>
                </div>
              </div>
              
              <div className="flex items-center gap-4">
                <div className="w-24 text-sm font-medium text-gray-600">Remaining</div>
                <div className="flex-1">
                  <div 
                    className="h-10 rounded-lg flex items-center px-3"
                    style={{ backgroundColor: currentMonthData.savings >= 0 ? "#10b981" : "#ef4444" }}
                  >
                    <span className="text-sm font-semibold text-white">
                      {fmt(currentMonthData.savings, currency)}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Action List */}
        {totalActions > 0 && (
          <div className="mb-8 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="mb-4 text-lg font-semibold text-gray-900">
              {totalActions} {totalActions === 1 ? "item" : "items"} need your attention
            </h2>
            <div className="space-y-3">
              {/* Subscriptions with no recent charge */}
              {subscriptions.noRecentCharge.length > 0 && (
                <Link
                  href="/account/spending?tab=subscriptions"
                  className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 hover:bg-amber-100 transition"
                >
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-600 text-white">
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-amber-900">
                      {subscriptions.noRecentCharge.length} {subscriptions.noRecentCharge.length === 1 ? "subscription hasn't" : "subscriptions haven't"} charged in 45+ days
                    </p>
                    <p className="mt-1 text-xs text-amber-700">
                      {subscriptions.noRecentCharge.slice(0, 3).map(s => s.merchant).join(", ")}
                      {subscriptions.noRecentCharge.length > 3 && `, +${subscriptions.noRecentCharge.length - 3} more`}
                    </p>
                  </div>
                  <svg className="h-5 w-5 shrink-0 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </Link>
              )}

              {/* Upcoming renewals */}
              {subscriptions.upcomingRenewals.length > 0 && (
                <Link
                  href="/account/spending?tab=subscriptions"
                  className="flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 p-4 hover:bg-blue-100 transition"
                >
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white">
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-blue-900">
                      {subscriptions.upcomingRenewals.length} {subscriptions.upcomingRenewals.length === 1 ? "subscription renewing" : "subscriptions renewing"} in the next 30 days
                    </p>
                    <p className="mt-1 text-xs text-blue-700">
                      Total: {fmt(subscriptions.upcomingRenewals.reduce((sum, s) => sum + s.amount, 0), currency)}
                    </p>
                  </div>
                  <svg className="h-5 w-5 shrink-0 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </Link>
              )}

              {/* Debt payoff progress */}
              {debtPlan && (
                <Link
                  href="/account/debts?tab=payoff"
                  className="flex items-start gap-3 rounded-lg border border-green-200 bg-green-50 p-4 hover:bg-green-100 transition"
                >
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-green-600 text-white">
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-green-900">
                      Debt payoff: On track to save {fmt(debtPlan.interestSaved, currency)} in interest
                    </p>
                    <p className="mt-1 text-xs text-green-700">
                      {Math.round(debtPlan.progressPct)}% complete
                    </p>
                  </div>
                  <svg className="h-5 w-5 shrink-0 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </Link>
              )}

              {/* Flagged transfers */}
              {flaggedTransfers.count > 0 && (
                <Link
                  href="/account/spending"
                  className="flex items-start gap-3 rounded-lg border border-purple-200 bg-purple-50 p-4 hover:bg-purple-100 transition"
                >
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-purple-600 text-white">
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-purple-900">
                      {fmt(flaggedTransfers.total, currency)} in transfers to external accounts
                    </p>
                    <p className="mt-1 text-xs text-purple-700">
                      {flaggedTransfers.count} {flaggedTransfers.count === 1 ? "transfer" : "transfers"} to accounts not in the app
                    </p>
                  </div>
                  <svg className="h-5 w-5 shrink-0 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </Link>
              )}

              {/* Unreviewed debt payments */}
              {unreviewedCount > 0 && (
                <Link
                  href="/account/spending"
                  className="flex items-start gap-3 rounded-lg border border-violet-200 bg-violet-50 p-4 hover:bg-violet-100 transition"
                >
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-violet-600 text-white">
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-violet-900">
                      {unreviewedCount} {unreviewedCount === 1 ? "debt payment needs" : "debt payments need"} review
                    </p>
                    <p className="mt-1 text-xs text-violet-700">
                      Classify payments to improve spending accuracy
                    </p>
                  </div>
                  <svg className="h-5 w-5 shrink-0 text-violet-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </Link>
              )}
            </div>
          </div>
        )}

        {/* Quick Navigation */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Link
            href="/account/spending"
            className="flex items-center gap-4 rounded-xl border border-gray-200 bg-white p-5 shadow-sm hover:shadow-md hover:border-purple-300 transition"
          >
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-purple-100">
              <svg className="h-6 w-6 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-900">Spending</p>
              {currentMonthData && (
                <p className="text-xs text-gray-500">
                  {fmt(currentMonthData.fixed + currentMonthData.essentials + currentMonthData.flexible, currency)} this month
                </p>
              )}
            </div>
            <svg className="h-5 w-5 shrink-0 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </Link>

          <Link
            href="/account/debts"
            className="flex items-center gap-4 rounded-xl border border-gray-200 bg-white p-5 shadow-sm hover:shadow-md hover:border-purple-300 transition"
          >
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-red-100">
              <svg className="h-6 w-6 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-900">Debts</p>
              <p className="text-xs text-gray-500">Credit cards & loans</p>
            </div>
            <svg className="h-5 w-5 shrink-0 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </Link>

          <Link
            href="/account/assets"
            className="flex items-center gap-4 rounded-xl border border-gray-200 bg-white p-5 shadow-sm hover:shadow-md hover:border-purple-300 transition"
          >
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-green-100">
              <svg className="h-6 w-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-900">Assets</p>
              <p className="text-xs text-gray-500">Bank accounts & investments</p>
            </div>
            <svg className="h-5 w-5 shrink-0 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </Link>

          <Link
            href="/account/spending?tab=subscriptions"
            className="flex items-center gap-4 rounded-xl border border-gray-200 bg-white p-5 shadow-sm hover:shadow-md hover:border-purple-300 transition"
          >
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-blue-100">
              <svg className="h-6 w-6 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-900">Subscriptions</p>
              {subscriptions.noRecentCharge.length > 0 && (
                <p className="text-xs text-amber-600 font-medium">
                  {subscriptions.noRecentCharge.length} inactive
                </p>
              )}
            </div>
            <svg className="h-5 w-5 shrink-0 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </Link>

          <Link
            href="/account/debts?tab=payoff"
            className="flex items-center gap-4 rounded-xl border border-gray-200 bg-white p-5 shadow-sm hover:shadow-md hover:border-purple-300 transition"
          >
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-violet-100">
              <svg className="h-6 w-6 text-violet-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-900">Debt Payoff</p>
              {debtPlan ? (
                <p className="text-xs text-green-600 font-medium">
                  {Math.round(debtPlan.progressPct)}% complete
                </p>
              ) : (
                <p className="text-xs text-gray-500">Plan your payoff strategy</p>
              )}
            </div>
            <svg className="h-5 w-5 shrink-0 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </Link>

          <Link
            href="/account/chat"
            className="flex items-center gap-4 rounded-xl border border-gray-200 bg-white p-5 shadow-sm hover:shadow-md hover:border-purple-300 transition"
          >
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-purple-100">
              <svg className="h-6 w-6 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-900">Ask AI</p>
              <p className="text-xs text-gray-500">Get financial insights</p>
            </div>
            <svg className="h-5 w-5 shrink-0 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </Link>
        </div>

      </div>
    </div>
  );
}

// ── V1 Dashboard (Original) ───────────────────────────────────────────────────

export default function DashboardPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { buildHeaders } = useActiveProfile();
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [askLoading, setAskLoading] = useState(false);
  const [currentAnswer, setCurrentAnswer] = useState<{ question: string; answer: string } | null>(null);
  const [breakdown, setBreakdown] = useState<MoneyCoachBreakdown | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [usageStats, setUsageStats] = useState<{ remaining: number; limit: number } | null>(null);
  const [savedAnswersCount, setSavedAnswersCount] = useState<number>(0);
  const [currency, setCurrency] = useState("USD");
  const [activeDrawer, setActiveDrawer] = useState<DrawerType | null>(null);
  const [unreviewedCount, setUnreviewedCount] = useState(0);
  
  // Range state - default to 3mo, sync with URL
  const [range, setRange] = useState<TimeRange>(() => {
    const param = searchParams.get("range");
    if (param === "12mo" || param === "ytd") return param;
    return "3mo";
  });
  const [rangeLoading, setRangeLoading] = useState(false);

  // Handle URL hash for drawer state
  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash.slice(1); // Remove #
      if (hash && ["income", "fixed", "essentials", "flexible", "savings"].includes(hash)) {
        setActiveDrawer(hash as DrawerType);
      } else {
        setActiveDrawer(null);
      }
    };

    handleHashChange(); // Initial load
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  const openDrawer = (type: DrawerType) => {
    window.location.hash = type;
  };

  const closeDrawer = () => {
    window.location.hash = "";
  };

  useEffect(() => {
    const { auth } = getFirebaseClient();
    return onAuthStateChanged(auth, async (user) => {
      if (!user) { 
        router.push("/login"); 
        return; 
      }
      const tok = await user.getIdToken();
      setToken(tok);
    });
  }, [router]);

  const loadData = useCallback(async (tok: string, selectedRange: TimeRange, options?: { silent?: boolean }) => {
    if (!options?.silent) {
      setLoading(true);
    }
    try {
      const [coachRes, suggestionsRes, anomaliesRes, savedAnswersRes] = await Promise.all([
        fetch(`/api/user/money-coach?range=${selectedRange}`, { headers: buildHeaders(tok) }),
        fetch("/api/user/ai-ask", { headers: buildHeaders(tok) }),
        fetch("/api/user/debt-payment-anomalies", { headers: buildHeaders(tok) }),
        fetch("/api/user/saved-answers", { headers: buildHeaders(tok) }),
      ]);
      
      if (coachRes.ok) {
        const data = await coachRes.json();
        setBreakdown(data);
        setCurrency(data.homeCurrency || "USD");
      }
      
      if (suggestionsRes.ok) {
        const data = await suggestionsRes.json();
        setSuggestions(data.suggestions || []);
        // Set usage stats (limit -1 means paid plan / unlimited)
        if (data.limit !== undefined && data.remaining !== undefined) {
          setUsageStats({ remaining: data.remaining, limit: data.limit });
        }
      }

      if (anomaliesRes.ok) {
        const data = await anomaliesRes.json();
        setUnreviewedCount(data.anomalies?.length || 0);
      }
      
      if (savedAnswersRes.ok) {
        const data = await savedAnswersRes.json();
        setSavedAnswersCount(data.savedAnswers?.length || 0);
      }
    } catch (error) {
      console.error("Failed to load dashboard data:", error);
    } finally {
      if (!options?.silent) {
        setLoading(false);
      }
    }
  }, [buildHeaders]);

  useEffect(() => {
    if (token) {
      loadData(token, range);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]); // Only reload on token change; range changes are handled by handleRangeChange
  
  const handleRangeChange = async (newRange: TimeRange) => {
    if (!token) return;
    
    // Keep previous values visible with loading state
    setRangeLoading(true);
    
    try {
      // Fetch only the money-coach data for the new range
      const coachRes = await fetch(`/api/user/money-coach?range=${newRange}`, { 
        headers: buildHeaders(token) 
      });
      
      if (coachRes.ok) {
        const data = await coachRes.json();
        setBreakdown(data);
        setCurrency(data.homeCurrency || "USD");
      }
      
      // Update URL without navigation
      const params = new URLSearchParams(window.location.search);
      params.set("range", newRange);
      window.history.replaceState({}, '', `?${params.toString()}`);
      
      // Update range state
      setRange(newRange);
    } catch (error) {
      console.error("Failed to update range:", error);
    } finally {
      setRangeLoading(false);
    }
  };

  const handleAsk = async (question: string) => {
    if (!token) return;
    
    setAskLoading(true);
    try {
      const res = await fetch("/api/user/ai-ask", {
        method: "POST",
        headers: {
          ...buildHeaders(token),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ question }),
      });
      
      const data = await res.json();
      setCurrentAnswer({ question, answer: data.answer });
      
      // Update usage stats if returned
      if (data.remaining !== undefined && data.limit !== undefined) {
        setUsageStats({ remaining: data.remaining, limit: data.limit });
      }
      
      setTimeout(() => {
        document.getElementById("answer-card")?.scrollIntoView({ 
          behavior: "smooth", 
          block: "center" 
        });
      }, 100);
    } catch (error) {
      console.error("Failed to answer question:", error);
    } finally {
      setAskLoading(false);
    }
  };

  const clearAnswer = () => {
    setCurrentAnswer(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
    // Focus and select all text in the Ask box
    setTimeout(() => {
      const questionBox = document.querySelector('input[placeholder*="Ask about"]') as HTMLInputElement;
      if (questionBox) {
        questionBox.focus();
        // Selection will happen via onFocus handler
      }
    }, 100);
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-purple-600 border-t-transparent" />
      </div>
    );
  }

  // Check for v=2 query parameter
  const version = searchParams.get("v");
  if (version === "2") {
    return <DashboardV2 />;
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-white pb-12">
      <div className="mx-auto max-w-6xl px-4 py-12">
        
        {/* Hero */}
        <div className="mb-10 text-center">
          <h1 className="mb-2 text-4xl font-bold tracking-tight text-gray-900">
            What do you want to know?
          </h1>
          <p className="text-lg text-gray-500">
            Ask me anything about your spending, savings, or financial goals
          </p>
        </div>

        {/* Question Box */}
        <div className="mb-8">
          <QuestionBox 
            onAsk={handleAsk} 
            loading={askLoading}
            suggestions={suggestions}
            usageStats={usageStats}
            savedAnswersCount={savedAnswersCount}
          />
        </div>

        {/* Answer */}
        {currentAnswer && (
          <div id="answer-card" className="mb-10">
            <AnswerCard 
              question={currentAnswer.question}
              answer={currentAnswer.answer}
              onClear={clearAnswer}
              token={token}
            />
          </div>
        )}

        {/* Debt Review List */}
        {breakdown && breakdown.coverage.monthsCovered > 0 && unreviewedCount > 0 && (
          <div className="mb-10">
            <ReviewList 
              token={token}
              reviewType="debt_payment"
              onReviewComplete={() => {
                // Silent background refresh - keep current UI, swap in new numbers
                if (token) {
                  loadData(token, range, { silent: true });
                }
              }} 
            />
          </div>
        )}

        {/* Where Money Goes */}
        {breakdown && breakdown.coverage.monthsCovered > 0 ? (
          <WhereMoneyGoes 
            breakdown={breakdown} 
            currency={currency} 
            onOpenDrawer={openDrawer} 
            unreviewedCount={unreviewedCount}
            range={range}
            onRangeChange={handleRangeChange}
            rangeLoading={rangeLoading}
          />
        ) : (
          <div className="mx-auto mt-16 max-w-2xl rounded-2xl border-2 border-dashed border-purple-200 bg-purple-50/30 p-12 text-center">
            <p className="mb-3 text-lg font-semibold text-gray-600">
              Upload your first statement to see your financial breakdown
            </p>
            <Link
              href="/upload"
              className="inline-flex items-center gap-2 rounded-xl bg-purple-600 px-6 py-3 font-semibold text-white shadow-md transition hover:bg-purple-700"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
              Upload statements
            </Link>
          </div>
        )}
      </div>

      {/* Drawer */}
      <Drawer
        type={activeDrawer || "income"}
        isOpen={activeDrawer !== null}
        onClose={closeDrawer}
        token={token}
        currency={currency}
        initialWindow={rangeToWindow(range)}
      />
    </div>
  );
}
