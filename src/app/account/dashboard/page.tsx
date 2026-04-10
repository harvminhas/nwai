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
import RefreshToast from "@/components/RefreshToast";
import { fmt } from "@/lib/currencyUtils";
import { usePlan } from "@/contexts/PlanContext";

// ── helpers ───────────────────────────────────────────────────────────────────


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

// ── Onboarding modal ──────────────────────────────────────────────────────────

const DISMISS_KEY = "nwai_onboarding_v1_dismissed";

const UNLOCKED = [
  { icon: "✓", label: "Net Worth snapshot" },
  { icon: "✓", label: "Savings Rate" },
  { icon: "✓", label: "Next Up predictions" },
  { icon: "✓", label: "AI Signals" },
];

const COMING = [
  { icon: "🔒", label: "On Your Radar — cash-flow conflicts" },
  { icon: "🔒", label: "Also This Month — all recurring bills" },
  { icon: "🔒", label: "Spending Trends — vs your typical month" },
  { icon: "🔒", label: "Income predictions & patterns" },
];

function OnboardingModal({ radar, onDismiss }: { radar: RadarItem[]; onDismiss: () => void }) {
  // Only show when not enough data for radar (< 2 months)
  if (radar.length > 0) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.45)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onDismiss(); }}
    >
      <div className="relative w-full max-w-lg rounded-2xl bg-white shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="bg-gradient-to-br from-purple-600 to-indigo-600 px-6 py-5">
          <button
            onClick={onDismiss}
            className="absolute top-3.5 right-4 text-white/60 hover:text-white transition"
            aria-label="Close"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          <p className="text-xs font-semibold uppercase tracking-widest text-purple-200 mb-1">Your financial picture is live</p>
          <h2 className="text-xl font-bold text-white leading-snug">
            Upload 1–2 more months to unlock the full experience
          </h2>
        </div>

        {/* Body */}
        <div className="px-6 py-5 grid sm:grid-cols-2 gap-4">
          {/* Unlocked */}
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-2">Already active</p>
            <ul className="space-y-2">
              {UNLOCKED.map((item) => (
                <li key={item.label} className="flex items-center gap-2.5">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-green-100 text-green-600 text-xs font-bold">
                    {item.icon}
                  </span>
                  <span className="text-sm text-gray-700">{item.label}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Coming */}
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-2">Unlocks with 2+ months</p>
            <ul className="space-y-2">
              {COMING.map((item) => (
                <li key={item.label} className="flex items-center gap-2.5">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-400 text-xs">
                    {item.icon}
                  </span>
                  <span className="text-sm text-gray-400">{item.label}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-gray-100 px-6 py-4 flex items-center justify-between gap-4">
          <button
            onClick={onDismiss}
            className="text-sm text-gray-400 hover:text-gray-600 transition"
          >
            Got it, don&apos;t show again
          </button>
          <Link
            href="/upload"
            onClick={onDismiss}
            className="rounded-lg bg-purple-600 px-5 py-2 text-sm font-semibold text-white hover:bg-purple-700 transition"
          >
            Upload a statement →
          </Link>
        </div>
      </div>
    </div>
  );
}

// ── Getting started / caught-up panel ─────────────────────────────────────────

const EXPLORE_TILES = [
  { href: "/account/spending",    icon: "💳", label: "Spending",    desc: "Where your money goes" },
  { href: "/account/income",      icon: "💰", label: "Income",      desc: "All income sources" },
  { href: "/account/liabilities", icon: "📋", label: "Liabilities", desc: "Debt & credit cards" },
  { href: "/account/assets",      icon: "📈", label: "Assets",      desc: "Savings & investments" },
  { href: "/account/goals",       icon: "🎯", label: "Goals",       desc: "Plan your targets" },
  { href: "/account/statements",  icon: "📄", label: "Statements",  desc: "Manage uploads" },
];

function GettingStartedPanel({
  netWorth,
  savingsRate,
  hasMultipleAccounts,
}: {
  netWorth:            { total: number } | null;
  savingsRate:         { rate: number; month: string } | null;
  hasMultipleAccounts: boolean;
}) {
  const isFirstRun = !hasMultipleAccounts;

  return (
    <div className="space-y-4">
      {/* Welcome / caught-up header */}
      <div className="rounded-xl border border-green-100 bg-green-50 px-5 py-4 flex items-start gap-3">
        <svg className="h-5 w-5 shrink-0 text-green-500 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <div>
          <p className="text-sm font-semibold text-green-800">
            {isFirstRun ? "Your first statement is ready!" : "You're all caught up"}
          </p>
          <p className="mt-0.5 text-xs text-green-700">
            {isFirstRun
              ? "Your data has been analysed. Explore your financial picture below, or upload more months for trends."
              : "No upcoming items or alerts. Check back as new statements are uploaded."}
          </p>
        </div>
      </div>

      {/* Explore tiles */}
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">Explore</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {EXPLORE_TILES.map((t) => (
            <Link key={t.href} href={t.href}
              className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm hover:border-purple-200 hover:shadow-md transition group">
              <span className="text-xl">{t.icon}</span>
              <p className="mt-2 text-sm font-semibold text-gray-800 group-hover:text-purple-700">{t.label}</p>
              <p className="text-xs text-gray-400 mt-0.5">{t.desc}</p>
            </Link>
          ))}
        </div>
      </div>

      {/* Upload more prompt */}
      <div className="rounded-xl border border-dashed border-purple-200 bg-purple-50/40 px-5 py-4 flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-purple-800">
            {isFirstRun ? "Add more months to see trends" : "Upload your latest statement"}
          </p>
          <p className="mt-0.5 text-xs text-purple-600">
            {isFirstRun
              ? "Trends, typical spend, and savings projections appear after 2–3 months of data."
              : "Keep your financial picture up to date."}
          </p>
        </div>
        <Link href="/upload"
          className="shrink-0 rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-700 transition">
          Upload
        </Link>
      </div>
    </div>
  );
}

// ── Feature preview section (shown when real features have no data yet) ───────

function FeaturePreviewSection({ upcoming }: { upcoming: UpcomingItem[] }) {
  // Mirror the same segmentation used in the main feed
  const dateItems = upcoming.filter((i) => !i.isThisMonth && i.daysFromNow >= 0);
  const thisMonth = upcoming.filter((i) => i.isThisMonth);

  const missingNextUp    = dateItems.length === 0;
  const missingThisMonth = thisMonth.length === 0;

  // Nothing to preview
  if (!missingNextUp && !missingThisMonth) return null;

  return (
    <div className="mt-6 space-y-4">
      <div className="flex items-center gap-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">
          More features as you upload statements
        </p>
        <Link href="/upload" className="ml-auto text-xs font-semibold text-purple-600 hover:underline">
          + Upload another →
        </Link>
      </div>

      <div className={`grid gap-3 ${missingNextUp && missingThisMonth ? "sm:grid-cols-2" : ""}`}>

        {/* Next Up preview */}
        {missingNextUp && (
          <PreviewCard
            title="Next Up"
            desc="Upcoming bills, subscriptions and income — predicted from your recurring patterns."
          >
            <div className="divide-y divide-gray-100">
              {[
                { icon: "💰", label: "Salary / payroll",    sub: "Recurring · bi-weekly", value: "+CA$3,200", color: "bg-green-100" },
                { icon: "🔄", label: "GoodLife Clubs",      sub: "Recurring · monthly",   value: "−CA$12",    color: "bg-purple-100" },
                { icon: "🏠", label: "Rent / mortgage",     sub: "Recurring · monthly",   value: "−CA$2,400", color: "bg-amber-100" },
              ].map((r) => (
                <div key={r.label} className="flex items-center gap-3 px-4 py-2.5">
                  <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${r.color} text-sm`}>{r.icon}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-gray-700 truncate">{r.label}</p>
                    <p className="text-[11px] text-gray-400">{r.sub}</p>
                  </div>
                  <span className="text-xs font-semibold text-gray-500 tabular-nums shrink-0">{r.value}</span>
                </div>
              ))}
            </div>
          </PreviewCard>
        )}

        {/* Also This Month preview */}
        {missingThisMonth && (
          <PreviewCard
            title="Also This Month"
            desc="All recurring expenses this month — including estimated credit card minimums."
          >
            <div className="divide-y divide-gray-100">
              {[
                { icon: "📋", label: "Visa ····1234 minimum",  sub: "Est. minimum · $8,500 balance",  value: "−CA$170", color: "bg-red-100" },
                { icon: "📋", label: "Mastercard ····5678",    sub: "Est. minimum · $4,200 balance",  value: "−CA$84",  color: "bg-red-100" },
                { icon: "🔄", label: "Netflix.com",            sub: "Recurring · monthly",            value: "−CA$18",  color: "bg-purple-100" },
              ].map((r) => (
                <div key={r.label} className="flex items-center gap-3 px-4 py-2.5">
                  <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${r.color} text-sm`}>{r.icon}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-gray-700 truncate">{r.label}</p>
                    <p className="text-[11px] text-gray-400">{r.sub}</p>
                  </div>
                  <span className="text-xs font-semibold text-gray-500 tabular-nums shrink-0">{r.value}</span>
                </div>
              ))}
            </div>
          </PreviewCard>
        )}
      </div>
    </div>
  );
}

function PreviewCard({ title, desc, children }: { title: string; desc: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-gray-100 bg-white shadow-sm overflow-hidden">
      <div className="px-4 pt-4 pb-1">
        <p className="text-sm font-semibold text-gray-700">{title}</p>
        <p className="mt-0.5 text-xs text-gray-400 leading-snug">{desc}</p>
      </div>
      <div className="relative">
        <div className="blur-sm opacity-40 pointer-events-none select-none">
          {children}
        </div>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="rounded-full bg-purple-100 px-3 py-1.5 text-xs font-semibold text-purple-700 shadow-sm">
            Appears after 2+ months of data
          </span>
        </div>
      </div>
    </div>
  );
}

export default function TodayPage() {
  const router = useRouter();
  const { planId } = usePlan();
  const [alerts,      setAlerts]      = useState<DashboardAlert[]>([]);
  const [upcoming,    setUpcoming]    = useState<UpcomingItem[]>([]);
  const [insights,    setInsights]    = useState<TodayInsight[]>([]);
  const [agentCards,  setAgentCards]  = useState<AgentCard[]>([]);
  const [radar,       setRadar]       = useState<RadarItem[]>([]);
  const [freshness,   setFreshness]   = useState<FreshnessData | null>(null);
  const [netWorth,    setNetWorth]    = useState<NetWorthSnapshot | null>(null);
  const [savingsRate, setSavingsRate] = useState<{ rate: number; income: number; expenses: number; debtPayments: number; month: string } | null>(null);
  const [statusBanner,setStatusBanner]= useState<{ type: string; text: string; detail: string } | null>(null);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState<string | null>(null);
  const [token,       setToken]       = useState<string | null>(null);
  const [refreshing,  setRefreshing]  = useState(false);
  const [expandedAlerts,   setExpandedAlerts]   = useState<Set<string>>(new Set());
  const [expandedRadar,    setExpandedRadar]    = useState<Set<string>>(new Set());
  const [dismissedRadar,   setDismissedRadar]   = useState<Set<string>>(new Set());
  const [statusOpen,       setStatusOpen]       = useState(false);
  const [showOnboarding,   setShowOnboarding]   = useState(false);
  const [showAllUpcoming,      setShowAllUpcoming]      = useState(false);
  const [includeDebtInExpenses, setIncludeDebtInExpenses] = useState(false);

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
      const radarData = insJson.radar ?? [];
      setRadar(radarData);
      // Show onboarding modal if data is sparse and user hasn't dismissed it
      if (radarData.length === 0 && !localStorage.getItem(DISMISS_KEY)) {
        setShowOnboarding(true);
      }
      setFreshness(insJson.freshness ?? null);
      setNetWorth(insJson.netWorth ?? null);
      setSavingsRate(insJson.savingsRate ? { debtPayments: 0, ...insJson.savingsRate } : null);
      setStatusBanner(insJson.statusBanner ?? null);
      setNeedsRefresh(insJson.needsRefresh ?? false);
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
    const { state, daysOverdue, accounts } = freshness;
    const isFresh = state === "fresh";
    const isStale = state === "stale";
    const bg      = isFresh ? "bg-green-50 border-green-200" : isStale ? "bg-red-50 border-red-200" : "bg-amber-50 border-amber-200";
    const text    = isFresh ? "text-green-800" : isStale ? "text-red-700" : "text-amber-800";
    const sub     = isFresh ? "text-green-600" : isStale ? "text-red-600" : "text-amber-600";
    const icon    = isFresh
      ? <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
      : <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>;

    const overdueAccounts = accounts.filter((a) => a.isOverdue);
    const headline = isFresh
      ? "Statements up to date"
      : overdueAccounts.length > 0
      ? `Latest statements ready to upload: ${overdueAccounts.map((a) => a.name).join(", ")}`
      : "Some statements may be due soon";

    const subline = isFresh
      ? accounts.slice(0, 5).map((a) => a.name).join("  ·  ")
      : "";

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
          href={isFresh ? "/account/activity?tab=coverage" : "/account/activity?tab=coverage"}
          className={`shrink-0 rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
            isFresh
              ? "border-green-200 text-green-700 hover:bg-green-100"
              : "border-amber-300 bg-white text-amber-700 hover:bg-amber-50"
          }`}
        >
          {isFresh ? "View coverage" : "View & upload"}
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
    const [expanded, setExpanded] = useState(false);
    if (!netWorth) return null;

    const cad = (n: number) => fmt(n);

    const PREVIEW = 3;
    const assets      = netWorth.accounts;
    const debts       = netWorth.debtAccounts ?? [];
    const showAssets  = expanded ? assets : assets.slice(0, PREVIEW);
    const showDebts   = expanded ? debts  : debts.slice(0, PREVIEW);
    const hasMore     = assets.length > PREVIEW || debts.length > PREVIEW;

    function AccountRow({ acc, isDebt = false }: { acc: { label: string; value: number; isEstimated: boolean }; isDebt?: boolean }) {
      return (
        <div className="flex items-center justify-between px-4 py-2">
          <span className="text-xs text-gray-500 truncate mr-2">{acc.label}</span>
          <span className={`text-xs font-semibold tabular-nums shrink-0 ${acc.isEstimated ? "text-gray-400" : isDebt ? "text-red-500" : "text-gray-800"}`}>
            {isDebt ? "−" : ""}{cad(Math.abs(acc.value))}
            {acc.isEstimated && <span className="ml-1 text-[10px] font-normal text-gray-400">est.</span>}
          </span>
        </div>
      );
    }

    return (
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        {/* Header */}
        <div className="px-4 pt-4 pb-3">
          <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">Net Worth</p>
          <p className="text-2xl font-bold text-gray-900 tabular-nums">{cad(netWorth.total)}</p>
          <p className={`text-xs mt-0.5 font-medium ${netWorth.isStale ? "text-amber-500" : "text-green-600"}`}>
            {netWorth.calculatedLabel}
          </p>
        </div>

        {/* Assets section */}
        {showAssets.length > 0 && (
          <div className="border-t border-gray-100">
            <p className="px-4 pt-2 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400">Assets</p>
            <div className="divide-y divide-gray-50">
              {showAssets.map((acc, i) => <AccountRow key={i} acc={acc} />)}
            </div>
          </div>
        )}

        {/* Debts section */}
        {showDebts.length > 0 && (
          <div className="border-t border-gray-100 mt-1">
            <p className="px-4 pt-2 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400">Liabilities</p>
            <div className="divide-y divide-gray-50">
              {showDebts.map((acc, i) => <AccountRow key={i} acc={acc} isDebt />)}
            </div>
          </div>
        )}

        {/* Expand / collapse */}
        {hasMore && (
          <button
            onClick={() => setExpanded((v) => !v)}
            className="w-full border-t border-gray-100 px-4 py-2 text-[11px] font-medium text-gray-400 hover:text-gray-600 hover:bg-gray-50 transition text-center"
          >
            {expanded ? "Show less ↑" : `Show all (${assets.length + debts.length} accounts) ↓`}
          </button>
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

  // ── SavingsRateCard ───────────────────────────────────────────────────────────
  function SavingsRateCard() {
    const [includeDebt, setIncludeDebt] = useState(false);
    if (!savingsRate || savingsRate.income <= 0) return null;
    const { income, expenses, debtPayments, month } = savingsRate;
    const cad = (n: number) => fmt(n);
    const monthLabel = month
      ? new Date(month + "-01").toLocaleDateString("en-CA", { month: "short", year: "numeric" })
      : "";

    // Recompute rate client-side so the toggle is instant (no round-trip)
    const effectiveExpenses = includeDebt ? expenses + debtPayments : expenses;
    const rate      = income > 0 ? Math.round(((income - effectiveExpenses) / income) * 100) : 0;
    const clampedRate = Math.max(-100, Math.min(100, rate));
    const barPct      = Math.max(0, Math.min(100, clampedRate));
    const isNeg       = rate < 0;
    const color       = rate >= 20 ? "bg-green-500"
                      : rate >= 10 ? "bg-emerald-400"
                      : rate >= 0  ? "bg-amber-400"
                      : "bg-red-400";
    const textColor   = rate >= 10 ? "text-green-600"
                      : rate >= 0  ? "text-amber-500"
                      : "text-red-500";

    return (
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        <div className="px-4 pt-4 pb-3">
          <div className="flex items-start justify-between">
            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Savings Rate</p>
            {monthLabel && <span className="text-[10px] text-gray-400">{monthLabel}</span>}
          </div>
          <div className="mt-1 flex items-end gap-2">
            <p className={`text-2xl font-bold tabular-nums ${textColor}`}>
              {isNeg ? "" : "+"}{rate}%
            </p>
            <p className="text-xs text-gray-400 mb-0.5">of income</p>
          </div>
          {/* Bar */}
          <div className="mt-2.5 h-1.5 w-full rounded-full bg-gray-100">
            <div className={`h-1.5 rounded-full transition-all ${color}`} style={{ width: `${barPct}%` }} />
          </div>
        </div>
        <div className="border-t border-gray-100 divide-y divide-gray-50">
          <div className="flex items-center justify-between px-4 py-2">
            <span className="text-xs text-gray-500">Income</span>
            <span className="text-xs font-semibold tabular-nums text-gray-800">{cad(income)}</span>
          </div>
          <div className="flex items-center justify-between px-4 py-2">
            <span className="text-xs text-gray-500">
              Expenses{includeDebt && debtPayments > 0 && (
                <span className="ml-1 text-gray-400">(+debt pmts)</span>
              )}
            </span>
            <span className="text-xs font-semibold tabular-nums text-gray-800">{cad(effectiveExpenses)}</span>
          </div>
          {/* Toggle — shown whenever min debt payment data exists (any month) */}
          {debtPayments > 0 && (
            <div className="flex items-center justify-between px-4 py-2 bg-gray-50/60">
              <span className="text-xs text-gray-500">
                Include min debt payments
                <span className="ml-1 text-gray-400">({cad(debtPayments)}/mo)</span>
              </span>
              <button
                onClick={() => setIncludeDebt((v) => !v)}
                className={`relative inline-flex h-4 w-8 shrink-0 rounded-full border-2 border-transparent transition-colors focus:outline-none ${
                  includeDebt ? "bg-indigo-500" : "bg-gray-200"
                }`}
                role="switch"
                aria-checked={includeDebt}
              >
                <span
                  className={`inline-block h-3 w-3 rounded-full bg-white shadow transform transition-transform ${
                    includeDebt ? "translate-x-4" : "translate-x-0"
                  }`}
                />
              </button>
            </div>
          )}
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

  const hasUpcoming = upcoming.length > 0;

  // Overdued payday items (cash-in overdue) — get special "Expected Payday" card
  const overduePaydays = upcoming.filter((i) => i.isOverdue && i.type === "cash-in");
  // Regular overdue non-payday
  const overdueOther   = upcoming.filter((i) => i.isOverdue && i.type !== "cash-in");
  // Upcoming sorted by impact (highest amount first)
  const upcomingByImpact = [...upcoming]
    .filter((i) => !i.isOverdue)
    .sort((a, b) => b.amount - a.amount);
  const UPCOMING_PREVIEW = 4;
  const upcomingVisible  = upcomingByImpact.slice(0, UPCOMING_PREVIEW);
  const upcomingHidden   = upcomingByImpact.length - UPCOMING_PREVIEW;

  // Freshness: count overdue accounts
  const overdueAccounts = freshness?.accounts.filter((a) => a.isOverdue) ?? [];

  // Month label for income/expenses

  return (
    <>
    <div className="mx-auto max-w-5xl px-4 pt-4 pb-8 sm:py-8 sm:px-6">

      {token && <ParseStatusBanner onRefresh={() => load(token)} />}
      {token && needsRefresh && (
        <RefreshToast token={token} onRefreshed={() => { setNeedsRefresh(false); load(token); }} />
      )}

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Today</h1>
          <p className="mt-0.5 text-sm text-gray-400">{todayLabel()}</p>
        </div>
        {/* Freshness CTA */}
        {overdueAccounts.length > 0 && (
          <Link href="/account/activity?tab=coverage"
            className="shrink-0 flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 shadow-sm hover:border-gray-300 hover:shadow-md transition">
            <span className="h-2 w-2 rounded-full bg-orange-400 shrink-0" />
            {overdueAccounts.length} statement{overdueAccounts.length > 1 ? "s" : ""} to upload
            <svg className="h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </Link>
        )}
      </div>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      {/* ── Two-column layout ────────────────────────────────────────────────── */}
      <div className="flex gap-5 items-start">

        {/* ── Main feed ─────────────────────────────────────────────────────── */}
        <div className="min-w-0 flex-1 space-y-3">

          {/* ── Net Worth + Income/Expenses hero card ────────────────────────── */}
          {netWorth && (
            <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
              <div className="px-5 pt-5 pb-4">
                {/* Top row: net worth left, income/expenses right (desktop only) */}
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">Net Worth</p>
                    <p className="text-4xl font-bold text-gray-900 tabular-nums tracking-tight">{fmt(netWorth.total)}</p>
                    <p className={`text-xs mt-1 font-medium ${netWorth.isStale ? "text-amber-500" : "text-gray-400"}`}>
                      {netWorth.calculatedLabel}
                    </p>
                  </div>
                  {savingsRate && savingsRate.income > 0 && (
                    <div className="hidden sm:flex gap-5 shrink-0 text-right">
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Income</p>
                        <p className="mt-0.5 text-base font-bold text-green-600 tabular-nums">{fmt(savingsRate.income)}</p>
                      </div>
                      <div>
                        <div className="flex items-center justify-end gap-1.5">
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Expenses</p>
                          {savingsRate.debtPayments > 0 && (
                            <button
                              onClick={() => setIncludeDebtInExpenses((v) => !v)}
                              title={includeDebtInExpenses ? "Excluding debt payments" : "Include debt payments"}
                              className={`relative inline-flex h-3.5 w-7 shrink-0 rounded-full border-2 border-transparent transition-colors focus:outline-none ${includeDebtInExpenses ? "bg-indigo-500" : "bg-gray-200"}`}
                              role="switch" aria-checked={includeDebtInExpenses}
                            >
                              <span className={`inline-block h-2.5 w-2.5 rounded-full bg-white shadow transform transition-transform ${includeDebtInExpenses ? "translate-x-3" : "translate-x-0"}`} />
                            </button>
                          )}
                        </div>
                        <p className="mt-0.5 text-base font-bold text-red-500 tabular-nums">
                          {fmt(savingsRate.expenses + (includeDebtInExpenses ? savingsRate.debtPayments : 0))}
                        </p>
                        {includeDebtInExpenses && savingsRate.debtPayments > 0 && (
                          <p className="text-[10px] text-gray-400">incl. {fmt(savingsRate.debtPayments)} debt pymts</p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
                {/* Mobile: income/expenses as a row below the net worth number */}
                {savingsRate && savingsRate.income > 0 && (
                  <div className="sm:hidden mt-3 flex gap-5 border-t border-gray-100 pt-3">
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Income</p>
                      <p className="mt-0.5 text-sm font-bold text-green-600 tabular-nums">{fmt(savingsRate.income)}</p>
                    </div>
                    <div>
                      <div className="flex items-center gap-1.5">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Expenses</p>
                        {savingsRate.debtPayments > 0 && (
                          <button
                            onClick={() => setIncludeDebtInExpenses((v) => !v)}
                            title={includeDebtInExpenses ? "Excluding debt payments" : "Include debt payments"}
                            className={`relative inline-flex h-3.5 w-7 shrink-0 rounded-full border-2 border-transparent transition-colors focus:outline-none ${includeDebtInExpenses ? "bg-indigo-500" : "bg-gray-200"}`}
                            role="switch" aria-checked={includeDebtInExpenses}
                          >
                            <span className={`inline-block h-2.5 w-2.5 rounded-full bg-white shadow transform transition-transform ${includeDebtInExpenses ? "translate-x-3" : "translate-x-0"}`} />
                          </button>
                        )}
                      </div>
                      <p className="mt-0.5 text-sm font-bold text-red-500 tabular-nums">
                        {fmt(savingsRate.expenses + (includeDebtInExpenses ? savingsRate.debtPayments : 0))}
                      </p>
                      {includeDebtInExpenses && savingsRate.debtPayments > 0 && (
                        <p className="text-[10px] text-gray-400">incl. {fmt(savingsRate.debtPayments)} debt pymts</p>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Status banner inline */}
              {statusBanner && (
                <button
                  onClick={() => setStatusOpen((v) => !v)}
                  className="w-full flex items-center gap-3 border-t border-gray-100 px-5 py-3 text-left hover:bg-gray-50/50 transition"
                >
                  <span className={`h-2 w-2 shrink-0 rounded-full ${statusBanner.type === "ok" ? "bg-green-400" : statusBanner.type === "alert" ? "bg-red-400" : "bg-orange-400"}`} />
                  <p className="flex-1 text-sm font-medium text-gray-700 min-w-0">{statusBanner.text}</p>
                  <Link href="/account/spending" onClick={(e) => e.stopPropagation()}
                    className="shrink-0 text-xs font-semibold text-purple-600 hover:underline whitespace-nowrap">
                    View breakdown →
                  </Link>
                </button>
              )}
              {statusOpen && statusBanner?.detail && (
                <div className="border-t border-gray-100 bg-gray-50/60 px-5 py-3">
                  <p className="text-xs text-gray-500 leading-relaxed">{statusBanner.detail}</p>
                </div>
              )}
            </div>
          )}

          {/* ── Expected Payday cards (overdue cash-in) ─────────────────────── */}
          {overduePaydays.map((item) => {
            const daysAgo = Math.abs(item.daysFromNow);
            return (
              <div key={item.id} className="rounded-2xl border border-orange-200 bg-white shadow-sm overflow-hidden">
                <div className="px-5 pt-4 pb-1 flex items-center gap-2">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-orange-500">Expected Payday</p>
                  <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-semibold text-orange-600">
                    {daysAgo}d ago
                  </span>
                  <span className="ml-auto text-lg font-bold text-green-600 tabular-nums">+{fmt(item.amount)}</span>
                </div>
                <div className="px-5 pb-4">
                  <div className="flex items-center gap-2 mt-1">
                    <p className="text-base font-bold text-gray-900">{item.title}</p>
                    {item.subtitle?.toLowerCase().includes("salary") && (
                      <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold text-blue-700">Salary</span>
                    )}
                  </div>
                  {item.subtitle && (
                    <p className="mt-0.5 text-xs text-gray-400">
                      {item.subtitle} · May be processing
                    </p>
                  )}
                  {item.href && (
                    <Link href={item.href} className="mt-2 inline-block text-xs font-semibold text-purple-600 hover:underline">
                      Mark as arrived →
                    </Link>
                  )}
                </div>
              </div>
            );
          })}

          {/* ── Radar / Cash Flow Pressure cards ─────────────────────────────── */}
          {visibleRadar.map((item) => {
            const isWarn = item.type === "warn";
            return (
              <div key={item.id} className={`rounded-2xl border shadow-sm overflow-hidden ${isWarn ? "border-amber-200 bg-white" : "border-green-200 bg-white"}`}>
                <div className="px-5 pt-4 pb-1 flex items-center gap-2">
                  <p className={`text-[10px] font-bold uppercase tracking-widest ${isWarn ? "text-amber-600" : "text-green-600"}`}>
                    {item.pill} · {item.when}
                  </p>
                  <span className="ml-auto text-base font-bold tabular-nums text-gray-800">{item.amount}</span>
                  <button
                    aria-label="Dismiss"
                    onClick={() => dismissRadar(item.id)}
                    className="shrink-0 text-gray-300 hover:text-gray-500 transition"
                  >
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                <div className="px-5 pb-4">
                  <p className="text-sm font-semibold text-gray-900">{item.title}</p>
                  <p className="mt-0.5 text-xs text-gray-400">{item.sub}</p>
                  {expandedRadar.has(item.id) && (
                    <div className="mt-2 border-t border-gray-100 pt-2 space-y-1">
                      {item.expand.breakdown.map((row, i) => (
                        <div key={i} className="flex justify-between text-xs">
                          <span className="text-gray-500">{row.label}</span>
                          <span className="font-semibold text-gray-800">{row.value}</span>
                        </div>
                      ))}
                      {item.expand.note && <p className="text-xs text-gray-500 mt-1">{item.expand.note}</p>}
                    </div>
                  )}
                  <button
                    onClick={() => toggleRadar(item.id)}
                    className="mt-1.5 text-xs font-medium text-gray-400 hover:text-gray-600"
                  >
                    {expandedRadar.has(item.id) ? "Less ↑" : "More →"}
                  </button>
                </div>
              </div>
            );
          })}

          {/* ── Overdue non-payday ───────────────────────────────────────────── */}
          {overdueOther.length > 0 && (
            <div className="rounded-2xl border border-red-200 bg-white shadow-sm overflow-hidden divide-y divide-gray-100">
              <p className="px-5 py-3 text-[10px] font-bold uppercase tracking-widest text-red-500">Overdue</p>
              {overdueOther.map((item) => (
                <UpcomingRow key={item.id} item={item} />
              ))}
            </div>
          )}

          {/* ── Upcoming · By Impact ─────────────────────────────────────────── */}
          {upcomingVisible.length > 0 && (
            <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
              <div className="px-5 py-3 flex items-center justify-between border-b border-gray-100">
                <div className="flex items-center gap-1.5">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Upcoming</p>
                  <span className="text-[10px] font-medium text-gray-400">· By Impact</span>
                </div>
                {upcomingHidden > 0 && !showAllUpcoming && (
                  <button
                    onClick={() => setShowAllUpcoming(true)}
                    className="text-[11px] font-semibold text-purple-600 hover:underline"
                  >
                    +{upcomingHidden} more
                  </button>
                )}
              </div>
              <div className="divide-y divide-gray-100">
                {(showAllUpcoming ? upcomingByImpact : upcomingVisible).map((item) => {
                  const { text, cls } = getDateLabel(item);
                  const row = (
                    <div className="flex items-center gap-3 px-5 py-3.5">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 min-w-0">
                          <p className="text-sm font-semibold text-gray-800 truncate">{item.title}</p>
                          {(item.subtitle?.toLowerCase().includes("salary") || item.subtitle?.toLowerCase().includes("payroll")) && (
                            <span className="shrink-0 rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold text-blue-700">Salary</span>
                          )}
                        </div>
                        {item.subtitle && (
                          <p className="text-xs text-gray-400 mt-0.5 truncate">{item.subtitle}</p>
                        )}
                      </div>
                      <div className="shrink-0 text-right">
                        <p className={`text-sm font-bold tabular-nums ${item.type === "cash-in" ? "text-green-600" : "text-gray-800"}`}>
                          {item.type === "cash-in" ? "+" : "−"}{fmt(item.amount)}
                        </p>
                        <p className={`text-xs mt-0.5 ${cls}`}>{text}</p>
                      </div>
                    </div>
                  );
                  return item.href
                    ? <Link key={item.id} href={item.href} className="block hover:bg-gray-50 transition">{row}</Link>
                    : <div key={item.id}>{row}</div>;
                })}
              </div>
              {showAllUpcoming && (
                <button
                  onClick={() => setShowAllUpcoming(false)}
                  className="w-full border-t border-gray-100 px-5 py-2.5 text-xs font-medium text-gray-400 hover:text-gray-600 text-center hover:bg-gray-50 transition"
                >
                  Show less ↑
                </button>
              )}
            </div>
          )}

          {/* Also-this-month strip (collapsed by default) */}
          {thisMonth.length > 0 && (
            <ThisMonthGroup items={thisMonth} ratePill={ratePill} />
          )}

          {/* Caught-up / getting-started panel */}
          {!hasUpcoming && visibleRadar.length === 0 && !statusBanner && (
            <GettingStartedPanel
              netWorth={netWorth}
              savingsRate={savingsRate}
              hasMultipleAccounts={(netWorth?.accounts?.length ?? 0) + (netWorth?.debtAccounts?.length ?? 0) > 1}
            />
          )}

          <FeaturePreviewSection upcoming={upcoming} />
        </div>

        {/* ── Right sidebar ─────────────────────────────────────────────────── */}
        <div className="hidden lg:block w-72 shrink-0">
          <div className="sticky top-6 space-y-3">

            {/* ── Accounts ───────────────────────────────────────────────────── */}
            {netWorth && (
              <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
                <p className="px-4 pt-4 pb-2 text-[10px] font-bold uppercase tracking-widest text-gray-400">Accounts</p>

                {/* Assets */}
                {(netWorth.accounts ?? []).length > 0 && (
                  <div className="border-t border-gray-100">
                    <p className="px-4 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400">Assets</p>
                    <div className="divide-y divide-gray-50">
                      {netWorth.accounts.map((acc, i) => (
                        <div key={i} className="flex items-center justify-between px-4 py-2">
                          <span className="text-xs text-gray-600 truncate mr-2">{acc.label}</span>
                          <span className={`text-xs font-semibold tabular-nums shrink-0 ${acc.isEstimated ? "text-gray-400" : "text-gray-800"}`}>
                            {new Intl.NumberFormat("en-CA", { maximumFractionDigits: 0 }).format(Math.abs(acc.value))}
                            {acc.isEstimated && <span className="ml-1 text-[10px] font-normal text-gray-400">est</span>}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Liabilities */}
                {(netWorth.debtAccounts ?? []).length > 0 && (
                  <div className="border-t border-gray-100 mt-1">
                    <p className="px-4 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400">Liabilities</p>
                    <div className="divide-y divide-gray-50">
                      {netWorth.debtAccounts.map((acc, i) => (
                        <div key={i} className="flex items-center justify-between px-4 py-2">
                          <span className="text-xs text-gray-600 truncate mr-2">{acc.label}</span>
                          <span className="text-xs font-semibold tabular-nums shrink-0 text-red-500">
                            −{new Intl.NumberFormat("en-CA", { maximumFractionDigits: 0 }).format(Math.abs(acc.value))}
                          </span>
                        </div>
                      ))}
                    </div>
                    {/* High-APR inline warning */}
                    {alerts.some((a) => a.type === "cc_interest") && (() => {
                      const a = alerts.find((al) => al.type === "cc_interest")!;
                      return (
                        <div className="mx-3 mb-3 mt-1 rounded-lg bg-red-50 px-3 py-2">
                          <p className="text-[11px] font-medium text-red-700 leading-snug">{a.body}</p>
                        </div>
                      );
                    })()}
                  </div>
                )}

                <Link href="/account/liabilities"
                  className="flex items-center justify-center gap-1 border-t border-gray-100 px-4 py-2.5 text-xs font-semibold text-gray-500 hover:text-gray-700 hover:bg-gray-50 transition">
                  Show all {(netWorth.accounts?.length ?? 0) + (netWorth.debtAccounts?.length ?? 0)} accounts →
                </Link>
              </div>
            )}

            {/* Savings rate mini-card */}
            <SavingsRateCard />

            {/* ── Signals ───────────────────────────────────────────────────── */}
            {agentCards.length > 0 && (
              <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
                <div className="px-4 pt-4 pb-2 flex items-center gap-2 border-b border-gray-100">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Signals</p>
                  <span className="ml-auto rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-bold text-gray-500">
                    {agentCards.length}
                  </span>
                </div>
                <div className="divide-y divide-gray-100">
                  {agentCards.map((card) => {
                    const isExternal = card.source === "external";
                    return (
                      <div key={card.id} className="px-4 py-3">
                        <div className="flex items-center gap-1.5 mb-1">
                          <span className="h-1.5 w-1.5 rounded-full bg-purple-500 shrink-0" />
                          <span className="text-[10px] font-bold text-purple-600 uppercase tracking-wider">
                            {isExternal ? "Market Signal" : "AI Insight"}
                          </span>
                          <button
                            onClick={() => dismissCard(card.id)}
                            className="ml-auto shrink-0 text-gray-300 hover:text-gray-500 transition"
                          >
                            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                        <p className="text-[13px] font-semibold text-gray-900 leading-snug">{card.title}</p>
                        <p className="mt-1 text-[12px] text-gray-500 leading-relaxed line-clamp-2">{card.body}</p>
                        <div className="mt-1.5 flex items-center gap-3">
                          <button
                            onClick={() => toggleAlert(card.id)}
                            className="text-[11px] font-medium text-gray-400 hover:text-gray-600"
                          >
                            {expandedAlerts.has(card.id) ? "Less" : "More →"}
                          </button>
                          {card.href && (
                            <Link href={card.href} className="text-[11px] font-semibold text-purple-600 hover:underline">
                              {isExternal ? "Source ↗" : "View →"}
                            </Link>
                          )}
                        </div>
                        {expandedAlerts.has(card.id) && (
                          <p className="mt-1.5 text-[12px] text-gray-500 leading-relaxed">{card.body}</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

          </div>
        </div>

      </div>

      {/* ── Mobile: horizontal scroll strip for accounts + signals ──────────── */}
      <div className="lg:hidden mt-5 -mx-4 px-4">
        <div className="flex gap-3 overflow-x-auto pb-2 snap-x snap-mandatory scrollbar-hide">
          <div className="snap-start shrink-0 w-64">
            <MobileCardShell><NetWorthCard /></MobileCardShell>
          </div>
          {savingsRate && savingsRate.income > 0 && (
            <div className="snap-start shrink-0 w-64">
              <MobileCardShell><SavingsRateCard /></MobileCardShell>
            </div>
          )}
          {agentCards.map((card) => (
            <div key={card.id} className="snap-start shrink-0 w-64">
              <MobileCardShell><SidebarSignalCard card={card} /></MobileCardShell>
            </div>
          ))}
        </div>
      </div>

    </div>

    {/* Onboarding modal */}
    {showOnboarding && (
      <OnboardingModal
        radar={radar}
        onDismiss={() => {
          localStorage.setItem(DISMISS_KEY, "1");
          setShowOnboarding(false);
        }}
      />
    )}
    </>
  );
}
