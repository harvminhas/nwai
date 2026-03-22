"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseClient } from "@/lib/firebase";
import type { ActivityEvent } from "@/app/api/user/activity/route";

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

// ── page ──────────────────────────────────────────────────────────────────────

export default function ActivityPage() {
  const router = useRouter();
  const [events, setEvents]   = useState<ActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [filter, setFilter]   = useState<ActivityEvent["type"] | "all">("all");
  const [token, setToken]     = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null); // statementId
  const [deleting, setDeleting]           = useState<string | null>(null);
  const [deleteError, setDeleteError]     = useState<string | null>(null);

  useEffect(() => {
    const { auth } = getFirebaseClient();
    return onAuthStateChanged(auth, async (user) => {
      if (!user) { router.push("/account/login"); return; }
      setLoading(true); setError(null);
      try {
        const tok = await user.getIdToken();
        setToken(tok);
        const res = await fetch("/api/user/activity", { headers: { Authorization: `Bearer ${tok}` } });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) { setError(json.error || "Failed to load"); return; }
        setEvents(json.events ?? []);
      } catch { setError("Failed to load activity"); }
      finally { setLoading(false); }
    });
  }, [router]);

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

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">

      {/* Header */}
      <div className="mb-6">
        <h1 className="font-bold text-3xl text-gray-900">Activity</h1>
        <p className="mt-0.5 text-sm text-gray-400">Everything you&apos;ve done in this account</p>
      </div>

      {/* Filter pills */}
      {!loading && events.length > 0 && (
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

      {loading && (
        <div className="flex min-h-[30vh] items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-purple-600 border-t-transparent" />
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      {!loading && filtered.length === 0 && (
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

      {/* Timeline */}
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
                  const isBeingDeleted = deleting === stmtId;
                  const isPendingConfirm = confirmDelete === stmtId;

                  return (
                    <div key={ev.id} className={`flex items-start gap-3 px-4 py-3.5 transition-colors ${isBeingDeleted ? "opacity-40" : ""}`}>
                      <EventIcon type={ev.type} meta={ev.meta} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            {ev.type === "statement_upload" && stmtId ? (
                              <Link
                                href={`/dashboard/${stmtId}`}
                                className="text-sm font-medium text-gray-800 hover:text-purple-600 transition-colors truncate block"
                              >
                                {ev.title}
                              </Link>
                            ) : (
                              <p className="text-sm font-medium text-gray-800 truncate">{ev.title}</p>
                            )}
                            {ev.subtitle && (
                              <p className="mt-0.5 text-xs text-gray-400">{ev.subtitle}</p>
                            )}

                            {/* Inline confirm */}
                            {isPendingConfirm && (
                              <div className="mt-2 flex items-center gap-2">
                                <p className="text-xs text-red-600 font-medium">Delete this statement and all its data?</p>
                                <button
                                  onClick={() => handleDelete(stmtId!)}
                                  disabled={isBeingDeleted}
                                  className="rounded-md bg-red-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-red-700 transition disabled:opacity-50"
                                >
                                  {isBeingDeleted ? "Deleting…" : "Yes, delete"}
                                </button>
                                <button
                                  onClick={() => setConfirmDelete(null)}
                                  className="rounded-md border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50 transition"
                                >
                                  Cancel
                                </button>
                              </div>
                            )}
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            <EventBadge type={ev.type} meta={ev.meta} />
                            <span className="text-[11px] text-gray-300 tabular-nums">{fmtTime(ev.timestamp)}</span>
                            {ev.type === "statement_upload" && stmtId && !isPendingConfirm && (
                              <button
                                onClick={() => { setConfirmDelete(stmtId); setDeleteError(null); }}
                                disabled={isBeingDeleted}
                                title="Delete statement"
                                className="ml-1 rounded p-1 text-gray-300 hover:bg-red-50 hover:text-red-500 transition disabled:opacity-30"
                              >
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

      {/* Footer count */}
      {!loading && filtered.length > 0 && (
        <p className="mt-6 text-center text-xs text-gray-300">
          {filtered.length} event{filtered.length !== 1 ? "s" : ""}
        </p>
      )}
    </div>
  );
}
