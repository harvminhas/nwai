"use client";

import { useEffect, useState, useCallback } from "react";
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
  const [hasInteracted, setHasInteracted] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = () => {
    if (query.trim() && !loading) {
      onAsk(query);
    }
  };

  const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    if (!hasInteracted) {
      e.target.select();
    }
  };

  const handleMouseUp = (e: React.MouseEvent<HTMLInputElement>) => {
    if (!hasInteracted) {
      e.preventDefault();
      setHasInteracted(true);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setQuery(e.target.value);
    setHasInteracted(true);
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={handleChange}
          onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
          onFocus={handleFocus}
          onMouseUp={handleMouseUp}
          disabled={loading}
          placeholder="Ask about your spending, savings, or goals…"
          className="w-full rounded-2xl border-2 border-gray-200 px-6 py-5 pr-28 text-lg shadow-sm transition-all placeholder:text-gray-400 focus:border-purple-500 focus:shadow-lg focus:shadow-purple-100 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
        />
        <button
          onClick={handleSubmit}
          disabled={!query.trim() || loading}
          className="absolute right-3 top-1/2 -translate-y-1/2 rounded-xl bg-purple-600 px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-purple-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {loading ? "Thinking…" : "Ask"}
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
    const questionBox = document.querySelector('input[placeholder*="Ask about"]') as HTMLInputElement;
    if (questionBox) {
      questionBox.focus();
      questionBox.select();
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-purple-600 border-t-transparent" />
      </div>
    );
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
