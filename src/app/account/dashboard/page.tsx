"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseClient } from "@/lib/firebase";
import type { DashboardAlert, UpcomingItem, TodayInsight } from "@/app/api/user/insights/route";
import type { AgentCard } from "@/lib/agentTypes";
import ParseStatusBanner from "@/components/ParseStatusBanner";

// ── helpers ───────────────────────────────────────────────────────────────────

function fmt(v: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD",
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(v);
}

function todayLabel(): string {
  return new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}

// ── alert styles ──────────────────────────────────────────────────────────────

const ALERT_STYLE: Record<string, { border: string; bg: string; text: string; icon: React.ReactNode }> = {
  high: {
    border: "border-red-200", bg: "bg-red-50", text: "text-red-700",
    icon: (
      <svg className="h-4 w-4 shrink-0 text-red-500 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
      </svg>
    ),
  },
  medium: {
    border: "border-amber-200", bg: "bg-amber-50", text: "text-amber-700",
    icon: (
      <svg className="h-4 w-4 shrink-0 text-amber-500 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
};

// ── upcoming item icons ───────────────────────────────────────────────────────

const TYPE_ICON: Record<string, React.ReactNode> = {
  "cash-out": (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-100">
      <svg className="h-4 w-4 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
      </svg>
    </span>
  ),
  "cash-in": (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-green-100">
      <svg className="h-4 w-4 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    </span>
  ),
  "subscription": (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-purple-100">
      <svg className="h-4 w-4 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
      </svg>
    </span>
  ),
  "debt": (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-red-100">
      <svg className="h-4 w-4 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z" />
      </svg>
    </span>
  ),
};

function getDateLabel(item: UpcomingItem): { text: string; cls: string } {
  if (item.isThisMonth) {
    if (item.predictedDate) {
      const d = new Date(item.predictedDate + "T00:00:00");
      return {
        text: "~" + d.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
        cls: "text-gray-400",
      };
    }
    return { text: "this month", cls: "text-gray-400" };
  }
  const { daysFromNow, date } = item;
  if (daysFromNow < 0)   return { text: `${Math.abs(daysFromNow)}d overdue`, cls: "text-red-500 font-semibold" };
  if (daysFromNow === 0) return { text: "Today",     cls: "text-amber-600 font-semibold" };
  if (daysFromNow === 1) return { text: "Tomorrow",  cls: "text-amber-500 font-semibold" };
  if (daysFromNow <= 7)  return { text: `In ${daysFromNow}d`, cls: "text-gray-600 font-medium" };
  const d = new Date(date + "T00:00:00");
  return { text: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }), cls: "text-gray-400" };
}

// ── sub-components ────────────────────────────────────────────────────────────

interface RatePill {
  label: string;  // e.g. "Prime 4.45%"
  direction: "up" | "down" | "unchanged";
}

function UpcomingRow({ item, muted = false, ratePill }: { item: UpcomingItem; muted?: boolean; ratePill?: RatePill }) {
  const { text, cls } = getDateLabel(item);
  const pillColor = ratePill?.direction === "up"
    ? "bg-red-50 text-red-600 border-red-100"
    : ratePill?.direction === "down"
    ? "bg-green-50 text-green-600 border-green-100"
    : "bg-amber-50 text-amber-600 border-amber-100";

  const row = (
    <div className={`flex items-center gap-3 px-4 py-3.5 ${item.isOverdue ? "bg-red-50/60" : ""} ${muted ? "opacity-40" : ""}`}>
      {TYPE_ICON[item.type] ?? TYPE_ICON["cash-out"]}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <p className={`text-sm font-medium ${muted ? "text-gray-400" : "text-gray-800"}`}>{item.title}</p>
          {ratePill && (
            <span className={`inline-flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold leading-none ${pillColor}`}>
              {ratePill.direction === "up" ? "↑" : ratePill.direction === "down" ? "↓" : "→"} {ratePill.label}
            </span>
          )}
        </div>
        {item.subtitle && <p className="text-xs text-gray-400 mt-0.5">{item.subtitle}</p>}
      </div>
      <div className="shrink-0 text-right">
        <p className={`text-sm font-semibold ${item.type === "cash-in" ? "text-green-600" : muted ? "text-gray-400" : "text-gray-800"}`}>
          {item.type === "cash-in" ? "+" : "−"}{fmt(item.amount)}
        </p>
        <p className={`text-xs mt-0.5 ${muted ? "text-gray-300" : cls}`}>{text}</p>
      </div>
      {item.href && (
        <svg className="h-4 w-4 shrink-0 text-gray-300 ml-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      )}
    </div>
  );
  return item.href
    ? <Link key={item.id} href={item.href} className="block hover:bg-gray-50 transition">{row}</Link>
    : <div key={item.id}>{row}</div>;
}

function UpcomingGroup({ title, items, emptySlot, ratePill }: { title: string; items: UpcomingItem[]; emptySlot?: React.ReactNode; ratePill?: RatePill }) {
  if (items.length === 0 && !emptySlot) return null;
  return (
    <div>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">{title}</p>
      {items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-5 py-4 text-center text-xs text-gray-400">
          {emptySlot}
        </div>
      ) : (
        <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden divide-y divide-gray-100">
          {items.map((item) => (
            <UpcomingRow key={item.id} item={item} ratePill={item.type === "debt" ? ratePill : undefined} />
          ))}
        </div>
      )}
    </div>
  );
}

function ThisMonthGroup({ items, ratePill }: { items: UpcomingItem[]; ratePill?: RatePill }) {
  const [showPast, setShowPast] = useState(false);
  if (items.length === 0) return null;

  const todayStr = new Date().toISOString().slice(0, 10);
  const upcoming = items.filter((i) => !i.predictedDate || i.predictedDate >= todayStr);
  const past     = items.filter((i) =>  i.predictedDate &&  i.predictedDate <  todayStr);

  return (
    <div>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">Also this month</p>
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden divide-y divide-gray-100">
        {upcoming.length > 0
          ? upcoming.map((item) => (
              <UpcomingRow key={item.id} item={item} ratePill={item.type === "debt" ? ratePill : undefined} />
            ))
          : (
            <p className="px-4 py-3 text-xs text-gray-400">Nothing left scheduled this month.</p>
          )
        }

        {past.length > 0 && (
          <>
            <button
              onClick={() => setShowPast((v) => !v)}
              className="flex w-full items-center justify-between px-4 py-2.5 text-xs font-medium text-gray-400 hover:bg-gray-50 transition"
            >
              <span>{showPast ? "Hide" : `${past.length} already occurred this month`}</span>
              <svg
                className={`h-3.5 w-3.5 transition-transform ${showPast ? "rotate-180" : ""}`}
                fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {showPast && (
              <div className="divide-y divide-gray-100">
                {past.map((item) => <UpcomingRow key={item.id} item={item} muted />)}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── page ──────────────────────────────────────────────────────────────────────

const INSIGHT_TONE: Record<string, { bg: string; border: string; text: string; sub: string }> = {
  positive: { bg: "bg-green-50",  border: "border-green-100", text: "text-green-800",  sub: "text-green-600" },
  caution:  { bg: "bg-amber-50",  border: "border-amber-100", text: "text-amber-800",  sub: "text-amber-600" },
  neutral:  { bg: "bg-gray-50",   border: "border-gray-100",  text: "text-gray-700",   sub: "text-gray-500"  },
};

export default function TodayPage() {
  const router = useRouter();
  const [alerts,      setAlerts]      = useState<DashboardAlert[]>([]);
  const [upcoming,    setUpcoming]    = useState<UpcomingItem[]>([]);
  const [insights,    setInsights]    = useState<TodayInsight[]>([]);
  const [agentCards,  setAgentCards]  = useState<AgentCard[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState<string | null>(null);
  const [token,       setToken]       = useState<string | null>(null);
  const [refreshing,  setRefreshing]  = useState(false);
  const [expandedInsights, setExpandedInsights] = useState<Set<string>>(new Set());
  const [expandedAlerts,   setExpandedAlerts]   = useState<Set<string>>(new Set());

  function toggleInsight(id: string) {
    setExpandedInsights((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }
  function toggleAlert(id: string) {
    setExpandedAlerts((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  const load = useCallback(async (tok: string) => {
    setLoading(true); setError(null);
    try {
      const headers = { Authorization: `Bearer ${tok}` };
      const [insRes, cardRes] = await Promise.all([
        fetch("/api/user/insights",       { headers }),
        fetch("/api/user/agent-insights", { headers }),
      ]);
      const insJson  = await insRes.json().catch(() => ({}));
      const cardJson = await cardRes.json().catch(() => ({}));
      if (!insRes.ok) { setError(insJson.error || "Failed to load"); return; }
      setAlerts(insJson.alerts ?? []);
      setUpcoming(insJson.upcoming ?? []);
      setInsights(insJson.insights ?? []);
      // Sort: high first, then medium, then low; external cards come after AI cards at same priority
      const sorted = (cardJson.cards ?? [] as AgentCard[]).sort((a: AgentCard, b: AgentCard) => {
        const pri = { high: 0, medium: 1, low: 2 };
        const pd = (pri[a.priority] ?? 2) - (pri[b.priority] ?? 2);
        if (pd !== 0) return pd;
        return (a.source === "external" ? 1 : 0) - (b.source === "external" ? 1 : 0);
      });
      setAgentCards(sorted);
    } catch { setError("Failed to load today view"); }
    finally { setLoading(false); }
  }, []);

  const handleRefresh = useCallback(async () => {
    if (!token) return;
    setRefreshing(true);
    try {
      await fetch("/api/user/insights/generate", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ event: "full.refresh" }),
      });
      await load(token);
    } catch { /* silent */ }
    finally { setRefreshing(false); }
  }, [token, load]);

  useEffect(() => {
    const { auth } = getFirebaseClient();
    return onAuthStateChanged(auth, async (user) => {
      if (!user) { router.push("/login"); return; }
      const tok = await user.getIdToken();
      setToken(tok);
      load(tok);
    });
  }, [router, load]);

  if (loading) return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <div className="h-10 w-10 animate-spin rounded-full border-4 border-purple-600 border-t-transparent" />
    </div>
  );

  // Segment upcoming items
  const overdue    = upcoming.filter((i) => !i.isThisMonth && i.daysFromNow < 0);
  const todayItems = upcoming.filter((i) => !i.isThisMonth && i.daysFromNow === 0);
  const thisWeek   = upcoming.filter((i) => !i.isThisMonth && i.daysFromNow > 0 && i.daysFromNow <= 7);
  const later      = upcoming.filter((i) => !i.isThisMonth && i.daysFromNow > 7);
  const thisMonth  = upcoming.filter((i) => i.isThisMonth);

  const urgentAlerts = alerts.filter((a) => a.severity === "high" || a.severity === "medium");
  const hasContent   = upcoming.length > 0 || urgentAlerts.length > 0 || insights.length > 0;

  // Derive a rate pill from the prime-rate agent card (if one exists)
  const primeCard = agentCards.find((c) => c.dataType === "canada-prime-rate" || c.dataType === "canada-overnight-rate");
  const ratePill: RatePill | undefined = primeCard
    ? {
        label: (() => {
          // Extract e.g. "4.45%" from title like "Canadian Prime Rate cut to 4.45%"
          const match = primeCard.title.match(/(\d+\.\d+%)/);
          const rate  = match ? match[1] : "";
          return `Prime ${rate}`.trim();
        })(),
        direction: primeCard.title.toLowerCase().includes("raised") || primeCard.title.toLowerCase().includes("up")
          ? "up"
          : primeCard.title.toLowerCase().includes("cut") || primeCard.title.toLowerCase().includes("down")
          ? "down"
          : "unchanged",
      }
    : undefined;

  // Helper: badge style per card source/priority
  function cardBadgeStyle(card: AgentCard) {
    if (card.source === "external") return "bg-blue-50 text-blue-600 border-blue-100";
    if (card.priority === "high")   return "bg-red-50 text-red-600 border-red-100";
    return "bg-purple-50 text-purple-600 border-purple-100";
  }
  function cardBadgeLabel(card: AgentCard) {
    return card.source === "external" ? "Market Signal" : "AI Insight";
  }

  async function dismissCard(id: string) {
    setAgentCards((prev) => prev.filter((c) => c.id !== id));
    if (!token) return;
    await fetch("/api/user/agent-insights", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "dismiss", cardId: id }),
    }).catch(() => {});
  }

  // ── Sidebar signal card ──────────────────────────────────────────────────────
  function SidebarSignalCard({ card }: { card: AgentCard }) {
    const [expanded, setExpanded] = useState(false);
    return (
      <div className="rounded-xl border border-gray-200 bg-white overflow-hidden shadow-sm">
        <div className="px-3.5 pt-3 pb-0 flex items-start justify-between gap-2">
          <span className={`inline-flex shrink-0 items-center rounded-full border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ${cardBadgeStyle(card)}`}>
            {cardBadgeLabel(card)}
          </span>
          <button
            onClick={() => dismissCard(card.id)}
            className="shrink-0 text-gray-300 hover:text-gray-500 transition -mt-0.5"
            title="Dismiss"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="px-3.5 pt-2 pb-3">
          <p className="text-[13px] font-semibold text-gray-900 leading-snug">{card.title}</p>
          <p className={`mt-1 text-[11px] text-gray-500 leading-relaxed ${expanded ? "" : "line-clamp-2"}`}>
            {card.body}
          </p>
          <div className="mt-2 flex items-center gap-3">
            {card.body.length > 120 && (
              <button
                onClick={() => setExpanded((v) => !v)}
                className="text-[11px] font-medium text-gray-400 hover:text-gray-600 transition"
              >
                {expanded ? "Less" : "More"}
              </button>
            )}
            {card.href && (
              <Link
                href={card.href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] font-semibold text-blue-600 hover:underline"
              >
                {card.source === "external" ? "Source ↗" : "View →"}
              </Link>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── Premium stub (used in sidebar) ──────────────────────────────────────────
  function MarketContextStub() {
    return (
      <div className="rounded-xl border border-gray-200 bg-gray-50 overflow-hidden">
        <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-gray-200">
          <div className="flex items-center gap-1.5">
            <svg className="h-3 w-3 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
            <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Market Context</p>
          </div>
          <span className="rounded-full bg-gray-200 px-1.5 py-0.5 text-[9px] font-bold text-gray-500 uppercase tracking-wider">
            Premium
          </span>
        </div>
        <div className="px-3.5 py-3 space-y-2 select-none">
          {["BoC rate history", "CPI inflation trend", "Rate impact on debt"].map((item) => (
            <div key={item} className="flex items-center gap-2 opacity-40">
              <div className="h-5 w-5 rounded bg-gray-200 shrink-0" />
              <div className="flex-1 space-y-1">
                <div className="h-2 rounded bg-gray-200 w-3/4" />
                <div className="h-1.5 rounded bg-gray-200 w-1/2" />
              </div>
            </div>
          ))}
          <p className="pt-0.5 text-center text-[10px] text-gray-400">Unlock with Market Context</p>
        </div>
      </div>
    );
  }

  return (
    // Wider outer container to accommodate sidebar
    <div className="mx-auto max-w-5xl px-4 pt-4 pb-8 sm:py-8 sm:px-6">

      {/* ── Pending parse banner ─────────────────────────────────────────────── */}
      {token && <ParseStatusBanner onRefresh={() => load(token)} />}

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Today</h1>
          <p className="mt-0.5 text-sm text-gray-400">{todayLabel()}</p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          title="Refresh insights"
          className="mt-1 flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-500 shadow-sm hover:border-purple-300 hover:text-purple-600 disabled:opacity-40 transition"
        >
          <svg className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`}
            viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      {/* ── Mobile signal strip (hidden on lg+) ──────────────────────────────── */}
      {agentCards.length > 0 && (
        <div className="mb-5 lg:hidden">
          <div className="flex gap-3 overflow-x-auto pb-1 -mx-4 px-4 snap-x snap-mandatory scrollbar-none">
            {agentCards.map((card) => (
              <div key={card.id}
                className="snap-start shrink-0 w-72 rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
                <div className="px-3.5 pt-3 pb-0 flex items-start justify-between gap-2">
                  <span className={`inline-flex shrink-0 items-center rounded-full border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ${cardBadgeStyle(card)}`}>
                    {cardBadgeLabel(card)}
                  </span>
                  <button onClick={() => dismissCard(card.id)} className="text-gray-300 hover:text-gray-500 transition -mt-0.5">
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                <div className="px-3.5 pt-2 pb-3">
                  <p className="text-[13px] font-semibold text-gray-900 leading-snug line-clamp-1">{card.title}</p>
                  <p className="mt-1 text-[11px] text-gray-500 leading-relaxed line-clamp-2">{card.body}</p>
                  {card.href && (
                    <Link href={card.href} target="_blank" rel="noopener noreferrer"
                      className="mt-1.5 inline-block text-[11px] font-semibold text-blue-600 hover:underline">
                      {card.source === "external" ? "Source ↗" : "View →"}
                    </Link>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Two-column layout (desktop) ──────────────────────────────────────── */}
      <div className="flex gap-6 items-start">

        {/* ── Main column ──────────────────────────────────────────────────── */}
        <div className="min-w-0 flex-1">

          {/* Alerts */}
          {urgentAlerts.length > 0 && (
            <div className="mb-6 space-y-2">
              {urgentAlerts.map((a) => {
                const sty  = ALERT_STYLE[a.severity] ?? ALERT_STYLE.medium;
                const open = expandedAlerts.has(a.id);
                return (
                  <button key={a.id} onClick={() => toggleAlert(a.id)}
                    className={`w-full text-left flex items-center gap-3 rounded-xl border ${sty.border} ${sty.bg} px-4 py-3 transition`}
                  >
                    {sty.icon}
                    <div className="min-w-0 flex-1">
                      <p className={`text-sm font-semibold ${sty.text}`}>{a.title}</p>
                      {open && <p className={`mt-0.5 text-xs ${sty.text} opacity-80`}>{a.body}</p>}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {open && a.href && (
                        <Link href={a.href} onClick={(e) => e.stopPropagation()}
                          className={`text-xs font-semibold ${sty.text} underline opacity-70 hover:opacity-100`}>
                          View →
                        </Link>
                      )}
                      <svg className={`h-3.5 w-3.5 transition-transform ${sty.text} opacity-50 ${open ? "rotate-180" : ""}`}
                        fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {/* Quick-stat insights */}
          {insights.length > 0 && (
            <div className="mb-6">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">Your finances right now</p>
              <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden divide-y divide-gray-100">
                {insights.map((ins) => {
                  const sty  = INSIGHT_TONE[ins.tone] ?? INSIGHT_TONE.neutral;
                  const open = expandedInsights.has(ins.id);
                  return (
                    <button key={ins.id} onClick={() => toggleInsight(ins.id)}
                      className="w-full text-left flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition">
                      <span className="text-lg leading-none shrink-0">{ins.emoji}</span>
                      <div className="min-w-0 flex-1">
                        <p className={`text-sm font-semibold ${sty.text}`}>{ins.title}</p>
                        {open && <p className={`mt-0.5 text-xs ${sty.sub}`}>{ins.subtitle}</p>}
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {open && ins.href && (
                          <Link href={ins.href} onClick={(e) => e.stopPropagation()}
                            className="text-xs font-semibold text-purple-600 hover:underline">
                            View →
                          </Link>
                        )}
                        <svg className={`h-3.5 w-3.5 text-gray-300 transition-transform ${open ? "rotate-180" : ""}`}
                          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                        </svg>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Upcoming schedule */}
          {hasContent ? (
            <div className="space-y-6">
              <UpcomingGroup title="Overdue"   items={overdue}    ratePill={ratePill} />
              <UpcomingGroup title="Today"     items={todayItems} ratePill={ratePill} />
              <UpcomingGroup title="This week" items={thisWeek}   ratePill={ratePill} />
              <UpcomingGroup title="Coming up" items={later}      ratePill={ratePill} />
              <ThisMonthGroup items={thisMonth} ratePill={ratePill} />
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-5 py-12 text-center">
              <svg className="mx-auto mb-2 h-8 w-8 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-sm font-medium text-gray-600">All clear</p>
              <p className="mt-1 text-xs text-gray-400">Nothing urgent or upcoming right now.</p>
              <Link href="/upload" className="mt-3 inline-block text-xs font-medium text-purple-600 hover:underline">
                Upload a statement →
              </Link>
            </div>
          )}

          {/* Footer */}
          {hasContent && (
            <div className="mt-8 border-t border-gray-100 pt-5 text-center">
              <Link href="/account/overview" className="text-sm font-medium text-purple-600 hover:underline">
                See your full financial overview →
              </Link>
            </div>
          )}
        </div>

        {/* ── Sidebar (desktop only) ───────────────────────────────────────── */}
        <div className="hidden lg:block w-72 shrink-0">
          <div className="sticky top-6 space-y-3">

            {/* Section header */}
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Signals</p>
              {agentCards.length > 0 && (
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-500">
                  {agentCards.length}
                </span>
              )}
            </div>

            {/* Signal cards — stacked */}
            {agentCards.length > 0
              ? agentCards.map((card) => <SidebarSignalCard key={card.id} card={card} />)
              : (
                <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-4 py-6 text-center">
                  <p className="text-xs text-gray-400">No active signals</p>
                </div>
              )
            }

            {/* Premium stub */}
            <MarketContextStub />

          </div>
        </div>

      </div>
    </div>
  );
}
