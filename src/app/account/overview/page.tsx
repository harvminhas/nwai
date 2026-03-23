"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseClient } from "@/lib/firebase";
import ConsolidatedCurrentDashboard from "@/components/ConsolidatedCurrentDashboard";
import type { DashboardAlert, UpcomingItem } from "@/app/api/user/insights/route";
import ParseStatusBanner from "@/components/ParseStatusBanner";

// ── helpers ───────────────────────────────────────────────────────────────────

function fmt(v: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD",
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(v);
}

// ── alert config ──────────────────────────────────────────────────────────────

const ALERT_CFG: Record<string, { border: string; bg: string; text: string; icon: React.ReactNode }> = {
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
  low: {
    border: "border-blue-200", bg: "bg-blue-50", text: "text-blue-700",
    icon: (
      <svg className="h-4 w-4 shrink-0 text-blue-400 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
};

// ── upcoming icons ────────────────────────────────────────────────────────────

const UPCOMING_ICON: Record<string, React.ReactNode> = {
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
  subscription: (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-purple-100">
      <svg className="h-4 w-4 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
      </svg>
    </span>
  ),
  debt: (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-red-100">
      <svg className="h-4 w-4 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z" />
      </svg>
    </span>
  ),
};

function formatPredictedDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return "~" + d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function dateLabelFn(daysFromNow: number, dateStr: string): { label: string; cls: string } {
  if (daysFromNow < 0)   return { label: `${Math.abs(daysFromNow)}d overdue`, cls: "text-red-500 font-semibold" };
  if (daysFromNow === 0) return { label: "Today",     cls: "text-amber-600 font-semibold" };
  if (daysFromNow === 1) return { label: "Tomorrow",  cls: "text-amber-500 font-semibold" };
  if (daysFromNow <= 7)  return { label: `In ${daysFromNow}d`, cls: "text-gray-600 font-medium" };
  const d = new Date(dateStr + "T00:00:00");
  return { label: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }), cls: "text-gray-400" };
}

// ── page ──────────────────────────────────────────────────────────────────────

export default function OverviewPage() {
  const router = useRouter();

  const [alerts,    setAlerts]    = useState<DashboardAlert[]>([]);
  const [upcoming,  setUpcoming]  = useState<UpcomingItem[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [token,     setToken]     = useState<string | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("nwai_dismissed_alerts");
      setDismissed(new Set(raw ? JSON.parse(raw) : []));
    } catch { /* ignore */ }
  }, []);

  const load = useCallback(async (tok: string) => {
    setLoading(true); setError(null);
    try {
      const res  = await fetch("/api/user/insights", { headers: { Authorization: `Bearer ${tok}` } });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setError(json.error || "Failed to load"); return; }
      setAlerts(json.alerts ?? []);
      setUpcoming(json.upcoming ?? []);
    } catch { setError("Failed to load overview"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    const { auth } = getFirebaseClient();
    return onAuthStateChanged(auth, async (user) => {
      if (!user) { router.push("/account/login"); return; }
      const tok = await user.getIdToken();
      setToken(tok);
      load(tok);
    });
  }, [router, load]);

  function dismiss(id: string) {
    setDismissed((prev) => {
      const next = new Set(prev).add(id);
      try { localStorage.setItem("nwai_dismissed_alerts", JSON.stringify([...next])); } catch { /* ignore */ }
      return next;
    });
  }

  function undismissAll() {
    setDismissed(new Set());
    try { localStorage.removeItem("nwai_dismissed_alerts"); } catch { /* ignore */ }
  }

  const visibleAlerts  = alerts.filter((a) => !dismissed.has(a.id));
  const hiddenCount    = alerts.length - visibleAlerts.length;
  const dated          = upcoming.filter((i) => !i.isThisMonth);
  const thisMonthItems = upcoming.filter((i) => i.isThisMonth);
  const outTotal       = thisMonthItems.filter((i) => i.type !== "cash-in").reduce((s, i) => s + i.amount, 0);
  const inExpected     = thisMonthItems.filter((i) => i.type === "cash-in").reduce((s, i) => s + i.amount, 0);

  return (
    <div>
      {/* ── Financial snapshot section ───────────────────────────────── */}
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">

        {/* Page title */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Overview</h1>
          <p className="mt-0.5 text-sm text-gray-400">Your financial position at a glance</p>
        </div>

        {/* Pending parse banner */}
        {token && <ParseStatusBanner onRefresh={() => load(token)} />}

        {/* Financial snapshot — net worth, this month, chart, on-track */}
        <ConsolidatedCurrentDashboard />
      </div>

      {/* ── Alerts & upcoming section ────────────────────────────────── */}
      <div className="border-t border-gray-100">
        <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">

          {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

          {/* Alerts */}
          <section className="mb-8">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                Insights
                {visibleAlerts.length > 0 && (
                  <span className="ml-2 rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-600">
                    {visibleAlerts.length}
                  </span>
                )}
              </p>
              {hiddenCount > 0 && (
                <button onClick={undismissAll} className="text-xs text-gray-400 hover:text-purple-600 transition">
                  Show {hiddenCount} dismissed
                </button>
              )}
            </div>

            {loading ? (
              <div className="rounded-xl border border-gray-100 bg-gray-50 px-5 py-8 text-center">
                <div className="mx-auto h-5 w-5 animate-spin rounded-full border-2 border-purple-600 border-t-transparent" />
              </div>
            ) : visibleAlerts.length === 0 ? (
              <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-5 py-8 text-center">
                <svg className="mx-auto mb-2 h-8 w-8 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="text-sm font-medium text-gray-600">All clear</p>
                <p className="mt-1 text-xs text-gray-400">No issues detected with your finances right now.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {visibleAlerts.map((alert) => {
                  const cfg = ALERT_CFG[alert.severity];
                  if (!cfg) return null;
                  return (
                    <div key={alert.id} className={`flex items-start gap-3 rounded-xl border ${cfg.border} ${cfg.bg} px-4 py-3.5`}>
                      {cfg.icon}
                      <div className="min-w-0 flex-1">
                        <p className={`text-sm font-semibold ${cfg.text}`}>{alert.title}</p>
                        <p className={`mt-0.5 text-xs ${cfg.text} opacity-80`}>{alert.body}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {alert.href && (
                          <Link href={alert.href} className={`text-xs font-semibold ${cfg.text} underline opacity-70 hover:opacity-100`}>
                            View →
                          </Link>
                        )}
                        <button
                          onClick={() => dismiss(alert.id)}
                          className={`rounded p-0.5 ${cfg.text} opacity-30 hover:opacity-70 transition`}
                          title="Dismiss"
                        >
                          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Upcoming — dated */}
          {!loading && (
            <section className="mb-8">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">Next 14 days</p>

              {dated.length === 0 ? (
                <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-5 py-8 text-center">
                  <p className="text-sm text-gray-500">No upcoming payments with exact dates.</p>
                  <p className="mt-1 text-xs text-gray-400">
                    Add cash commitments with dates in{" "}
                    <Link href="/account/spending?tab=cash" className="text-purple-600 hover:underline">Spending → Cash</Link>.
                  </p>
                </div>
              ) : (
                <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
                  <div className="divide-y divide-gray-100">
                    {dated.map((item) => {
                      const { label, cls } = dateLabelFn(item.daysFromNow, item.date);
                      return (
                        <div key={item.id} className={`flex items-center gap-3 px-4 py-3.5 ${item.isOverdue ? "bg-red-50/60" : ""}`}>
                          {UPCOMING_ICON[item.type]}
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-gray-800">{item.title}</p>
                            {item.subtitle && <p className="text-xs text-gray-400 mt-0.5">{item.subtitle}</p>}
                          </div>
                          <div className="shrink-0 text-right">
                            <p className={`text-sm font-semibold ${item.type === "cash-in" ? "text-green-600" : "text-gray-800"}`}>
                              {item.type === "cash-in" ? "+" : "−"}{fmt(item.amount)}
                            </p>
                            <p className={`text-xs mt-0.5 ${cls}`}>{label}</p>
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
            </section>
          )}

          {/* Upcoming — this month (undated recurring) */}
          {!loading && thisMonthItems.length > 0 && (
            <section>
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Also this month</p>
                <div className="flex items-center gap-3 text-xs text-gray-400">
                  {outTotal > 0 && <span>Out: <span className="font-semibold text-gray-700">{fmt(outTotal)}</span></span>}
                  {inExpected > 0 && <span>In: <span className="font-semibold text-green-600">{fmt(inExpected)}</span></span>}
                </div>
              </div>
              <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
                <div className="divide-y divide-gray-100">
              {thisMonthItems.map((item) => (
                <div key={item.id} className="flex items-center gap-3 px-4 py-3.5">
                  {UPCOMING_ICON[item.type]}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-800">{item.title}</p>
                    {item.subtitle && <p className="text-xs text-gray-400 mt-0.5">{item.subtitle}</p>}
                  </div>
                  <div className="shrink-0 text-right">
                    <p className={`text-sm font-semibold ${item.type === "cash-in" ? "text-green-600" : "text-gray-700"}`}>
                      {item.type === "cash-in" ? "+" : "−"}{fmt(item.amount)}
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {item.predictedDate ? formatPredictedDate(item.predictedDate) : "this month"}
                    </p>
                  </div>
                      {item.href && (
                        <Link href={item.href} className="shrink-0 text-gray-300 hover:text-gray-500 transition ml-1">
                          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                          </svg>
                        </Link>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </section>
          )}

          {!loading && upcoming.length === 0 && (
            <div className="mt-4 rounded-xl border border-dashed border-gray-200 bg-gray-50 px-5 py-10 text-center">
              <p className="text-sm text-gray-500">Nothing upcoming yet.</p>
              <p className="mt-1 text-xs text-gray-400">Upload statements or add cash commitments to see upcoming payments here.</p>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
