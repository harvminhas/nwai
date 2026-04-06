"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import type { AgentCard } from "@/lib/agentTypes";
import { fmt } from "@/lib/currencyUtils";

const PRIORITY_DOT: Record<string, string> = {
  high:   "bg-red-400",
  medium: "bg-amber-400",
  low:    "bg-gray-300",
};

/** Category → the most relevant page to send the user to. */
const CATEGORY_HREF: Record<string, string> = {
  subscriptions: "/account/spending",
  cashflow:      "/account/spending",
  debt:          "/account/liabilities",
  savings:       "/account/goals",
  goals:         "/account/goals",
  tax:           "/account/income",
  alert:         "/account/spending",
  external:      "/account/overview",
};

const CATEGORY_LABEL: Record<string, string> = {
  subscriptions: "View spending",
  cashflow:      "View spending",
  debt:          "View liabilities",
  savings:       "View goals",
  goals:         "View goals",
  tax:           "View income",
  alert:         "View spending",
  external:      "View overview",
};

// ── single expandable row ─────────────────────────────────────────────────────

interface RowProps {
  card:      AgentCard;
  token:     string;
  onDismiss: (id: string) => void;
}

function InsightRow({ card, token, onDismiss }: RowProps) {
  const [open, setOpen] = useState(false);

  const href  = CATEGORY_HREF[card.category]  ?? "/account/spending";
  const label = CATEGORY_LABEL[card.category] ?? "View →";

  async function dismiss(e: React.MouseEvent) {
    e.stopPropagation();
    onDismiss(card.id);
    await fetch("/api/user/agent-insights", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "dismiss", cardId: card.id }),
    }).catch(() => {});
  }

  return (
    <div className="border-b border-gray-100 last:border-0">
      {/* collapsed row */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 transition"
      >
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${PRIORITY_DOT[card.priority] ?? "bg-gray-300"}`} />
        <span className="shrink-0 text-base leading-none">{card.emoji}</span>
        <p className="flex-1 min-w-0 truncate text-sm font-medium text-gray-800">{card.title}</p>
        {card.dollarImpact != null && card.dollarImpact !== 0 && (
          <span className="shrink-0 text-xs font-semibold text-gray-500 tabular-nums">
            {fmt(card.dollarImpact)}{card.impactLabel ? ` ${card.impactLabel}` : ""}
          </span>
        )}
        <svg
          className={`h-3.5 w-3.5 shrink-0 text-gray-400 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* expanded detail */}
      {open && (
        <div className="px-4 pb-4 pt-0">
          <div className="rounded-lg bg-gray-50 p-3">
            <p className="text-xs text-gray-600 leading-relaxed">{card.body}</p>
            <div className="mt-3 flex items-center gap-3">
              <Link
                href={href}
                className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:border-purple-300 hover:text-purple-700 transition"
              >
                {label} →
              </Link>
              <button
                onClick={dismiss}
                className="ml-auto text-xs text-gray-400 hover:text-gray-600 transition"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── main component ────────────────────────────────────────────────────────────

interface AgentInsightCardsProps {
  cards: AgentCard[];
  token: string;
}

export default function AgentInsightCards({ cards: initialCards, token }: AgentInsightCardsProps) {
  const [cards, setCards]   = useState<AgentCard[]>(initialCards);
  const [showAll, setShowAll] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await fetch("/api/user/insights/generate", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ event: "full.refresh" }),
      });
    } catch { /* listener will pick up updates */ }
    finally { setRefreshing(false); }
  }, [token]);

  const handleDismiss = useCallback((id: string) => {
    setCards((prev) => prev.filter((c) => c.id !== id));
  }, []);

  if (cards.length === 0) return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
      <div className="flex items-center justify-between border-b border-gray-100 px-4 py-2.5">
        <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Recommendations</p>
      </div>
      <div className="flex flex-col items-center gap-3 px-4 py-8 text-center">
        <p className="text-sm text-gray-500">No insights generated yet.</p>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="inline-flex items-center gap-1.5 rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700 disabled:opacity-50 transition"
        >
          <svg className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`}
            viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          {refreshing ? "Generating…" : "Generate insights"}
        </button>
      </div>
    </div>
  );

  const visible = showAll ? cards : cards.slice(0, 4);
  const hidden  = cards.length - visible.length;

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
      <div className="flex items-center justify-between border-b border-gray-100 px-4 py-2.5">
        <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Recommendations</p>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-500">
            {cards.length}
          </span>
          <button onClick={handleRefresh} disabled={refreshing} title="Refresh insights"
            className="text-gray-400 hover:text-purple-600 transition disabled:opacity-40">
            <svg className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`}
              viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        </div>
      </div>

      {visible.map((card) => (
        <InsightRow key={card.id} card={card} token={token} onDismiss={handleDismiss} />
      ))}

      {hidden > 0 && (
        <button onClick={() => setShowAll(true)}
          className="w-full border-t border-gray-100 px-4 py-2.5 text-center text-xs font-medium text-gray-400 hover:text-purple-600 hover:bg-gray-50 transition">
          Show {hidden} more
        </button>
      )}
    </div>
  );
}
