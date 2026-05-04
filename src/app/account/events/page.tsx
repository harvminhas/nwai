"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseClient } from "@/lib/firebase";
import { useActiveProfile } from "@/contexts/ActiveProfileContext";
import type { EventSummary, EventColor, ServiceCadence, BillingMethod, VisitLog } from "@/lib/events/types";
import ServiceLogModal from "@/components/events/ServiceLogModal";
import AddExpenseModal from "@/components/events/AddExpenseModal";
import { EVENT_COLORS } from "@/lib/events/types";
import { fmt, HOME_CURRENCY } from "@/lib/currencyUtils";

// ── constants ─────────────────────────────────────────────────────────────────

const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

// ── helpers ───────────────────────────────────────────────────────────────────

function colorCfg(color: EventColor) {
  return EVENT_COLORS.find((c) => c.id === color) ?? EVENT_COLORS[0];
}

function fmtDateRange(start?: string, end?: string): string | null {
  if (!start && !end) return null;
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" };
  const s = start ? new Date(start + "T00:00:00").toLocaleDateString("en-US", opts) : null;
  const e = end   ? new Date(end   + "T00:00:00").toLocaleDateString("en-US", opts) : null;
  if (s && e) return `${s} – ${e}`;
  return s ?? e ?? null;
}

function daysBetween(start: string, end: string): number {
  return Math.round(
    (new Date(end + "T00:00:00").getTime() - new Date(start + "T00:00:00").getTime()) / 86400000,
  );
}

function projectStatus(startDate?: string, endDate?: string): "upcoming" | "active" | "completed" {
  const today = new Date().toISOString().substring(0, 10);
  if (startDate && startDate > today) return "upcoming";
  if (endDate   && endDate   < today) return "completed";
  return "active";
}

function cadenceLabel(
  cadence: ServiceCadence,
  seasonStart?: number,
  seasonEnd?: number,
  billingMethod?: BillingMethod,
): string {
  const c = { weekly: "Weekly", biweekly: "Biweekly", monthly: "Monthly", quarterly: "Quarterly" }[cadence];
  const isYearRound = !seasonStart || !seasonEnd || (seasonStart === 1 && seasonEnd === 12);
  const season = isYearRound
    ? "year-round"
    : `season ${MONTH_NAMES[seasonStart! - 1]}–${MONTH_NAMES[seasonEnd! - 1]}`;
  const billing = billingMethod === "per-visit" ? "billed per visit" : billingMethod === "monthly" ? "billed monthly" : null;
  return [c, season, billing].filter(Boolean).join(" · ");
}

// ── Color swatch picker (shared) ──────────────────────────────────────────────

function ColorPicker({ value, onChange }: { value: EventColor; onChange: (c: EventColor) => void }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-700 mb-1.5">Color</label>
      <div className="flex flex-wrap gap-2">
        {EVENT_COLORS.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => onChange(c.id)}
            title={c.label}
            className={`h-7 w-7 rounded-full ${c.bg} border-2 transition-all ${
              value === c.id ? `${c.border} scale-110` : "border-transparent"
            }`}
          />
        ))}
      </div>
    </div>
  );
}

interface CreateModalProps {
  headers: Record<string, string>;
  onCreated: (ev: EventSummary) => void;
  onClose: () => void;
  /** From step-1 picker — one-time (`project`) vs recurring service (`service`). */
  planKind: "project" | "service";
}

// ── Plan type picker (step 1, then New plan form) ───────────────────────────────

function PlanKindPicker({ onPick, onClose }: { onPick: (k: "project" | "service") => void; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white shadow-xl p-6">
        <h2 className="text-base font-semibold text-gray-900 mb-1">What kind of tracker?</h2>
        <p className="text-xs text-gray-500 mb-5">One-off trips and budgets, or ongoing services on a schedule.</p>
        <div className="grid grid-cols-2 gap-3 mb-5">
          <button
            type="button"
            onClick={() => onPick("project")}
            className="rounded-xl border-2 border-gray-100 p-4 text-left hover:border-purple-300 hover:bg-purple-50/40 transition-all group"
          >
            <p className="text-sm font-semibold text-gray-900 mb-1.5 group-hover:text-purple-700">One-time</p>
            <p className="text-xs text-gray-500 leading-relaxed mb-3">
              Bounded dates and optional budget — tag transactions and ledger off-card spend.
            </p>
            <p className="text-[11px] text-purple-400 font-medium">Trip · renovation</p>
          </button>
          <button
            type="button"
            onClick={() => onPick("service")}
            className="rounded-xl border-2 border-gray-100 p-4 text-left hover:border-blue-300 hover:bg-blue-50/40 transition-all group"
          >
            <p className="text-sm font-semibold text-gray-900 mb-1.5 group-hover:text-blue-700">Recurring</p>
            <p className="text-xs text-gray-500 leading-relaxed mb-3">
              Visit cadence — log visits and payments across the season.
            </p>
            <p className="text-[11px] text-blue-400 font-medium">Lawn · cleaning</p>
          </button>
        </div>
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-gray-500 hover:text-gray-700 px-3 py-1.5 rounded-lg hover:bg-gray-100 transition"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function CreateEventModal({ headers, onCreated, onClose, planKind }: CreateModalProps) {
  const [name, setName]               = useState("");
  const [budget, setBudget]           = useState("");
  const [startDate, setStartDate]     = useState("");
  const [endDate, setEndDate]         = useState("");
  const repeats                       = planKind === "service";
  const [cadence, setCadence]         = useState<ServiceCadence>("monthly");
  const [color, setColor]             = useState<EventColor>("purple");
  const [saving, setSaving]           = useState(false);
  const [err, setErr]                 = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setErr("Name is required"); return; }
    setSaving(true); setErr(null);
    try {
      const todayISO = new Date().toISOString().substring(0, 10);
      const base = {
        name: name.trim(),
        color,
        startDate: startDate || todayISO,
        ...(endDate ? { endDate } : {}),
        ...(budget.trim() ? { budget: parseFloat(budget) } : {}),
      };
      const body = repeats
        ? {
            ...base,
            kind: "service" as const,
            cadence,
          }
        : {
            ...base,
            kind: "project" as const,
            type: "one-off" as const,
          };
      const res = await fetch("/api/user/events", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify(body),
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
      <div className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-gray-900">New tracker</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {planKind === "service"
                ? "Recurring · name, frequency, budget"
                : "One-time · name, budget, dates"}
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">
            ×
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4 px-6 py-5">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Name *</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={planKind === "service" ? "e.g. lawn care · house cleaning" : "e.g. Mexico trip · renovation"}
              autoFocus
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Budget <span className="font-normal text-gray-400">(optional)</span></label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
              placeholder="Spending limit"
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
            />
          </div>

          {repeats && (
            <>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1.5">Visit frequency</label>
                <div className="grid grid-cols-4 gap-1.5">
                  {(["weekly", "biweekly", "monthly", "quarterly"] as ServiceCadence[]).map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setCadence(c)}
                      className={`rounded-lg border py-2 text-xs font-medium transition ${
                        cadence === c
                          ? "border-purple-400 bg-purple-50 text-purple-800"
                          : "border-gray-200 text-gray-600 hover:border-gray-300"
                      }`}
                    >
                      {c.charAt(0).toUpperCase() + c.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          <ColorPicker value={color} onChange={setColor} />

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
              {saving ? "Creating…" : "Create tracker"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Project card ──────────────────────────────────────────────────────────────

function ProjectCard({
  ev,
  homeCurrency,
  onAddExpense,
}: {
  ev: EventSummary;
  homeCurrency: string;
  onAddExpense: () => void;
}) {
  const router = useRouter();
  const cfg     = colorCfg(ev.color);
  const pct     = ev.budget ? Math.min(100, Math.round((ev.totalSpent / ev.budget) * 100)) : null;
  const status  = projectStatus(ev.startDate, ev.endDate);
  const isOver  = pct !== null && pct >= 100;
  const hc      = homeCurrency;

  const dateRange = fmtDateRange(ev.startDate ?? ev.date, ev.endDate);
  const days      = ev.startDate && ev.endDate ? daysBetween(ev.startDate, ev.endDate) : null;
  const remaining = ev.budget != null ? Math.max(0, ev.budget - ev.totalSpent) : null;

  const nStmt = ev.txCount ?? 0;
  const nMan  = ev.ledgerEntryCount ?? 0;
  const nExp  = nStmt + nMan;

  const statusLabel =
    status === "upcoming" ? "Upcoming" : status === "completed" ? "Completed" : "In progress";

  return (
    <div
      onClick={() => router.push(`/account/events/${ev.id}`)}
      className="w-full cursor-pointer rounded-2xl border border-gray-100 bg-white p-5 shadow-sm transition hover:border-gray-200 hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <span className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${cfg.bg}`}>
            <svg className={`h-5 w-5 ${cfg.text}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[15px] font-semibold leading-snug text-gray-900">{ev.name}</p>
              <span className="inline-flex shrink-0 rounded-full bg-purple-50 px-2 py-0.5 text-[11px] font-medium text-purple-700">
                {statusLabel}
              </span>
            </div>
            {dateRange && (
              <p className="mt-0.5 text-xs text-gray-500">
                {dateRange}
                {days !== null && ` · ${days + 1} days`}
              </p>
            )}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-lg font-bold tabular-nums text-gray-900">{fmt(ev.totalSpent, hc)}</p>
          {ev.budget != null && <p className="text-xs text-gray-500">of {fmt(ev.budget, hc)}</p>}
        </div>
      </div>

      {pct !== null && (
        <div className="mt-4">
          <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100">
            <div
              className={`h-2 rounded-full transition-all ${isOver ? "bg-red-400" : "bg-purple-500"}`}
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="mt-2 flex items-start justify-between gap-2 text-xs text-gray-500">
            <p>
              {pct}% of budget
              {status === "upcoming" && <> · trip hasn&apos;t started</>}
            </p>
            {remaining != null && ev.budget != null && (
              <p className="shrink-0 text-right tabular-nums text-gray-500">{fmt(remaining, hc)} remaining</p>
            )}
          </div>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-gray-50 pt-4">
        <p className="text-xs text-gray-400">
          {nExp === 0
            ? "No expenses yet"
            : `${nExp} expense${nExp !== 1 ? "s" : ""} · ${nStmt} from statement, ${nMan} manual`}
        </p>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onAddExpense();
          }}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-800 shadow-sm hover:bg-gray-50"
        >
          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          Add expense
        </button>
      </div>
    </div>
  );
}

// ── Recurring service card ───────────────────────────────────────────────────

function fmtShortDate(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatVisitLogLine(log: VisitLog, homeCurrency: string): string {
  const d = fmtShortDate(log.date);
  let pay: string;
  if (log.amount != null && log.paymentMethod) {
    pay = `${fmt(log.amount, homeCurrency)} · ${log.paymentMethod}`;
  } else if (log.paymentMethod === "statement") {
    pay = "From statement";
  } else {
    pay = "Visit only";
  }
  const raw = log.note?.trim() ?? "";
  const note =
    raw.length > 0
      ? ` · ${raw.length > 48 ? `${raw.slice(0, 48)}…` : raw}`
      : "";
  return `${d} · ${pay}${note}`;
}

function ServiceCard({
  ev,
  homeCurrency,
  onLog,
}: {
  ev: EventSummary;
  homeCurrency: string;
  onLog: () => void;
}) {
  const router = useRouter();
  const cfg = colorCfg(ev.color);

  const cadence = ev.cadence ?? "monthly";
  const seasonStart = ev.seasonStart;
  const seasonEnd = ev.seasonEnd;
  const billingMethod = ev.billingMethod;
  const recent = ev.recentVisitLogs ?? [];

  return (
    <div
      onClick={() => router.push(`/account/events/${ev.id}`)}
      className="w-full cursor-pointer rounded-2xl border border-gray-100 bg-white p-5 shadow-sm transition hover:border-gray-200 hover:shadow-md"
    >
      <div className="flex gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-3">
            <span className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${cfg.bg}`}>
              <svg className={`h-5 w-5 ${cfg.text}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </span>
            <div className="min-w-0">
              <p className="text-[15px] font-semibold leading-snug text-gray-900">{ev.name}</p>
              <p className="mt-0.5 text-xs text-gray-500">{cadenceLabel(cadence, seasonStart, seasonEnd, billingMethod)}</p>

              <div className="mt-3 space-y-1">
                {recent.length === 0 ? (
                  <p className="text-xs text-gray-400">No visits logged yet.</p>
                ) : (
                  recent.map((log) => (
                    <p key={log.id} className="text-xs text-gray-500 line-clamp-2">
                      {formatVisitLogLine(log, homeCurrency)}
                    </p>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2">
          <p className="text-lg font-bold tabular-nums text-gray-900">{fmt(ev.totalSpent, homeCurrency)}</p>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onLog();
            }}
            className="rounded-lg bg-purple-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-purple-700"
          >
            + Log
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function EventsPage() {
  const [token, setToken]           = useState<string | null>(null);
  const [events, setEvents]         = useState<EventSummary[]>([]);
  const [loading, setLoading]       = useState(true);
  const [createStep, setCreateStep]           = useState<null | "pick" | "plan">(null);
  const [createPlanKind, setCreatePlanKind] = useState<"project" | "service" | null>(null);
  const [homeCurrency, setHomeCurrency] = useState(HOME_CURRENCY);
  const [listLogEventId, setListLogEventId] = useState<string | null>(null);
  const [listAddExpenseEventId, setListAddExpenseEventId] = useState<string | null>(null);
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
        const res  = await fetch("/api/user/events", { headers: buildHeaders(tok) });
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
    setCreateStep(null);
    setCreatePlanKind(null);
  }

  const headers = token ? buildHeaders(token) : {};
  const projectEvents = events.filter((ev) => (ev.kind ?? "project") === "project");
  const serviceEvents = events.filter((ev) => ev.kind === "service");
  const addExpenseEvent = listAddExpenseEventId ? events.find((e) => e.id === listAddExpenseEventId) : undefined;

  return (
    <div className="min-h-screen bg-[#f8f7f4]">
      <div className="mx-auto max-w-3xl px-4 py-10">

        {/* Page header */}
        <div className="mb-10 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Trackers</h1>
            <p className="mt-1.5 text-sm leading-relaxed text-gray-500">
              Budgets for one-time events and visits for recurring services.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setCreateStep("pick")}
            className="shrink-0 rounded-lg bg-gray-900 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-gray-800"
          >
            + New tracker
          </button>
        </div>

        {/* Content */}
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-32 rounded-xl bg-gray-100 animate-pulse" />
            ))}
          </div>
        ) : events.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-gray-200 bg-white px-8 py-16 text-center">
            <p className="text-4xl mb-4">📋</p>
            <h3 className="text-base font-semibold text-gray-900 mb-1">No trackers yet</h3>
            <p className="mx-auto max-w-sm text-sm text-gray-500 mb-6 leading-relaxed">
              Create a budget tracker or a recurring service — you&apos;ll tag transactions and log visits on the detail page.
            </p>
            <button
              type="button"
              onClick={() => setCreateStep("pick")}
              className="rounded-lg bg-gray-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-gray-800"
            >
              Create your first tracker
            </button>
          </div>
        ) : (
          <div className="space-y-12">
            {/* Budget trackers */}
            <section>
              <div className="mb-4">
                <h2 className="text-[11px] font-bold uppercase tracking-wider text-gray-400">
                  Budget trackers <span className="font-semibold text-gray-400">{projectEvents.length} active</span>
                </h2>
                <p className="mt-1 text-sm text-gray-500">
                  Trips, renovations, weddings — anything with a fixed budget.
                </p>
              </div>
              <div className="space-y-4">
                {projectEvents.length === 0 ? (
                  <p className="text-sm text-gray-400">No budget trackers yet.</p>
                ) : (
                  projectEvents.map((ev) => (
                    <ProjectCard
                      key={ev.id}
                      ev={ev}
                      homeCurrency={homeCurrency}
                      onAddExpense={() => setListAddExpenseEventId(ev.id)}
                    />
                  ))
                )}
              </div>
            </section>

            {/* Recurring services */}
            <section>
              <div className="mb-4">
                <h2 className="text-[11px] font-bold uppercase tracking-wider text-gray-400">
                  Recurring services <span className="font-semibold text-gray-400">{serviceEvents.length} active</span>
                </h2>
                <p className="mt-1 text-sm text-gray-500">
                  Cleaners, lawn care, subscriptions — anything that repeats.
                </p>
              </div>
              <div className="space-y-4">
                {serviceEvents.length === 0 ? (
                  <p className="text-sm text-gray-400">No recurring services yet.</p>
                ) : (
                  serviceEvents.map((ev) => (
                    <ServiceCard
                      key={ev.id}
                      ev={ev}
                      homeCurrency={homeCurrency}
                      onLog={() => setListLogEventId(ev.id)}
                    />
                  ))
                )}
              </div>
            </section>
          </div>
        )}
      </div>

      {/* Modals */}
      {createStep === "pick" && (
        <PlanKindPicker
          onPick={(k) => {
            setCreatePlanKind(k);
            setCreateStep("plan");
          }}
          onClose={() => setCreateStep(null)}
        />
      )}
      {createStep === "plan" && createPlanKind && (
        <CreateEventModal
          key={createPlanKind}
          headers={headers}
          planKind={createPlanKind}
          onCreated={handleCreated}
          onClose={() => {
            setCreateStep(null);
            setCreatePlanKind(null);
          }}
        />
      )}

      {token && listLogEventId && (
        <ServiceLogModal
          open
          onClose={() => setListLogEventId(null)}
          eventId={listLogEventId}
          headers={headers}
          homeCurrency={homeCurrency}
          onAfterChange={() => load(token)}
        />
      )}

      {token && listAddExpenseEventId && addExpenseEvent && (
        <AddExpenseModal
          open
          onClose={() => setListAddExpenseEventId(null)}
          eventId={listAddExpenseEventId}
          eventName={addExpenseEvent.name}
          headers={headers}
          homeCurrency={homeCurrency}
          onAfterChange={() => load(token)}
        />
      )}
    </div>
  );
}
