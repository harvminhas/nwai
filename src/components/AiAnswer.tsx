/**
 * Shared AI answer renderer used everywhere AI answers display.
 * 
 * Uses react-markdown + remark-gfm for consistent formatting:
 * - Compact paragraphs and bullets
 * - Bold key figures
 * - Small headings
 * - Simple tables
 * - Amounts with whitespace-nowrap including minus sign
 * - No horizontal overflow
 * 
 * Used in:
 * - Dashboard Ask panel (dashboard/page.tsx)
 * - Chat page (chat/page.tsx)
 * - Saved answers page (saved-answers/page.tsx)
 * - Money coach insights
 * - Insight cards (AgentInsightCards.tsx)
 */

"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface AiAnswerProps {
  content: string;
  className?: string;
}

export function AiAnswer({ content, className = "" }: AiAnswerProps) {
  return (
    <div className={`ai-answer-container ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Compact paragraphs
          p: ({ children }) => (
            <p className="text-sm leading-relaxed mb-2 last:mb-0">{children}</p>
          ),
          // Small headings
          h1: ({ children }) => (
            <h1 className="text-sm font-semibold uppercase tracking-wide text-gray-800 mt-3 first:mt-0 mb-2">
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="text-[13px] font-semibold uppercase tracking-wide text-gray-800 mt-3 first:mt-0 mb-1.5">
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-700 mt-2 first:mt-0 mb-1">
              {children}
            </h3>
          ),
          // Compact bullet lists
          ul: ({ children }) => (
            <ul className="my-1.5 space-y-0.5 pl-4">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="my-1.5 space-y-0.5 pl-4 list-decimal">{children}</ol>
          ),
          li: ({ children }) => (
            <li className="flex items-start gap-1.5 text-sm">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-current opacity-40" />
              <span>{children}</span>
            </li>
          ),
          // Simple tables with no overflow
          table: ({ children }) => (
            <div className="my-2 -mx-1 max-w-full overflow-x-auto rounded-lg border border-gray-100 bg-gray-50/80">
              <table className="w-full min-w-[320px] border-collapse text-left text-xs text-gray-800">
                {children}
              </table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="border-b border-gray-200 bg-gray-100/90">
              {children}
            </thead>
          ),
          tbody: ({ children }) => <tbody>{children}</tbody>,
          tr: ({ children }) => (
            <tr className="border-b border-gray-100 last:border-0 hover:bg-white/80">
              {children}
            </tr>
          ),
          th: ({ children }) => (
            <th className="whitespace-nowrap px-2 py-1.5 font-semibold text-gray-700">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="max-w-[200px] px-2 py-1.5 align-top text-gray-700 sm:max-w-[280px]">
              <span className="break-words">{children}</span>
            </td>
          ),
          // Bold key figures
          strong: ({ children }) => (
            <strong className="font-semibold text-gray-900 whitespace-nowrap">
              {children}
            </strong>
          ),
          // Code inline
          code: ({ children }) => (
            <code className="rounded bg-gray-100 px-1 py-0.5 text-xs font-mono text-gray-800">
              {children}
            </code>
          ),
          // No code blocks
          pre: ({ children }) => <div className="hidden">{children}</div>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
