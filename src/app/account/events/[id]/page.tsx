"use client";

import { useEffect, useState, useCallback, useRef, use } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseClient } from "@/lib/firebase";
import { useActiveProfile } from "@/contexts/ActiveProfileContext";
import type { UserEvent, TaggedTransaction, EventColor } from "@/lib/events/types";
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

function txDate(iso: string) {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-CA", { month: "short", day: "numeric" });
}

// ── Edit event modal ──────────────────────────────────────────────────────────

interface EditModalProps {
  event: UserEvent;
  headers: Record<string, string>;
  onSaved: (updated: UserEvent) => void;
  onClose: () => void;
}

function EditEventModal({ event, headers, onSaved, onClose }: EditModalProps) {
  const [name, setName]     = useState(event.name);
  const [budget, setBudget] = useState(event.budget ? String(event.budget) : "");
  const [date, setDate]     = useState(event.date ?? "");
  const [type, setType]     = useState<"one-off" | "annual">(event.type);
  const [color, setColor]   = useState<EventColor>(event.color);
  const [saving, setSaving] = useState(false);
  const [err, setErr]       = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setErr("Name is required"); return; }
    setSaving(true); setErr(null);
    try {
      const res = await fetch(`/api/user/events/${event.id}`, {
        method: "PUT",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          type,
          color,
          date: date || "",
          budget: budget ? parseFloat(budget) : "",
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to save");
      onSaved({ ...event, name: name.trim(), type, color, date: date || undefined, budget: budget ? parseFloat(budget) : undefined });
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
          <h2 className="text-base font-semibold text-gray-900">Edit event</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4 px-6 py-5">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Event name *</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
            />
          </div>
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
            <button type="button" onClick={onClose}
              className="flex-1 rounded-lg border border-gray-200 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50">
              Cancel
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 rounded-lg bg-purple-600 py-2 text-sm font-medium text-white hover:bg-purple-700 disabled:opacity-50">
              {saving ? "Saving…" : "Save changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Tag picker modal ──────────────────────────────────────────────────────────

interface RawTx {
  fingerprint: string;
  date: string;
  description: string;
  amount: number;
  category: string;
  accountLabel: string;
}

interface TagPickerProps {
  eventId: string;
  eventName: string;
  taggedFingerprints: Set<string>;
  headers: Record<string, string>;
  onTagged: (tx: RawTx) => void;
  onClose: () => void;
}

function TagPicker({ eventId, eventName, taggedFingerprints, headers, onTagged, onClose }: TagPickerProps) {
  const [txns, setTxns]       = useState<RawTx[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ]             = useState("");
  const [tagging, setTagging] = useState<string | null>(null);
  const [pendingNote, setPendingNote] = useState<{ tx: RawTx; note: string } | null>(null);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/user/spending/transactions?months=12`, { headers })
      .then((r) => r.json())
      .then((j) => setTxns(j.transactions ?? []))
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = txns.filter((t) => {
    if (!q) return true;
    return t.description.toLowerCase().includes(q.toLowerCase());
  });

  async function handleTag(tx: RawTx, note?: string) {
    setTagging(tx.fingerprint);
    setPendingNote(null);
    try {
      const res = await fetch("/api/user/tx-tags", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          fingerprint: tx.fingerprint,
          add: [eventId],
          ...(note ? { note } : {}),
        }),
      });
      if (res.ok) onTagged(tx);
    } finally {
      setTagging(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40">
      <div className="w-full max-w-lg rounded-t-2xl sm:rounded-2xl bg-white shadow-xl max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4 shrink-0">
          <h2 className="text-sm font-semibold text-gray-900">Tag a transaction</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>
        <div className="px-4 pt-3 pb-2 shrink-0">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search merchant…"
            autoFocus
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
          />
        </div>

        {/* Note input panel — appears after user clicks Tag on a tx */}
        {pendingNote && (
          <div className="mx-4 mb-2 rounded-xl border border-purple-100 bg-purple-50 p-3 shrink-0">
            <p className="text-xs font-semibold text-purple-700 mb-2">
              Add a note for &quot;{pendingNote.tx.description}&quot; <span className="font-normal">(optional)</span>
            </p>
            <div className="flex gap-2">
              <input
                value={pendingNote.note}
                onChange={(e) => setPendingNote({ ...pendingNote, note: e.target.value })}
                placeholder="e.g. Flight to Paris, deposit…"
                className="flex-1 rounded-lg border border-purple-200 bg-white px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-purple-400"
                onKeyDown={(e) => { if (e.key === "Enter") handleTag(pendingNote.tx, pendingNote.note); }}
                autoFocus
              />
              <button
                onClick={() => handleTag(pendingNote.tx, pendingNote.note)}
                disabled={tagging !== null}
                className="shrink-0 rounded-lg bg-purple-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-purple-700 disabled:opacity-50"
              >
                {tagging ? "…" : "Confirm"}
              </button>
              <button
                onClick={() => handleTag(pendingNote.tx)}
                className="shrink-0 rounded-lg border border-purple-200 px-3 py-1.5 text-xs font-medium text-purple-600 hover:bg-purple-100"
              >
                Skip
              </button>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto divide-y divide-gray-50 px-2 pb-4">
          {loading ? (
            <div className="py-10 text-center text-sm text-gray-400">Loading transactions…</div>
          ) : filtered.length === 0 ? (
            <div className="py-10 text-center text-sm text-gray-400">
              {q ? "No transactions match your search" : "No transactions in the last 12 months"}
            </div>
          ) : (
            filtered.map((tx) => {
              const alreadyTagged = taggedFingerprints.has(tx.fingerprint);
              return (
                <div key={tx.fingerprint} className={`flex items-center gap-3 px-2 py-3 ${alreadyTagged ? "opacity-60" : ""}`}>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-900 truncate">{tx.description}</p>
                    <p className="text-xs text-gray-400">{txDate(tx.date)} · {tx.category} · {tx.accountLabel}</p>
                    {alreadyTagged && (
                      <p className="text-[11px] text-purple-500 font-medium mt-0.5">Already tagged to {eventName}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-sm font-semibold text-gray-900">{fmt(tx.amount)}</span>
                    {alreadyTagged ? (
                      <span className="rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-400">Tagged ✓</span>
                    ) : (
                      <button
                        onClick={() => setPendingNote({ tx, note: "" })}
                        disabled={tagging === tx.fingerprint || pendingNote?.tx.fingerprint === tx.fingerprint}
                        className="rounded-lg bg-purple-50 px-3 py-1.5 text-xs font-medium text-purple-700 hover:bg-purple-100 disabled:opacity-50"
                      >
                        {tagging === tx.fingerprint ? "…" : "Tag"}
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

// ── Inline note editor ────────────────────────────────────────────────────────

function NoteEditor({
  fingerprint,
  initialNote,
  headers,
  onSaved,
}: {
  fingerprint: string;
  initialNote?: string;
  headers: Record<string, string>;
  onSaved: (note: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue]     = useState(initialNote ?? "");
  const [saving, setSaving]   = useState(false);
  const inputRef              = useRef<HTMLInputElement>(null);

  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);

  async function save() {
    setSaving(true);
    try {
      await fetch("/api/user/tx-tags", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ fingerprint, note: value || null }),
      });
      onSaved(value);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <button
        onClick={() => setEditing(true)}
        className="text-[11px] text-gray-400 hover:text-purple-600 transition mt-0.5 text-left"
      >
        {initialNote ? initialNote : "+ Add note"}
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1.5 mt-0.5">
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Add a note…"
        className="flex-1 rounded border border-gray-200 px-2 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-purple-400"
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") { setValue(initialNote ?? ""); setEditing(false); }
        }}
      />
      <button
        onClick={save}
        disabled={saving}
        className="text-[11px] font-medium text-purple-600 hover:underline disabled:opacity-50"
      >
        {saving ? "…" : "Save"}
      </button>
      <button
        onClick={() => { setValue(initialNote ?? ""); setEditing(false); }}
        className="text-[11px] text-gray-400 hover:text-gray-600"
      >
        ✕
      </button>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function EventDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();

  const [token, setToken]           = useState<string | null>(null);
  const [event, setEvent]           = useState<UserEvent | null>(null);
  const [tagged, setTagged]         = useState<TaggedTransaction[]>([]);
  const [totalSpent, setTotalSpent] = useState(0);
  const [loading, setLoading]       = useState(true);
  const [showPicker, setShowPicker] = useState(false);
  const [showEdit, setShowEdit]     = useState(false);
  const [removing, setRemoving]     = useState<string | null>(null);
  const [currentYear, setCurrentYear] = useState<string | null>(null);
  const { buildHeaders, targetUid } = useActiveProfile();

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
        const res = await fetch(`/api/user/events/${id}`, { headers: buildHeaders(tok) });
        if (res.status === 404) { router.replace("/account/events"); return; }
        const json = await res.json();
        if (res.ok) {
          setEvent(json.event);
          setTagged(json.transactions ?? []);
          setTotalSpent(json.totalSpent ?? 0);
          setCurrentYear(json.currentYear ?? null);
        }
      } finally {
        setLoading(false);
      }
    },
    [id, buildHeaders, router],
  );

  useEffect(() => {
    if (token) load(token);
  }, [token, load, targetUid]);

  async function handleRemove(fingerprint: string) {
    if (!token) return;
    setRemoving(fingerprint);
    try {
      const res = await fetch("/api/user/tx-tags", {
        method: "POST",
        headers: { ...buildHeaders(token), "Content-Type": "application/json" },
        body: JSON.stringify({ fingerprint, remove: [id] }),
      });
      if (res.ok) {
        const removed = tagged.find((t) => t.fingerprint === fingerprint);
        setTagged((prev) => prev.filter((t) => t.fingerprint !== fingerprint));
        if (removed) setTotalSpent((s) => Math.max(0, s - removed.amount));
      }
    } finally {
      setRemoving(null);
    }
  }

  async function handleArchive() {
    if (!token || !confirm(`Archive "${event?.name}"? Tagged transactions will be preserved.`)) return;
    const res = await fetch(`/api/user/events/${id}`, {
      method: "DELETE",
      headers: buildHeaders(token),
    });
    if (res.ok) router.push("/account/events");
  }

  function handleTagged(tx: RawTx) {
    const newTx: TaggedTransaction = {
      fingerprint: tx.fingerprint,
      date: tx.date,
      description: tx.description,
      amount: tx.amount,
      category: tx.category,
      accountLabel: tx.accountLabel,
      eventIds: [id],
    };
    setTagged((prev) => [newTx, ...prev].sort((a, b) => b.date.localeCompare(a.date)));
    setTotalSpent((s) => s + tx.amount);
  }

  function handleNoteUpdate(fingerprint: string, note: string) {
    setTagged((prev) => prev.map((t) => t.fingerprint === fingerprint ? { ...t, note: note || undefined } : t));
  }

  const headers = token ? buildHeaders(token) : {};
  const taggedSet = new Set(tagged.map((t) => t.fingerprint));
  const pct = event?.budget ? Math.min(100, Math.round((totalSpent / event.budget) * 100)) : null;
  const cfg = event ? colorCfg(event.color) : EVENT_COLORS[0];

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="mx-auto max-w-2xl px-4 py-8 space-y-4">
          <div className="h-8 w-48 bg-gray-100 rounded-lg animate-pulse" />
          <div className="h-32 bg-gray-100 rounded-2xl animate-pulse" />
          <div className="h-64 bg-gray-100 rounded-2xl animate-pulse" />
        </div>
      </div>
    );
  }

  if (!event) return null;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-2xl px-4 py-8">
        {/* Back nav */}
        <button
          onClick={() => router.push("/account/events")}
          className="mb-5 flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700"
        >
          ← Events
        </button>

        {/* Event header card */}
        <div className={`rounded-2xl border ${cfg.border} bg-white p-5 mb-5 shadow-sm`}>
          <div className="flex items-start justify-between gap-4 mb-4">
            <div className="flex items-center gap-3 min-w-0">
              <span className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${cfg.bg} text-xl`}>
                🗓
              </span>
              <div className="min-w-0">
                <h1 className="text-lg font-bold text-gray-900 truncate">{event.name}</h1>
                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${cfg.bg} ${cfg.text}`}>
                    {event.type === "annual" ? "Annual" : "One-off"}
                  </span>
                  {event.date && (
                    <span className="text-xs text-gray-400">{fmtDate(event.date)}</span>
                  )}
                  {event.type === "annual" && currentYear && (
                    <span className="text-xs text-gray-400">· {currentYear} total</span>
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => setShowEdit(true)}
                className="rounded-lg px-3 py-1.5 text-xs font-medium text-gray-500 hover:text-gray-800 hover:bg-gray-100 border border-gray-100"
              >
                Edit
              </button>
              <button
                onClick={handleArchive}
                className="rounded-lg px-3 py-1.5 text-xs font-medium text-gray-400 hover:text-red-500 hover:bg-red-50 border border-gray-100"
              >
                Archive
              </button>
            </div>
          </div>

          {/* Totals */}
          <div className="flex items-end justify-between mb-3">
            <div>
              <p className="text-2xl font-bold text-gray-900">{fmt(totalSpent)}</p>
              {event.budget && (
                <p className="text-sm text-gray-400">of {fmt(event.budget)} budget</p>
              )}
            </div>
            <div className="text-right">
              <p className="text-sm font-medium text-gray-700">{tagged.length} transaction{tagged.length !== 1 ? "s" : ""}</p>
              {pct != null && (
                <p className={`text-xs font-medium ${pct >= 100 ? "text-red-500" : "text-gray-400"}`}>
                  {pct}% used
                </p>
              )}
            </div>
          </div>

          {/* Budget progress */}
          {pct != null && (
            <div className="h-2 w-full rounded-full bg-gray-100">
              <div
                className={`h-2 rounded-full transition-all ${pct >= 100 ? "bg-red-400" : cfg.bg}`}
                style={{ width: `${pct}%` }}
              />
            </div>
          )}
        </div>

        {/* Tagged transactions */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden mb-4">
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-50">
            <h2 className="text-sm font-semibold text-gray-900">Tagged transactions</h2>
            <button
              onClick={() => setShowPicker(true)}
              className="rounded-lg bg-purple-50 px-3 py-1.5 text-xs font-medium text-purple-700 hover:bg-purple-100"
            >
              + Tag transaction
            </button>
          </div>

          {tagged.length === 0 ? (
            <div className="px-5 py-12 text-center">
              <p className="text-3xl mb-3">🏷</p>
              <p className="text-sm font-medium text-gray-700 mb-1">No transactions tagged yet</p>
              <p className="text-xs text-gray-400 mb-4">Tag transactions from your history to track spending for this event.</p>
              <button
                onClick={() => setShowPicker(true)}
                className="rounded-lg bg-purple-50 px-4 py-2 text-sm font-medium text-purple-700 hover:bg-purple-100"
              >
                Tag your first transaction
              </button>
            </div>
          ) : (
            <div className="divide-y divide-gray-50">
              {tagged.map((tx) => (
                <div key={tx.fingerprint} className="flex items-start gap-3 px-5 py-3.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-900 truncate">{tx.description}</p>
                    <p className="text-xs text-gray-400">{txDate(tx.date)} · {tx.category} · {tx.accountLabel}</p>
                    <NoteEditor
                      fingerprint={tx.fingerprint}
                      initialNote={tx.note}
                      headers={headers}
                      onSaved={(note) => handleNoteUpdate(tx.fingerprint, note)}
                    />
                  </div>
                  <div className="flex items-center gap-3 shrink-0 pt-0.5">
                    <span className="text-sm font-semibold text-gray-900">{fmt(tx.amount)}</span>
                    <button
                      onClick={() => handleRemove(tx.fingerprint)}
                      disabled={removing === tx.fingerprint}
                      className="rounded-lg px-2.5 py-1.5 text-xs text-gray-400 hover:text-red-500 hover:bg-red-50 disabled:opacity-40"
                    >
                      {removing === tx.fingerprint ? "…" : "Remove"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {showPicker && (
        <TagPicker
          eventId={id}
          eventName={event.name}
          taggedFingerprints={taggedSet}
          headers={headers}
          onTagged={handleTagged}
          onClose={() => setShowPicker(false)}
        />
      )}

      {showEdit && (
        <EditEventModal
          event={event}
          headers={headers}
          onSaved={(updated) => { setEvent(updated); setShowEdit(false); }}
          onClose={() => setShowEdit(false)}
        />
      )}
    </div>
  );
}
