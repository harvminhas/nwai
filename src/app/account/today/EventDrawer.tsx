"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fmt } from "@/lib/currencyUtils";
import type { UserEvent, TaggedTransaction } from "@/lib/events/types";

/** Firestore id from `/account/events/:id` — Forecast near-term & other deep links. */
export function eventIdFromEventsDetailHref(href: string | undefined): string | null {
  if (!href?.startsWith("/account/events/")) return null;
  const rest = href.slice("/account/events/".length);
  const id = rest.split(/[/?#]/)[0]?.trim();
  return id || null;
}

function trackerKindLabel(ev: UserEvent): string {
  if (ev.kind === "scheduled_payment") return "Set payment";
  if (ev.kind === "service") return "Service";
  return ev.type === "annual" ? "Annual tracker" : "Project";
}

function fmtShort(iso: string) {
  if (!iso) return "—";
  return new Date(iso + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

interface EventDetailPayload {
  event: UserEvent;
  transactions: TaggedTransaction[];
  totalSpent: number;
  txCount: number;
}

export function EventDrawer({
  eventId,
  token,
  homeCurrency,
  isOpen,
  onClose,
}: {
  eventId: string | null;
  token: string | null;
  homeCurrency: string;
  isOpen: boolean;
  onClose: () => void;
}) {
  const [payload, setPayload] = useState<EventDetailPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!eventId || !token || !isOpen) return;
    setLoading(true);
    setError(null);
    setPayload(null);
    fetch(`/api/user/events/${encodeURIComponent(eventId)}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    })
      .then(async (r) => {
        const json = (await r.json().catch(() => ({}))) as EventDetailPayload & { error?: string };
        if (!r.ok) throw new Error(json.error ?? "Failed to load tracker");
        setPayload({ event: json.event, transactions: json.transactions ?? [], totalSpent: json.totalSpent ?? 0, txCount: json.txCount ?? 0 });
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [eventId, token, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isOpen, onClose]);

  const ev = payload?.event;
  const budget = ev?.budget;
  const remaining =
    budget != null && budget > 0 ? Math.max(0, budget - (payload?.totalSpent ?? 0)) : null;
  const slots = [...(ev?.scheduledPayments ?? [])].sort((a, b) => a.date.localeCompare(b.date)).slice(0, 8);

  return (
    <>
      <div
        className={`fixed inset-0 z-40 bg-black/20 transition-opacity duration-300 ${isOpen ? "opacity-100" : "pointer-events-none opacity-0"}`}
        onClick={onClose}
      />
      <div
        className={`fixed right-0 top-0 z-50 flex h-full w-full max-w-lg flex-col bg-white shadow-2xl transition-transform duration-300 ${isOpen ? "translate-x-0" : "translate-x-full"}`}
      >
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
          <div className="min-w-0 pr-2">
            <p className="text-[10px] font-bold uppercase tracking-widest text-purple-600">Tracker</p>
            <h2 className="mt-0.5 truncate text-lg font-bold text-gray-900">{ev?.name ?? "Loading…"}</h2>
            {ev && (
              <p className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">{trackerKindLabel(ev)}</p>
            )}
          </div>
          <button type="button" onClick={onClose} className="rounded-full p-2 text-gray-400 transition hover:bg-gray-100">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading && <div className="flex h-32 items-center justify-center text-sm text-gray-400">Loading…</div>}
          {!loading && error && (
            <div className="px-6 py-8 text-center text-sm text-red-600">{error}</div>
          )}
          {!loading && !error && payload && ev && (
            <div className="divide-y divide-gray-100">
              {ev.kind === "scheduled_payment" && slots.length > 0 && (
                <div className="px-6 py-4">
                  <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-gray-400">Scheduled amounts</p>
                  <div className="space-y-2">
                    {slots.map((s, i) => (
                      <div key={`${s.date}-${i}`} className="flex items-center justify-between text-sm">
                        <span className="text-gray-600">{fmtShort(s.date)}</span>
                        <span className="font-semibold tabular-nums text-gray-900">{fmt(s.estimatedAmount, homeCurrency)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {(ev.kind === "project" || !ev.kind || ev.kind === "service") && budget != null && budget > 0 && (
                <div className="grid grid-cols-3 divide-x divide-gray-100 border-b border-gray-100">
                  <div className="px-4 py-3">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Budget</p>
                    <p className="text-base font-bold tabular-nums text-gray-900">{fmt(budget, homeCurrency)}</p>
                  </div>
                  <div className="px-4 py-3">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Spent</p>
                    <p className="text-base font-bold tabular-nums text-gray-900">{fmt(payload.totalSpent, homeCurrency)}</p>
                  </div>
                  <div className="px-4 py-3">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Left</p>
                    <p className="text-base font-bold tabular-nums text-purple-700">{remaining != null ? fmt(remaining, homeCurrency) : "—"}</p>
                  </div>
                </div>
              )}

              {(ev.startDate || ev.endDate || ev.date) && (
                <div className="px-6 py-4">
                  <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-gray-400">Timeframe</p>
                  <p className="text-sm text-gray-700">
                    {ev.startDate && ev.endDate && ev.startDate !== ev.endDate
                      ? `${fmtShort(ev.startDate)} – ${fmtShort(ev.endDate)}`
                      : fmtShort(ev.endDate ?? ev.startDate ?? ev.date ?? "")}
                  </p>
                </div>
              )}

              <div className="px-6 py-4">
                <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-gray-400">
                  Tagged transactions · {payload.txCount} total
                </p>
                {payload.transactions.length === 0 ? (
                  <p className="text-xs text-gray-400">No statement charges tagged yet.</p>
                ) : (
                  <div className="divide-y divide-gray-50">
                    {payload.transactions.slice(0, 10).map((t) => (
                      <div key={t.fingerprint} className="flex items-center justify-between gap-2 py-2.5 first:pt-0">
                        <div className="min-w-0">
                          <p className="truncate text-xs text-gray-700">{t.description}</p>
                          <p className="text-[11px] text-gray-400">
                            {fmtShort(t.date)}
                            {t.accountLabel ? ` · ${t.accountLabel}` : ""}
                          </p>
                        </div>
                        <p className="shrink-0 text-sm font-semibold tabular-nums text-gray-900">{fmt(t.amount, homeCurrency)}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {eventId && (
          <div className="border-t border-gray-100 px-6 py-4">
            <Link
              href={`/account/events/${eventId}`}
              onClick={onClose}
              className="flex items-center gap-2 text-sm font-semibold text-purple-600 hover:underline"
            >
              <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
              Open full tracker page
            </Link>
          </div>
        )}
      </div>
    </>
  );
}

export function useEventDrawer() {
  const [drawerEventId, setDrawerEventId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  function openDrawer(eventId: string) {
    setDrawerEventId(eventId);
    requestAnimationFrame(() => requestAnimationFrame(() => setDrawerOpen(true)));
  }
  function closeDrawer() {
    setDrawerOpen(false);
    setTimeout(() => setDrawerEventId(null), 300);
  }

  return { drawerEventId, drawerOpen, openDrawer, closeDrawer };
}
