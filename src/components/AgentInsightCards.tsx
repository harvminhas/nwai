"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import type { AgentCard, AgentCardAction } from "@/lib/agentTypes";

function fmt(v: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD",
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(v);
}

const PRIORITY_DOT: Record<string, string> = {
  high:   "bg-red-400",
  medium: "bg-amber-400",
  low:    "bg-gray-300",
};

// ── single expandable row ─────────────────────────────────────────────────────

interface RowProps {
  card: AgentCard;
  token: string;
  onDismiss: (id: string) => void;
  onComplete: (id: string) => void;
}

function InsightRow({ card, token, onDismiss, onComplete }: RowProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [acting, setActing] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<AgentCardAction | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function executeAction(action: AgentCardAction) {
    if (action.tool === "navigate" || action.tool === "run_scenario") {
      router.push((action.params.href as string) ?? "/account/spending");
      return;
    }
    if (action.requiresApproval && !confirming) {
      setPendingAction(action);
      setConfirming(true);
      return;
    }
    setActing(action.id);
    setConfirming(false);
    setPendingAction(null);
    try {
      const res = await fetch("/api/user/agent-actions", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ tool: action.tool, params: action.params, insightId: card.id }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok) {
        setResult(json.resultMessage ?? "Done!");
        setTimeout(() => onComplete(card.id), 1500);
      } else {
        setResult(json.error ?? "Something went wrong.");
      }
    } catch {
      setResult("Request failed. Please try again.");
    } finally {
      setActing(null);
    }
  }

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
      {/* ── collapsed row ── */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 transition"
      >
        {/* priority dot */}
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${PRIORITY_DOT[card.priority]}`} />

        {/* emoji + title */}
        <span className="shrink-0 text-base leading-none">{card.emoji}</span>
        <p className="flex-1 min-w-0 truncate text-sm font-medium text-gray-800">{card.title}</p>

        {/* dollar impact */}
        {card.dollarImpact !== null && (
          <span className="shrink-0 text-xs font-semibold text-gray-500 tabular-nums">
            {fmt(card.dollarImpact)}{card.impactLabel ? ` ${card.impactLabel}` : ""}
          </span>
        )}

        {/* chevron */}
        <svg
          className={`h-3.5 w-3.5 shrink-0 text-gray-400 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* ── expanded detail ── */}
      {open && (
        <div className="px-4 pb-4 pt-0">
          <div className="rounded-lg bg-gray-50 p-3">
            <p className="text-xs text-gray-600 leading-relaxed">{card.body}</p>

            {/* confirmation prompt */}
            {confirming && pendingAction && (
              <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
                <p className="text-xs font-medium text-amber-800 mb-2">
                  Confirm: {pendingAction.label}?
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => executeAction(pendingAction)}
                    className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700 transition"
                  >
                    Confirm
                  </button>
                  <button
                    onClick={() => { setConfirming(false); setPendingAction(null); }}
                    className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 transition"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* result */}
            {result && (
              <p className="mt-2 text-xs font-medium text-green-700">✓ {result}</p>
            )}

            {/* action buttons + dismiss */}
            {!confirming && !result && (
              <div className="mt-3 flex items-center gap-2 flex-wrap">
                {card.actions.map((action) => (
                  <button
                    key={action.id}
                    onClick={() => executeAction(action)}
                    disabled={acting === action.id}
                    className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition disabled:opacity-50 ${
                      action.requiresApproval
                        ? "bg-gray-900 text-white hover:bg-gray-700"
                        : "border border-gray-200 bg-white text-gray-700 hover:border-purple-300 hover:text-purple-700"
                    }`}
                  >
                    {acting === action.id ? "Working…" : action.label}
                  </button>
                ))}
                <button
                  onClick={dismiss}
                  className="ml-auto text-xs text-gray-400 hover:text-gray-600 transition"
                >
                  Dismiss
                </button>
              </div>
            )}
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
  const [cards, setCards] = useState<AgentCard[]>(initialCards);
  const [showAll, setShowAll] = useState(false);

  const handleDismiss = useCallback((id: string) => {
    setCards((prev) => prev.filter((c) => c.id !== id));
  }, []);
  const handleComplete = useCallback((id: string) => {
    setCards((prev) => prev.filter((c) => c.id !== id));
  }, []);

  if (cards.length === 0) return null;

  const visible = showAll ? cards : cards.slice(0, 4);
  const hidden  = cards.length - visible.length;

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
      {/* header */}
      <div className="flex items-center justify-between border-b border-gray-100 px-4 py-2.5">
        <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">
          Recommendations
        </p>
        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-500">
          {cards.length}
        </span>
      </div>

      {/* rows */}
      {visible.map((card) => (
        <InsightRow
          key={card.id}
          card={card}
          token={token}
          onDismiss={handleDismiss}
          onComplete={handleComplete}
        />
      ))}

      {/* show more */}
      {hidden > 0 && (
        <button
          onClick={() => setShowAll(true)}
          className="w-full border-t border-gray-100 px-4 py-2.5 text-center text-xs font-medium text-gray-400 hover:text-purple-600 hover:bg-gray-50 transition"
        >
          Show {hidden} more
        </button>
      )}
    </div>
  );
}
