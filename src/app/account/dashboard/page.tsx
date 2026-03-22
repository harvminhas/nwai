"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseClient } from "@/lib/firebase";
import type { DashboardAlert, UpcomingItem } from "@/app/api/user/insights/route";

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

function UpcomingGroup({ title, items, emptySlot }: { title: string; items: UpcomingItem[]; emptySlot?: React.ReactNode }) {
  if (items.length === 0 && !emptySlot) return null;
  return (
    <div>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">{title}</p>
      {items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-5 py-4 text-center text-xs text-gray-400">
          {emptySlot}
        </div>
      ) : (
        <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
          <div className="divide-y divide-gray-100">
            {items.map((item) => {
              const { text, cls } = getDateLabel(item);
              return (
                <div
                  key={item.id}
                  className={`flex items-center gap-3 px-4 py-3.5 ${item.isOverdue ? "bg-red-50/60" : ""}`}
                >
                  {TYPE_ICON[item.type] ?? TYPE_ICON["cash-out"]}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-800">{item.title}</p>
                    {item.subtitle && <p className="text-xs text-gray-400 mt-0.5">{item.subtitle}</p>}
                  </div>
                  <div className="shrink-0 text-right">
                    <p className={`text-sm font-semibold ${item.type === "cash-in" ? "text-green-600" : "text-gray-800"}`}>
                      {item.type === "cash-in" ? "+" : "−"}{fmt(item.amount)}
                    </p>
                    <p className={`text-xs mt-0.5 ${cls}`}>{text}</p>
                  </div>
                  {item.href && (
                    <Link href={item.href} className="shrink-0 text-gray-300 hover:text-gray-500 transition ml-1">
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                      </svg>
                    </Link>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── page ──────────────────────────────────────────────────────────────────────

export default function TodayPage() {
  const router = useRouter();
  const [alerts,   setAlerts]   = useState<DashboardAlert[]>([]);
  const [upcoming, setUpcoming] = useState<UpcomingItem[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState<string | null>(null);

  const load = useCallback(async (tok: string) => {
    setLoading(true); setError(null);
    try {
      const res  = await fetch("/api/user/insights", { headers: { Authorization: `Bearer ${tok}` } });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setError(json.error || "Failed to load"); return; }
      setAlerts(json.alerts ?? []);
      setUpcoming(json.upcoming ?? []);
    } catch { setError("Failed to load today view"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    const { auth } = getFirebaseClient();
    return onAuthStateChanged(auth, async (user) => {
      if (!user) { router.push("/account/login"); return; }
      const tok = await user.getIdToken();
      load(tok);
    });
  }, [router, load]);

  if (loading) return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <div className="h-10 w-10 animate-spin rounded-full border-4 border-purple-600 border-t-transparent" />
    </div>
  );

  // Segment upcoming items
  const overdue   = upcoming.filter((i) => !i.isThisMonth && i.daysFromNow < 0);
  const todayItems = upcoming.filter((i) => !i.isThisMonth && i.daysFromNow === 0);
  const thisWeek  = upcoming.filter((i) => !i.isThisMonth && i.daysFromNow > 0 && i.daysFromNow <= 7);
  const later     = upcoming.filter((i) => !i.isThisMonth && i.daysFromNow > 7);
  const thisMonth = upcoming.filter((i) => i.isThisMonth);

  const urgentAlerts = alerts.filter((a) => a.severity === "high" || a.severity === "medium");
  const hasContent   = upcoming.length > 0 || urgentAlerts.length > 0;

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">

      {/* ── Header ───────────────────────────────────────────────────────── */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Today</h1>
        <p className="mt-0.5 text-sm text-gray-400">{todayLabel()}</p>
      </div>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      {/* ── Alerts (high + medium — no dismiss here, they're urgent) ──────── */}
      {urgentAlerts.length > 0 && (
        <div className="mb-6 space-y-2">
          {urgentAlerts.map((a) => {
            const sty = ALERT_STYLE[a.severity] ?? ALERT_STYLE.medium;
            return (
              <div key={a.id} className={`flex items-start gap-3 rounded-xl border ${sty.border} ${sty.bg} px-4 py-3.5`}>
                {sty.icon}
                <div className="min-w-0 flex-1">
                  <p className={`text-sm font-semibold ${sty.text}`}>{a.title}</p>
                  <p className={`mt-0.5 text-xs ${sty.text} opacity-80`}>{a.body}</p>
                </div>
                {a.href && (
                  <Link href={a.href} className={`shrink-0 text-xs font-semibold ${sty.text} underline opacity-70 hover:opacity-100`}>
                    View →
                  </Link>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Upcoming items grouped by time ───────────────────────────────── */}
      {hasContent ? (
        <div className="space-y-6">
          <UpcomingGroup title="Overdue" items={overdue} />
          <UpcomingGroup title="Today" items={todayItems} />
          <UpcomingGroup title="This week" items={thisWeek} />
          <UpcomingGroup title="Coming up" items={later} />
          <UpcomingGroup title="Also this month" items={thisMonth} />
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

      {/* ── Footer link to full overview ──────────────────────────────────── */}
      {hasContent && (
        <div className="mt-8 border-t border-gray-100 pt-5 text-center">
          <Link href="/account/overview" className="text-sm font-medium text-purple-600 hover:underline">
            See your full financial overview →
          </Link>
        </div>
      )}

    </div>
  );
}
