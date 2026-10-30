"use client";

import { useState, useEffect, useRef } from "react";
import { AiAnswer } from "@/components/AiAnswer";

const SAMPLE_DATA = {
  netWorth: 45234,
  monthChange: 1234,
  fixed: 1800,
  essentials: 650,
  flexible: 420,
  income: 5200,
  question: "Where did my money go last month?",
  answer: `You spent **$2,870** last month across three groups:\n\n**Fixed ($1,800)**: Mortgage, car payment, and insurance — these are your must-pay bills.\n\n**Essentials ($650)**: Groceries, utilities, and gas — necessary but can vary.\n\n**Flexible ($420)**: Dining out, shopping, and entertainment — your discretionary spending.\n\nYou also saved **$2,330** (45% of your income), which is well above the average savings rate.`,
  table: [
    { category: "Fixed", amount: 1800, change: "+2%" },
    { category: "Essentials", amount: 650, change: "-5%" },
    { category: "Flexible", amount: 420, change: "+15%" },
  ],
  alert: "2 subscriptions haven't charged in 60 days",
};

const STEPS = [
  "Reading your statements",
  "Grouping spending",
  "Checking subscriptions",
];

type Stage = "dashboard" | "typing" | "thinking" | "answer";

export function HeroDemo() {
  const [stage, setStage] = useState<Stage>("dashboard");
  const [typedText, setTypedText] = useState("");
  const [currentStep, setCurrentStep] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const [barWidths, setBarWidths] = useState({ fixed: 0, essentials: 0, flexible: 0 });
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Check for prefers-reduced-motion
  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    setPrefersReducedMotion(mediaQuery.matches);
    
    const handleChange = (e: MediaQueryListEvent) => {
      setPrefersReducedMotion(e.matches);
    };
    
    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, []);

  // Animation sequence
  useEffect(() => {
    if (prefersReducedMotion) {
      // Show final state immediately
      setStage("answer");
      setTypedText(SAMPLE_DATA.question);
      setCurrentStep(STEPS.length);
      setShowAnswer(true);
      setBarWidths({
        fixed: (SAMPLE_DATA.fixed / SAMPLE_DATA.income) * 100,
        essentials: (SAMPLE_DATA.essentials / SAMPLE_DATA.income) * 100,
        flexible: (SAMPLE_DATA.flexible / SAMPLE_DATA.income) * 100,
      });
      return;
    }

    const runSequence = async () => {
      // Stage 1: Dashboard fades in
      setStage("dashboard");
      await delay(500);
      
      // Animate bar widths
      animateBarWidths();
      await delay(1500);
      
      // Stage 2: Type question
      setStage("typing");
      await typeText(SAMPLE_DATA.question);
      await delay(500);
      
      // Stage 3: Thinking steps
      setStage("thinking");
      for (let i = 0; i < STEPS.length; i++) {
        setCurrentStep(i);
        await delay(600);
      }
      setCurrentStep(STEPS.length);
      await delay(400);
      
      // Stage 4: Show answer
      setStage("answer");
      setShowAnswer(true);
    };

    runSequence();

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [prefersReducedMotion]);

  const delay = (ms: number) => new Promise(resolve => {
    timerRef.current = setTimeout(resolve, ms);
  });

  const typeText = async (text: string) => {
    for (let i = 0; i <= text.length; i++) {
      setTypedText(text.slice(0, i));
      await delay(30);
    }
  };

  const animateBarWidths = () => {
    const targetWidths = {
      fixed: (SAMPLE_DATA.fixed / SAMPLE_DATA.income) * 100,
      essentials: (SAMPLE_DATA.essentials / SAMPLE_DATA.income) * 100,
      flexible: (SAMPLE_DATA.flexible / SAMPLE_DATA.income) * 100,
    };

    let progress = 0;
    const animate = () => {
      progress += 0.05;
      if (progress <= 1) {
        setBarWidths({
          fixed: targetWidths.fixed * progress,
          essentials: targetWidths.essentials * progress,
          flexible: targetWidths.flexible * progress,
        });
        requestAnimationFrame(animate);
      } else {
        setBarWidths(targetWidths);
      }
    };
    requestAnimationFrame(animate);
  };

  const replay = () => {
    setStage("dashboard");
    setTypedText("");
    setCurrentStep(0);
    setShowAnswer(false);
    setBarWidths({ fixed: 0, essentials: 0, flexible: 0 });
  };

  return (
    <div className="relative w-full max-w-2xl mx-auto">
      {/* Label */}
      <div className="mb-3 text-center">
        <span className="inline-block rounded-full bg-purple-100 text-purple-700 px-3 py-1 text-xs font-semibold">
          Sample data: a fictional household
        </span>
      </div>

      {/* Demo container */}
      <div className="rounded-xl shadow-2xl border border-gray-200 overflow-hidden bg-white">
        {/* Browser chrome */}
        <div className="bg-gray-100 px-4 py-3 flex items-center gap-2 border-b border-gray-200">
          <div className="flex gap-1.5">
            <div className="w-3 h-3 rounded-full bg-red-400" />
            <div className="w-3 h-3 rounded-full bg-yellow-400" />
            <div className="w-3 h-3 rounded-full bg-green-400" />
          </div>
          <div className="flex-1 bg-white rounded-md text-xs text-gray-400 px-4 py-1.5 text-center max-w-xs ml-2">
            networth.online
          </div>
        </div>

        {/* Content */}
        <div className="p-6 md:p-8 bg-gray-50 min-h-[400px] flex flex-col">
          {/* Dashboard card */}
          <div
            className={`transition-opacity duration-500 ${
              stage === "dashboard" || stage === "typing" || stage === "thinking" || stage === "answer"
                ? "opacity-100"
                : "opacity-0"
            }`}
          >
            <div className="bg-white rounded-lg p-6 border border-gray-100 mb-4">
              <div className="text-sm text-gray-500 uppercase tracking-wide font-medium">Net Worth</div>
              <div className="text-4xl font-bold text-gray-900 mt-2">
                ${SAMPLE_DATA.netWorth.toLocaleString()}
              </div>
              <div className="flex gap-3 mt-4">
                <span className="bg-green-50 text-green-700 text-sm font-semibold px-3 py-1 rounded-full">
                  ↑ ${SAMPLE_DATA.monthChange.toLocaleString()} this month
                </span>
              </div>
            </div>

            {/* Spending bar */}
            <div className="bg-white rounded-lg p-6 border border-gray-100 mb-4">
              <div className="text-sm font-semibold text-gray-900 mb-4">This Month</div>
              <div className="flex items-center gap-3">
                <div className="w-20 text-xs font-medium text-gray-600">Spending</div>
                <div className="flex-1 h-10 flex gap-1">
                  <div
                    className="rounded-l-lg bg-purple-600 flex items-center justify-center px-2 text-xs font-semibold text-white transition-all duration-1000"
                    style={{ width: `${barWidths.fixed}%` }}
                  >
                    {barWidths.fixed > 15 && "Fixed"}
                  </div>
                  <div
                    className="bg-blue-500 flex items-center justify-center px-2 text-xs font-semibold text-white transition-all duration-1000"
                    style={{ width: `${barWidths.essentials}%` }}
                  >
                    {barWidths.essentials > 8 && "Ess."}
                  </div>
                  <div
                    className="rounded-r-lg bg-green-500 flex items-center justify-center px-2 text-xs font-semibold text-white transition-all duration-1000"
                    style={{ width: `${barWidths.flexible}%` }}
                  >
                    {barWidths.flexible > 6 && "Flex"}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Ask box */}
          {(stage === "typing" || stage === "thinking" || stage === "answer") && (
            <div className="mb-4">
              <div className="relative">
                <input
                  type="text"
                  value={typedText}
                  readOnly
                  className="w-full rounded-xl border-2 border-purple-300 px-4 py-3 text-sm bg-white"
                  placeholder="Ask about your spending..."
                />
                {stage === "typing" && (
                  <div className="absolute right-3 top-1/2 -translate-y-1/2">
                    <div className="w-1 h-4 bg-purple-600 animate-pulse" />
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Thinking steps */}
          {(stage === "thinking" || stage === "answer") && (
            <div className="bg-white rounded-lg p-4 border border-gray-100 mb-4">
              <div className="space-y-2">
                {STEPS.map((step, idx) => (
                  <div key={step} className="flex items-center gap-3">
                    {idx < currentStep ? (
                      <svg
                        className="h-5 w-5 text-green-500 shrink-0"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2.5}
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    ) : idx === currentStep ? (
                      <div className="h-5 w-5 shrink-0 flex items-center justify-center">
                        <div className="w-3 h-3 border-2 border-purple-600 border-t-transparent rounded-full animate-spin" />
                      </div>
                    ) : (
                      <div className="h-5 w-5 shrink-0 rounded-full border-2 border-gray-300" />
                    )}
                    <span className={`text-sm ${idx <= currentStep ? "text-gray-900 font-medium" : "text-gray-400"}`}>
                      {step}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Answer */}
          {showAnswer && (
            <div className="bg-white rounded-lg p-6 border border-purple-200 animate-fade-in">
              <div className="text-sm text-gray-700 leading-relaxed mb-4">
                <AiAnswer content={SAMPLE_DATA.answer} />
              </div>

              {/* Table */}
              <div className="mb-4 overflow-hidden rounded-lg border border-gray-200">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-2 text-left font-semibold text-gray-900">Category</th>
                      <th className="px-4 py-2 text-right font-semibold text-gray-900">Amount</th>
                      <th className="px-4 py-2 text-right font-semibold text-gray-900">Change</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {SAMPLE_DATA.table.map((row) => (
                      <tr key={row.category}>
                        <td className="px-4 py-2 text-gray-900">{row.category}</td>
                        <td className="px-4 py-2 text-right text-gray-900">${row.amount.toLocaleString()}</td>
                        <td
                          className={`px-4 py-2 text-right font-medium ${
                            row.change.startsWith("+") ? "text-red-600" : "text-green-600"
                          }`}
                        >
                          {row.change}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Alert */}
              <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 flex items-start gap-2">
                <svg
                  className="h-5 w-5 text-amber-600 shrink-0 mt-0.5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                  />
                </svg>
                <span className="text-sm text-amber-900 font-medium">{SAMPLE_DATA.alert}</span>
              </div>

              {/* Replay link */}
              {!prefersReducedMotion && (
                <div className="mt-4 text-center">
                  <button
                    onClick={replay}
                    className="text-sm font-medium text-purple-600 hover:text-purple-700 transition inline-flex items-center gap-1"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                      />
                    </svg>
                    Replay
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <style jsx>{`
        @keyframes fade-in {
          from {
            opacity: 0;
            transform: translateY(10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        .animate-fade-in {
          animation: fade-in 0.5s ease-out;
        }
      `}</style>
    </div>
  );
}
