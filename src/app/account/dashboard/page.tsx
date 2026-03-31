"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseClient } from "@/lib/firebase";
import type { DashboardAlert, UpcomingItem, TodayInsight } from "@/app/api/user/insights/route";
import type { AgentCard } from "@/lib/agentTypes";
import type { RadarItem, FreshnessData, NetWorthSnapshot } from "@/lib/today/types";
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
  const [radar,       setRadar]       = useState<RadarItem[]>([]);
  const [freshness,   setFreshness]   = useState<FreshnessData | null>(null);
  const [netWorth,    setNetWorth]    = useState<NetWorthSnapshot | null>(null);
  const [statusBanner,setStatusBanner]= useState<{ type: string; text: string; detail: string } | null>(null);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState<string | null>(null);
  const [token,       setToken]       = useState<string | null>(null);
  const [refreshing,  setRefreshing]  = useState(false);
  const [expandedAlerts,   setExpandedAlerts]   = useState<Set<string>>(new Set());
  const [expandedRadar,    setExpandedRadar]    = useState<Set<string>>(new Set());
  const [dismissedRadar,   setDismissedRadar]   = useState<Set<string>>(new Set());
  const [statusOpen,       setStatusOpen]       = useState(false);

  function toggleAlert(id: string) {
    setExpandedAlerts((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function toggleRadar(id: string) {
    setExpandedRadar((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function dismissRadar(id: string) {
    setDismissedRadar((prev) => new Set([...prev, id]));
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
      setRadar(insJson.radar ?? []);
      setFreshness(insJson.freshness ?? null);
      setNetWorth(insJson.netWorth ?? null);
      setStatusBanner(insJson.statusBanner ?? null);
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
  const thisMonth  = upcoming.filter((i) => i.isThisMonth);
  const dateItems  = upcoming.filter((i) => !i.isThisMonth && i.daysFromNow >= 0);

  // Visible (non-dismissed) radar items
  const visibleRadar = radar.filter((r) => !dismissedRadar.has(r.id));

  // Derive a rate pill from the prime-rate agent card
  const primeCard = agentCards.find((c) => c.dataType === "canada-prime-rate" || c.dataType === "canada-overnight-rate");
  const ratePill: RatePill | undefined = primeCard
    ? {
        label: (() => {
          const match = primeCard.title.match(/(\d+\.\d+%)/);
          return `Prime ${match ? match[1] : ""}`.trim();
        })(),
        direction: primeCard.title.toLowerCase().includes("raised") || primeCard.title.toLowerCase().includes("up")
          ? "up"
          : primeCard.title.toLowerCase().includes("cut") || primeCard.title.toLowerCase().includes("down")
          ? "down" : "unchanged",
      }
    : undefined;

  async function dismissCard(id: string) {
    setAgentCards((prev) => prev.filter((c) => c.id !== id));
    if (!token) return;
    await fetch("/api/user/agent-insights", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "dismiss", cardId: id }),
    }).catch(() => {});
  }

  // ── Radar pill styles ────────────────────────────────────────────────────────
  const RADAR_STYLE = {
    warn:     { bg: "bg-amber-50",  border: "border-amber-200",  pill: "bg-amber-100 text-amber-800",  amount: "text-amber-700" },
    windfall: { bg: "bg-green-50",  border: "border-green-200",  pill: "bg-green-100 text-green-800",  amount: "text-green-700" },
    neutral:  { bg: "bg-blue-50",   border: "border-blue-100",   pill: "bg-blue-100 text-blue-700",    amount: "text-blue-700"  },
  };

  // ── RadarCard ────────────────────────────────────────────────────────────────
  function RadarCard({ item }: { item: RadarItem }) {
    const sty      = RADAR_STYLE[item.type] ?? RADAR_STYLE.neutral;
    const expanded = expandedRadar.has(item.id);

    return (
      <div className={`rounded-xl border ${sty.border} ${sty.bg} overflow-hidden`}>
        {/* Header row */}
        <div
          role="button" tabIndex={0}
          className="flex items-start gap-3 px-4 py-3.5 cursor-pointer"
          onClick={() => toggleRadar(item.id)}
          onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && toggleRadar(item.id)}
        >
          <span className="text-xl leading-none mt-0.5 shrink-0">{item.icon}</span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5 mb-0.5">
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${sty.pill}`}>
                {item.pill}
              </span>
              <span className="text-[11px] text-gray-400 font-medium">{item.when}</span>
            </div>
            <p className="text-sm font-semibold text-gray-900 leading-snug">{item.title}</p>
            <p className="mt-0.5 text-xs text-gray-500">{item.sub}</p>
          </div>
          <div className="shrink-0 text-right ml-2">
            <p className={`text-sm font-bold tabular-nums ${sty.amount}`}>{item.amount}</p>
            <p className="text-[10px] text-gray-400 mt-0.5 whitespace-nowrap">{item.amountLabel}</p>
          </div>
          <button
            aria-label="Dismiss"
            onClick={(e) => { e.stopPropagation(); dismissRadar(item.id); }}
            className="shrink-0 text-gray-300 hover:text-gray-500 transition ml-1 -mt-0.5"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Expanded detail */}
        {expanded && (
          <div className="border-t border-gray-100 bg-white px-4 py-3 space-y-3">
            {/* Breakdown table */}
            <table className="w-full text-xs">
              <tbody className="divide-y divide-gray-50">
                {item.expand.breakdown.map((row, i) => (
                  <tr key={i}>
                    <td className="py-1 text-gray-500 pr-4">{row.label}</td>
                    <td className="py-1 text-right font-semibold text-gray-800 tabular-nums">{row.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {item.expand.note && (
              <p className="text-xs text-gray-500 leading-relaxed">{item.expand.note}</p>
            )}
            <div className="flex items-center justify-between pt-1">
              <span className={`text-[10px] rounded-full px-2 py-0.5 font-medium ${
                item.expand.confidence.level === "high"   ? "bg-green-100 text-green-700" :
                item.expand.confidence.level === "medium" ? "bg-amber-100 text-amber-700" :
                "bg-gray-100 text-gray-500"
              }`}>
                {item.expand.confidence.text}
              </span>
              {item.expand.primaryAction.href && (
                <Link href={item.expand.primaryAction.href}
                  className="text-xs font-semibold text-purple-600 hover:underline">
                  {item.expand.primaryAction.label} →
                </Link>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── FreshnessBar ─────────────────────────────────────────────────────────────
  function FreshnessBar() {
    if (!freshness) return null;
    const { state, daysSinceUpload, accounts } = freshness;
    const isFresh = state === "fresh";
    const isStale = state === "stale";
    const bg      = isFresh ? "bg-green-50 border-green-200" : isStale ? "bg-red-50 border-red-200" : "bg-amber-50 border-amber-200";
    const text    = isFresh ? "text-green-800" : isStale ? "text-red-700" : "text-amber-800";
    const sub     = isFresh ? "text-green-600" : isStale ? "text-red-600" : "text-amber-600";
    const icon    = isFresh
      ? <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
      : <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>;

    const headline = isFresh
      ? "Statements up to date"
      : isStale
      ? `Statements are ${daysSinceUpload} days old — predictions are unreliable`
      : `Statements last uploaded ${daysSinceUpload} days ago`;

    const subline = accounts.slice(0, 4).map((a) => {
      const d = new Date(a.uploadedAt + "T00:00:00");
      return `${a.name} · ${d.toLocaleDateString("en-CA", { month: "short", day: "numeric" })}`;
    }).join("  ·  ");

    return (
      <div className={`mb-4 flex items-start justify-between gap-3 rounded-xl border px-4 py-3 ${bg}`}>
        <div className={`flex items-start gap-2.5 ${text}`}>
          {icon}
          <div>
            <p className="text-sm font-semibold">{headline}</p>
            {subline && <p className={`mt-0.5 text-xs ${sub}`}>{subline}</p>}
          </div>
        </div>
        <Link
          href="/account/upload"
          className={`shrink-0 rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
            isFresh
              ? "border-green-200 text-green-700 hover:bg-green-100"
              : "border-amber-300 bg-white text-amber-700 hover:bg-amber-50"
          }`}
        >
          {isFresh ? "View coverage" : "Upload now"}
        </Link>
      </div>
    );
  }

  // ── StatusBanner ──────────────────────────────────────────────────────────────
  function StatusBannerBar() {
    if (!statusBanner) return null;
    const isWarn   = statusBanner.type === "warn" || statusBanner.type === "alert";
    const isOk     = statusBanner.type === "ok";
    const bg       = isOk ? "bg-green-50 border-green-200" : "bg-amber-50 border-amber-200";
    const text     = isOk ? "text-green-800" : "text-amber-800";
    return (
      <button
        onClick={() => setStatusOpen((v) => !v)}
        className={`mb-4 w-full text-left flex items-center gap-3 rounded-xl border px-4 py-3 transition ${bg}`}
      >
        <svg className={`h-4 w-4 shrink-0 ${isOk ? "text-green-500" : "text-amber-500"}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          {isOk
            ? <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            : <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          }
        </svg>
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-semibold ${text}`}>{statusBanner.text}</p>
          {statusOpen && statusBanner.detail && (
            <p className={`mt-0.5 text-xs ${isOk ? "text-green-600" : "text-amber-700"}`}>{statusBanner.detail}</p>
          )}
        </div>
        <svg className={`h-3.5 w-3.5 shrink-0 transition-transform ${text} opacity-50 ${statusOpen ? "rotate-180" : ""}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
    );
  }

  // ── NetWorthCard ──────────────────────────────────────────────────────────────
  function NetWorthCard() {
    if (!netWorth) return null;
    const totalFmt = new Intl.NumberFormat("en-CA", {
      style: "currency", currency: "CAD",
      minimumFractionDigits: 0, maximumFractionDigits: 0,
    }).format(netWorth.total);

    return (
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        <div className="px-4 pt-4 pb-3">
          <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">Net Worth</p>
          <p className="text-2xl font-bold text-gray-900 tabular-nums">{totalFmt}</p>
          <p className={`text-xs mt-0.5 font-medium ${netWorth.isStale ? "text-amber-500" : "text-green-600"}`}>
            {netWorth.calculatedLabel}
          </p>
        </div>
        {netWorth.accounts.length > 0 && (
          <div className="border-t border-gray-100 divide-y divide-gray-50">
            {netWorth.accounts.map((acc, i) => {
              const valFmt = new Intl.NumberFormat("en-CA", {
                style: "currency", currency: "CAD",
                minimumFractionDigits: 0, maximumFractionDigits: 0,
              }).format(Math.abs(acc.value));
              return (
                <div key={i} className="flex items-center justify-between px-4 py-2">
                  <span className="text-xs text-gray-500">{acc.label}</span>
                  <span className={`text-xs font-semibold tabular-nums ${acc.isEstimated ? "text-gray-400" : "text-gray-800"}`}>
                    {acc.isEstimated ? "~" : ""}{valFmt}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // ── SidebarSignalCard ─────────────────────────────────────────────────────────
  function SidebarSignalCard({ card }: { card: AgentCard }) {
    const [expanded, setExpanded] = useState(false);
    const isExternal = card.source === "external";
    return (
      <div className="rounded-xl border border-gray-200 bg-white overflow-hidden shadow-sm">
        <div className="px-3.5 pt-3 pb-0 flex items-start justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-purple-500 shrink-0" />
            <span className="text-[10px] font-bold text-purple-600 uppercase tracking-wider">
              {isExternal ? "Market Signal" : "AI Insight"}
            </span>
          </div>
          <button
            onClick={() => dismissCard(card.id)}
            aria-label="Dismiss"
            className="shrink-0 text-gray-300 hover:text-gray-500 transition -mt-0.5"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="px-3.5 pt-2 pb-3">
          <p className="text-[13px] font-semibold text-gray-900 leading-snug">{card.title}</p>
          <p className={`mt-1.5 text-[12px] text-gray-500 leading-relaxed ${expanded ? "" : "line-clamp-3"}`}>
            {card.body}
          </p>
          <div className="mt-2 flex items-center gap-3">
            {card.body.length > 100 && (
              <button
                onClick={() => setExpanded((v) => !v)}
                className="text-[11px] font-medium text-gray-400 hover:text-gray-600"
              >
                {expanded ? "Less" : "More →"}
              </button>
            )}
            {card.href && (
              <Link href={card.href} target="_blank" rel="noopener noreferrer"
                className="text-[11px] font-semibold text-purple-600 hover:underline">
                {isExternal ? "Source ↗" : "View →"}
              </Link>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── MobileCardShell — fixed-height clamp with expand/collapse for the mobile strip ──
  function MobileCardShell({ children }: { children: React.ReactNode }) {
    const [expanded, setExpanded] = useState(false);
    return (
      <div className="relative">
        <div className={`overflow-hidden rounded-xl transition-[max-height] duration-300 ease-in-out ${expanded ? "max-h-[600px]" : "max-h-36"}`}>
          {children}
        </div>
        {!expanded && (
          <button
            onClick={() => setExpanded(true)}
            className="absolute bottom-0 inset-x-0 flex items-end justify-center pt-8 pb-2 bg-gradient-to-t from-white via-white/80 to-transparent rounded-b-xl"
          >
            <span className="text-[10px] font-semibold text-gray-400 flex items-center gap-0.5">
              More
              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </span>
          </button>
        )}
        {expanded && (
          <button
            onClick={() => setExpanded(false)}
            className="mt-1 w-full flex justify-center"
          >
            <span className="text-[10px] font-semibold text-gray-400 flex items-center gap-0.5">
              Less
              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
              </svg>
            </span>
          </button>
        )}
      </div>
    );
  }

  // ── MarketContextStub ─────────────────────────────────────────────────────────
  function MarketContextStub() {
    return (
      <div className="rounded-xl border border-gray-200 bg-gray-50 overflow-hidden">
        <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-gray-200">
          <div className="flex items-center gap-1.5 text-gray-400">
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
            <p className="text-[10px] font-semibold uppercase tracking-wider">Market Context</p>
          </div>
          <span className="rounded-full bg-gray-800 px-2 py-0.5 text-[9px] font-bold text-white uppercase tracking-wider">Premium</span>
        </div>
        <div className="px-3.5 py-3 space-y-2 select-none opacity-60">
          {["BoC rate history", "CPI trend", "Rate impact on your debt"].map((item) => (
            <div key={item} className="flex items-center gap-2">
              <div className="h-4 w-4 rounded bg-gray-200 shrink-0" />
              <div className="h-2 rounded bg-gray-200 flex-1" />
            </div>
          ))}
        </div>
        <div className="px-3.5 pb-3">
          <button className="w-full rounded-lg bg-gray-900 px-3 py-2 text-xs font-semibold text-white hover:bg-gray-800 transition">
            Upgrade to unlock
          </button>
        </div>
      </div>
    );
  }

  const hasUpcoming = upcoming.length > 0;

  return (
    <div className="mx-auto max-w-5xl px-4 pt-4 pb-8 sm:py-8 sm:px-6">

      {token && <ParseStatusBanner onRefresh={() => load(token)} />}

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-gray-900">Today</h1>
        <p className="mt-0.5 text-sm text-gray-400">{todayLabel()}</p>
      </div>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      {/* ── Mobile sidebar strip (horizontal scroll, hidden on desktop) ──────── */}
      <div className="lg:hidden -mx-4 px-4 mb-5">
        <div className="flex gap-3 overflow-x-auto pb-2 snap-x snap-mandatory scrollbar-hide">
          <div className="snap-start shrink-0 w-64">
            <MobileCardShell><NetWorthCard /></MobileCardShell>
          </div>
          {agentCards.map((card) => (
            <div key={card.id} className="snap-start shrink-0 w-64">
              <MobileCardShell><SidebarSignalCard card={card} /></MobileCardShell>
            </div>
          ))}
          <div className="snap-start shrink-0 w-64">
            <MobileCardShell><MarketContextStub /></MobileCardShell>
          </div>
        </div>
      </div>

      {/* ── Two-column layout ────────────────────────────────────────────────── */}
      <div className="flex gap-6 items-start">

        {/* ── Main feed ─────────────────────────────────────────────────────── */}
        <div className="min-w-0 flex-1">

          {/* Freshness bar */}
          <FreshnessBar />

          {/* Status banner */}
          <StatusBannerBar />

          {/* On your radar */}
          {visibleRadar.length > 0 && (
            <div className="mb-6">
              <div className="mb-2 flex items-center gap-2">
                <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">On your radar</p>
                <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-bold text-gray-500">
                  {visibleRadar.length}
                </span>
              </div>
              <div className="space-y-2">
                {visibleRadar.map((item) => <RadarCard key={item.id} item={item} />)}
              </div>
            </div>
          )}

          {/* Overdue events */}
          {overdue.length > 0 && (
            <UpcomingGroup title="Overdue" items={overdue} ratePill={ratePill} />
          )}

          {/* Date-sorted upcoming */}
          {dateItems.length > 0 && (
            <div className="mb-6">
              <UpcomingGroup
                title={overdue.length > 0 ? "Upcoming" : "Next up"}
                items={dateItems}
                ratePill={ratePill}
              />
            </div>
          )}

          {/* Also this month */}
          {thisMonth.length > 0 && (
            <ThisMonthGroup items={thisMonth} ratePill={ratePill} />
          )}

          {/* Caught-up empty state */}
          {!hasUpcoming && visibleRadar.length === 0 && !statusBanner && (
            <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-5 py-12 text-center">
              <svg className="mx-auto mb-2 h-8 w-8 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-sm font-semibold text-gray-700">You&apos;re all caught up</p>
              <p className="mt-1 text-xs text-gray-400">Nothing overdue. Check back tomorrow.</p>
            </div>
          )}
        </div>

        {/* ── Right sidebar ─────────────────────────────────────────────────── */}
        <div className="hidden lg:block w-72 shrink-0">
          <div className="sticky top-6 space-y-3">

            {/* Net worth card */}
            <NetWorthCard />

            {/* Signals section */}
            <div className="flex items-center justify-between mt-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Signals</p>
              {agentCards.length > 0 && (
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-500">
                  {agentCards.length}
                </span>
              )}
            </div>

            {agentCards.length > 0
              ? agentCards.map((card) => <SidebarSignalCard key={card.id} card={card} />)
              : (
                <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-4 py-5 text-center">
                  <p className="text-xs text-gray-400">No active signals</p>
                </div>
              )
            }

            {/* Market context premium stub */}
            <MarketContextStub />

          </div>
        </div>

      </div>
    </div>
  );
}
