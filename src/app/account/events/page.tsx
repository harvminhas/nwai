"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseClient } from "@/lib/firebase";
import { useActiveProfile } from "@/contexts/ActiveProfileContext";
import type { EventSummary, EventColor } from "@/lib/events/types";
import { EVENT_COLORS } from "@/lib/events/types";
import { fmt } from "@/lib/currencyUtils";

// ── helpers ──────────────────────────────────────────────────────────────────

function colorCfg(color: EventColor) {
  return EVENT_COLORS.find((c) => c.id === color) ?? EVENT_COLORS[0];
}

function fmtDate(iso?: string) {
  if (!iso) return null;
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" });
}

function budgetPct(spent: number, budget?: number) {
  if (!budget || budget <= 0) return null;
  return Math.min(100, Math.round((spent / budget) * 100));
}

// ── Create event modal ────────────────────────────────────────────────────────

interface CreateModalProps {
  onClose: () => void;
  onCreated: (ev: EventSummary) => void;
  headers: Record<string, string>;
}

function CreateEventModal({ onClose, onCreated, headers }: CreateModalProps) {
  const [name, setName]     = useState("");
  const [budget, setBudget] = useState("");
  const [date, setDate]     = useState("");
  const [type, setType]     = useState<"one-off" | "annual">("one-off");
  const [color, setColor]   = useState<EventColor>("purple");
  const [saving, setSaving] = useState(false);
  const [err, setErr]       = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setErr("Name is required"); return; }
    setSaving(true); setErr(null);
    try {
      const res = await fetch("/api/user/events", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          type,
          color,
          ...(budget ? { budget: parseFloat(budget) } : {}),
          ...(date ? { date } : {}),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to create");
      onCreated({ ...json.event, totalSpent: 0, txCount: 0 });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
          <h2 className="text-base font-semibold text-gray-900">New event</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4 px-6 py-5">
          {/* Name */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Event name *</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Anniversary trip, Home renovation…"
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
            />
          </div>

          {/* Date + Budget row */}
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs font-medium text-gray-700 mb-1">Target date</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
            </div>
            <div className="flex-1">
              <label className="block text-xs font-medium text-gray-700 mb-1">Budget ($)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={budget}
                onChange={(e) => setBudget(e.target.value)}
                placeholder="Optional"
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
            </div>
          </div>

          {/* Type */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Type</label>
            <div className="flex gap-2">
              {(["one-off", "annual"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setType(t)}
                  className={`flex-1 rounded-lg border py-2 text-xs font-medium transition-colors ${
                    type === t
                      ? "border-purple-500 bg-purple-50 text-purple-700"
                      : "border-gray-200 text-gray-600 hover:border-gray-300"
                  }`}
                >
                  {t === "one-off" ? "One-off" : "Annual (repeats)"}
                </button>
              ))}
            </div>
          </div>

          {/* Color */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Colour</label>
            <div className="flex flex-wrap gap-2">
              {EVENT_COLORS.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setColor(c.id)}
                  title={c.label}
                  className={`h-7 w-7 rounded-full ${c.bg} border-2 transition-all ${
                    color === c.id ? `${c.border} scale-110` : "border-transparent"
                  }`}
                />
              ))}
            </div>
          </div>

          {err && <p className="text-xs text-red-600">{err}</p>}

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-lg border border-gray-200 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 rounded-lg bg-purple-600 py-2 text-sm font-medium text-white hover:bg-purple-700 disabled:opacity-50"
            >
              {saving ? "Creating…" : "Create event"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Event card ────────────────────────────────────────────────────────────────

function EventCard({ ev }: { ev: EventSummary }) {
  const router = useRouter();
  const cfg = colorCfg(ev.color);
  const pct = budgetPct(ev.totalSpent, ev.budget);

  return (
    <button
      onClick={() => router.push(`/account/events/${ev.id}`)}
      className="w-full text-left rounded-xl border border-gray-100 bg-white p-4 shadow-sm hover:shadow-md hover:border-gray-200 transition-all"
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${cfg.bg}`}>
            <span className="text-base">🗓</span>
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-900 truncate">{ev.name}</p>
            {ev.date && (
              <p className="text-xs text-gray-400 mt-0.5">{fmtDate(ev.date)}</p>
            )}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-sm font-semibold text-gray-900">{fmt(ev.totalSpent)}</p>
          {ev.budget && (
            <p className="text-xs text-gray-400">of {fmt(ev.budget)}</p>
          )}
        </div>
      </div>

      {/* Progress bar (only when budget set) */}
      {pct != null && (
        <div className="mb-2">
          <div className="h-1.5 w-full rounded-full bg-gray-100">
            <div
              className={`h-1.5 rounded-full transition-all ${pct >= 100 ? "bg-red-400" : cfg.bg.replace("bg-", "bg-")}`}
              style={{ width: `${pct}%`, backgroundColor: pct >= 100 ? undefined : undefined }}
            />
          </div>
          <p className="mt-0.5 text-xs text-gray-400">{pct}% of budget</p>
        </div>
      )}

      {/* Footer row */}
      <div className="flex items-center justify-between">
        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${cfg.bg} ${cfg.text}`}>
          {ev.type === "annual" ? "Annual" : "One-off"}
        </span>
        <span className="text-xs text-gray-400">
          {ev.txCount === 0 ? "No transactions tagged" : `${ev.txCount} transaction${ev.txCount !== 1 ? "s" : ""}`}
        </span>
      </div>
    </button>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function EventsPage() {
  const [token, setToken]           = useState<string | null>(null);
  const [events, setEvents]         = useState<EventSummary[]>([]);
  const [loading, setLoading]       = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const { buildHeaders, targetUid } = useActiveProfile();

  // Auth
  useEffect(() => {
    const { auth } = getFirebaseClient();
    return onAuthStateChanged(auth, async (u) => {
      if (u) setToken(await u.getIdToken());
      else setToken(null);
    });
  }, []);

  const load = useCallback(
    async (tok: string) => {
      setLoading(true);
      try {
        const res = await fetch("/api/user/events", { headers: buildHeaders(tok) });
        const json = await res.json();
        if (res.ok) setEvents(json.events ?? []);
      } finally {
        setLoading(false);
      }
    },
    [buildHeaders],
  );

  useEffect(() => {
    if (token) load(token);
  }, [token, load, targetUid]);

  function handleCreated(ev: EventSummary) {
    setEvents((prev) => [ev, ...prev]);
    setShowCreate(false);
  }

  const headers = token ? buildHeaders(token) : {};

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-2xl px-4 py-8">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Events</h1>
            <p className="text-sm text-gray-500 mt-0.5">Plan budgets and tag transactions to track spending</p>
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="rounded-xl bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700 shadow-sm"
          >
            + New event
          </button>
        </div>

        {/* Content */}
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-28 rounded-xl bg-gray-100 animate-pulse" />
            ))}
          </div>
        ) : events.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-gray-200 bg-white px-8 py-16 text-center">
            <p className="text-4xl mb-4">🗓</p>
            <h3 className="text-base font-semibold text-gray-900 mb-1">No events yet</h3>
            <p className="text-sm text-gray-500 mb-6">
              Create an event to set a budget and tag transactions — great for trips, renovations, or any spending goal.
            </p>
            <button
              onClick={() => setShowCreate(true)}
              className="rounded-xl bg-purple-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-purple-700"
            >
              Create your first event
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {events.map((ev) => <EventCard key={ev.id} ev={ev} />)}
          </div>
        )}
      </div>

      {showCreate && (
        <CreateEventModal
          onClose={() => setShowCreate(false)}
          onCreated={handleCreated}
          headers={headers}
        />
      )}
    </div>
  );
}
