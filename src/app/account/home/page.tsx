"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseClient } from "@/lib/firebase";
import { useActiveProfile } from "@/contexts/ActiveProfileContext";
import { fmt } from "@/lib/currencyUtils";

// ── Types ──────────────────────────────────────────────────────────────────────

interface MoneyCoachBucket {
  bucket: string;
  label: string;
  emoji: string;
  monthlyMedian: number;
  pctOfIncome: number;
  targetPct: number;
  advice: string;
}

interface MoneyCoachBreakdown {
  incomeMedian: number;
  buckets: MoneyCoachBucket[];
  totalSpending: number;
  savingsRate: number;
  coverage: {
    monthsCovered: number;
    monthsSpan: number;
    coveragePct: number;
    missingMonths: string[];
  };
}

// ── Components ─────────────────────────────────────────────────────────────────

function DataQualityIndicator({ 
  coverage 
}: { 
  coverage: MoneyCoachBreakdown["coverage"] 
}) {
  const { monthsCovered, monthsSpan, coveragePct, missingMonths } = coverage;
  
  if (monthsSpan === 0) return null;
  
  const qualityLevel = coveragePct >= 90 ? "high" : coveragePct >= 70 ? "medium" : "low";
  
  if (qualityLevel === "high") {
    return (
      <div className="inline-flex items-center gap-1.5 text-xs text-gray-500">
        <svg className="h-4 w-4 text-green-500" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
        </svg>
        <span>Based on {monthsCovered} of {monthsSpan} months</span>
      </div>
    );
  }
  
  const formatMissingMonths = (months: string[]) => {
    const formatted = months.slice(0, 3).map(ym => {
      const [y, m] = ym.split("-");
      return new Date(parseInt(y), parseInt(m) - 1).toLocaleDateString("en-US", { 
        month: "short", 
        year: "numeric" 
      });
    });
    
    if (months.length > 3) {
      return `${formatted.join(", ")}, +${months.length - 3} more`;
    }
    return formatted.join(", ");
  };
  
  if (qualityLevel === "medium") {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
        <div className="flex items-start gap-2">
          <span className="text-amber-600 text-lg">⚠️</span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-amber-900">
              Good data coverage
            </p>
            <p className="mt-0.5 text-xs text-gray-600">
              Based on {monthsCovered} of {monthsSpan} months ({coveragePct}% coverage)
              {missingMonths.length > 0 && ` • Missing: ${formatMissingMonths(missingMonths)}`}
            </p>
            <Link
              href="/account/statements"
              className="mt-1 inline-block text-xs font-semibold text-amber-700 hover:underline"
            >
              Upload missing months for better accuracy →
            </Link>
          </div>
        </div>
      </div>
    );
  }
  
  return (
    <div className="rounded-xl border-2 border-red-200 bg-red-50 p-4">
      <div className="flex items-start gap-3">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-red-100 text-red-700 text-sm font-bold">
          !
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-red-900">
            Limited data — averages may not be representative
          </p>
          <p className="mt-1 text-xs text-gray-700">
            You've uploaded {monthsCovered} of {monthsSpan} months ({coveragePct}%). 
            We need at least 6 months for reliable trends.
          </p>
          <div className="mt-3 flex gap-2">
            <Link
              href="/account/statements"
              className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700"
            >
              Upload more statements
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

function AIQuestionBox({ 
  onAsk, 
  loading,
  suggestions,
}: { 
  onAsk: (q: string) => void; 
  loading: boolean;
  suggestions: string[];
}) {
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);

  const handleSubmit = () => {
    if (query.trim() && !loading) {
      onAsk(query);
    }
  };

  return (
    <div className="w-full space-y-4">
      <div className={`relative transition-all ${focused ? "scale-[1.01]" : ""}`}>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
          disabled={loading}
          placeholder="Ask about your spending, savings, or financial goals..."
          className={`w-full rounded-2xl border-2 px-6 py-5 pr-32 text-lg shadow-sm transition-all placeholder:text-gray-400 focus:outline-none ${
            focused 
              ? "border-purple-500 shadow-lg shadow-purple-100" 
              : "border-gray-200 hover:border-gray-300"
          } ${loading ? "opacity-60 cursor-not-allowed" : ""}`}
        />
        <button
          onClick={handleSubmit}
          disabled={!query.trim() || loading}
          className="absolute right-3 top-1/2 -translate-y-1/2 rounded-xl bg-purple-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-purple-700 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {loading ? (
            <div className="flex items-center gap-2">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
              Thinking
            </div>
          ) : (
            "Ask"
          )}
        </button>
      </div>
      
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-gray-500">Try asking:</span>
        {suggestions.slice(0, 3).map((q) => (
          <button
            key={q}
            onClick={() => onAsk(q)}
            disabled={loading}
            className="rounded-full border border-purple-200 bg-purple-50 px-4 py-2 text-sm font-medium text-purple-700 transition hover:bg-purple-100 hover:border-purple-300 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {q}
          </button>
        ))}
      </div>
    </div>
  );
}

function AnswerCard({ 
  question, 
  answer, 
  onClear 
}: { 
  question: string; 
  answer: string; 
  onClear: () => void;
}) {
  return (
    <div className="rounded-2xl border-2 border-purple-100 bg-purple-50/30 p-6 shadow-sm">
      <div className="mb-3 flex items-start gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-purple-600 text-white">
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-purple-900">
            {question}
          </p>
        </div>
      </div>
      
      <div className="ml-11 space-y-3">
        <div 
          className="text-sm leading-relaxed text-gray-700 prose prose-sm max-w-none"
          dangerouslySetInnerHTML={{ __html: answer.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>') }}
        />
        
        <button
          onClick={onClear}
          className="text-sm font-medium text-purple-600 hover:text-purple-700"
        >
          Ask another question ↗
        </button>
      </div>
    </div>
  );
}

function MoneyCoachCard({ breakdown, currency }: { breakdown: MoneyCoachBreakdown; currency: string }) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">
          💰 Your Money Coach Breakdown
        </h2>
        <p className="mt-1 text-sm text-gray-500">
          Monthly averages based on your spending patterns
        </p>
      </div>

      {/* Income */}
      <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="text-2xl">💵</span>
            <h3 className="text-lg font-semibold text-gray-900">Monthly Income</h3>
          </div>
          <p className="text-2xl font-bold text-gray-900">
            {fmt(breakdown.incomeMedian, currency)}
          </p>
        </div>
        <p className="text-xs text-gray-500">Median across {breakdown.coverage.monthsCovered} months</p>
      </div>

      {/* Buckets */}
      <div className="space-y-3">
        {breakdown.buckets.map((bucket) => (
          <div key={bucket.bucket} className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="text-2xl">{bucket.emoji}</span>
                <div>
                  <h3 className="text-base font-semibold text-gray-900">{bucket.label}</h3>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {fmt(bucket.monthlyMedian, currency)}/mo • {bucket.pctOfIncome.toFixed(0)}% of income
                  </p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-sm font-medium text-gray-600">
                  Target: {bucket.targetPct}%
                </p>
                <div className={`mt-1 inline-flex items-center gap-1 text-xs font-semibold ${
                  bucket.pctOfIncome > bucket.targetPct + 5 ? "text-red-600" :
                  bucket.pctOfIncome < bucket.targetPct - 5 ? "text-green-600" :
                  "text-gray-500"
                }`}>
                  {bucket.pctOfIncome > bucket.targetPct + 5 ? "↑ Over" :
                   bucket.pctOfIncome < bucket.targetPct - 5 ? "↓ Under" :
                   "✓ On track"}
                </div>
              </div>
            </div>
            
            {/* Progress bar */}
            <div className="mt-3 h-2 w-full rounded-full bg-gray-100 overflow-hidden">
              <div 
                className={`h-full rounded-full transition-all ${
                  bucket.pctOfIncome > bucket.targetPct + 5 ? "bg-red-500" :
                  bucket.pctOfIncome < bucket.targetPct - 5 ? "bg-green-500" :
                  "bg-purple-500"
                }`}
                style={{ width: `${Math.min(100, (bucket.pctOfIncome / 100) * 100)}%` }}
              />
            </div>
            
            {/* Advice */}
            {bucket.advice && (
              <p className="mt-3 text-sm text-gray-600 leading-relaxed">
                {bucket.advice}
              </p>
            )}
          </div>
        ))}
      </div>

      {/* Savings Rate Summary */}
      <div className="rounded-xl border-2 border-purple-100 bg-purple-50 p-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-purple-900">Your Savings Rate</p>
            <p className="text-xs text-purple-700 mt-0.5">
              Income minus all spending
            </p>
          </div>
          <p className="text-3xl font-bold text-purple-900">
            {(breakdown.savingsRate * 100).toFixed(0)}%
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function HomePage() {
  const router = useRouter();
  const { buildHeaders } = useActiveProfile();
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [askLoading, setAskLoading] = useState(false);
  const [currentAnswer, setCurrentAnswer] = useState<{ question: string; answer: string } | null>(null);
  const [breakdown, setBreakdown] = useState<MoneyCoachBreakdown | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [currency, setCurrency] = useState("USD");

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

  const loadData = useCallback(async (tok: string) => {
    setLoading(true);
    try {
      // Load money coach breakdown
      const coachRes = await fetch("/api/user/money-coach", {
        headers: buildHeaders(tok),
      });
      
      if (coachRes.ok) {
        const data = await coachRes.json();
        setBreakdown(data);
        
        // Infer currency from data (defaults to USD)
        setCurrency("USD");
      }
      
      // Load suggestions
      const suggestionsRes = await fetch("/api/user/ai-ask", {
        headers: buildHeaders(tok),
      });
      
      if (suggestionsRes.ok) {
        const data = await suggestionsRes.json();
        setSuggestions(data.suggestions || []);
      }
    } catch (error) {
      console.error("Failed to load home data:", error);
    } finally {
      setLoading(false);
    }
  }, [buildHeaders]);

  useEffect(() => {
    if (token) {
      loadData(token);
    }
  }, [token, loadData]);

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
      
      // Scroll to answer
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
      <div className="mx-auto max-w-5xl px-4 py-12">
        
        {/* Hero Section */}
        <div className="mb-12 text-center">
          <h1 className="mb-3 text-4xl font-bold text-gray-900">
            What do you want to know?
          </h1>
          <p className="text-lg text-gray-500">
            Ask me anything about your spending, savings, or financial goals
          </p>
        </div>

        {/* AI Question Box */}
        <div className="mb-6">
          <AIQuestionBox 
            onAsk={handleAsk} 
            loading={askLoading}
            suggestions={suggestions}
          />
        </div>

        {/* Answer (if present) */}
        {currentAnswer && (
          <div id="answer-card" className="mb-12">
            <AnswerCard 
              question={currentAnswer.question}
              answer={currentAnswer.answer}
              onClear={clearAnswer}
            />
          </div>
        )}

        {/* Money Coach Breakdown */}
        {breakdown && (
          <div className="space-y-6">
            {/* Data Quality Indicator */}
            <DataQualityIndicator coverage={breakdown.coverage} />

            {/* Breakdown */}
            <MoneyCoachCard breakdown={breakdown} currency={currency} />
          </div>
        )}

        {/* Empty State */}
        {!breakdown && !loading && (
          <div className="rounded-2xl border-2 border-dashed border-gray-200 bg-gray-50 p-12 text-center">
            <p className="text-lg font-semibold text-gray-600 mb-3">
              Upload your first statement to see your financial breakdown
            </p>
            <Link
              href="/account/statements"
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
    </div>
  );
}
