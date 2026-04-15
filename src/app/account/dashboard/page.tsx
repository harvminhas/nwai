"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseClient } from "@/lib/firebase";
import type { DashboardAlert, UpcomingItem, TodayInsight } from "@/app/api/user/insights/route";
import type { AgentCard } from "@/lib/agentTypes";
import type { RadarItem, FreshnessData, NetWorthSnapshot } from "@/lib/today/types";
import ParseStatusBanner, { addPendingParse } from "@/components/ParseStatusBanner";
import PromoDashboardBanner from "@/components/PromoDashboardBanner";
import UploadZone from "@/components/UploadZone";
import RefreshToast from "@/components/RefreshToast";
import { fmt } from "@/lib/currencyUtils";
import { usePlan } from "@/contexts/PlanContext";
import { useActiveProfile } from "@/contexts/ActiveProfileContext";

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

function UpcomingRow({ item, muted = false, ratePill, homeCurrency = "USD" }: { item: UpcomingItem; muted?: boolean; ratePill?: RatePill; homeCurrency?: string }) {
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
          {item.type === "cash-in" ? "+" : "−"}{fmt(item.amount, homeCurrency)}
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

function UpcomingGroup({ title, items, emptySlot, ratePill, homeCurrency = "USD" }: { title: string; items: UpcomingItem[]; emptySlot?: React.ReactNode; ratePill?: RatePill; homeCurrency?: string }) {
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
            <UpcomingRow key={item.id} item={item} ratePill={item.type === "debt" ? ratePill : undefined} homeCurrency={homeCurrency} />
          ))}
        </div>
      )}
    </div>
  );
}

function ThisMonthGroup({ items, ratePill, homeCurrency = "USD" }: { items: UpcomingItem[]; ratePill?: RatePill; homeCurrency?: string }) {
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
              <UpcomingRow key={item.id} item={item} ratePill={item.type === "debt" ? ratePill : undefined} homeCurrency={homeCurrency} />
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
                {past.map((item) => <UpcomingRow key={item.id} item={item} muted homeCurrency={homeCurrency} />)}
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
                { icon: "💰", label: "Salary / payroll",    sub: "Recurring · bi-weekly", value: "+$3,200", color: "bg-green-100" },
                { icon: "🔄", label: "GoodLife Clubs",      sub: "Recurring · monthly",   value: "−$12",    color: "bg-purple-100" },
                { icon: "🏠", label: "Rent / mortgage",     sub: "Recurring · monthly",   value: "−$2,400", color: "bg-amber-100" },
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
                { icon: "📋", label: "Visa ····1234 minimum",  sub: "Est. minimum · $8,500 balance",  value: "−$170", color: "bg-red-100" },
                { icon: "📋", label: "Mastercard ····5678",    sub: "Est. minimum · $4,200 balance",  value: "−$84",  color: "bg-red-100" },
                { icon: "🔄", label: "Netflix.com",            sub: "Recurring · monthly",            value: "−$18",  color: "bg-purple-100" },
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

// ── Zero-statements layout (no data yet) ─────────────────────────────────────

const EXAMPLE_INSIGHTS = [
  {
    priority: "high",
    title: "$340/mo in subscriptions you may have forgotten",
    body: "We found 11 recurring charges across 3 accounts. 4 of them haven't been used in over 60 days based on your statement patterns.",
  },
  {
    priority: "medium",
    title: "Your salary arrives biweekly — but April has 3 paydays",
    body: "Some months have an extra payday due to how the calendar falls. We flag these in advance so you can plan around them.",
  },
  {
    priority: "low",
    title: "You're saving 38% of your income without realising it",
    body: "After all expenses and debt payments, your net savings rate is strong. Most Canadians save less than 5%. You're well ahead.",
  },
];

const HOW_IT_WORKS = [
  {
    n: "1",
    title: "Download a PDF from your bank",
    body: "Log into your bank's website and export last month's statement as a PDF.",
  },
  {
    n: "2",
    title: "Drop it here — we do the rest",
    body: "We parse your transactions, categorise your spending, and detect recurring patterns automatically.",
  },
  {
    n: "3",
    title: "Get insights in under a minute",
    body: "Your Today page populates with real findings from your actual finances — not generic tips.",
  },
];

function ZeroStatementsLayout({ token, onUploaded, homeCurrency = "USD" }: { token: string | null; onUploaded: () => void; homeCurrency?: string }) {
  const [uploadError,   setUploadError]   = useState<string | null>(null);
  const [uploading,     setUploading]     = useState(false);
  const [uploadedName,  setUploadedName]  = useState<string | null>(null);

  async function handleFileSelect(file: File) {
    if (!token) return;
    setUploading(true); setUploadError(null);
    const formData = new FormData();
    formData.append("file", file);
    try {
      const res  = await fetch("/api/upload", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: formData });
      const data = await res.json();
      if (res.status === 409 && data.error === "duplicate") { onUploaded(); return; }
      if (!res.ok) { setUploadError(data.error || "Upload failed. Please try again."); return; }
      const sid = data.statementId as string;
      setUploadedName(file.name);
      addPendingParse(sid, file.name);
      fetch("/api/parse", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ statementId: sid }) }).catch(() => {});
      onUploaded();
    } catch {
      setUploadError("Upload failed. Please try again.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="flex gap-5 items-start">

      {/* ── Main column ──────────────────────────────────────────────────────── */}
      <div className="min-w-0 flex-1 space-y-4">

        {/* Upload hero */}
        <div className="rounded-2xl border border-gray-200 bg-white shadow-sm p-8">
          <div className="text-center mb-6">
            <h2 className="text-2xl font-bold text-gray-900 leading-snug mb-2">
              Upload a bank statement.<br />See your finances clearly.
            </h2>
            <p className="text-sm text-gray-500 leading-relaxed max-w-sm mx-auto">
              No bank login. No open banking. Just upload a PDF statement and we&apos;ll analyse it instantly — spending, income, patterns, and insights.
            </p>
          </div>

          {uploadedName ? (
            /* Success state — analysis kicked off */
            <div className="rounded-xl border border-green-200 bg-green-50 px-6 py-5 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-100 mx-auto mb-3">
                <svg className="h-6 w-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <p className="text-sm font-semibold text-gray-900">Statement uploaded!</p>
              <p className="mt-1 text-xs text-gray-500">
                AI analysis is running in the background — usually 30–60 seconds.
                Your dashboard will update automatically.
              </p>
            </div>
          ) : (
            <>
              <UploadZone onFileSelect={handleFileSelect} disabled={uploading} />
              {uploading && (
                <div className="mt-3 flex items-center justify-center gap-2 text-sm text-purple-600">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-purple-600 border-t-transparent" />
                  Uploading…
                </div>
              )}
              {uploadError && (
                <p className="mt-3 text-center text-sm text-red-600">{uploadError}</p>
              )}
            </>
          )}

          <p className="mt-4 flex items-center justify-center gap-4 text-[11px] text-gray-400">
            <span className="flex items-center gap-1">
              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
              Encrypted
            </span>
            <span>·</span>
            <span>Private to your account</span>
            <span>·</span>
            <span>No bank credentials needed</span>
          </p>
        </div>

        {/* Example insights */}
        <div className="space-y-3">
          <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">What people typically discover</p>
          {EXAMPLE_INSIGHTS.map((card, i) => {
            const { dot, label } = priorityLabel(card.priority);
            const border = priorityBorder(card.priority);
            return (
              <div key={i} className={`rounded-xl border border-gray-100 bg-white shadow-sm overflow-hidden ${border}`}>
                <div className="px-5 py-4">
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-1.5">
                      <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${dot}`} />
                      <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">{label}</span>
                    </div>
                    <span className="rounded border border-gray-200 px-1.5 py-0.5 text-[10px] font-medium text-gray-400">example</span>
                  </div>
                  <p className="text-sm font-semibold text-gray-900 mb-1">{card.title}</p>
                  <p className="text-xs text-gray-500 leading-relaxed">{card.body}</p>
                </div>
              </div>
            );
          })}
        </div>

        {/* How it works */}
        <div className="rounded-xl border border-gray-100 bg-white shadow-sm p-5 space-y-4">
          <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">How it works</p>
          {HOW_IT_WORKS.map((step) => (
            <div key={step.n} className="flex items-start gap-4">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 border-gray-200 bg-white">
                <span className="text-xs font-bold text-gray-500">{step.n}</span>
              </div>
              <div className="pt-0.5">
                <p className="text-sm font-semibold text-gray-800">{step.title}</p>
                <p className="text-xs text-gray-400 mt-0.5 leading-relaxed">{step.body}</p>
              </div>
            </div>
          ))}
        </div>

      </div>

      {/* ── Right sidebar ────────────────────────────────────────────────────── */}
      <div className="hidden lg:block w-72 shrink-0 space-y-4">

        {/* Net Worth placeholder */}
        <div className="rounded-2xl border border-gray-200 bg-white shadow-sm p-5">
          <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">Net Worth</p>
          <p className="text-3xl font-bold text-gray-400 tabular-nums">{homeCurrency === "CAD" ? "CA$" : "US$"}—</p>
          <div className="mt-3 rounded-lg bg-gray-50 px-3 py-2.5">
            <p className="text-xs text-gray-500 leading-relaxed">
              Upload statements from chequing, savings, credit cards, and investments to calculate your net worth.
            </p>
          </div>
        </div>

        {/* After your first upload */}
        <div className="rounded-2xl border border-gray-200 bg-white shadow-sm p-4 space-y-3">
          <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">After your first upload</p>
          <div className="space-y-2">
            {[
              "AI-generated insights from your real spending",
              "Your savings rate vs income",
              "Recurring subscriptions and bills detected",
              "Top spending categories broken down",
            ].map((f) => (
              <div key={f} className="flex items-start gap-2.5">
                <div className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded-full border-2 border-gray-200 bg-white" />
                <span className="text-[11px] text-gray-400 leading-snug">{f}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Privacy first */}
        <div className="rounded-2xl border border-gray-200 bg-white shadow-sm p-4 space-y-3">
          <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Privacy first</p>
          <div className="space-y-2">
            {[
              "No bank login or open banking required",
              "Statements are parsed then discarded — raw files not stored",
              "Your data is never sold or used for advertising",
            ].map((f) => (
              <div key={f} className="flex items-start gap-2.5">
                <svg className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
                <span className="text-[11px] text-gray-500 leading-snug">{f}</span>
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}

// ── First-time user layout ────────────────────────────────────────────────────

type AgentCardShape = {
  id: string; priority: string; title: string; body: string; href?: string | null; source?: string;
};

function priorityLabel(priority: string): { dot: string; label: string } {
  if (priority === "high")   return { dot: "bg-red-500",    label: "HIGH PRIORITY" };
  if (priority === "medium") return { dot: "bg-amber-500",  label: "WORTH REVIEWING" };
  return                            { dot: "bg-blue-400",   label: "OPPORTUNITY" };
}

function priorityBorder(priority: string): string {
  if (priority === "high")   return "border-l-4 border-l-red-400";
  if (priority === "medium") return "border-l-4 border-l-amber-400";
  return                            "border-l-4 border-l-blue-400";
}

function shortMonth(ym: string) {
  if (!ym) return "";
  const [y, m] = ym.split("-");
  const date = new Date(parseInt(y), parseInt(m) - 1, 1);
  return date.toLocaleDateString("en-CA", { month: "short", year: "numeric" });
}

function savingsSummary(income: number, expenses: number, debtPayments: number, rate: number, month: string, homeCurrency = "USD"): string {
  // rate is already an integer percentage (e.g. 54 for 54%)
  // Use core expenses (no debt) for the "saved" figure to match SavingsRateCard default
  const saved = income - expenses;
  if (saved <= 0 || income <= 0) return "";
  const aboveAvg = rate >= 20;
  const mo = shortMonth(month);
  return `You saved ${fmt(saved, homeCurrency)} in ${mo} — putting away ${rate}% of your income.${aboveAvg ? " That's above average." : ""}`;
}

interface FirstTimeProps {
  agentCards: AgentCardShape[];
  netWorth: import("@/lib/today/types").NetWorthSnapshot | null;
  topSpending: { category: string; amount: number }[];
  statementCount: number;
  monthCount: number;
  savingsMonth: string;
  /** The SavingsRateCard component rendered by TodayPage — guarantees identical logic */
  savingsRateCard: React.ReactNode;
  /** Raw numbers for the summary sentence */
  savingsRaw: { income: number; expenses: number; debtPayments: number; rate: number; month: string } | null;
  homeCurrency: string;
}

function FirstTimeLayout({ agentCards, netWorth, topSpending, statementCount, monthCount, savingsMonth, savingsRateCard, savingsRaw, homeCurrency }: FirstTimeProps) {
  const month = savingsMonth;
  const summary = savingsRaw
    ? savingsSummary(savingsRaw.income, savingsRaw.expenses, savingsRaw.debtPayments, savingsRaw.rate, savingsRaw.month, homeCurrency)
    : "";

  // Feature unlock tiers
  const features = [
    { label: "Spending analysis",        unlocked: statementCount >= 1 },
    { label: "AI insights",              unlocked: agentCards.length > 0 },
    { label: "Recurring predictions",    unlocked: statementCount >= 2 },
    { label: "Trend charts",             unlocked: statementCount >= 3 },
    { label: "Net worth history",        unlocked: statementCount >= 3 },
  ];

  const statementsNeeded = statementCount === 0 ? 3 : statementCount === 1 ? 2 : 1;

  return (
    <div className="flex gap-5 items-start">

      {/* ── Main column ──────────────────────────────────────────────────────── */}
      <div className="min-w-0 flex-1 space-y-4">

        {/* Status banner */}
        <div className="rounded-xl border border-green-200 bg-green-50 px-5 py-4 flex items-start justify-between gap-4">
          <div className="flex items-start gap-3 min-w-0">
            <svg className="h-5 w-5 shrink-0 text-green-500 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-green-800">
                {statementCount === 1 ? "Your first statement has been analysed" : `${statementCount} statements analysed`}
              </p>
              <p className="text-xs text-green-700 mt-0.5">
                {statementCount === 1
                  ? "Here\u2019s what we found. Upload more months to unlock trends and predictions."
                  : `Here\u2019s what we found so far. Upload ${statementsNeeded} more to unlock full trends and predictions.`}
              </p>
            </div>
          </div>
          <Link href="/upload"
            className="shrink-0 rounded-lg border border-green-300 bg-white px-3 py-1.5 text-xs font-semibold text-green-700 hover:bg-green-50 transition whitespace-nowrap">
            + Upload another →
          </Link>
        </div>

        {/* What We Found — reuses SavingsRateCard (identical logic to mature layout) */}
        {savingsRateCard && (
          <div className="space-y-1">
            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
              What we found · {shortMonth(month).toUpperCase()}
            </p>
            {savingsRateCard}
            {summary && (
              <p className="text-sm text-gray-600 leading-relaxed pt-2">{summary}</p>
            )}
          </div>
        )}

        {/* What We Noticed (AI signals) */}
        {agentCards.length > 0 && (
          <div className="space-y-3">
            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">What we noticed</p>
            {agentCards.map((card) => {
              const { dot, label } = priorityLabel(card.priority);
              const border = priorityBorder(card.priority);
              return (
                <div key={card.id} className={`rounded-xl border border-gray-100 bg-white shadow-sm overflow-hidden ${border}`}>
                  <div className="px-5 py-4">
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${dot}`} />
                      <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">{label}</span>
                    </div>
                    <p className="text-sm font-semibold text-gray-900 mb-1">{card.title}</p>
                    <p className="text-xs text-gray-500 leading-relaxed">{card.body}</p>
                    {card.href && (
                      <Link href={card.href} className="mt-2 inline-block text-xs font-semibold text-purple-600 hover:underline">
                        {card.source === "external" ? "Source ↗" : "Explore →"}
                      </Link>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Unlocks with more statements */}
        <div className="rounded-xl border border-dashed border-gray-200 bg-white p-5 space-y-3">
          <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Unlocks with more statements</p>
          <div className="space-y-3">
            {[
              { label: "Upcoming bills & salary predictions", sub: "Needs 2+ months to detect recurring patterns" },
              { label: "Spending trends & anomalies",         sub: "Typical spend comparison unlocks with history" },
              { label: "Net worth over time",                 sub: "Track growth across all accounts month by month" },
            ].map((item) => (
              <div key={item.label} className="flex items-start gap-3">
                <div className="mt-0.5 h-4 w-4 shrink-0 rounded-full border-2 border-gray-200 bg-white" />
                <div>
                  <p className="text-xs font-medium text-gray-700">{item.label}</p>
                  <p className="text-[11px] text-gray-400 mt-0.5">{item.sub}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="pt-1 flex items-center justify-between border-t border-gray-100">
            <p className="text-xs text-gray-500">
              Upload {statementsNeeded === 1 ? "1 more statement" : `${statementsNeeded} more statements`} to unlock predictions and trend analysis
            </p>
            <Link href="/upload"
              className="shrink-0 ml-4 rounded-lg bg-gray-900 px-4 py-2 text-xs font-semibold text-white hover:bg-gray-700 transition">
              Upload now →
            </Link>
          </div>
        </div>

      </div>

      {/* ── Right sidebar ────────────────────────────────────────────────────── */}
      <div className="hidden lg:block w-72 shrink-0 space-y-4">

        {/* Net Worth */}
        {netWorth && (
          <div className="rounded-2xl border border-gray-200 bg-white shadow-sm p-5">
            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">Net Worth</p>
            <p className="text-3xl font-bold text-gray-900 tabular-nums">{fmt(netWorth.total, homeCurrency)}</p>
            {netWorth.fxRatesApplied && Object.keys(netWorth.fxRatesApplied).length > 0 && (
              <p className="text-[10px] text-gray-400 mt-0.5">
                {Object.entries(netWorth.fxRatesApplied)
                  .map(([ccy, rate]) => `1 ${ccy} = ${rate.toFixed(4)} ${netWorth.homeCurrency}`)
                  .join(" · ")}
              </p>
            )}
            {(netWorth.accounts?.length ?? 0) + (netWorth.debtAccounts?.length ?? 0) === 1 && (
              <p className="text-xs text-gray-400 mt-1.5 leading-snug">
                Based on 1 account · chequing balance only. Add more accounts for a complete picture.
              </p>
            )}
            <Link href="/account/overview" className="mt-3 block text-xs font-semibold text-gray-500 hover:text-gray-800">
              Show all {(netWorth.accounts?.length ?? 0) + (netWorth.debtAccounts?.length ?? 0)} account{((netWorth.accounts?.length ?? 0) + (netWorth.debtAccounts?.length ?? 0)) !== 1 ? "s" : ""} →
            </Link>
          </div>
        )}

        {/* Top Spending */}
        {topSpending.length > 0 && (
          <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-4 pt-4 pb-2">
              <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
                Top Spending · {shortMonth(month).replace(" ", " ").toUpperCase()}
              </p>
            </div>
            <div className="divide-y divide-gray-50 pb-1">
              {topSpending.map((s) => (
                <div key={s.category} className="flex items-center justify-between px-4 py-2.5">
                  <span className="text-xs text-gray-600">{s.category}</span>
                  <span className="text-xs font-semibold text-gray-800 tabular-nums">{fmt(s.amount, homeCurrency)}</span>
                </div>
              ))}
            </div>
            <Link href="/account/spending"
              className="flex items-center justify-center gap-1 border-t border-gray-100 px-4 py-2.5 text-xs font-semibold text-gray-500 hover:text-gray-700 hover:bg-gray-50 transition">
              View full breakdown →
            </Link>
          </div>
        )}

        {/* Your Data */}
        <div className="rounded-2xl border border-gray-200 bg-white shadow-sm p-4 space-y-3">
          <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Your Data</p>
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-600">Statements uploaded</span>
            <span className="text-xs font-bold text-gray-900">{statementCount}</span>
          </div>
          <p className="text-[11px] text-gray-400 leading-snug">
            Upload {statementsNeeded === 1 ? "2–3 more statements" : statementsNeeded === 2 ? "1–2 more statements" : "a few more statements"} to unlock predictions and trend analysis.
          </p>
          <div className="space-y-1.5 pt-1">
            {features.map((f) => (
              <div key={f.label} className="flex items-center gap-2">
                <div className={`h-3.5 w-3.5 shrink-0 rounded-full border-2 transition-colors ${f.unlocked ? "bg-green-400 border-green-400" : "bg-white border-gray-200"}`} />
                <span className={`text-[11px] ${f.unlocked ? "text-gray-700 font-medium" : "text-gray-400"}`}>{f.label}</span>
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}

// ── Events widget (dashboard sidebar) ────────────────────────────────────────

import type { EventSummary, EventColor } from "@/lib/events/types";
import { EVENT_COLORS } from "@/lib/events/types";

function evColorCfg(color: EventColor) {
  return EVENT_COLORS.find((c) => c.id === color) ?? EVENT_COLORS[0];
}

function EventsWidget({ events, homeCurrency = "USD" }: { events: EventSummary[]; homeCurrency?: string }) {
  if (events.length === 0) return null;
  return (
    <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-4 pt-4 pb-2 border-b border-gray-100">
        <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Events</p>
        <Link href="/account/events" className="text-[11px] font-semibold text-purple-600 hover:underline">
          All →
        </Link>
      </div>
      <div className="divide-y divide-gray-50">
        {events.map((ev) => {
          const cfg = evColorCfg(ev.color);
          const pct = ev.budget ? Math.min(100, Math.round((ev.totalSpent / ev.budget) * 100)) : null;
          const daysAway = ev.date
            ? Math.round((new Date(ev.date + "T00:00:00").getTime() - Date.now()) / 86400000)
            : null;
          return (
            <Link key={ev.id} href={`/account/events/${ev.id}`} className="block px-4 py-3 hover:bg-gray-50 transition">
              <div className="flex items-center gap-2.5 mb-1.5">
                <span className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${cfg.bg} text-sm`}>🗓</span>
                <p className="text-xs font-semibold text-gray-800 truncate flex-1">{ev.name}</p>
                {daysAway != null && daysAway >= 0 && daysAway <= 30 && (
                  <span className="shrink-0 text-[10px] font-bold text-amber-600 bg-amber-50 rounded-full px-1.5 py-0.5">
                    {daysAway === 0 ? "Today" : `${daysAway}d`}
                  </span>
                )}
              </div>
              <div className="flex items-center justify-between gap-2 text-[11px]">
                <span className="text-gray-500">{fmt(ev.totalSpent, homeCurrency)} spent</span>
                {ev.budget && (
                  <span className={`font-medium ${pct != null && pct >= 100 ? "text-red-500" : "text-gray-400"}`}>
                    {pct}% of {fmt(ev.budget, homeCurrency)}
                  </span>
                )}
              </div>
              {pct != null && (
                <div className="mt-1.5 h-1 w-full rounded-full bg-gray-100">
                  <div
                    className={`h-1 rounded-full ${pct >= 100 ? "bg-red-400" : cfg.bg}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

export default function TodayPage() {
  const router = useRouter();
  const { planId } = usePlan();
  const { targetUid, buildHeaders } = useActiveProfile();
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
  const [sigExpanded,      setSigExpanded]      = useState(false);
  const [statusOpen,       setStatusOpen]       = useState(false);
  const [showOnboarding,   setShowOnboarding]   = useState(false);
  const [showAllUpcoming,      setShowAllUpcoming]      = useState(false);
  const [includeDebtInExpenses, setIncludeDebtInExpenses] = useState(false);
  const [activeEvents, setActiveEvents] = useState<import("@/lib/events/types").EventSummary[]>([]);
  const [monthCount,   setMonthCount]   = useState<number>(0);
  const [statementCount, setStatementCount] = useState<number>(0);
  const [topSpending,  setTopSpending]  = useState<{ category: string; amount: number }[]>([]);
  const [confirmedCountry, setConfirmedCountry] = useState<"CA" | "US" | null>(null);
  const [detectedCountry,  setDetectedCountry]  = useState<"CA" | "US">("US");
  const [countryConfirming, setCountryConfirming] = useState(false);
  const [homeCurrency, setHomeCurrency] = useState<string>("USD");
  const [currencyInfo, setCurrencyInfo] = useState<{
    homeCurrency: string;
    showExchange: boolean;
    cadPerUsd: number | null;
    usdPerCad: number | null;
    rateDate: string | null;
  } | null>(null);

  async function confirmCountry(country: "CA" | "US") {
    if (!token) return;
    setCountryConfirming(true);
    try {
      await fetch("/api/user/profile", {
        method: "PATCH",
        headers: { ...buildHeaders(token), "Content-Type": "application/json" },
        body: JSON.stringify({ country }),
      });
      setConfirmedCountry(country);
    } catch { /* silent — user can retry */ }
    finally { setCountryConfirming(false); }
  }

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
      const headers = buildHeaders(tok);
      const [insRes, cardRes, fxRes] = await Promise.all([
        fetch("/api/user/insights",       { headers }),
        fetch("/api/user/agent-insights", { headers }),
        fetch("/api/user/currency-info",  { headers }),
      ]);
      const insJson  = await insRes.json().catch(() => ({}));
      const cardJson = await cardRes.json().catch(() => ({}));
      const fxJson   = await fxRes.json().catch(() => ({}));
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
      setMonthCount(insJson.monthCount ?? 0);
      setStatementCount(insJson.statementCount ?? 0);
      setTopSpending(insJson.topSpending ?? []);
      setConfirmedCountry(cardJson.confirmedCountry ?? null);
      setDetectedCountry(cardJson.detectedCountry ?? "US");
      // homeCurrency from profile (authoritative after schema v27 rebuild).
      // Fall back to the confirmed/detected country so the symbol is never wrong.
      const resolvedCountry = (cardJson.confirmedCountry ?? cardJson.detectedCountry ?? "US") as "CA" | "US";
      setHomeCurrency(insJson.homeCurrency ?? (resolvedCountry === "CA" ? "CAD" : "USD"));
      if (fxJson.homeCurrency) setCurrencyInfo(fxJson);
    } catch { setError("Failed to load today view"); }
    finally { setLoading(false); }
  }, [buildHeaders]);

  const handleRefresh = useCallback(async () => {
    if (!token) return;
    setRefreshing(true);
    try {
      await fetch("/api/user/insights/generate", {
        method: "POST",
        headers: { ...buildHeaders(token), "Content-Type": "application/json" },
        body: JSON.stringify({ event: "full.refresh" }),
      });
      await load(token);
    } catch { /* silent */ }
    finally { setRefreshing(false); }
  }, [token, load, buildHeaders]);

  useEffect(() => {
    const { auth } = getFirebaseClient();
    return onAuthStateChanged(auth, async (user) => {
      if (!user) { router.push("/login"); return; }
      const tok = await user.getIdToken();
      setToken(tok);
      load(tok);
    });
  }, [router, load]);

  // Re-load when the active profile switches (own ↔ shared account)
  useEffect(() => {
    if (token) load(token);
  // targetUid is the only thing that should trigger this — token changes are handled above
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetUid]);

  // Load active events independently (lightweight, doesn't block the main page)
  useEffect(() => {
    if (!token) return;
    fetch("/api/user/events", { headers: buildHeaders(token) })
      .then((r) => r.json())
      .then((j) => {
        const now = new Date().toISOString().slice(0, 10);
        const in30 = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
        // Surface events that are upcoming (date within 30 days) or have budget >75% used
        const surface = (j.events ?? []).filter((ev: import("@/lib/events/types").EventSummary) => {
          if (ev.date && ev.date >= now && ev.date <= in30) return true;
          if (ev.budget && ev.totalSpent / ev.budget >= 0.75) return true;
          if (!ev.date && !ev.budget) return true; // always show events with no date/budget
          return false;
        }).slice(0, 5);
        setActiveEvents(surface);
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, targetUid]);

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
      headers: { ...buildHeaders(token), "Content-Type": "application/json" },
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

    const cad = (n: number) => fmt(n, homeCurrency);

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


  // ── MarketSignalCard — rich card for external/market data signals ─────────────
  function MarketSignalCard({ card, onDismiss }: { card: AgentCard; onDismiss?: () => void }) {
    const c = card as AgentCard & Record<string, unknown>;

    // Derive source label from dataType — more reliable than the stored dataSource field
    function sourceLabel(dataType: string | undefined): string {
      switch (dataType) {
        case "canada-overnight-rate":
        case "canada-prime-rate":   return "Bank of Canada";
        case "canada-cpi":          return "CPI · Canada";
        case "canada-food-cpi":     return "Food CPI · Canada";
        case "us-federal-funds-rate": return "Federal Reserve";
        case "us-cpi":              return "CPI · USA";
        case "us-food-cpi":         return "Food CPI · USA";
        default:                    return "Market Data";
      }
    }

    const dataSource  = sourceLabel(card.dataType);
    // Derive period from releaseDate if dataPeriod field isn't stored yet
    const rawPeriod = (c.dataPeriod as string | undefined);
    const dataPeriod = rawPeriod ?? (() => {
      const rel = card.releaseDate ?? "";
      if (!rel) return "";
      const d = new Date(rel + (rel.length === 7 ? "-01" : "") + "T12:00:00Z");
      return isNaN(d.getTime()) ? rel : d.toLocaleDateString("en-CA", { month: "short", year: "numeric" }).toUpperCase();
    })();
    const inflationPct = typeof c.inflationPct === "number" ? c.inflationPct : null;
    const userSpendPct = typeof c.userSpendPct === "number" ? c.userSpendPct : null;
    const rateCurrent  = typeof c.rateCurrent  === "number" ? c.rateCurrent  : null;
    const rateDelta    = typeof c.rateDelta    === "number" ? c.rateDelta    : null;
    const rateDirection = c.rateDirection as string | undefined;
    const monthlyImpact = typeof c.monthlyImpact === "number" ? c.monthlyImpact : null;
    const isCpi  = card.dataType === "canada-cpi" || card.dataType === "us-cpi"
                 || card.dataType === "canada-food-cpi" || card.dataType === "us-food-cpi";
    const isRate = !isCpi;
    const rateAccounts = Array.isArray(c.rateAccounts)
      ? c.rateAccounts as { label: string; balance: number; monthlyImpact: number }[]
      : [];

    // Bar visual: scale to max value
    function Bar({ pct, color }: { pct: number; color: string }) {
      const max = isCpi && userSpendPct !== null && inflationPct !== null
        ? Math.max(Math.abs(userSpendPct), Math.abs(inflationPct), 1) * 1.2
        : 100;
      const width = Math.min(Math.abs(pct) / max * 100, 100);
      return (
        <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
          <div className="h-full rounded-full transition-all" style={{ width: `${width}%`, backgroundColor: color }} />
        </div>
      );
    }

    return (
      <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        {/* Header */}
        <div className="px-4 pt-3.5 pb-2 flex items-center gap-2 border-b border-gray-100">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-purple-500 shrink-0" />
              <span className="text-[10px] font-bold uppercase tracking-wider text-purple-600">Market Signal</span>
            </div>
            <p className="text-[10px] text-gray-400 mt-0.5 uppercase tracking-wide">
              {dataSource}{dataPeriod ? ` · ${dataPeriod}` : ""}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {card.href && (
              <a href={card.href} target="_blank" rel="noopener noreferrer"
                className="text-[10px] font-semibold text-purple-600 hover:text-purple-800 uppercase tracking-wide">
                Source ↗
              </a>
            )}
            {onDismiss && (
              <button onClick={onDismiss} className="text-gray-300 hover:text-gray-500 transition">
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* Body */}
        <div className="px-4 py-3 space-y-3">
          {/* Headline */}
          <p className="text-sm font-bold text-gray-900 leading-snug">{card.title}</p>

          {/* CPI comparison bars — all-items or food */}
          {isCpi && inflationPct !== null && userSpendPct !== null && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-gray-500 w-20 shrink-0">
                  {(c.linkedCategory as string | undefined) ?? "CPI"}
                </span>
                <Bar pct={inflationPct} color="#22c55e" />
                <span className="text-[11px] font-semibold text-green-600 w-10 text-right shrink-0">
                  +{inflationPct}%
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-gray-500 w-20 shrink-0">Your spend</span>
                <Bar pct={userSpendPct} color={userSpendPct > inflationPct ? "#f97316" : "#22c55e"} />
                <span className={`text-[11px] font-semibold w-10 text-right shrink-0 ${userSpendPct > inflationPct ? "text-orange-500" : "text-green-600"}`}>
                  {userSpendPct > 0 ? "+" : ""}{userSpendPct}%
                </span>
              </div>
            </div>
          )}

          {/* Rate comparison */}
          {isRate && rateCurrent !== null && (
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <p className="text-2xl font-bold text-gray-900 tabular-nums">{rateCurrent.toFixed(2)}%</p>
                  <p className="text-[11px] text-gray-400">Current rate</p>
                </div>
                {rateDelta !== null && rateDelta !== 0 && (
                  <div className={`rounded-lg px-3 py-2 text-center ${rateDirection === "up" ? "bg-red-50" : "bg-green-50"}`}>
                    <p className={`text-sm font-bold ${rateDirection === "up" ? "text-red-600" : "text-green-600"}`}>
                      {rateDelta > 0 ? "+" : ""}{rateDelta}%
                    </p>
                    <p className={`text-[10px] font-medium ${rateDirection === "up" ? "text-red-400" : "text-green-400"}`}>
                      {rateDirection === "up" ? "raised" : "cut"}
                    </p>
                  </div>
                )}
              </div>
              {/* Per-account breakdown */}
              {rateAccounts.length > 0 && (
                <div className="space-y-1 pt-1 border-t border-gray-100">
                  {rateAccounts.map((acct, i) => (
                    <div key={i} className="flex items-center justify-between">
                      <span className="text-[11px] text-gray-500 truncate mr-2">{acct.label}</span>
                      {acct.monthlyImpact > 0 && rateDelta !== 0 ? (
                        <span className={`text-[11px] font-semibold shrink-0 ${rateDirection === "up" ? "text-red-500" : "text-green-600"}`}>
                          {rateDirection === "up" ? "+" : "−"}${acct.monthlyImpact}/mo
                        </span>
                      ) : (
                        <span className="text-[11px] text-gray-400 shrink-0 tabular-nums">
                          ${new Intl.NumberFormat("en-CA", { maximumFractionDigits: 0 }).format(acct.balance)}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Dollar impact footer */}
          {card.dollarImpact !== null && card.dollarImpact !== undefined && (card.dollarImpact as number) > 0 && (
            <div className="flex items-center gap-1.5 pt-1 border-t border-gray-100">
              <span className="text-[11px] font-semibold text-gray-700">
                ~${Math.round(card.dollarImpact as number)}/mo
                {isCpi ? " above inflation" : (isRate && rateDirection === "up" ? " extra interest" : " interest saved")}
              </span>
              {monthlyImpact !== null && isRate && (
                <span className="text-[10px] text-gray-400">on your variable debt</span>
              )}
            </div>
          )}
        </div>
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
    const cad = (n: number) => fmt(n, homeCurrency);
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

      <PromoDashboardBanner />
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

        {/* Right side: currency widget + freshness CTA */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Currency widget */}
          {currencyInfo && (
            <div className="flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2 shadow-sm">
              <span className="text-sm font-bold text-gray-800">
                {currencyInfo.homeCurrency === "CAD" ? "🍁" : "🇺🇸"} {currencyInfo.homeCurrency}
              </span>
              {currencyInfo.showExchange && currencyInfo.cadPerUsd !== null && currencyInfo.usdPerCad !== null && (
                <>
                  <span className="text-gray-300 text-sm">·</span>
                  <span className="text-xs text-gray-500 font-medium">
                    {currencyInfo.homeCurrency === "USD"
                      ? `1 CAD = $${currencyInfo.usdPerCad.toFixed(4)}`
                      : `1 USD = $${currencyInfo.cadPerUsd.toFixed(4)} CAD`}
                  </span>
                  {currencyInfo.rateDate && (
                    <span className="text-[10px] text-gray-400 hidden sm:inline">
                      {new Date(currencyInfo.rateDate + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    </span>
                  )}
                </>
              )}
            </div>
          )}

          {/* Freshness CTA — only shown when user has statements */}
          {statementCount > 0 && overdueAccounts.length > 0 && (
            <Link href="/account/activity?tab=coverage"
              className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 shadow-sm hover:border-gray-300 hover:shadow-md transition">
              <span className="h-2 w-2 rounded-full bg-orange-400 shrink-0" />
              {overdueAccounts.length} statement{overdueAccounts.length > 1 ? "s" : ""} to upload
              <svg className="h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          )}
        </div>
      </div>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      {/* ── Country confirmation — shown once after first statement upload ─── */}
      {!loading && statementCount >= 1 && confirmedCountry === null && (
        <div className="mb-5 rounded-xl border border-blue-100 bg-blue-50 px-5 py-4 flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-blue-900">
              {detectedCountry === "CA" ? "🍁" : "🇺🇸"} Confirm your home country
            </p>
            <p className="text-xs text-blue-700 mt-0.5">
              We detected{" "}
              <span className="font-semibold">
                {detectedCountry === "CA" ? "Canada" : "United States"}
              </span>{" "}
              from your bank. Is that right? This helps us tailor tax tips, savings advice, and market signals to you.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => confirmCountry(detectedCountry)}
              disabled={countryConfirming}
              className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50 transition"
            >
              Yes, {detectedCountry === "CA" ? "Canada 🍁" : "United States 🇺🇸"}
            </button>
            <button
              onClick={() => confirmCountry(detectedCountry === "CA" ? "US" : "CA")}
              disabled={countryConfirming}
              className="rounded-lg border border-blue-200 bg-white px-4 py-2 text-xs font-semibold text-blue-700 hover:border-blue-300 disabled:opacity-50 transition"
            >
              No, {detectedCountry === "CA" ? "United States 🇺🇸" : "Canada 🍁"}
            </button>
          </div>
        </div>
      )}

      {/* ── Zero / First-time / Rich layouts ────────────────────────────────── */}
      {!loading && statementCount === 0 ? (
        <ZeroStatementsLayout token={token} onUploaded={() => token && load(token)} homeCurrency={homeCurrency} />
      ) : statementCount <= 3 && !loading ? (
        <FirstTimeLayout
          agentCards={agentCards}
          netWorth={netWorth}
          topSpending={topSpending}
          statementCount={statementCount}
          monthCount={monthCount}
          savingsMonth={savingsRate?.month ?? ""}
          savingsRateCard={savingsRate && savingsRate.income > 0 ? <SavingsRateCard /> : null}
          savingsRaw={savingsRate ? {
            income:       savingsRate.income,
            expenses:     savingsRate.expenses,
            debtPayments: savingsRate.debtPayments,
            rate:         (() => {
              // rate from API is already integer % (e.g. 54). Re-derive to be safe.
              const eff = savingsRate.income > 0
                ? Math.round(((savingsRate.income - savingsRate.expenses) / savingsRate.income) * 100)
                : 0;
              return eff;
            })(),
            month:        savingsRate.month,
          } : null}
          homeCurrency={homeCurrency}
        />
      ) : (<>

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
                    <p className="text-4xl font-bold text-gray-900 tabular-nums tracking-tight">{fmt(netWorth.total, homeCurrency)}</p>
                    <p className={`text-xs mt-1 font-medium ${netWorth.isStale ? "text-amber-500" : "text-gray-400"}`}>
                      {netWorth.calculatedLabel}
                    </p>
                    {netWorth.fxRatesApplied && Object.keys(netWorth.fxRatesApplied).length > 0 && (
                      <p className="text-[10px] text-gray-400 mt-0.5">
                        {Object.entries(netWorth.fxRatesApplied)
                          .map(([ccy, rate]) => `1 ${ccy} = ${rate.toFixed(4)} ${netWorth.homeCurrency}`)
                          .join(" · ")}
                      </p>
                    )}
                  </div>
                  {savingsRate && savingsRate.income > 0 && (
                    <div className="hidden sm:flex gap-5 shrink-0 text-right">
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Income</p>
                        <p className="mt-0.5 text-base font-bold text-green-600 tabular-nums">{fmt(savingsRate.income, homeCurrency)}</p>
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
                          {fmt(savingsRate.expenses + (includeDebtInExpenses ? savingsRate.debtPayments : 0), homeCurrency)}
                        </p>
                        {includeDebtInExpenses && savingsRate.debtPayments > 0 && (
                          <p className="text-[10px] text-gray-400">incl. {fmt(savingsRate.debtPayments, homeCurrency)} debt pymts</p>
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
                      <p className="mt-0.5 text-sm font-bold text-green-600 tabular-nums">{fmt(savingsRate.income, homeCurrency)}</p>
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
                        {fmt(savingsRate.expenses + (includeDebtInExpenses ? savingsRate.debtPayments : 0), homeCurrency)}
                      </p>
                      {includeDebtInExpenses && savingsRate.debtPayments > 0 && (
                        <p className="text-[10px] text-gray-400">incl. {fmt(savingsRate.debtPayments, homeCurrency)} debt pymts</p>
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
                    <span className="ml-auto text-lg font-bold text-green-600 tabular-nums">+{fmt(item.amount, homeCurrency)}</span>
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
                <UpcomingRow key={item.id} item={item} homeCurrency={homeCurrency} />
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
                          {item.type === "cash-in" ? "+" : "−"}{fmt(item.amount, homeCurrency)}
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
            <ThisMonthGroup items={thisMonth} ratePill={ratePill} homeCurrency={homeCurrency} />
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

          {/* ── What we noticed — non-external agent cards ───────────────── */}
          {agentCards.filter(c => c.source !== "external" && !c.dismissed).length > 0 && (
            <div className="space-y-3">
              <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">What we noticed</p>
              {agentCards.filter(c => c.source !== "external" && !c.dismissed).map((card) => {
                const { dot, label } = priorityLabel(card.priority);
                const border = priorityBorder(card.priority);
                return (
                  <div key={card.id} className={`rounded-xl border border-gray-100 bg-white shadow-sm overflow-hidden ${border}`}>
                    <div className="px-5 py-4">
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-1.5">
                          <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${dot}`} />
                          <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">{label}</span>
                        </div>
                        <button
                          onClick={() => dismissCard(card.id)}
                          className="text-gray-300 hover:text-gray-500 transition"
                          aria-label="Dismiss"
                        >
                          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                      <p className="text-sm font-semibold text-gray-900 mb-1">{card.title}</p>
                      <p className="text-xs text-gray-500 leading-relaxed">{card.body}</p>
                      {card.href && (
                        <Link href={card.href} className="mt-2 inline-block text-xs font-semibold text-purple-600 hover:underline">
                          Explore →
                        </Link>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* ── Market Signals — main feed (always visible, all screen sizes) ── */}
          {agentCards.filter(c => c.source === "external").length > 0 && (() => {
            const externalCards = agentCards.filter(c => c.source === "external");
            return (
              <div className="space-y-3">
                <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Market Signals</p>
                {externalCards.map((card) => (
                  <MarketSignalCard key={card.id} card={card} onDismiss={() => dismissCard(card.id)} />
                ))}
              </div>
            );
          })()}
        </div>

        {/* ── Right sidebar ─────────────────────────────────────────────────── */}
        <div className="hidden lg:block w-72 shrink-0">
          <div className="sticky top-6 space-y-3">

            {/* ── Market Signals — top of sidebar, collapsible ───────────────── */}
            {agentCards.some(c => c.source === "external") && (() => {
              const externalCards = agentCards.filter(c => c.source === "external");
              const visible = sigExpanded ? externalCards : externalCards.slice(0, 1);
              return (
                <div>
                  <button
                    onClick={() => setSigExpanded(v => !v)}
                    className="w-full mb-2 flex items-center gap-2 px-1 group"
                  >
                    <span className="text-sm">📡</span>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-purple-600">Market Signals</p>
                    <span className="ml-auto rounded-full bg-purple-100 px-2 py-0.5 text-[10px] font-bold text-purple-600">
                      {externalCards.length}
                    </span>
                    <svg className={`h-3.5 w-3.5 text-gray-400 transition-transform shrink-0 ${sigExpanded ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  <div className="space-y-2">
                    {visible.map((card) => (
                      <MarketSignalCard key={card.id} card={card} onDismiss={() => dismissCard(card.id)} />
                    ))}
                  </div>
                  {externalCards.length > 1 && (
                    <button
                      onClick={() => setSigExpanded(v => !v)}
                      className="mt-1 w-full text-[11px] font-semibold text-gray-400 hover:text-gray-600 transition"
                    >
                      {sigExpanded ? "Show less ↑" : `+${externalCards.length - 1} more ↓`}
                    </button>
                  )}
                </div>
              );
            })()}

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

            {/* ── Events ─────────────────────────────────────────────────────── */}
            <EventsWidget events={activeEvents} homeCurrency={homeCurrency} />

          </div>
        </div>

      </div>

      </>) /* end rich-data layout */}

      {/* ── Mobile: horizontal scroll strip — rich data only ─────────────────── */}
      {statementCount > 3 && (
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
          {agentCards.filter(c => c.source === "external").map((card) => (
            <div key={card.id} className="snap-start shrink-0 w-64">
              <MobileCardShell><SidebarSignalCard card={card} /></MobileCardShell>
            </div>
          ))}
          {activeEvents.length > 0 && (
            <div className="snap-start shrink-0 w-64">
              <MobileCardShell><EventsWidget events={activeEvents} homeCurrency={homeCurrency} /></MobileCardShell>
            </div>
          )}
        </div>
      </div>
      )} {/* end mobile strip */}

    </div> {/* end mx-auto max-w-5xl */}

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
