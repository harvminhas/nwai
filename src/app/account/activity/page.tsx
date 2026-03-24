"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseClient } from "@/lib/firebase";
import type { ActivityEvent } from "@/app/api/user/activity/route";
import type { UserStatementSummary } from "@/lib/types";
import { buildAccountSlug } from "@/lib/accountSlug";

// ── helpers ───────────────────────────────────────────────────────────────────

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function dayKey(iso: string): string {
  return iso.slice(0, 10); // YYYY-MM-DD
}

function groupLabel(key: string): string {
  const today     = new Date();
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  const d         = new Date(key + "T12:00:00");

  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

  if (sameDay(d, today))     return "Today";
  if (sameDay(d, yesterday)) return "Yesterday";

  const daysAgo = Math.floor((today.getTime() - d.getTime()) / 86_400_000);
  if (daysAgo <= 7)  return "This week";
  if (daysAgo <= 30) return "This month";
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

// ── event icons ───────────────────────────────────────────────────────────────

function EventIcon({ type, meta }: { type: ActivityEvent["type"]; meta: Record<string, unknown> }) {
  if (type === "statement_upload") {
    const status = meta.status as string;
    const color  = status === "completed" ? "bg-green-100 text-green-600"
      : status === "error" ? "bg-red-100 text-red-500"
      : "bg-gray-100 text-gray-400";
    return (
      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${color}`}>
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round"
            d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      </span>
    );
  }
  if (type === "category_rule") {
    return (
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-purple-100 text-purple-600">
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round"
            d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
        </svg>
      </span>
    );
  }
  if (type === "recurring_rule") {
    return (
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-teal-100 text-teal-600">
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round"
            d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
      </span>
    );
  }
  // rate_change
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-600">
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round"
          d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
      </svg>
    </span>
  );
}

function EventBadge({ type, meta }: { type: ActivityEvent["type"]; meta: Record<string, unknown> }) {
  if (type === "statement_upload") {
    const status = meta.status as string;
    if (status === "completed" && meta.superseded) {
      return <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-400">superseded</span>;
    }
    if (status === "error") {
      return <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-medium text-red-500">error</span>;
    }
    if (status === "completed") {
      const typeLabel = (meta.accountType as string) || null;
      if (typeLabel) return (
        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-500 capitalize">{typeLabel}</span>
      );
    }
  }
  return null;
}

// ── coverage helpers ──────────────────────────────────────────────────────────

function stmtYearMonth(s: UserStatementSummary): string {
  if (s.statementDate) return s.statementDate.slice(0, 7);
  return s.uploadedAt.slice(0, 7);
}

function stmtAccountSlug(s: UserStatementSummary): string {
  return buildAccountSlug(s.bankName, s.accountId);
}

function stmtDisplayName(s: UserStatementSummary): string {
  if (s.accountName) return s.accountName;
  const id = s.accountId ? ` (${s.accountId})` : "";
  return `${s.bankName ?? "Unknown"}${id}`;
}

function addMonths(ym: string, n: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthRange(from: string, to: string): string[] {
  const months: string[] = [];
  let cur = from;
  while (cur <= to) {
    months.push(cur);
    cur = addMonths(cur, 1);
  }
  return months;
}

function shortMo(ym: string): string {
  const [y, m] = ym.split("-");
  return new Date(parseInt(y), parseInt(m) - 1, 1)
    .toLocaleDateString("en-US", { month: "short", year: "2-digit" });
}

type CoverageStatus = "uploaded" | "gap" | "carried" | "future";

interface AccountCoverage {
  slug: string;
  displayName: string;
  accountType: string;
  firstMonth: string;
  lastMonth: string;
  uploadedMonths: Set<string>;
}

function buildCoverage(statements: UserStatementSummary[]): {
  accounts: AccountCoverage[];
  months: string[];
  currentMonth: string;
} {
  const completed = statements.filter((s) => s.status === "completed" && !s.superseded);
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  // Group by slug
  const map = new Map<string, AccountCoverage>();
  for (const s of completed) {
    const slug = stmtAccountSlug(s);
    const ym   = stmtYearMonth(s);
    let entry  = map.get(slug);
    if (!entry) {
      entry = {
        slug,
        displayName: stmtDisplayName(s),
        accountType: s.accountType ?? "other",
        firstMonth: ym,
        lastMonth: ym,
        uploadedMonths: new Set(),
      };
      map.set(slug, entry);
    }
    entry.uploadedMonths.add(ym);
    if (ym < entry.firstMonth) entry.firstMonth = ym;
    if (ym > entry.lastMonth)  entry.lastMonth  = ym;
  }

  const accounts = Array.from(map.values()).sort((a, b) => a.displayName.localeCompare(b.displayName));

  // Show only the last 6 months (or fewer if data is newer)
  const sixMonthsAgo = addMonths(currentMonth, -5);
  const globalFirst = accounts.reduce((min, a) => a.firstMonth < min ? a.firstMonth : min, currentMonth);
  const rangeStart = globalFirst > sixMonthsAgo ? globalFirst : sixMonthsAgo;
  const months = monthRange(rangeStart, currentMonth);

  return { accounts, months, currentMonth };
}

// ── page ──────────────────────────────────────────────────────────────────────

export default function ActivityPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<"timeline" | "coverage">("timeline");
  const [events, setEvents]       = useState<ActivityEvent[]>([]);
  const [statements, setStatements] = useState<UserStatementSummary[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [filter, setFilter]       = useState<ActivityEvent["type"] | "all">("all");
  const [token, setToken]         = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [deleting, setDeleting]           = useState<string | null>(null);
  const [deleteError, setDeleteError]     = useState<string | null>(null);
  const [refreshing, setRefreshing]       = useState(false);

  const loadData = useCallback(async (tok: string, silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    setError(null);
    try {
      const [actRes, stmtRes] = await Promise.all([
        fetch("/api/user/activity",   { headers: { Authorization: `Bearer ${tok}` } }),
        fetch("/api/user/statements", { headers: { Authorization: `Bearer ${tok}` } }),
      ]);
      const actJson  = await actRes.json().catch(() => ({}));
      const stmtJson = await stmtRes.json().catch(() => ({}));
      if (!actRes.ok) { setError(actJson.error || "Failed to load"); return; }
      setEvents(actJson.events ?? []);
      setStatements(stmtJson.statements ?? []);
    } catch { setError("Failed to load activity"); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => {
    const { auth } = getFirebaseClient();
    return onAuthStateChanged(auth, async (user) => {
      if (!user) { router.push("/login"); return; }
      const tok = await user.getIdToken();
      setToken(tok);
      loadData(tok);
    });
  }, [router, loadData]);

  async function handleDelete(statementId: string) {
    if (!token) return;
    setDeleting(statementId);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/user/statements/${statementId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setDeleteError(j.error || "Delete failed");
        return;
      }
      // Remove all events for this statement from local state
      setEvents((prev) => prev.filter((e) => e.meta?.statementId !== statementId));
    } catch {
      setDeleteError("Delete failed — please try again");
    } finally {
      setDeleting(null);
      setConfirmDelete(null);
    }
  }

  const filtered = filter === "all" ? events : events.filter((e) => e.type === filter);

  // Group by day
  const groups: { label: string; date: string; items: ActivityEvent[] }[] = [];
  for (const ev of filtered) {
    const key   = dayKey(ev.timestamp);
    const label = groupLabel(key);
    const last  = groups[groups.length - 1];
    if (last && last.date === key) {
      last.items.push(ev);
    } else {
      groups.push({ label, date: key, items: [ev] });
    }
  }

  // Counts per type
  const counts: Record<string, number> = { all: events.length };
  for (const e of events) counts[e.type] = (counts[e.type] ?? 0) + 1;

  const FILTERS: { id: ActivityEvent["type"] | "all"; label: string }[] = [
    { id: "all",              label: "All" },
    { id: "statement_upload", label: "Uploads" },
    { id: "category_rule",    label: "Rules" },
    { id: "recurring_rule",   label: "Recurring" },
    { id: "rate_change",      label: "Rates" },
  ];

  // ── coverage data ────────────────────────────────────────────────────────────
  const { accounts: coverageAccounts, months: coverageMonths, currentMonth } =
    !loading && statements.length > 0
      ? buildCoverage(statements)
      : { accounts: [], months: [], currentMonth: "" };

  const totalGaps = coverageAccounts.reduce((sum, acc) => {
    return sum + coverageMonths.filter((mo) => {
      if (mo > acc.lastMonth || mo < acc.firstMonth) return false;
      if (mo >= currentMonth) return false;
      return !acc.uploadedMonths.has(mo);
    }).length;
  }, 0);

  function getCellStatus(acc: AccountCoverage, mo: string): CoverageStatus {
    if (mo > currentMonth) return "future";
    if (mo < acc.firstMonth) return "future"; // before this account existed
    if (acc.uploadedMonths.has(mo)) return "uploaded";
    if (mo > acc.lastMonth) return "carried"; // carried forward from last upload
    return "gap"; // between first and last but no upload
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">

      {/* Header */}
      <div className="mb-6">
        <h1 className="font-bold text-3xl text-gray-900">Activity & Coverage</h1>
        <p className="mt-0.5 text-sm text-gray-400">Your upload history and statement coverage</p>
      </div>

      {/* Top-level tabs */}
      <div className="mb-6 flex gap-1 border-b border-gray-200">
        {([
          { id: "timeline", label: "Timeline" },
          { id: "coverage", label: totalGaps > 0 ? `Coverage · ${totalGaps} gap${totalGaps !== 1 ? "s" : ""}` : "Coverage" },
        ] as const).map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition -mb-px ${
              activeTab === tab.id
                ? "border-purple-600 text-purple-700"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            {tab.label}
            {tab.id === "coverage" && totalGaps > 0 && activeTab !== "coverage" && (
              <span className="ml-1.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-amber-100 text-[10px] font-bold text-amber-600">
                {totalGaps > 9 ? "9+" : totalGaps}
              </span>
            )}
          </button>
        ))}
      </div>

      {loading && (
        <div className="flex min-h-[30vh] items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-purple-600 border-t-transparent" />
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      {/* ── TIMELINE tab ──────────────────────────────────────────────────────── */}
      {!loading && activeTab === "timeline" && (
        <>
          {/* Filter pills */}
          {events.length > 0 && (
            <div className="mb-6 flex gap-1.5 flex-wrap">
              {FILTERS.map((f) => {
                const count = counts[f.id] ?? 0;
                if (f.id !== "all" && count === 0) return null;
                return (
                  <button
                    key={f.id}
                    onClick={() => setFilter(f.id)}
                    className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                      filter === f.id
                        ? "bg-gray-900 text-white"
                        : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                    }`}
                  >
                    {f.label}
                    {count > 0 && (
                      <span className={`ml-1.5 ${filter === f.id ? "text-gray-300" : "text-gray-400"}`}>
                        {count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {filtered.length === 0 && (
            <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-12 text-center">
              <p className="text-sm text-gray-500">No activity yet.</p>
              <Link href="/upload" className="mt-2 inline-block text-sm font-medium text-purple-600 hover:underline">
                Upload a statement to get started →
              </Link>
            </div>
          )}

          {deleteError && (
            <p className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{deleteError}</p>
          )}

          <div className="space-y-8">
            {groups.map((group) => (
              <div key={group.date}>
                <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">
                  {group.label}
                  <span className="ml-2 normal-case font-normal text-gray-300">
                    {group.label === "Today" || group.label === "Yesterday" ? fmtDate(group.date + "T12:00:00") : ""}
                  </span>
                </p>
                <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
                  <div className="divide-y divide-gray-100">
                    {group.items.map((ev) => {
                      const stmtId = ev.meta?.statementId as string | undefined;
                      const isBeingDeleted   = deleting === stmtId;
                      const isPendingConfirm = confirmDelete === stmtId;
                      return (
                        <div key={ev.id} className={`flex items-start gap-3 px-4 py-3.5 transition-colors ${isBeingDeleted ? "opacity-40" : ""}`}>
                          <EventIcon type={ev.type} meta={ev.meta} />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                {ev.type === "statement_upload" && stmtId ? (
                                  <Link href={`/dashboard/${stmtId}`} className="text-sm font-medium text-gray-800 hover:text-purple-600 transition-colors truncate block">
                                    {ev.title}
                                  </Link>
                                ) : (
                                  <p className="text-sm font-medium text-gray-800 truncate">{ev.title}</p>
                                )}
                                {ev.subtitle && <p className="mt-0.5 text-xs text-gray-400">{ev.subtitle}</p>}
                                {isPendingConfirm && (
                                  <div className="mt-2 flex items-center gap-2">
                                    <p className="text-xs text-red-600 font-medium">Delete this statement and all its data?</p>
                                    <button onClick={() => handleDelete(stmtId!)} disabled={isBeingDeleted}
                                      className="rounded-md bg-red-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-red-700 transition disabled:opacity-50">
                                      {isBeingDeleted ? "Deleting…" : "Yes, delete"}
                                    </button>
                                    <button onClick={() => setConfirmDelete(null)}
                                      className="rounded-md border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50 transition">
                                      Cancel
                                    </button>
                                  </div>
                                )}
                              </div>
                              <div className="flex shrink-0 items-center gap-2">
                                <EventBadge type={ev.type} meta={ev.meta} />
                                <span className="text-[11px] text-gray-300 tabular-nums">{fmtTime(ev.timestamp)}</span>
                                {ev.type === "statement_upload" && stmtId && !isPendingConfirm && (
                                  <button onClick={() => { setConfirmDelete(stmtId); setDeleteError(null); }} disabled={isBeingDeleted}
                                    title="Delete statement"
                                    className="ml-1 rounded p-1 text-gray-300 hover:bg-red-50 hover:text-red-500 transition disabled:opacity-30">
                                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                    </svg>
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {filtered.length > 0 && (
            <p className="mt-6 text-center text-xs text-gray-300">
              {filtered.length} event{filtered.length !== 1 ? "s" : ""}
            </p>
          )}
        </>
      )}

      {/* ── COVERAGE tab ──────────────────────────────────────────────────────── */}
      {!loading && activeTab === "coverage" && (
        <div className="space-y-5">

          {/* Legend + refresh */}
          <div className="flex flex-wrap items-center gap-4 text-xs text-gray-500">
            {[
              { color: "bg-green-500",  label: "Uploaded" },
              { color: "bg-amber-400",  label: "Carried forward" },
              { color: "bg-red-400",    label: "Gap — missing upload" },
              { color: "bg-gray-100 border border-gray-200", label: "Not applicable" },
            ].map(({ color, label }) => (
              <span key={label} className="flex items-center gap-1.5">
                <span className={`h-3 w-3 rounded-sm ${color}`} />
                {label}
              </span>
            ))}
            <div className="ml-auto flex items-center gap-3">
              <button
                onClick={() => token && loadData(token, true)}
                disabled={refreshing}
                className="inline-flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-purple-600 transition disabled:opacity-40"
                title="Refresh coverage"
              >
                <svg className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                {refreshing ? "Refreshing…" : "Refresh"}
              </button>
              <Link href="/upload" className="text-xs font-medium text-purple-600 hover:underline">
                Upload missing →
              </Link>
            </div>
          </div>

          {coverageAccounts.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-12 text-center">
              <p className="text-sm text-gray-500">No statements uploaded yet.</p>
              <Link href="/upload" className="mt-2 inline-block text-sm font-medium text-purple-600 hover:underline">
                Upload your first statement →
              </Link>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
              <table className="min-w-full text-xs">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="sticky left-0 z-10 bg-white px-4 py-3 text-left font-semibold text-gray-600 min-w-[180px]">
                      Account
                    </th>
                    {coverageMonths.map((mo) => (
                      <th
                        key={mo}
                        className={`px-2 py-3 text-center font-medium whitespace-nowrap ${
                          mo === currentMonth ? "text-purple-600" : "text-gray-400"
                        }`}
                      >
                        {shortMo(mo)}
                        {mo === currentMonth && (
                          <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-purple-500 align-middle" />
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {coverageAccounts.map((acc) => {
                    const gaps = coverageMonths.filter((mo) => getCellStatus(acc, mo) === "gap").length;
                    return (
                      <tr key={acc.slug} className="hover:bg-gray-50/50">
                        <td className="sticky left-0 z-10 bg-white px-4 py-3 hover:bg-gray-50/50">
                          <p className="font-medium text-gray-800 truncate max-w-[160px]" title={acc.displayName}>
                            {acc.displayName}
                          </p>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] capitalize text-gray-500">
                              {acc.accountType}
                            </span>
                            {gaps > 0 && (
                              <span className="rounded-full bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold text-red-500">
                                {gaps} gap{gaps !== 1 ? "s" : ""}
                              </span>
                            )}
                          </div>
                        </td>
                        {coverageMonths.map((mo) => {
                          const status = getCellStatus(acc, mo);
                          const cell = {
                            uploaded: { bg: "bg-green-500",   title: "Statement uploaded" },
                            carried:  { bg: "bg-amber-400",   title: "Carried forward from previous month" },
                            gap:      { bg: "bg-red-400",     title: "Missing — no statement uploaded" },
                            future:   { bg: "bg-gray-100 border border-gray-200",    title: "Not applicable" },
                          }[status];
                          return (
                            <td key={mo} className="px-2 py-3 text-center">
                              <span
                                className={`inline-block h-4 w-4 rounded-sm ${cell.bg}`}
                                title={`${acc.displayName} · ${shortMo(mo)} · ${cell.title}`}
                              />
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Gap summary */}
          {totalGaps > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3.5">
              <div className="flex items-start gap-2.5">
                <svg className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                </svg>
                <div>
                  <p className="text-sm font-semibold text-amber-800">
                    {totalGaps} missing statement{totalGaps !== 1 ? "s" : ""} detected
                  </p>
                  <p className="mt-0.5 text-xs text-amber-700">
                    Gaps mean your financial trends for those months use estimated or carried-forward balances.
                    Uploading missing statements will improve accuracy.
                  </p>
                  <Link href="/upload" className="mt-2 inline-block text-xs font-semibold text-amber-800 underline hover:text-amber-900">
                    Upload missing statements →
                  </Link>
                </div>
              </div>
            </div>
          )}

          {totalGaps === 0 && coverageAccounts.length > 0 && (
            <div className="flex items-center gap-2 rounded-xl border border-green-200 bg-green-50 px-4 py-3">
              <svg className="h-4 w-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-sm font-medium text-green-700">All accounts are fully covered — no gaps found.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
