"use client";

import { useEffect, useState, useCallback, useRef, use } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseClient } from "@/lib/firebase";
import { useActiveProfile } from "@/contexts/ActiveProfileContext";
import type { UserEvent, TaggedTransaction, EventColor, VisitLog, ServiceCadence, BillingMethod, ProjectLedgerEntry } from "@/lib/events/types";
import { EVENT_COLORS } from "@/lib/events/types";
import { fmt, HOME_CURRENCY, getCurrencySymbol } from "@/lib/currencyUtils";

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

const MONTH_NAMES_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function cadenceLabelShort(
  cadence: ServiceCadence,
  seasonStart?: number,
  seasonEnd?: number,
  billingMethod?: BillingMethod,
): string {
  const c = { weekly: "Weekly", biweekly: "Biweekly", monthly: "Monthly", quarterly: "Quarterly" }[cadence];
  const isYearRound = !seasonStart || !seasonEnd || (seasonStart === 1 && seasonEnd === 12);
  const season = isYearRound ? "year-round" : `season ${MONTH_NAMES_SHORT[seasonStart! - 1]}–${MONTH_NAMES_SHORT[seasonEnd! - 1]}`;
  const billing = billingMethod === "per-visit" ? "per visit" : billingMethod === "monthly" ? "billed monthly" : null;
  return [c, season, billing].filter(Boolean).join(" · ");
}

// ── Edit event modal ──────────────────────────────────────────────────────────

interface EditModalProps {
  event: UserEvent;
  headers: Record<string, string>;
  homeCurrency: string;
  onSaved: (updated: UserEvent) => void;
  onClose: () => void;
}

function EditEventModal({ event, headers, homeCurrency, onSaved, onClose }: EditModalProps) {
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
          <h2 className="text-base font-semibold text-gray-900">Edit tracker</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4 px-6 py-5">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Name *</label>
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
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Budget ({getCurrencySymbol(homeCurrency).trim()})
              </label>
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

// ── Tag picker — imported from shared component ───────────────────────────────
import TagPicker, { type RawTx } from "@/components/events/TagPicker";

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
  const [visitLogs, setVisitLogs]   = useState<VisitLog[]>([]);
  const [ledgerEntries, setLedgerEntries] = useState<ProjectLedgerEntry[]>([]);
  const [totalSpent, setTotalSpent] = useState(0);
  const [loading, setLoading]       = useState(true);
  const [showEdit, setShowEdit]     = useState(false);
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false);
  const [archiving, setArchiving]   = useState(false);
  const [removing, setRemoving]     = useState<string | null>(null);
  const [removingVisit, setRemovingVisit] = useState<string | null>(null);
  const [currentYear, setCurrentYear] = useState<string | null>(null);
  const [showLedgerForm, setShowLedgerForm] = useState(false);
  const [ledgerDate, setLedgerDate]        = useState(() => new Date().toISOString().substring(0, 10));
  const [ledgerAmount, setLedgerAmount]      = useState("");
  const [ledgerNote, setLedgerNote]        = useState("");
  const [ledgerEntryType, setLedgerEntryType] = useState<"cash" | "manual">("manual");
  const [savingLedger, setSavingLedger]       = useState(false);
  const [removingLedger, setRemovingLedger] = useState<string | null>(null);
  const [homeCurrency, setHomeCurrency] = useState(HOME_CURRENCY);
  const { buildHeaders, targetUid } = useActiveProfile();

  useEffect(() => {
    const { auth } = getFirebaseClient();
    return onAuthStateChanged(auth, async (u) => {
      if (u) setToken(await u.getIdToken());
      else setToken(null);
    });
  }, []);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      const res = await fetch("/api/user/currency-info", { headers: buildHeaders(token) });
      const json = await res.json().catch(() => ({}));
      if (!cancelled && json.homeCurrency) setHomeCurrency(json.homeCurrency);
    })();
    return () => {
      cancelled = true;
    };
  }, [token, buildHeaders]);

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
          setVisitLogs(json.visitLogs ?? []);
          setLedgerEntries(json.ledgerEntries ?? []);
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
    const row = tagged.find((t) => t.fingerprint === fingerprint);
    try {
      const res = await fetch("/api/user/tx-tags", {
        method: "POST",
        headers: { ...buildHeaders(token), "Content-Type": "application/json" },
        body: JSON.stringify({
          fingerprint,
          remove: [id],
          ...(row?.date ? { date: row.date } : {}),
        }),
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

  async function performArchive() {
    if (!token) return;
    setArchiving(true);
    try {
      const res = await fetch(`/api/user/events/${id}`, {
        method: "DELETE",
        headers: buildHeaders(token),
      });
      if (res.ok) router.push("/account/events");
    } finally {
      setArchiving(false);
      setShowArchiveConfirm(false);
    }
  }

  async function handleRemoveVisit(visitId: string) {
    if (!token) return;
    setRemovingVisit(visitId);
    try {
      const res = await fetch(`/api/user/events/${id}/visits`, {
        method: "DELETE",
        headers: { ...buildHeaders(token), "Content-Type": "application/json" },
        body: JSON.stringify({ visitId }),
      });
      if (res.ok) setVisitLogs((prev) => prev.filter((v) => v.id !== visitId));
    } finally {
      setRemovingVisit(null);
    }
  }


  async function handleAddLedgerEntry(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    const amt = parseFloat(ledgerAmount);
    if (!Number.isFinite(amt) || amt <= 0) return;
    setSavingLedger(true);
    try {
      const res = await fetch(`/api/user/events/${id}/ledger`, {
        method: "POST",
        headers: { ...buildHeaders(token), "Content-Type": "application/json" },
        body: JSON.stringify({
          date: ledgerDate,
          amount: amt,
          entryType: ledgerEntryType,
          ...(ledgerNote.trim() ? { note: ledgerNote.trim() } : {}),
        }),
      });
      if (res.ok) {
        const json = await res.json() as { entry: ProjectLedgerEntry };
        setLedgerEntries((prev) => [json.entry, ...prev].sort((a, b) => b.date.localeCompare(a.date)));
        setTotalSpent((s) => s + json.entry.amount);
        setEvent((ev) =>
          ev
            ? {
                ...ev,
                ledgerTotal: (ev.ledgerTotal ?? 0) + json.entry.amount,
                ledgerEntryCount: (ev.ledgerEntryCount ?? 0) + 1,
              }
            : ev,
        );
        setLedgerAmount("");
        setLedgerNote("");
        setShowLedgerForm(false);
      }
    } finally {
      setSavingLedger(false);
    }
  }

  async function handleRemoveLedgerEntry(entryId: string) {
    if (!token) return;
    setRemovingLedger(entryId);
    const removed = ledgerEntries.find((x) => x.id === entryId);
    try {
      const res = await fetch(`/api/user/events/${id}/ledger`, {
        method: "DELETE",
        headers: { ...buildHeaders(token), "Content-Type": "application/json" },
        body: JSON.stringify({ entryId }),
      });
      if (res.ok && removed) {
        setLedgerEntries((prev) => prev.filter((x) => x.id !== entryId));
        setTotalSpent((s) => Math.max(0, s - removed.amount));
        setEvent((ev) =>
          ev
            ? {
                ...ev,
                ledgerTotal: Math.max(0, (ev.ledgerTotal ?? 0) - removed.amount),
                ledgerEntryCount: Math.max(0, (ev.ledgerEntryCount ?? 1) - 1),
              }
            : ev,
        );
      }
    } finally {
      setRemovingLedger(null);
    }
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
  const hc = homeCurrency;
  const curSym = getCurrencySymbol(hc).trim();

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
          ← Trackers
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
                    {event.kind === "service" ? "Service" : event.type === "annual" ? "Annual" : "Project"}
                  </span>
                  {event.kind === "service" ? (
                    <span className="text-xs text-gray-400">
                      {cadenceLabelShort(
                        event.cadence ?? "monthly",
                        event.seasonStart,
                        event.seasonEnd,
                        event.billingMethod,
                      )}
                    </span>
                  ) : (
                    <>
                      {(event.startDate ?? event.date) && (
                        <span className="text-xs text-gray-400">{fmtDate(event.startDate ?? event.date)}</span>
                      )}
                      {event.endDate && (
                        <span className="text-xs text-gray-400">→ {fmtDate(event.endDate)}</span>
                      )}
                      {event.type === "annual" && currentYear && (
                        <span className="text-xs text-gray-400">· {currentYear} total</span>
                      )}
                    </>
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
                type="button"
                onClick={() => setShowArchiveConfirm(true)}
                className="rounded-lg px-3 py-1.5 text-xs font-medium text-gray-400 hover:text-red-500 hover:bg-red-50 border border-gray-100"
              >
                Archive
              </button>
            </div>
          </div>

          {/* Totals */}
          <div className="flex items-end justify-between mb-3">
            <div>
              <p className="text-2xl font-bold text-gray-900">{fmt(totalSpent, hc)}</p>
              {event.budget && (
                <p className="text-sm text-gray-400">of {fmt(event.budget, hc)} budget</p>
              )}
            </div>
            <div className="text-right">
              {event.kind === "service" ? (
                <>
                  <p className="text-sm font-medium text-gray-700">
                    {visitLogs.length} visit{visitLogs.length !== 1 ? "s" : ""} logged
                  </p>
                  {(() => {
                    const cashPaid = visitLogs.filter((v) => v.paymentMethod === "cash").length;
                    const stmtPaid = tagged.length;
                    const paid     = cashPaid + stmtPaid;
                    const unbilled = Math.max(0, visitLogs.length - paid);
                    return (
                      <p className="text-xs text-gray-400">
                        {paid} paid · {unbilled} unbilled
                      </p>
                    );
                  })()}
                </>
              ) : (
                <>
                  <p className="text-sm font-medium text-gray-700">
                    {tagged.length} tagged
                    {(event.ledgerEntryCount ?? ledgerEntries.length) > 0 && (
                      <span className="text-gray-400 font-normal"> · {(event.ledgerEntryCount ?? ledgerEntries.length)} ledger</span>
                    )}
                  </p>
                  {pct != null && (
                    <p className={`text-xs font-medium ${pct >= 100 ? "text-red-500" : "text-gray-400"}`}>
                      {pct}% used
                    </p>
                  )}
                </>
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

        {/* ── Activity (service events): visits + payments merged ──────── */}
        {event.kind === "service" && (() => {
          type ActivityItem =
            | { kind: "visit";            date: string; id: string; note?: string }
            | { kind: "cash";             date: string; id: string; amount?: number; note?: string }
            | { kind: "card";             date: string; id: string; amount?: number; note?: string }
            | { kind: "statement";        date: string; fingerprint: string; description: string; amount: number; accountLabel: string };

          const items: ActivityItem[] = [
            // Pure visits (no payment method)
            ...visitLogs
              .filter((v) => !v.paymentMethod)
              .map((v) => ({ kind: "visit" as const, date: v.date, id: v.id, note: v.note })),
            // Cash payments
            ...visitLogs
              .filter((v) => v.paymentMethod === "cash")
              .map((v) => ({ kind: "cash" as const, date: v.date, id: v.id, amount: v.amount, note: v.note })),
            // Card placeholders
            ...visitLogs
              .filter((v) => v.paymentMethod === "card")
              .map((v) => ({ kind: "card" as const, date: v.date, id: v.id, amount: v.amount, note: v.note })),
            // Statement-tagged transactions
            ...tagged.map((t) => ({ kind: "statement" as const, date: t.date, fingerprint: t.fingerprint, description: t.description, amount: t.amount, accountLabel: t.accountLabel })),
          ].sort((a, b) => b.date.localeCompare(a.date));

          const fmtDay = (iso: string) =>
            new Date(iso + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

          return (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden mb-4">
              <div className="px-5 py-4 border-b border-gray-50">
                <h2 className="text-sm font-semibold text-gray-900">Activity</h2>
                <p className="text-xs text-gray-400 mt-0.5">Visits and payments — use the tracker card to log</p>
              </div>
              {items.length === 0 ? (
                <div className="px-5 py-10 text-center">
                  <p className="text-sm text-gray-500">No activity yet.</p>
                  <p className="text-xs text-gray-400 mt-1">Log visits and payments from the tracker card.</p>
                </div>
              ) : (
                <div className="divide-y divide-gray-50">
                  {items.map((item) => {
                    if (item.kind === "visit") return (
                      <div key={`v-${item.id}`} className="flex items-start gap-3 px-5 py-3.5">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-500">Visit</span>
                            <p className="text-sm font-medium text-gray-800">{fmtDay(item.date)}</p>
                          </div>
                          {item.note && <p className="text-xs text-gray-400 mt-0.5">{item.note}</p>}
                        </div>
                        <button onClick={() => handleRemoveVisit(item.id)} disabled={removingVisit === item.id}
                          className="rounded-lg px-2.5 py-1.5 text-xs text-gray-400 hover:text-red-500 hover:bg-red-50 disabled:opacity-40 transition">
                          {removingVisit === item.id ? "…" : "Remove"}
                        </button>
                      </div>
                    );
                    if (item.kind === "cash") return (
                      <div key={`c-${item.id}`} className="flex items-start gap-3 px-5 py-3.5">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="inline-flex items-center rounded-full bg-emerald-50 border border-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700">Cash</span>
                            <p className="text-sm font-medium text-gray-800">{fmtDay(item.date)}</p>
                          </div>
                          {item.note && <p className="text-xs text-gray-400 mt-0.5">{item.note}</p>}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {item.amount != null && <span className="text-sm font-semibold text-gray-900">{fmt(item.amount, hc)}</span>}
                          <button onClick={() => handleRemoveVisit(item.id)} disabled={removingVisit === item.id}
                            className="rounded-lg px-2.5 py-1.5 text-xs text-gray-400 hover:text-red-500 hover:bg-red-50 disabled:opacity-40 transition">
                            {removingVisit === item.id ? "…" : "Remove"}
                          </button>
                        </div>
                      </div>
                    );
                    if (item.kind === "card") return (
                      <div key={`k-${item.id}`} className="flex items-start gap-3 px-5 py-3.5">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="inline-flex items-center rounded-full bg-amber-50 border border-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700">Card · Pending</span>
                            <p className="text-sm font-medium text-gray-800">{fmtDay(item.date)}</p>
                          </div>
                          {item.note && <p className="text-xs text-gray-400 mt-0.5">{item.note}</p>}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {item.amount != null && <span className="text-sm font-semibold text-gray-900">{fmt(item.amount, hc)}</span>}
                          <button onClick={() => handleRemoveVisit(item.id)} disabled={removingVisit === item.id}
                            className="rounded-lg px-2.5 py-1.5 text-xs text-gray-400 hover:text-red-500 hover:bg-red-50 disabled:opacity-40 transition">
                            {removingVisit === item.id ? "…" : "Remove"}
                          </button>
                        </div>
                      </div>
                    );
                    // statement
                    return (
                      <div key={`s-${item.fingerprint}`} className="flex items-start gap-3 px-5 py-3.5">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="inline-flex items-center rounded-full bg-indigo-50 border border-indigo-100 px-2 py-0.5 text-[11px] font-medium text-indigo-700">Statement</span>
                            <p className="text-sm font-medium text-gray-800 truncate">{item.description}</p>
                          </div>
                          <p className="text-xs text-gray-400 mt-0.5">{txDate(item.date)} · {item.accountLabel}</p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-sm font-semibold text-gray-900">{fmt(item.amount, hc)}</span>
                          <button onClick={() => handleRemove(item.fingerprint)} disabled={removing === item.fingerprint}
                            className="rounded-lg px-2.5 py-1.5 text-xs text-gray-400 hover:text-red-500 hover:bg-red-50 disabled:opacity-40 transition">
                            {removing === item.fingerprint ? "…" : "Remove"}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })()}

        {/* ── Project ledger (off-statement cash / manual — adds to budget) ── */}
        {event.kind !== "service" && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden mb-4">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-50">
              <div>
                <h2 className="text-sm font-semibold text-gray-900">Project ledger</h2>
                <p className="text-xs text-gray-400 mt-0.5">
                  Cash, quotes, trades — anything not on a tagged bank line. Rolls into budget with tagged transactions.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowLedgerForm((v) => !v)}
                className="rounded-lg bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-100 shrink-0"
              >
                {showLedgerForm ? "Close" : "+ Add"}
              </button>
            </div>

            {showLedgerForm && (
              <form onSubmit={handleAddLedgerEntry} className="border-b border-gray-50 bg-gray-50 px-5 py-4 space-y-3">
                <div className="flex flex-wrap gap-3">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1">Date</p>
                    <input
                      type="date"
                      value={ledgerDate}
                      onChange={(e) => setLedgerDate(e.target.value)}
                      className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs"
                      required
                    />
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1">Amount</p>
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-gray-400">{curSym}</span>
                      <input
                        type="number"
                        min="0.01"
                        step="0.01"
                        value={ledgerAmount}
                        onChange={(e) => setLedgerAmount(e.target.value)}
                        placeholder="0.00"
                        className="w-28 rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs"
                        required
                      />
                    </div>
                  </div>
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1.5">Type</p>
                  <div className="flex gap-2">
                    {(["cash", "manual"] as const).map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setLedgerEntryType(t)}
                        className={`rounded-lg px-3 py-1.5 text-xs font-medium border transition ${
                          ledgerEntryType === t
                            ? "bg-amber-600 text-white border-amber-600"
                            : "border-gray-200 text-gray-600 bg-white hover:border-gray-300"
                        }`}
                      >
                        {t === "cash" ? "Cash" : "Other / invoice"}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1">Note (optional)</p>
                  <input
                    value={ledgerNote}
                    onChange={(e) => setLedgerNote(e.target.value)}
                    placeholder="e.g. contractor deposit, materials from Home Depot"
                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm"
                  />
                </div>
                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={savingLedger}
                    className="rounded-lg bg-amber-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
                  >
                    {savingLedger ? "Saving…" : "Add to ledger"}
                  </button>
                </div>
              </form>
            )}

            {ledgerEntries.length === 0 ? (
              <div className="px-5 py-8 text-center">
                <p className="text-sm text-gray-500">No off-statement lines yet.</p>
                <p className="text-xs text-gray-400 mt-1">Renovations, birthdays: add cash or manual totals here.</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-50">
                {ledgerEntries.map((row) => (
                  <div key={row.id} className="flex items-start gap-3 px-5 py-3.5">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-gray-800">
                        {new Date(row.date + "T00:00:00").toLocaleDateString("en-CA", {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </p>
                      {row.note && <p className="text-xs text-gray-400 mt-0.5">{row.note}</p>}
                      <span
                        className={`inline-flex mt-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                          row.entryType === "cash"
                            ? "bg-emerald-50 text-emerald-800 border border-emerald-100"
                            : "bg-slate-50 text-slate-600 border border-slate-100"
                        }`}
                      >
                        {row.entryType === "cash" ? "Cash" : "Other / invoice"}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-sm font-semibold text-gray-900">{fmt(row.amount, hc)}</span>
                      <button
                        type="button"
                        onClick={() => handleRemoveLedgerEntry(row.id)}
                        disabled={removingLedger === row.id}
                        className="rounded-lg px-2.5 py-1.5 text-xs text-gray-400 hover:text-red-500 hover:bg-red-50 disabled:opacity-40"
                      >
                        {removingLedger === row.id ? "…" : "Remove"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Tagged transactions (project events only) ─────────────────── */}
        {event.kind !== "service" && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden mb-4">
            <div className="px-5 py-4 border-b border-gray-50">
              <h2 className="text-sm font-semibold text-gray-900">Tagged transactions</h2>
            </div>
            {tagged.length === 0 ? (
              <div className="px-5 py-10 text-center">
                <p className="text-3xl mb-3">🏷</p>
                <p className="text-sm font-medium text-gray-700 mb-1">No transactions tagged yet</p>
                <p className="text-xs text-gray-400">Tag transactions from the tracker card using +Payment.</p>
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
                      <span className="text-sm font-semibold text-gray-900">{fmt(tx.amount, hc)}</span>
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
        )}
      </div>


      {showEdit && (
        <EditEventModal
          event={event}
          headers={headers}
          homeCurrency={homeCurrency}
          onSaved={(updated) => { setEvent(updated); setShowEdit(false); }}
          onClose={() => setShowEdit(false)}
        />
      )}

      {showArchiveConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget && !archiving) setShowArchiveConfirm(false);
          }}
        >
          <div
            role="dialog"
            aria-labelledby="archive-plan-title"
            aria-modal="true"
            className="w-full max-w-sm rounded-2xl bg-white shadow-xl p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="archive-plan-title" className="text-base font-semibold text-gray-900 mb-2">
              Archive this tracker?
            </h3>
            <p className="text-sm text-gray-600 mb-6">
              Archive &quot;{event.name}&quot;? Tags and ledger entries stay in your data but won&apos;t show on active trackers.
            </p>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                disabled={archiving}
                onClick={() => setShowArchiveConfirm(false)}
                className="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 border border-gray-200 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={archiving}
                onClick={performArchive}
                className="rounded-lg px-4 py-2 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 disabled:opacity-50"
              >
                {archiving ? "Archiving…" : "Archive tracker"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
