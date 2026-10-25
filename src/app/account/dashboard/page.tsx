"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseClient } from "@/lib/firebase";
import { useActiveProfile } from "@/contexts/ActiveProfileContext";
import { fmt } from "@/lib/currencyUtils";
import { Drawer, type DrawerType } from "@/components/Drawer";

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
}

// ── Components ─────────────────────────────────────────────────────────────────

function QuestionBox({ 
  onAsk, 
  loading,
  suggestions,
}: { 
  onAsk: (q: string) => void; 
  loading: boolean;
  suggestions: string[];
}) {
  const [query, setQuery] = useState("");

  const handleSubmit = () => {
    if (query.trim() && !loading) {
      onAsk(query);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="relative">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
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
    <div className="mx-auto max-w-3xl rounded-2xl border-2 border-purple-100 bg-purple-50/30 p-6 shadow-sm">
      <div className="flex gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-purple-600 text-sm font-bold text-white">
          ?
        </div>
        <div className="min-w-0 flex-1">
          <h4 className="text-sm font-semibold text-purple-900">{question}</h4>
          <p 
            className="mt-2 text-sm leading-relaxed text-gray-700"
            dangerouslySetInnerHTML={{ __html: answer.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>') }}
          />
          <button
            onClick={onClear}
            className="mt-3 text-sm font-semibold text-purple-600 hover:text-purple-700"
          >
            Ask another question ↗
          </button>
        </div>
      </div>
    </div>
  );
}

function WhereMoneyGoes({ 
  breakdown, 
  currency, 
  onOpenDrawer 
}: { 
  breakdown: MoneyCoachBreakdown; 
  currency: string;
  onOpenDrawer: (type: DrawerType) => void;
}) {
  const [expanded, setExpanded] = useState(true);

  const { coverage, incomeAmount, incomeBasisLabel, buckets } = breakdown;
  
  // Calculate bucket percentages
  const fixedBucket = buckets.find(b => b.bucket === "fixed");
  const essentialsBucket = buckets.find(b => b.bucket === "essentials");
  const flexibleBucket = buckets.find(b => b.bucket === "flexible");
  const savingsBucket = buckets.find(b => b.bucket === "savings");
  
  const fixedPct = fixedBucket?.pctOfIncome || 0;
  const essentialsPct = essentialsBucket?.pctOfIncome || 0;
  const flexPct = flexibleBucket?.pctOfIncome || 0;
  const savPct = savingsBucket?.pctOfIncome || 0;

  const bucketColors: Record<string, string> = {
    fixed: "#7c3aed",
    essentials: "#0ea5e9",
    flexible: "#f59e0b",
    savings: "#10b981",
  };

  return (
    <section className="mt-10">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-5 rounded-2xl border border-gray-200 bg-white p-5 text-left shadow-sm transition-all hover:border-purple-200"
        aria-expanded={expanded}
      >
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-bold text-gray-900">Where your money goes</h2>
          <p className="mt-0.5 text-sm text-gray-500">
            {incomeBasisLabel} · {fmt(incomeAmount, currency)} take-home
          </p>
        </div>
        
        {/* Mini bar */}
        <div className="flex h-2.5 min-w-20 flex-1 max-w-xs gap-0.5 overflow-hidden rounded-full">
          <div style={{ flex: fixedPct, background: bucketColors.fixed }} />
          <div style={{ flex: essentialsPct, background: bucketColors.essentials }} />
          <div style={{ flex: flexPct, background: bucketColors.flexible }} />
          <div style={{ flex: savPct, background: bucketColors.savings }} />
        </div>
        
        <span className="whitespace-nowrap text-sm text-gray-700">
          Fixed {Math.round(fixedPct)}% · Essentials {Math.round(essentialsPct)}% · Flexible {Math.round(flexPct)}% · Savings {Math.round(savPct)}%
        </span>
        
        <svg 
          className={`h-6 w-6 shrink-0 text-gray-500 transition-transform ${expanded ? "rotate-180" : ""}`}
          fill="none" 
          viewBox="0 0 24 24" 
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {expanded && (
        <div className="mt-4 space-y-4">
          {/* Coverage Note */}
          {coverage.coveragePct < 90 && (
            <div className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-900">
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

          {/* Main Breakdown Bar with Legend */}
          <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            {/* Stacked Bar */}
            <div className="flex h-6 gap-0.5 overflow-hidden rounded-lg">
              {fixedBucket && (
                <div 
                  style={{ flex: fixedBucket.pctOfIncome, backgroundColor: bucketColors.fixed }}
                  className="flex items-center justify-center text-[11px] font-bold text-white"
                >
                  {Math.round(fixedBucket.pctOfIncome)}%
                </div>
              )}
              {essentialsBucket && (
                <div 
                  style={{ flex: essentialsBucket.pctOfIncome, backgroundColor: bucketColors.essentials }}
                  className="flex items-center justify-center text-[11px] font-bold text-white"
                >
                  {Math.round(essentialsBucket.pctOfIncome)}%
                </div>
              )}
              {flexibleBucket && (
                <div 
                  style={{ flex: flexibleBucket.pctOfIncome, backgroundColor: bucketColors.flexible }}
                  className="flex items-center justify-center text-[11px] font-bold text-white"
                >
                  {Math.round(flexibleBucket.pctOfIncome)}%
                </div>
              )}
              {savingsBucket && (
                <div 
                  style={{ flex: savingsBucket.pctOfIncome, backgroundColor: bucketColors.savings }}
                  className="flex items-center justify-center text-[11px] font-bold text-white"
                >
                  {Math.round(savingsBucket.pctOfIncome)}%
                </div>
              )}
            </div>

            {/* Legend with amounts */}
            <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm">
              {fixedBucket && (
                <span className="flex items-center gap-2">
                  <span className="h-3 w-3 rounded" style={{ backgroundColor: bucketColors.fixed }} />
                  <span className="font-semibold">Fixed costs</span>
                  <span className="text-gray-600">{fmt(fixedBucket.monthlyAverage, currency)}</span>
                  <span className="text-gray-400">({Math.round(fixedBucket.pctOfIncome)}%)</span>
                </span>
              )}
              {essentialsBucket && (
                <span className="flex items-center gap-2">
                  <span className="h-3 w-3 rounded" style={{ backgroundColor: bucketColors.essentials }} />
                  <span className="font-semibold">Essentials</span>
                  <span className="text-gray-600">{fmt(essentialsBucket.monthlyAverage, currency)}</span>
                  <span className="text-gray-400">({Math.round(essentialsBucket.pctOfIncome)}%)</span>
                </span>
              )}
              {flexibleBucket && (
                <span className="flex items-center gap-2">
                  <span className="h-3 w-3 rounded" style={{ backgroundColor: bucketColors.flexible }} />
                  <span className="font-semibold">Flexible</span>
                  <span className="text-gray-600">{fmt(flexibleBucket.monthlyAverage, currency)}</span>
                  <span className="text-gray-400">({Math.round(flexibleBucket.pctOfIncome)}%)</span>
                </span>
              )}
              {savingsBucket && (
                <span className="flex items-center gap-2">
                  <span className="h-3 w-3 rounded" style={{ backgroundColor: bucketColors.savings }} />
                  <span className="font-semibold">Savings & debt</span>
                  <span className="text-gray-600">{fmt(savingsBucket.monthlyAverage, currency)}</span>
                  <span className="text-gray-400">({Math.round(savingsBucket.pctOfIncome)}%)</span>
                </span>
              )}
            </div>

            {/* Target reference */}
            <div className="mt-3 text-xs text-gray-500">
              Target: Fixed costs 35% + Essentials 15% = 50% · Flexible 30% · Savings & debt 20%
            </div>
          </div>

          {/* Five Bucket Cards */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
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
              <p className="mt-1 text-xs text-gray-500">100% · take-home</p>
              
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
              
              let statusTag = "On track";
              let statusColor = "bg-green-100 text-green-800";
              
              if (diff > 3) {
                statusTag = `${Math.round(absDiff)}% over`;
                statusColor = "bg-amber-100 text-amber-800";
              } else if (diff < -3) {
                statusTag = `${Math.round(absDiff)}% under`;
                statusColor = "bg-green-100 text-green-800";
              } else if (diff > 0) {
                statusTag = `${Math.round(absDiff)}% ahead`;
                statusColor = "bg-green-100 text-green-800";
              }

              return (
                <button
                  key={bucket.bucket}
                  onClick={() => onOpenDrawer(bucket.bucket as DrawerType)}
                  className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm transition hover:shadow-md hover:border-purple-300 text-left"
                >
                  <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-gray-500">
                    <span 
                      className="h-2.5 w-2.5 rounded" 
                      style={{ backgroundColor: bucketColors[bucket.bucket as keyof typeof bucketColors] }}
                    />
                    {bucket.label}
                    {bucket.hasEstimates && (
                      <span className="ml-1 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold normal-case text-gray-600">
                        est.
                      </span>
                    )}
                    <svg className="ml-auto h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                  <p className="text-2xl font-bold tracking-tight text-gray-900">
                    {fmt(bucket.monthlyAverage, currency)}
                    <span className="text-sm font-medium text-gray-400">/mo</span>
                  </p>
                  <p className="mt-1 text-xs text-gray-500">
                    {Math.round(bucket.pctOfIncome)}% of take-home
                  </p>
                  
                  <div className="relative mt-4 h-2 w-full rounded-full bg-gray-100">
                    <div 
                      className="h-full rounded-full" 
                      style={{ 
                        width: `${Math.min(100, (bucket.pctOfIncome / 50) * 100)}%`,
                        backgroundColor: bucketColors[bucket.bucket as keyof typeof bucketColors]
                      }}
                    />
                    <div 
                      className="absolute top-[-3px] h-4 w-0.5 rounded-full bg-gray-900"
                      style={{ left: `${(bucket.targetPct / 50) * 100}%` }}
                    />
                  </div>
                  <div className="mt-1 flex justify-between text-[11px] text-gray-400">
                    <span>0%</span>
                    <span>target {bucket.targetPct}%</span>
                    <span>{bucket.bucket === "fixed" ? "50%" : bucket.bucket === "essentials" ? "25%" : bucket.bucket === "flexible" ? "40%" : "30%"}</span>
                  </div>
                  
                  <span className={`mt-3 inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${statusColor}`}>
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
        </div>
      )}
    </section>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const router = useRouter();
  const { buildHeaders } = useActiveProfile();
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [askLoading, setAskLoading] = useState(false);
  const [currentAnswer, setCurrentAnswer] = useState<{ question: string; answer: string } | null>(null);
  const [breakdown, setBreakdown] = useState<MoneyCoachBreakdown | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [currency, setCurrency] = useState("USD");
  const [activeDrawer, setActiveDrawer] = useState<DrawerType | null>(null);

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

  const loadData = useCallback(async (tok: string) => {
    setLoading(true);
    try {
      const [coachRes, suggestionsRes] = await Promise.all([
        fetch("/api/user/money-coach", { headers: buildHeaders(tok) }),
        fetch("/api/user/ai-ask", { headers: buildHeaders(tok) }),
      ]);
      
      if (coachRes.ok) {
        const data = await coachRes.json();
        setBreakdown(data);
        setCurrency(data.homeCurrency || "USD");
      }
      
      if (suggestionsRes.ok) {
        const data = await suggestionsRes.json();
        setSuggestions(data.suggestions || []);
      }
    } catch (error) {
      console.error("Failed to load dashboard data:", error);
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
          />
        </div>

        {/* Answer */}
        {currentAnswer && (
          <div id="answer-card" className="mb-10">
            <AnswerCard 
              question={currentAnswer.question}
              answer={currentAnswer.answer}
              onClear={clearAnswer}
            />
          </div>
        )}

        {/* Where Money Goes */}
        {breakdown && breakdown.coverage.monthsCovered > 0 ? (
          <WhereMoneyGoes breakdown={breakdown} currency={currency} onOpenDrawer={openDrawer} />
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
      />
    </div>
  );
}
