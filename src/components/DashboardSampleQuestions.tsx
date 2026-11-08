"use client";

import { useState } from "react";

export const SAMPLE_QUESTIONS_CHIPS_CLASS =
  "hidden lg:flex flex-wrap items-center justify-center gap-2";
export const SAMPLE_QUESTIONS_DROPDOWN_CLASS = "lg:hidden";

interface DashboardSampleQuestionsProps {
  suggestions: string[];
  onAsk: (q: string) => void;
  loading?: boolean;
}

/**
 * Dashboard "Try asking" prompts.
 * Desktop (>=1024): the existing chip row, unchanged.
 * Phone: one compact native select with the same options and onAsk submit.
 */
export function DashboardSampleQuestions({
  suggestions,
  onAsk,
  loading = false,
}: DashboardSampleQuestionsProps) {
  const options = suggestions.slice(0, 3);
  const [selectValue, setSelectValue] = useState("");

  const ask = (q: string) => {
    if (!q || loading) return;
    onAsk(q);
  };

  return (
    <>
      <div className={SAMPLE_QUESTIONS_DROPDOWN_CLASS}>
        <label htmlFor="dashboard-sample-question" className="sr-only">
          Try asking
        </label>
        <select
          id="dashboard-sample-question"
          value={selectValue}
          disabled={loading || options.length === 0}
          onChange={(e) => {
            const q = e.target.value;
            setSelectValue("");
            ask(q);
          }}
          aria-label="Try asking a sample question"
          className="w-full min-h-11 rounded-xl border border-purple-200 bg-purple-50 px-3 py-2.5 text-sm font-medium text-purple-700 focus:border-purple-400 focus:outline-none focus:ring-2 focus:ring-purple-200 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <option value="">Try asking…</option>
          {options.map((q) => (
            <option key={q} value={q}>
              {q}
            </option>
          ))}
        </select>
      </div>

      <div className={SAMPLE_QUESTIONS_CHIPS_CLASS}>
        <span className="text-sm text-gray-500">Try asking:</span>
        {options.map((q) => (
          <button
            key={q}
            type="button"
            onClick={() => ask(q)}
            disabled={loading}
            className="rounded-full border border-purple-200 bg-purple-50 px-4 py-2 text-sm font-medium text-purple-700 transition hover:border-purple-300 hover:bg-purple-100 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {q}
          </button>
        ))}
      </div>
    </>
  );
}
