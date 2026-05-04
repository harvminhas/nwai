"use client";

import { useEffect, useState, useCallback, useRef, use } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseClient } from "@/lib/firebase";
import { useActiveProfile } from "@/contexts/ActiveProfileContext";
import type { UserEvent, TaggedTransaction, EventColor, VisitLog, ServiceCadence, BillingMethod, ProjectLedgerEntry } from "@/lib/events/types";
import { EVENT_COLORS } from "@/lib/events/types";
import { fmt, HOME_CURRENCY, getCurrencySymbol } from "@/lib/currencyUtils";
import ServiceLogModal from "@/components/events/ServiceLogModal";
import AddExpenseModal from "@/components/events/AddExpenseModal";

function colorCfg(color: EventColor) {
  return EVENT_COLORS.find((c) => c.id === color) ?? EVENT_COLORS[0];
}

function fmtDate(iso?: string) {
  if (!iso) return null;
  return new Date(iso + "T00:00:00").toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" });
}

function txDate(iso: string) {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-CA", { month: "short", day: "numeric" });
}

function daysBetween(a: string, b: string) {
  return Math.round(Math.abs(new Date(b + "T00:00:00").getTime() - new Date(a + "T00:00:00").getTime()) / 86_400_000);
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
  const season = isYearRound ? "Year-round" : `${MONTH_NAMES_SHORT[seasonStart! - 1]}–${MONTH_NAMES_SHORT[seasonEnd! - 1]}`;
  const billing = billingMethod === "per-visit" ? "per visit" : billingMethod === "monthly" ? "billed monthly" : null;
  return [c, season, billing].filter(Boolean).join(" · ");
}

// ── helpers shared with timeline ─────────────────────────────────────────────

function visitsPerMonthFloat(cadence: ServiceCadence): number {
  return cadence === "weekly" ? 4.33 : cadence === "biweekly" ? 2.17 : cadence === "monthly" ? 1 : 0.33;
}

// ── Season timeline ───────────────────────────────────────────────────────────

function SeasonTimeline({ event }: { event: UserEvent }) {
  const today     = new Date();
  const currentYM = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
  const year      = today.getFullYear();

  const seasonStart = event.seasonStart ?? 1;
  const seasonEnd   = event.seasonEnd   ?? 12;
  const cadence     = event.cadence     ?? "monthly";

  const vpm             = visitsPerMonthFloat(cadence);
  const expectedPerMonth = Math.max(1, Math.round(vpm));

  // All 12 months (show full year, dim out-of-season)
  const months = Array.from({ length: 12 }, (_, i) => i + 1);
  const inSeason = (m: number) => m >= seasonStart && m <= seasonEnd;

  return (
    <div>
      <div className="flex gap-0.5 items-end">
        {months.map((m) => {
          const ym       = `${year}-${String(m).padStart(2, "0")}`;
          const visits   = event.visitsByMonth?.[ym]   ?? 0;
          const payments = event.paymentsByMonth?.[ym] ?? 0;
          const isPast    = ym < currentYM;
          const isCurrent = ym === currentYM;
          const inS       = inSeason(m);

          const activity      = Math.max(visits, payments);
          const totalFillPct  = inS ? Math.min(100, Math.round((activity / expectedPerMonth) * 100)) : 0;
          const paidFillPct   = activity > 0 ? Math.min(totalFillPct, Math.round((payments / expectedPerMonth) * 100)) : 0;
          const unpaidFillPct = Math.max(0, totalFillPct - paidFillPct);

          return (
            <div key={m} className="flex-1 flex flex-col items-center gap-1">
              <div className="relative w-full h-7 rounded-sm overflow-hidden bg-gray-100">
                {inS && isPast && activity === 0 && (
                  <div className="absolute inset-0 border border-gray-200 rounded-sm" />
                )}
                {inS && isCurrent && activity === 0 && (
                  <div className="absolute inset-0 bg-blue-50" />
                )}
                {unpaidFillPct > 0 && (
                  <div className="absolute left-0 right-0 bg-blue-400 transition-all"
                    style={{ height: `${unpaidFillPct}%`, bottom: `${paidFillPct}%` }} />
                )}
                {paidFillPct > 0 && (
                  <div className="absolute bottom-0 left-0 right-0 bg-emerald-400 transition-all"
                    style={{ height: `${paidFillPct}%` }} />
                )}
              </div>
              <span className="text-[9px] text-gray-400 leading-none">{MONTH_NAMES_SHORT[m - 1]}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
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
  const [name, setName]         = useState(event.name);
  const [budget, setBudget]     = useState(event.budget ? String(event.budget) : "");
  const [date, setDate]         = useState(event.date ?? "");
  const [type, setType]         = useState<"one-off" | "annual">(event.type);
  const [color, setColor]       = useState<EventColor>(event.color);
  const [avgPerVisit, setAvg]   = useState(event.avgPerVisit ? String(event.avgPerVisit) : "");
  const [vendor, setVendor]     = useState(event.vendor ?? "");
  const [category, setCategory] = useState(event.category ?? "");
  const [notes, setNotes]       = useState(event.notes ?? "");
  const [saving, setSaving]     = useState(false);
  const [err, setErr]           = useState<string | null>(null);

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
          avgPerVisit: avgPerVisit ? parseFloat(avgPerVisit) : "",
          vendor: vendor.trim() || "",
          category: category.trim() || "",
          notes: notes.trim() || "",
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to save");
      onSaved({
        ...event,
        name: name.trim(), type, color,
        date: date || undefined,
        budget: budget ? parseFloat(budget) : undefined,
        avgPerVisit: avgPerVisit ? parseFloat(avgPerVisit) : undefined,
        vendor: vendor.trim() || undefined,
        category: category.trim() || undefined,
        notes: notes.trim() || undefined,
      });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const hc = homeCurrency;
  const curSym = getCurrencySymbol(hc).trim();

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
            <input value={name} onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500" />
          </div>
          {event.kind !== "service" && (
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="block text-xs font-medium text-gray-700 mb-1">Target date</label>
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500" />
              </div>
              <div className="flex-1">
                <label className="block text-xs font-medium text-gray-700 mb-1">Budget ({curSym})</label>
                <input type="number" min="0" step="0.01" value={budget} onChange={(e) => setBudget(e.target.value)}
                  placeholder="Optional"
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500" />
              </div>
            </div>
          )}
          {event.kind === "service" && (
            <>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="block text-xs font-medium text-gray-700 mb-1">Expected per visit ({curSym})</label>
                  <input type="number" min="0" step="0.01" value={avgPerVisit} onChange={(e) => setAvg(e.target.value)}
                    placeholder="e.g. 85"
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500" />
                </div>
                <div className="flex-1">
                  <label className="block text-xs font-medium text-gray-700 mb-1">Budget ({curSym})</label>
                  <input type="number" min="0" step="0.01" value={budget} onChange={(e) => setBudget(e.target.value)}
                    placeholder="Optional annual cap"
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Vendor / provider</label>
                <input value={vendor} onChange={(e) => setVendor(e.target.value)}
                  placeholder="e.g. John's Lawn Care"
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500" />
              </div>
            </>
          )}
          {event.kind !== "service" && (
            <>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="block text-xs font-medium text-gray-700 mb-1">Type</label>
                  <div className="flex gap-2">
                    {(["one-off", "annual"] as const).map((t) => (
                      <button key={t} type="button" onClick={() => setType(t)}
                        className={`flex-1 rounded-lg border py-2 text-xs font-medium transition-colors ${
                          type === t ? "border-purple-500 bg-purple-50 text-purple-700" : "border-gray-200 text-gray-600 hover:border-gray-300"
                        }`}>
                        {t === "one-off" ? "One-off" : "Annual (repeats)"}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex-1">
                  <label className="block text-xs font-medium text-gray-700 mb-1">Category</label>
                  <input value={category} onChange={(e) => setCategory(e.target.value)}
                    placeholder="e.g. Trip, Home, Medical"
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Notes</label>
                <textarea value={notes} onChange={(e) => setNotes(e.target.value)}
                  rows={2} placeholder="Add a description…"
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 resize-none" />
              </div>
            </>
          )}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Colour</label>
            <div className="flex flex-wrap gap-2">
              {EVENT_COLORS.map((c) => (
                <button key={c.id} type="button" onClick={() => setColor(c.id)} title={c.label}
                  className={`h-7 w-7 rounded-full ${c.bg} border-2 transition-all ${color === c.id ? `${c.border} scale-110` : "border-transparent"}`} />
              ))}
            </div>
          </div>
          {err && <p className="text-xs text-red-600">{err}</p>}
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 rounded-lg border border-gray-200 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50">Cancel</button>
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

// ── Inline note editor ────────────────────────────────────────────────────────

function NoteEditor({ fingerprint, initialNote, headers, onSaved }: {
  fingerprint: string; initialNote?: string; headers: Record<string, string>; onSaved: (note: string) => void;
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
      onSaved(value); setEditing(false);
    } finally { setSaving(false); }
  }

  if (!editing) return (
    <button onClick={() => setEditing(true)} className="text-[11px] text-gray-400 hover:text-purple-600 transition mt-0.5 text-left">
      {initialNote ? initialNote : "+ Add note"}
    </button>
  );

  return (
    <div className="flex items-center gap-1.5 mt-0.5">
      <input ref={inputRef} value={value} onChange={(e) => setValue(e.target.value)}
        placeholder="Add a note…"
        className="flex-1 rounded border border-gray-200 px-2 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-purple-400"
        onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") { setValue(initialNote ?? ""); setEditing(false); } }} />
      <button onClick={save} disabled={saving} className="text-[11px] font-medium text-purple-600 hover:underline disabled:opacity-50">{saving ? "…" : "Save"}</button>
      <button onClick={() => { setValue(initialNote ?? ""); setEditing(false); }} className="text-[11px] text-gray-400 hover:text-gray-600">✕</button>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function EventDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();

  const [token, setToken]                 = useState<string | null>(null);
  const [event, setEvent]                 = useState<UserEvent | null>(null);
  const [tagged, setTagged]               = useState<TaggedTransaction[]>([]);
  const [visitLogs, setVisitLogs]         = useState<VisitLog[]>([]);
  const [ledgerEntries, setLedgerEntries] = useState<ProjectLedgerEntry[]>([]);
  const [totalSpent, setTotalSpent]       = useState(0);
  const [loading, setLoading]             = useState(true);
  const [showEdit, setShowEdit]           = useState(false);
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm]   = useState(false);
  const [archiving, setArchiving]         = useState(false);
  const [deleting, setDeleting]           = useState(false);
  const [removing, setRemoving]           = useState<string | null>(null);
  const [removingVisit, setRemovingVisit] = useState<string | null>(null);
  const [currentYear, setCurrentYear]     = useState<string | null>(null);

  // Service tracker — shared log modal; project — shared add expense modal
  const [logModalOpen, setLogModalOpen] = useState(false);
  const [addExpenseOpen, setAddExpenseOpen] = useState(false);

  // Activity tab
  const [activityTab, setActivityTab]     = useState<"all" | "visits" | "payments">("all");

  // Project ledger
  const [showLedgerForm, setShowLedgerForm]       = useState(false);
  const [ledgerDate, setLedgerDate]               = useState(() => new Date().toISOString().substring(0, 10));
  const [ledgerAmount, setLedgerAmount]           = useState("");
  const [ledgerNote, setLedgerNote]               = useState("");
  const [ledgerEntryType, setLedgerEntryType]     = useState<"cash" | "manual">("manual");
  const [savingLedger, setSavingLedger]           = useState(false);
  const [removingLedger, setRemovingLedger]       = useState<string | null>(null);

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
      const res  = await fetch("/api/user/currency-info", { headers: buildHeaders(token) });
      const json = await res.json().catch(() => ({}));
      if (!cancelled && json.homeCurrency) setHomeCurrency(json.homeCurrency);
    })();
    return () => { cancelled = true; };
  }, [token, buildHeaders]);

  const load = useCallback(async (tok: string, opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    try {
      const res  = await fetch(`/api/user/events/${id}`, { headers: buildHeaders(tok) });
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
      if (!opts?.silent) setLoading(false);
    }
  }, [id, buildHeaders, router]);

  useEffect(() => { if (token) load(token); }, [token, load, targetUid]);

  /** Open log / add-expense modal when arriving from trackers list (?log=1 | ?addExpense=1). */
  const queryConsumedRef = useRef(false);
  useEffect(() => {
    queryConsumedRef.current = false;
  }, [id]);

  useEffect(() => {
    if (!event || typeof window === "undefined" || queryConsumedRef.current) return;
    const params = new URLSearchParams(window.location.search);
    const logQ = params.get("log");
    const addQ = params.get("addExpense");
    if (logQ !== "1" && addQ !== "1") return;

    if (logQ === "1" && event.kind === "service") {
      setLogModalOpen(true);
    }
    const isProject = (event.kind ?? "project") === "project";
    if (addQ === "1" && isProject) {
      setAddExpenseOpen(true);
    }
    queryConsumedRef.current = true;
    const url = new URL(window.location.href);
    url.searchParams.delete("log");
    url.searchParams.delete("addExpense");
    const q = url.searchParams.toString();
    window.history.replaceState({}, "", url.pathname + (q ? `?${q}` : "") + url.hash);
  }, [event]);

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
    } finally { setRemovingVisit(null); }
  }

  async function handleRemove(fingerprint: string) {
    if (!token) return;
    setRemoving(fingerprint);
    const row = tagged.find((t) => t.fingerprint === fingerprint);
    try {
      const res = await fetch("/api/user/tx-tags", {
        method: "POST",
        headers: { ...buildHeaders(token), "Content-Type": "application/json" },
        body: JSON.stringify({ fingerprint, remove: [id], ...(row?.date ? { date: row.date } : {}) }),
      });
      if (res.ok) {
        const removed = tagged.find((t) => t.fingerprint === fingerprint);
        setTagged((prev) => prev.filter((t) => t.fingerprint !== fingerprint));
        if (removed) setTotalSpent((s) => Math.max(0, s - removed.amount));
      }
    } finally { setRemoving(null); }
  }

  async function performArchive() {
    if (!token) return;
    setArchiving(true);
    try {
      const res = await fetch(`/api/user/events/${id}`, { method: "DELETE", headers: buildHeaders(token) });
      if (res.ok) router.push("/account/events");
    } finally { setArchiving(false); setShowArchiveConfirm(false); }
  }

  async function performDelete() {
    if (!token) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/user/events/${id}`, {
        method: "DELETE",
        headers: { ...buildHeaders(token), "Content-Type": "application/json" },
        body: JSON.stringify({ permanent: true }),
      });
      if (res.ok) router.push("/account/events");
    } finally { setDeleting(false); setShowDeleteConfirm(false); }
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
        body: JSON.stringify({ date: ledgerDate, amount: amt, entryType: ledgerEntryType, ...(ledgerNote.trim() ? { note: ledgerNote.trim() } : {}) }),
      });
      if (res.ok) {
        const json = await res.json() as { entry: ProjectLedgerEntry };
        setLedgerEntries((prev) => [json.entry, ...prev].sort((a, b) => b.date.localeCompare(a.date)));
        setTotalSpent((s) => s + json.entry.amount);
        setEvent((ev) => ev ? { ...ev, ledgerTotal: (ev.ledgerTotal ?? 0) + json.entry.amount, ledgerEntryCount: (ev.ledgerEntryCount ?? 0) + 1 } : ev);
        setLedgerAmount(""); setLedgerNote(""); setShowLedgerForm(false);
      }
    } finally { setSavingLedger(false); }
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
        setEvent((ev) => ev ? { ...ev, ledgerTotal: Math.max(0, (ev.ledgerTotal ?? 0) - removed.amount), ledgerEntryCount: Math.max(0, (ev.ledgerEntryCount ?? 1) - 1) } : ev);
      }
    } finally { setRemovingLedger(null); }
  }

  function handleNoteUpdate(fingerprint: string, note: string) {
    setTagged((prev) => prev.map((t) => t.fingerprint === fingerprint ? { ...t, note: note || undefined } : t));
  }

  const headers    = token ? buildHeaders(token) : {};
  const pct        = event?.budget ? Math.min(100, Math.round((totalSpent / event.budget) * 100)) : null;
  const cfg        = event ? colorCfg(event.color) : EVENT_COLORS[0];
  const hc         = homeCurrency;
  const curSym     = getCurrencySymbol(hc).trim();

  // ── Service-specific derived data ────────────────────────────────────────

  const sortedVisits = visitLogs.filter((v) => v?.date).sort((a, b) => a.date.localeCompare(b.date));

  // Longest gap between consecutive visits
  let longestGap = 0;
  for (let i = 1; i < sortedVisits.length; i++) {
    longestGap = Math.max(longestGap, daysBetween(sortedVisits[i-1].date, sortedVisits[i].date));
  }

  // All payments (visits with paymentMethod + statement-tagged)
  const allPayments = [
    ...visitLogs.filter((v) => v?.date && v.paymentMethod),
    ...tagged.filter((t) => t?.date),
  ].sort((a, b) => b.date.localeCompare(a.date));
  const lastPaymentDate = allPayments[0]?.date;

  // Visits since last payment (unbilled)
  const visitsSinceLastPay = lastPaymentDate
    ? visitLogs.filter((v) => v?.date && !v.paymentMethod && v.date > lastPaymentDate).length
    : visitLogs.filter((v) => v?.date && !v.paymentMethod).length;
  const avgCostPerVisit = event?.avgPerVisit ?? (visitLogs.length > 0 && totalSpent > 0 ? totalSpent / visitLogs.length : 0);
  const estimatedOwed = visitsSinceLastPay * avgCostPerVisit;

  // Pending payments (card placeholders, not yet confirmed by statement)
  const pendingPayments = visitLogs.filter((v) => v?.paymentMethod === "card").length;

  // By season: group visitsByMonth by year
  const byYear: Record<string, { visits: number; spent: number }> = {};
  if (event?.visitsByMonth) {
    for (const [ym, count] of Object.entries(event.visitsByMonth)) {
      const yr = ym.substring(0, 4);
      if (!byYear[yr]) byYear[yr] = { visits: 0, spent: 0 };
      byYear[yr].visits += count;
      byYear[yr].spent  += count * avgCostPerVisit;
    }
  }
  const byYearSorted = Object.entries(byYear).sort(([a], [b]) => b.localeCompare(a));
  const maxYearSpent  = Math.max(...byYearSorted.map(([, d]) => d.spent), 1);

  // postCashPayment helper for payment panel
  async function postCashPayment(p: { date: string; amount: number; note?: string; paymentMethod?: "cash" | "card" }) {
    if (!token) return false;
    const res = await fetch(`/api/user/events/${id}/visits`, {
      method: "POST",
      headers: { ...buildHeaders(token), "Content-Type": "application/json" },
      body: JSON.stringify(p),
    });
    if (res.ok) {
      const json = await res.json() as { visit: VisitLog };
      if (json.visit) {
        setVisitLogs((prev) => [json.visit, ...prev].sort((a, b) => b.date.localeCompare(a.date)));
        setTotalSpent((s) => s + (p.amount ?? 0));
      }
    }
    return res.ok;
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#f8f7f4]">
        <div className="mx-auto max-w-4xl px-4 py-8 space-y-4">
          <div className="h-8 w-48 bg-gray-100 rounded-lg animate-pulse" />
          <div className="h-32 bg-gray-100 rounded-2xl animate-pulse" />
          <div className="h-64 bg-gray-100 rounded-2xl animate-pulse" />
        </div>
      </div>
    );
  }

  if (!event) return null;

  const isService = event.kind === "service";

  return (
    <div className="min-h-screen bg-[#f8f7f4]">
      <div className="mx-auto max-w-4xl px-4 py-8">

        {/* Back nav */}
        <button onClick={() => router.push("/account/events")}
          className="mb-5 flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700">
          ← Trackers
        </button>

        {/* ── Header ────────────────────────────────────────────────────── */}
        <div className={`rounded-2xl border ${cfg.border} bg-white p-5 mb-5 shadow-sm`}>
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <span className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${cfg.bg} text-xl`}>
                {isService ? "🔧" : "🗓"}
              </span>
              <div className="min-w-0">
                <h1 className="text-xl font-bold text-gray-900">
                  {event.name}
                  {event.vendor && <span className="font-normal text-gray-400"> · {event.vendor}</span>}
                </h1>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${cfg.bg} ${cfg.text}`}>
                    {isService ? "Service" : event.type === "annual" ? "Annual" : "Project"}
                  </span>
                  {isService ? (
                    <>
                      <span className="text-xs text-gray-400">{cadenceLabelShort(event.cadence ?? "monthly", event.seasonStart, event.seasonEnd, event.billingMethod)}</span>
                    </>
                  ) : (
                    <>
                      {(event.startDate ?? event.date) && <span className="text-xs text-gray-400">{fmtDate(event.startDate ?? event.date)}</span>}
                      {event.endDate && <span className="text-xs text-gray-400">→ {fmtDate(event.endDate)}</span>}
                      {event.type === "annual" && currentYear && <span className="text-xs text-gray-400">· {currentYear} total</span>}
                    </>
                  )}
                </div>
              </div>
            </div>
            <div className="text-right shrink-0">
              <p className="text-2xl font-bold text-gray-900">{fmt(totalSpent, hc)}</p>
              {isService ? (
                <p className="text-xs text-gray-400 mt-0.5">
                  {avgCostPerVisit > 0 && <span>spent · {fmt(avgCostPerVisit, hc)} avg / visit</span>}
                </p>
              ) : (
                event.budget && <p className="text-sm text-gray-400">of {fmt(event.budget, hc)} budget</p>
              )}
              {isService && (
                <p className="text-xs text-gray-500 mt-0.5">
                  {visitLogs.length} visit{visitLogs.length !== 1 ? "s" : ""} · {allPayments.length} payment{allPayments.length !== 1 ? "s" : ""}
                </p>
              )}
            </div>
          </div>

          {/* Budget bar (non-service) */}
          {!isService && pct != null && (
            <div className="mt-4 h-2 w-full rounded-full bg-gray-100">
              <div className={`h-2 rounded-full transition-all ${pct >= 100 ? "bg-red-400" : cfg.bg}`} style={{ width: `${pct}%` }} />
            </div>
          )}
        </div>

        {/* ── Service tracker layout ─────────────────────────────────────── */}
        {isService && (
          <>
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_260px] gap-5 items-start">

            {/* LEFT column */}
            <div className="space-y-4">

              {/* Season timeline card */}
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-5 py-4">
                <div className="flex items-center justify-between mb-4">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
                    Season Timeline · {new Date().getFullYear()}
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      if (logModalOpen) setLogModalOpen(false);
                      else setLogModalOpen(true);
                    }}
                    className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                      logModalOpen
                        ? "bg-gray-100 text-gray-600 hover:bg-gray-200"
                        : "bg-indigo-600 text-white hover:bg-indigo-700"
                    }`}>
                    {logModalOpen ? "Close" : "+ Log"}
                  </button>
                </div>
                <SeasonTimeline event={event} />

                {/* Balance banner */}
                {visitsSinceLastPay > 0 && (
                  <div className="mt-4 flex items-center justify-between rounded-lg bg-amber-50 border border-amber-100 px-4 py-2.5">
                    <p className="text-xs text-amber-700">
                      Balance · {visitsSinceLastPay} visit{visitsSinceLastPay !== 1 ? "s" : ""} since last payment
                    </p>
                    {estimatedOwed > 0 && (
                      <span className="text-xs font-semibold text-amber-800">~{fmt(estimatedOwed, hc)} owed</span>
                    )}
                  </div>
                )}
              </div>

              {/* Activity section */}
              {(() => {
                type ActivityItem =
                  | { kind: "visit";     date: string; id: string; note?: string }
                  | { kind: "cash";      date: string; id: string; amount?: number; note?: string }
                  | { kind: "card";      date: string; id: string; amount?: number; note?: string }
                  | { kind: "statement"; date: string; fingerprint: string; description: string; amount: number; accountLabel: string; note?: string };

                const allItems: ActivityItem[] = [
                  ...visitLogs.filter((v) => v?.date && !v.paymentMethod).map((v) => ({ kind: "visit" as const, date: v.date, id: v.id, note: v.note })),
                  ...visitLogs.filter((v) => v?.date && v.paymentMethod === "cash").map((v) => ({ kind: "cash" as const, date: v.date, id: v.id, amount: v.amount, note: v.note })),
                  ...visitLogs.filter((v) => v?.date && v.paymentMethod === "card").map((v) => ({ kind: "card" as const, date: v.date, id: v.id, amount: v.amount, note: v.note })),
                  ...tagged.map((t) => ({ kind: "statement" as const, date: t.date, fingerprint: t.fingerprint, description: t.description, amount: t.amount, accountLabel: t.accountLabel, note: t.note })),
                ].sort((a, b) => b.date.localeCompare(a.date));

                const visibleItems = activityTab === "all" ? allItems
                  : activityTab === "visits" ? allItems.filter((i) => i.kind === "visit")
                  : allItems.filter((i) => i.kind !== "visit");

                const fmtDay = (iso: string) =>
                  new Date(iso + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });

                const paymentStatusLabel = (item: ActivityItem): { label: string; sub: string } | null => {
                  if (item.kind === "cash") return { label: "Cash", sub: "Confirmed" };
                  if (item.kind === "card") return { label: "Card", sub: "Pending · awaiting statement match" };
                  if (item.kind === "statement") return { label: "Statement", sub: "Verified · from statement" };
                  return null;
                };

                return (
                  <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                    {/* Tab header */}
                    <div className="flex items-center justify-between border-b border-gray-100 px-5">
                      <div className="flex">
                        {(["all", "visits", "payments"] as const).map((tab) => (
                          <button key={tab} onClick={() => setActivityTab(tab)}
                            className={`py-3.5 px-3 text-xs font-semibold border-b-2 transition ${
                              activityTab === tab
                                ? "border-indigo-600 text-gray-900"
                                : "border-transparent text-gray-400 hover:text-gray-600"
                            }`}>
                            {tab === "all" ? "All" : tab === "visits" ? "Visits" : "Payments"}
                          </button>
                        ))}
                      </div>
                      <span className="text-[10px] font-medium text-gray-400 uppercase tracking-wider">Newest first</span>
                    </div>

                    {visibleItems.length === 0 ? (
                      <div className="px-5 py-10 text-center">
                        <p className="text-sm text-gray-500">
                          {activityTab === "visits" ? "No visits logged yet." : activityTab === "payments" ? "No payments recorded yet." : "No activity yet."}
                        </p>
                        <p className="text-xs text-gray-400 mt-1">Use the buttons above the timeline to log.</p>
                      </div>
                    ) : (
                      <div className="divide-y divide-gray-50">
                        {visibleItems.map((item) => {
                          if (item.kind === "visit") return (
                            <div key={`v-${item.id}`} className="flex items-start gap-3 px-5 py-3.5">
                              <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center shrink-0 mt-0.5">
                                <span className="text-[11px] text-gray-500">✓</span>
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="flex items-baseline gap-2">
                                  <p className="text-xs font-medium text-gray-500">{fmtDay(item.date)}</p>
                                  <p className="text-sm font-semibold text-gray-800">Visit</p>
                                </div>
                                {item.note && <p className="text-xs text-gray-400 mt-0.5 italic">&ldquo;{item.note}&rdquo;</p>}
                              </div>
                              <button onClick={() => handleRemoveVisit(item.id)} disabled={removingVisit === item.id}
                                className="text-xs text-gray-300 hover:text-red-400 disabled:opacity-40 transition px-1 py-1">
                                {removingVisit === item.id ? "…" : "✕"}
                              </button>
                            </div>
                          );

                          const ps = paymentStatusLabel(item)!;
                          const isCard = item.kind === "card";
                          const isCash = item.kind === "cash";
                          const isStmt = item.kind === "statement";

                          const dotClass = isStmt ? "bg-indigo-500" : isCash ? "bg-emerald-500" : "bg-amber-400";
                          const amountStr = "amount" in item && item.amount != null
                            ? fmt(item.amount, hc)
                            : null;

                          return (
                            <div key={item.kind === "statement" ? `s-${item.fingerprint}` : `p-${item.id}`}
                              className="flex items-start gap-3 px-5 py-3.5">
                              <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${isStmt ? "bg-indigo-50" : isCash ? "bg-emerald-50" : "bg-amber-50"}`}>
                                <div className={`w-2.5 h-2.5 rounded-full ${dotClass}`} />
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="flex items-baseline gap-2 flex-wrap">
                                  <p className="text-xs font-medium text-gray-500">{fmtDay(item.date)}</p>
                                  <p className="text-sm font-semibold text-gray-800">
                                    Payment · {amountStr ?? "—"}
                                  </p>
                                </div>
                                <p className={`text-xs mt-0.5 ${isCard ? "text-amber-600" : "text-gray-400"}`}>
                                  {ps.sub}
                                  {item.kind === "statement" && " · " + item.accountLabel}
                                  {item.note && <> · <em>&ldquo;{item.note}&rdquo;</em></>}
                                </p>
                                {item.kind === "statement" && (
                                  <NoteEditor fingerprint={item.fingerprint} initialNote={item.note}
                                    headers={headers} onSaved={(note) => handleNoteUpdate(item.fingerprint, note)} />
                                )}
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                {amountStr && <span className="text-sm font-bold text-gray-900">{amountStr}</span>}
                                {item.kind === "statement" ? (
                                  <button onClick={() => handleRemove(item.fingerprint)} disabled={removing === item.fingerprint}
                                    className="text-xs text-gray-300 hover:text-red-400 disabled:opacity-40 transition px-1 py-1">
                                    {removing === item.fingerprint ? "…" : "✕"}
                                  </button>
                                ) : (
                                  <button onClick={() => handleRemoveVisit(item.id)} disabled={removingVisit === item.id}
                                    className="text-xs text-gray-300 hover:text-red-400 disabled:opacity-40 transition px-1 py-1">
                                    {removingVisit === item.id ? "…" : "✕"}
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>

            {/* RIGHT column */}
            <div className="space-y-4">

              {/* Settings panel */}
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-5 py-4">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Settings</p>
                  <button onClick={() => setShowEdit(true)}
                    className="text-xs text-indigo-600 hover:underline font-medium">Edit</button>
                </div>
                <div className="space-y-3">
                  <div>
                    <p className="text-[9px] font-bold uppercase tracking-widest text-gray-400 mb-0.5">Cadence</p>
                    <p className="text-sm font-semibold text-indigo-600">
                      {{ weekly: "Weekly", biweekly: "Biweekly", monthly: "Monthly", quarterly: "Quarterly" }[event.cadence ?? "monthly"]}
                    </p>
                  </div>
                  {event.billingMethod && (
                    <div>
                      <p className="text-[9px] font-bold uppercase tracking-widest text-gray-400 mb-0.5">Billing model</p>
                      <p className="text-sm font-medium text-gray-700">
                        {event.billingMethod === "per-visit" ? "Per visit" : "Periodic · monthly"}
                      </p>
                    </div>
                  )}
                  <div>
                    <p className="text-[9px] font-bold uppercase tracking-widest text-gray-400 mb-0.5">Season</p>
                    <p className="text-sm font-medium text-gray-700">
                      {(!event.seasonStart || !event.seasonEnd || (event.seasonStart === 1 && event.seasonEnd === 12))
                        ? "Year-round"
                        : `${MONTH_NAMES_SHORT[event.seasonStart - 1]} – ${MONTH_NAMES_SHORT[event.seasonEnd - 1]}`}
                    </p>
                  </div>
                  <div>
                    <p className="text-[9px] font-bold uppercase tracking-widest text-gray-400 mb-0.5">Expected per visit</p>
                    <p className="text-sm font-medium text-gray-700">
                      {event.avgPerVisit ? fmt(event.avgPerVisit, hc) : <span className="text-gray-300 text-xs">Not set</span>}
                    </p>
                  </div>
                  <div>
                    <p className="text-[9px] font-bold uppercase tracking-widest text-gray-400 mb-0.5">Vendor</p>
                    {event.vendor ? (
                      <p className="text-sm font-medium text-gray-700">{event.vendor}</p>
                    ) : (
                      <button onClick={() => setShowEdit(true)}
                        className="text-xs text-gray-300 hover:text-indigo-500 transition">Add vendor name</button>
                    )}
                  </div>
                </div>
              </div>

              {/* This season stats */}
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-5 py-4">
                <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-3">This season</p>
                <div className="space-y-2.5">
                  {[
                    { label: "Total visits",      value: visitLogs.length.toString() },
                    { label: "Total spent",        value: fmt(totalSpent, hc) },
                    { label: "Avg per visit",      value: avgCostPerVisit > 0 ? fmt(avgCostPerVisit, hc) : "—" },
                    { label: "Longest gap",        value: longestGap > 0 ? `${longestGap} days` : "—" },
                    { label: "Pending payments",   value: pendingPayments.toString(), highlight: pendingPayments > 0 },
                  ].map(({ label, value, highlight }) => (
                    <div key={label} className="flex items-center justify-between">
                      <p className="text-xs text-gray-500">{label}</p>
                      <p className={`text-sm font-semibold ${highlight ? "text-amber-600" : "text-gray-800"}`}>{value}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* By season */}
              {byYearSorted.length > 0 && (
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-5 py-4">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-3">By season</p>
                  <div className="space-y-2.5">
                    {byYearSorted.map(([yr, data]) => {
                      const barW = Math.round((data.spent / maxYearSpent) * 100);
                      return (
                        <div key={yr}>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs font-medium text-gray-600">{yr}</span>
                            <span className="text-xs font-semibold text-gray-800">{fmt(data.spent, hc)}</span>
                          </div>
                          <div className="h-1.5 w-full rounded-full bg-gray-100">
                            <div className="h-1.5 rounded-full bg-indigo-400 transition-all" style={{ width: `${barW}%` }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {byYearSorted.length >= 2 && avgCostPerVisit > 0 && (() => {
                    const thisYr = String(new Date().getFullYear());
                    const lastYr = String(new Date().getFullYear() - 1);
                    const thisData = byYear[thisYr];
                    const lastData = byYear[lastYr];
                    if (!thisData || !lastData) return null;
                    const remaining = Math.max(0, (event.seasonEnd ?? 12) - new Date().getMonth());
                    const pace = thisData.spent + (thisData.visits / Math.max(1, new Date().getMonth() + 1 - (event.seasonStart ?? 1))) * remaining * avgCostPerVisit;
                    const diff = pace - lastData.spent;
                    return (
                      <p className="text-[11px] text-gray-400 mt-3 leading-snug">
                        On pace for ~{fmt(pace, hc)} by end of season —{" "}
                        {Math.abs(diff) < 50 ? "similar to" : diff > 0 ? "slightly above" : "slightly below"} last year.
                      </p>
                    );
                  })()}
                </div>
              )}

            </div>
          </div>

          {/* Full-width footer */}
          <div className="mt-6 flex items-center justify-between border-t border-gray-200 pt-5">
            <button onClick={() => setShowArchiveConfirm(true)}
              className="text-sm text-gray-400 hover:text-gray-600 underline">
              Done with this tracker?
            </button>
            <div className="flex gap-2">
              <button onClick={() => setShowArchiveConfirm(true)}
                className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-500 hover:bg-white">
                Archive
              </button>
              <button onClick={() => setShowDeleteConfirm(true)}
                className="rounded-lg border border-red-100 px-4 py-2 text-sm font-medium text-red-500 hover:bg-red-50">
                Delete tracker
              </button>
            </div>
          </div>
          </>
        )}

        {/* ── Project / one-time layout ──────────────────────────────────── */}
        {!isService && (() => {
          // ── Trip / date metrics ──────────────────────────────────────
          const tripStart = event.startDate ?? event.date;
          const tripEnd   = event.endDate;
          const todayStr  = new Date().toISOString().substring(0, 10);
          const msPerDay  = 86_400_000;

          const startMs = tripStart ? new Date(tripStart + "T00:00:00").getTime() : null;
          const endMs   = tripEnd   ? new Date(tripEnd   + "T00:00:00").getTime() : null;
          const todayMs = new Date(todayStr + "T00:00:00").getTime();

          const tripTotalDays   = (startMs && endMs) ? Math.round((endMs - startMs) / msPerDay) + 1 : null;
          const daysElapsed     = startMs ? Math.max(1, Math.min(tripTotalDays ?? 999, Math.round((todayMs - startMs) / msPerDay) + 1)) : null;
          const daysRemaining   = endMs   ? Math.max(0, Math.round((endMs - todayMs) / msPerDay)) : null;
          const tripStatus      = !startMs ? null : todayMs < startMs ? "upcoming" : endMs && todayMs > endMs ? "ended" : "active";

          const dailyBurn       = (daysElapsed && daysElapsed > 0) ? totalSpent / daysElapsed : 0;
          const remaining       = event.budget ? Math.max(0, event.budget - totalSpent) : null;
          const dailyAllowance  = (remaining != null && daysRemaining != null && daysRemaining > 0) ? remaining / daysRemaining : null;
          const projectedTotal  = event.budget && dailyBurn > 0 && daysRemaining != null
            ? totalSpent + dailyBurn * daysRemaining
            : null;
          const projectedOver   = projectedTotal != null && event.budget ? projectedTotal - event.budget : null;

          // day-label for a transaction date
          function dayLabel(date: string): string {
            if (!startMs) return txDate(date);
            const d = new Date(date + "T00:00:00").getTime();
            if (d < startMs) return "Pre-trip";
            if (endMs && d > endMs) return "Post-trip";
            return `Day ${Math.round((d - startMs) / msPerDay) + 1}`;
          }

          // ── Unified payments list ────────────────────────────────────
          type PayItem =
            | { kind: "verified"; date: string; fingerprint: string; description: string; amount: number; accountLabel: string; note?: string }
            | { kind: "pending";  date: string; id: string; note?: string; amount: number; entryType: "cash" | "manual"; category?: string };

          const allPayItems: PayItem[] = [
            ...tagged.map((t) => ({ kind: "verified" as const, date: t.date, fingerprint: t.fingerprint, description: t.description, amount: t.amount, accountLabel: t.accountLabel, note: t.note })),
            ...ledgerEntries.map((l) => ({ kind: "pending" as const, date: l.date, id: l.id, note: l.note, amount: l.amount, entryType: l.entryType, category: l.category })),
          ].sort((a, b) => b.date.localeCompare(a.date));

          // ── Spend velocity chart data ────────────────────────────────
          const chartItems = [...allPayItems].sort((a, b) => a.date.localeCompare(b.date));
          const velocityPoints: { x: number; y: number }[] = [];
          if (chartItems.length > 0 && startMs) {
            let cum = 0;
            const totalDaysSpan = tripTotalDays ?? 30;
            for (const item of chartItems) {
              cum += item.amount;
              const d = new Date(item.date + "T00:00:00").getTime();
              const dayOffset = Math.max(0, Math.round((d - startMs) / msPerDay));
              velocityPoints.push({ x: Math.min(1, dayOffset / Math.max(1, totalDaysSpan - 1)), y: cum });
            }
          }

          // ── Activity tab filter ──────────────────────────────────────
          const [projTab, setProjTab] = [activityTab, setActivityTab];
          const visiblePayItems = projTab === "all" ? allPayItems
            : projTab === "visits" ? allPayItems.filter((i) => i.kind === "pending")
            : allPayItems.filter((i) => i.kind === "verified");

          return (
            <div>
              <div className="grid grid-cols-1 lg:grid-cols-[1fr_260px] gap-5 items-start">

                {/* LEFT column */}
                <div className="space-y-4">

                  {/* Budget card */}
                  <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-5 py-4">
                    <div className="flex items-center justify-between mb-3">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Budget</p>
                      <button type="button"
                        onClick={() => setAddExpenseOpen(true)}
                        className="rounded-lg bg-purple-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-purple-700 transition">
                        + Add expense
                      </button>
                    </div>

                    <div className="flex items-end justify-between mb-2">
                      <div>
                        <p className="text-2xl font-bold text-gray-900">{fmt(totalSpent, hc)} <span className="text-sm font-normal text-gray-400">spent</span></p>
                        {event.budget && remaining != null && (
                          <p className="text-xs text-gray-400">{fmt(remaining, hc)} remaining of {fmt(event.budget, hc)}</p>
                        )}
                      </div>
                    </div>

                    {pct != null && (
                      <div className="h-2.5 w-full rounded-full bg-gray-100 mb-3">
                        <div className={`h-2.5 rounded-full transition-all ${pct >= 100 ? "bg-red-400" : "bg-purple-500"}`} style={{ width: `${pct}%` }} />
                      </div>
                    )}

                    {/* Pace banner */}
                    {dailyBurn > 0 && projectedOver != null && (
                      <div className={`rounded-lg px-4 py-2.5 mb-2 ${projectedOver > 0 ? "bg-red-50 border border-red-100" : "bg-emerald-50 border border-emerald-100"}`}>
                        <p className={`text-xs font-medium ${projectedOver > 0 ? "text-red-700" : "text-emerald-700"}`}>
                          Pace · {fmt(dailyBurn, hc)}/day on the trip ·{" "}
                          {projectedOver > 0
                            ? `projected ${fmt(projectedOver, hc)} over`
                            : `projected ${fmt(Math.abs(projectedOver), hc)} under`}
                        </p>
                      </div>
                    )}

                    {/* Trip day counter */}
                    {tripStatus && tripTotalDays != null && (
                      <p className="text-xs text-gray-400 text-center">
                        {tripStatus === "upcoming" && `Trip starts in ${Math.round((startMs! - todayMs) / msPerDay)} day${Math.round((startMs! - todayMs) / msPerDay) !== 1 ? "s" : ""}`}
                        {tripStatus === "active" && daysElapsed != null && daysRemaining != null && `Day ${daysElapsed} of ${tripTotalDays} · trip ends in ${daysRemaining} day${daysRemaining !== 1 ? "s" : ""}`}
                        {tripStatus === "ended" && `Trip ended · ${tripTotalDays} days`}
                      </p>
                    )}
                  </div>

                  {/* Activity */}
                  <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                    <div className="flex items-center justify-between border-b border-gray-100 px-5">
                      <div className="flex">
                        {(["all", "visits", "payments"] as const).map((tab) => (
                          <button key={tab} onClick={() => setProjTab(tab)}
                            className={`py-3.5 px-3 text-xs font-semibold border-b-2 transition ${
                              projTab === tab ? "border-purple-600 text-gray-900" : "border-transparent text-gray-400 hover:text-gray-600"
                            }`}>
                            {tab === "all" ? "All payments" : tab === "visits" ? "Pending" : "Verified"}
                          </button>
                        ))}
                      </div>
                      <span className="text-[10px] font-medium text-gray-400 uppercase tracking-wider">Newest first</span>
                    </div>

                    {visiblePayItems.length === 0 ? (
                      <div className="px-5 py-10 text-center">
                        <p className="text-sm text-gray-500">No payments yet.</p>
                        <p className="text-xs text-gray-400 mt-1">Use &quot;+ Add expense&quot; to tag a statement transaction or enter spending manually.</p>
                      </div>
                    ) : (
                      <div className="divide-y divide-gray-50">
                        {visiblePayItems.map((item) => {
                          const isPending = item.kind === "pending";
                          const isCash    = isPending && item.entryType === "cash";
                          const dotBg     = isPending ? (isCash ? "bg-emerald-500" : "bg-amber-400") : "bg-indigo-500";
                          const dotRing   = isPending ? (isCash ? "bg-emerald-50" : "bg-amber-50") : "bg-indigo-50";
                          const statusLine = isPending
                            ? isCash ? "Cash · manual entry" : "Pending · awaiting statement match"
                            : "Verified · from statement";

                          return (
                            <div key={isPending ? `l-${item.id}` : `t-${item.fingerprint}`}
                              className="flex items-start gap-3 px-5 py-3.5">
                              <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${dotRing}`}>
                                <div className={`w-2.5 h-2.5 rounded-full ${dotBg}`} />
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="flex items-baseline gap-2">
                                  <p className="text-xs font-medium text-gray-400">{txDate(item.date)}</p>
                                  {startMs && <p className="text-[10px] text-gray-300">{dayLabel(item.date)}</p>}
                                </div>
                                <p className="text-sm font-semibold text-gray-800 truncate mt-0.5">
                                  {isPending ? (item.note ?? "Manual entry") : item.description}
                                </p>
                                <p className={`text-xs mt-0.5 ${isCash || !isPending ? "text-gray-400" : "text-amber-600"}`}>
                                  {item.kind === "pending" && item.category ? `${item.category} · ` : ""}{statusLine}
                                  {!isPending && item.note && <> · <em>&ldquo;{item.note}&rdquo;</em></>}
                                </p>
                                {!isPending && (
                                  <NoteEditor fingerprint={item.fingerprint} initialNote={item.note}
                                    headers={headers} onSaved={(note) => handleNoteUpdate(item.fingerprint, note)} />
                                )}
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                <span className="text-sm font-bold text-gray-900">{fmt(item.amount, hc)}</span>
                                {isPending ? (
                                  <button onClick={() => handleRemoveLedgerEntry(item.id)} disabled={removingLedger === item.id}
                                    className="text-xs text-gray-300 hover:text-red-400 disabled:opacity-40 transition px-1">
                                    {removingLedger === item.id ? "…" : "✕"}
                                  </button>
                                ) : (
                                  <button onClick={() => handleRemove(item.fingerprint)} disabled={removing === item.fingerprint}
                                    className="text-xs text-gray-300 hover:text-red-400 disabled:opacity-40 transition px-1">
                                    {removing === item.fingerprint ? "…" : "✕"}
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>

                {/* RIGHT column */}
                <div className="space-y-4">

                  {/* Settings */}
                  <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-5 py-4">
                    <div className="flex items-center justify-between mb-3">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Settings</p>
                      <button onClick={() => setShowEdit(true)} className="text-xs text-purple-600 hover:underline font-medium">Edit</button>
                    </div>
                    <div className="space-y-3">
                      {event.budget && (
                        <div>
                          <p className="text-[9px] font-bold uppercase tracking-widest text-gray-400 mb-0.5">Budget</p>
                          <p className="text-sm font-semibold text-gray-800">{fmt(event.budget, hc)}</p>
                        </div>
                      )}
                      {tripStart && (
                        <div>
                          <p className="text-[9px] font-bold uppercase tracking-widest text-gray-400 mb-0.5">Starts</p>
                          <p className="text-sm font-medium text-gray-700">{fmtDate(tripStart)}</p>
                        </div>
                      )}
                      {tripEnd && (
                        <div>
                          <p className="text-[9px] font-bold uppercase tracking-widest text-gray-400 mb-0.5">Ends</p>
                          <p className="text-sm font-medium text-gray-700">{fmtDate(tripEnd)}</p>
                        </div>
                      )}
                      <div>
                        <p className="text-[9px] font-bold uppercase tracking-widest text-gray-400 mb-0.5">Category</p>
                        {event.category ? (
                          <p className="text-sm font-medium text-gray-700">{event.category}</p>
                        ) : (
                          <button onClick={() => setShowEdit(true)} className="text-xs text-gray-300 hover:text-purple-500 transition">Add category</button>
                        )}
                      </div>
                      <div>
                        <p className="text-[9px] font-bold uppercase tracking-widest text-gray-400 mb-0.5">Notes</p>
                        {event.notes ? (
                          <p className="text-xs text-gray-600 leading-relaxed">{event.notes}</p>
                        ) : (
                          <button onClick={() => setShowEdit(true)} className="text-xs text-gray-300 hover:text-purple-500 transition">Add a description…</button>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Status */}
                  {event.budget && (
                    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-5 py-4">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-3">Status</p>
                      <div className="space-y-2.5">
                        {[
                          { label: "Spent",           value: fmt(totalSpent, hc) },
                          { label: "Remaining",        value: fmt(remaining ?? 0, hc), highlight: remaining != null && remaining < 0 },
                          { label: "% used",           value: pct != null ? `${pct}%` : "—", highlight: (pct ?? 0) >= 100 },
                          { label: "Days remaining",   value: daysRemaining != null ? `${daysRemaining}` : "—" },
                          { label: "Daily burn",       value: dailyBurn > 0 ? `${fmt(dailyBurn, hc)}/day` : "—" },
                          { label: "Daily allowance",  value: dailyAllowance != null ? `${fmt(dailyAllowance, hc)}/day` : "—", muted: true },
                        ].map(({ label, value, highlight, muted }) => (
                          <div key={label} className="flex items-center justify-between">
                            <p className="text-xs text-gray-500">{label}</p>
                            <p className={`text-sm font-semibold ${highlight ? "text-red-500" : muted ? "text-purple-600" : "text-gray-800"}`}>{value}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Spend velocity */}
                  {velocityPoints.length >= 2 && event.budget && (
                    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-5 py-4">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-3">Spend velocity</p>
                      {(() => {
                        const W = 220; const H = 80;
                        const maxY = event.budget!;
                        const pts  = velocityPoints.map((p) => `${p.x * W},${H - (p.y / maxY) * H}`).join(" ");
                        const first = velocityPoints[0];
                        const last  = velocityPoints[velocityPoints.length - 1];
                        return (
                          <>
                            <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-20 overflow-visible">
                              <polyline points={pts} fill="none" stroke="#7c3aed" strokeWidth="1.5" strokeLinejoin="round" />
                              <circle cx={last.x * W} cy={H - (last.y / maxY) * H} r="3" fill="#7c3aed" />
                              <line x1="0" y1={H} x2={W} y2={H} stroke="#e5e7eb" strokeWidth="1" />
                              {event.budget && (
                                <line x1="0" y1="0" x2={W} y2="0" stroke="#fca5a5" strokeWidth="1" strokeDasharray="4 2" />
                              )}
                            </svg>
                            {projectedOver != null && dailyAllowance != null && (
                              <p className="text-[11px] text-gray-400 mt-2 leading-snug">
                                {projectedOver > 0
                                  ? <>In-trip spending is <strong className="text-gray-600">{(dailyBurn / (dailyAllowance || 1)).toFixed(2)}×</strong> the daily allowance. At this pace, you&apos;d exceed budget by <strong className="text-red-500">{fmt(projectedOver, hc)}</strong> by trip end. Slow to <strong className="text-purple-600">{fmt(dailyAllowance, hc)}/day</strong> to stay on track.</>
                                  : <>You&apos;re on pace to finish <strong className="text-emerald-600">{fmt(Math.abs(projectedOver), hc)} under budget</strong>. Keep it up!</>
                                }
                              </p>
                            )}
                          </>
                        );
                      })()}
                    </div>
                  )}
                </div>
              </div>

              {/* Footer */}
              <div className="mt-6 flex items-center justify-between border-t border-gray-200 pt-5">
                <button onClick={() => setShowArchiveConfirm(true)}
                  className="text-sm text-gray-400 hover:text-gray-600 underline">
                  Done with this tracker?
                </button>
                <div className="flex gap-2">
                  <button onClick={() => setShowArchiveConfirm(true)}
                    className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-500 hover:bg-white">
                    Archive
                  </button>
                  <button onClick={() => setShowDeleteConfirm(true)}
                    className="rounded-lg border border-red-100 px-4 py-2 text-sm font-medium text-red-500 hover:bg-red-50">
                    Delete tracker
                  </button>
                </div>
              </div>
            </div>
          );
        })()}
      </div>

      {/* ── Modals ─────────────────────────────────────────────────────────── */}

      {isService && (
        <ServiceLogModal
          open={logModalOpen}
          onClose={() => setLogModalOpen(false)}
          eventId={id}
          headers={headers}
          homeCurrency={hc}
          onAfterChange={() => { if (token) void load(token, { silent: true }); }}
        />
      )}

      {!isService && event && (
        <AddExpenseModal
          open={addExpenseOpen}
          onClose={() => setAddExpenseOpen(false)}
          eventId={id}
          eventName={event.name}
          headers={headers}
          homeCurrency={hc}
          onAfterChange={() => { if (token) void load(token, { silent: true }); }}
        />
      )}

      {showEdit && (
        <EditEventModal event={event} headers={headers} homeCurrency={homeCurrency}
          onSaved={(updated) => { setEvent(updated); setShowEdit(false); }}
          onClose={() => setShowEdit(false)} />
      )}

      {showArchiveConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={(e) => { if (e.target === e.currentTarget && !archiving) setShowArchiveConfirm(false); }}>
          <div className="w-full max-w-sm rounded-2xl bg-white shadow-xl p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-gray-900 mb-2">Archive this tracker?</h3>
            <p className="text-sm text-gray-600 mb-6">
              Archive &quot;{event.name}&quot;? Tags and activity stay in your data but won&apos;t show on active trackers.
            </p>
            <div className="flex justify-end gap-3">
              <button type="button" disabled={archiving} onClick={() => setShowArchiveConfirm(false)}
                className="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 border border-gray-200 disabled:opacity-50">Cancel</button>
              <button type="button" disabled={archiving} onClick={performArchive}
                className="rounded-lg px-4 py-2 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 disabled:opacity-50">
                {archiving ? "Archiving…" : "Archive tracker"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={(e) => { if (e.target === e.currentTarget && !deleting) setShowDeleteConfirm(false); }}>
          <div className="w-full max-w-sm rounded-2xl bg-white shadow-xl p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-gray-900 mb-2">Delete this tracker?</h3>
            <p className="text-sm text-gray-600 mb-6">
              Permanently delete &quot;{event.name}&quot;? This cannot be undone. All visits and payments will be lost.
            </p>
            <div className="flex justify-end gap-3">
              <button type="button" disabled={deleting} onClick={() => setShowDeleteConfirm(false)}
                className="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 border border-gray-200 disabled:opacity-50">Cancel</button>
              <button type="button" disabled={deleting} onClick={performDelete}
                className="rounded-lg px-4 py-2 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 disabled:opacity-50">
                {deleting ? "Deleting…" : "Delete permanently"}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
