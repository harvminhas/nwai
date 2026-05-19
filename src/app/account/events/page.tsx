"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseClient } from "@/lib/firebase";
import { useActiveProfile } from "@/contexts/ActiveProfileContext";
import type { EventSummary, EventColor, ServiceCadence, BillingMethod, VisitLog, ServiceRecentActivity, ProjectRecentExpense, ScheduledPaymentSlot } from "@/lib/events/types";
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
  /** From step-1 picker — Events (`project`), Services (`service`), or Scheduled Payments. */
  planKind: "project" | "service" | "scheduled_payment";
}

// ── Plan type picker (step 1, then New plan form) ───────────────────────────────

function PlanKindPicker({ onPick, onClose }: { onPick: (k: "project" | "service" | "scheduled_payment") => void; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-3xl rounded-2xl bg-white shadow-xl overflow-hidden">

        {/* Header */}
        <div className="px-7 pt-6 pb-5 border-b border-gray-100">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-bold text-gray-900 mb-0.5">New tracker</h2>
              <p className="text-sm text-gray-500">Pick how it lives on your timeline.</p>
            </div>
            <button type="button" onClick={onClose} className="mt-0.5 text-gray-400 hover:text-gray-600 text-xl leading-none shrink-0">×</button>
          </div>
        </div>

        {/* Cards */}
        <div className="grid grid-cols-3 gap-4 p-6">

          {/* Events */}
          <button
            type="button"
            onClick={() => onPick("project")}
            className="rounded-2xl border-2 border-gray-100 p-5 text-left hover:border-purple-300 hover:bg-purple-50/30 transition-all group"
          >
            <div className="mb-4 space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-purple-100 text-purple-600 text-sm">🚩</span>
                <p className="text-base font-bold text-gray-900 group-hover:text-purple-700 transition-colors">Events</p>
              </div>
              <p className="pl-9 text-[11px] font-medium leading-snug text-gray-400">Has an end</p>
            </div>

            <div className="mb-4 px-1">
              <div className="relative flex items-center">
                <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-px border-t-2 border-dashed border-gray-200" />
                <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[60%] h-0.5 bg-purple-500 rounded-full" />
                <div className="relative z-10 h-3 w-3 rounded-full bg-purple-600 ring-2 ring-white shrink-0" />
                <div className="flex-1" />
                <div className="relative z-10 h-3 w-3 rounded-full bg-purple-400 ring-2 ring-white shrink-0" />
              </div>
              <div className="flex justify-between mt-1.5">
                <span className="text-[10px] text-gray-400">start</span>
                <span className="text-[10px] text-purple-400">done</span>
              </div>
            </div>

            <p className="text-sm text-gray-600 leading-relaxed mb-4">
              Bounded dates, optional budget. Tag transactions across the run.
            </p>

            <div className="flex flex-wrap gap-1.5">
              {["Kitchen reno", "Italy trip", "Wedding"].map((ex) => (
                <span key={ex} className="rounded-full bg-gray-100 px-2.5 py-1 text-[11px] font-medium text-gray-500">{ex}</span>
              ))}
            </div>
          </button>

          {/* Services */}
          <button
            type="button"
            onClick={() => onPick("service")}
            className="rounded-2xl border-2 border-gray-100 p-5 text-left hover:border-blue-300 hover:bg-blue-50/30 transition-all group"
          >
            <div className="mb-4 space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-blue-100 text-blue-600 text-sm">🔁</span>
                <p className="text-base font-bold text-gray-900 group-hover:text-blue-700 transition-colors">Services</p>
              </div>
              <p className="pl-9 text-[11px] font-medium leading-snug text-gray-400">On a cadence</p>
            </div>

            <div className="mb-4 px-1">
              <div className="relative flex items-center gap-0">
                <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-px border-t-2 border-dashed border-gray-200" />
                {[0, 1, 2, 3, 4].map((i) => (
                  <div key={i} className="relative z-10 flex-1 flex justify-center">
                    <div className={`h-3 w-3 rounded-full ring-2 ring-white ${i === 4 ? "bg-blue-200" : "bg-blue-600"}`} />
                  </div>
                ))}
              </div>
              <div className="relative mt-1.5">
                <span className="absolute left-1/2 -translate-x-1/2 text-[10px] text-blue-400">every visit</span>
              </div>
              <div className="mt-4" />
            </div>

            <p className="text-sm text-gray-600 leading-relaxed mb-4">
              Visit cadence and per-occurrence costs across the season.
            </p>

            <div className="flex flex-wrap gap-1.5">
              {["Lawn care", "Cleaning", "Tutoring"].map((ex) => (
                <span key={ex} className="rounded-full bg-gray-100 px-2.5 py-1 text-[11px] font-medium text-gray-500">{ex}</span>
              ))}
            </div>
          </button>

          {/* Set Payments */}
          <button
            type="button"
            onClick={() => onPick("scheduled_payment")}
            className="rounded-2xl border-2 border-gray-100 p-5 text-left hover:border-amber-300 hover:bg-amber-50/30 transition-all group"
          >
            <div className="mb-4 space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-600 text-sm">📅</span>
                <p className="text-base font-bold text-gray-900 group-hover:text-amber-700 transition-colors">
                  Set Payments
                </p>
              </div>
              <p className="pl-9 text-[11px] font-medium leading-snug text-gray-400">Fixed dates</p>
            </div>

            <div className="mb-4 px-1">
              <div className="relative flex items-center gap-0">
                <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-px border-t-2 border-dashed border-gray-200" />
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="relative z-10 flex-1 flex justify-center">
                    <div className={`flex flex-col items-center gap-0.5`}>
                      <div className={`h-3 w-3 rounded-full ring-2 ring-white ${i < 2 ? "bg-amber-500" : i === 2 ? "bg-amber-200" : "bg-gray-200"}`} />
                    </div>
                  </div>
                ))}
              </div>
              <div className="relative mt-1.5 flex justify-between px-1">
                <span className="text-[10px] text-amber-500">paid</span>
                <span className="text-[10px] text-amber-500">paid</span>
                <span className="text-[10px] text-amber-300">due</span>
                <span className="text-[10px] text-gray-300">future</span>
              </div>
            </div>

            <p className="text-sm text-gray-600 leading-relaxed mb-4">
              Pick specific dates with an expected amount. Tag or log cash as each payment comes due.
            </p>

            <div className="flex flex-wrap gap-1.5">
              {["Contractor", "Tax instalments", "Tuition"].map((ex) => (
                <span key={ex} className="rounded-full bg-gray-100 px-2.5 py-1 text-[11px] font-medium text-gray-500">{ex}</span>
              ))}
            </div>
          </button>
        </div>

        {/* Footer */}
        <div className="px-6 pb-5 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-gray-500 hover:text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-100 transition"
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
  const [notes, setNotes]             = useState("");
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
        ...(endDate  ? { endDate }                   : {}),
        ...(budget.trim() ? { budget: parseFloat(budget) } : {}),
        ...(notes.trim()  ? { notes: notes.trim() }  : {}),
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
                ? "Service · name, frequency, budget"
                : "Event · name, budget, dates"}
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
              placeholder={planKind === "service" ? "e.g. lawn care · house cleaning" : "e.g. Mexico trip · renovation · anniversary"}
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

          {!repeats && (
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="block text-xs font-medium text-gray-700 mb-1">Start date</label>
                <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500" />
              </div>
              <div className="flex-1">
                <label className="block text-xs font-medium text-gray-700 mb-1">End date</label>
                <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)}
                  min={startDate || undefined}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500" />
              </div>
            </div>
          )}

          {!repeats && (
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Notes <span className="font-normal text-gray-400">(optional)</span></label>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)}
                rows={2} placeholder="Add a description…"
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 resize-none" />
            </div>
          )}

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

function fmtShortDate(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatProjectExpenseLine(row: ProjectRecentExpense, homeCurrency: string): string {
  if (row.kind === "statement") {
    const d = fmtShortDate(row.date);
    const merchant =
      row.merchant.length > 36 ? `${row.merchant.slice(0, 36)}…` : row.merchant;
    return `${d} · ${fmt(row.amount, homeCurrency)} · ${merchant} · Statement`;
  }
  const d = fmtShortDate(row.date);
  const label = (row.note?.trim() || row.category?.trim() || "Expense");
  const short = label.length > 40 ? `${label.slice(0, 40)}…` : label;
  const via = row.entryType === "cash" ? "Cash" : "Manual";
  return `${d} · ${fmt(row.amount, homeCurrency)} · ${short} · ${via}`;
}

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

  const recentEx = ev.recentProjectExpenses ?? [];

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
          <div className="h-1 w-full overflow-hidden rounded-full bg-gray-100">
            <div
              className={`h-1 rounded-full transition-all ${isOver ? "bg-red-400" : "bg-purple-500"}`}
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

      <div className="mt-4 min-w-0 flex flex-wrap items-start justify-between gap-3 border-t border-gray-50 pt-4">
        <div className="min-w-0 flex-1 space-y-1">
          {recentEx.length === 0 ? (
            <p className="text-xs text-gray-400">No expenses yet.</p>
          ) : (
            recentEx.map((row) => (
              <p key={`${row.kind}:${row.id}`} className="text-xs text-gray-500 line-clamp-2">
                {formatProjectExpenseLine(row, hc)}
              </p>
            ))
          )}
        </div>
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

function formatServiceActivityLine(a: ServiceRecentActivity, homeCurrency: string): string {
  if (a.kind === "visit") {
    return formatVisitLogLine(a.visit, homeCurrency);
  }
  const d = fmtShortDate(a.date);
  const merchant =
    a.merchant.length > 36 ? `${a.merchant.slice(0, 36)}…` : a.merchant;
  return `${d} · ${fmt(a.amount, homeCurrency)} · ${merchant} · Statement`;
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
  const recent = ev.recentActivities ?? [];

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
                  <p className="text-xs text-gray-400">No activity yet.</p>
                ) : (
                  recent.map((row) => (
                    <p key={`${row.kind}:${row.id}`} className="text-xs text-gray-500 line-clamp-2">
                      {formatServiceActivityLine(row, homeCurrency)}
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

// ── Scheduled Payment creation modal ─────────────────────────────────────────

function CreateScheduledPaymentModal({
  headers,
  onCreated,
  onClose,
}: {
  headers: Record<string, string>;
  onCreated: (ev: EventSummary) => void;
  onClose: () => void;
}) {
  const [name, setName]         = useState("");
  const [color, setColor]       = useState<EventColor>("amber");
  const [saving, setSaving]     = useState(false);
  const [err, setErr]           = useState<string | null>(null);
  const [slots, setSlots]       = useState<{ date: string; amount: string }[]>([
    { date: "", amount: "" },
  ]);

  function addSlot() {
    setSlots((prev) => [...prev, { date: "", amount: "" }]);
  }

  function removeSlot(idx: number) {
    setSlots((prev) => prev.filter((_, i) => i !== idx));
  }

  function updateSlot(idx: number, field: "date" | "amount", value: string) {
    setSlots((prev) => prev.map((s, i) => i === idx ? { ...s, [field]: value } : s));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setErr("Name is required"); return; }
    const valid = slots.filter((s) => s.date && parseFloat(s.amount) > 0);
    if (valid.length === 0) { setErr("Add at least one date with an amount"); return; }

    setSaving(true); setErr(null);
    try {
      const scheduledPayments: ScheduledPaymentSlot[] = valid
        .map((s) => ({ date: s.date, estimatedAmount: parseFloat(s.amount) }))
        .sort((a, b) => a.date.localeCompare(b.date));

      const res = await fetch("/api/user/events", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          kind: "scheduled_payment",
          color,
          scheduledPayments,
          startDate: scheduledPayments[0]?.date,
          endDate: scheduledPayments[scheduledPayments.length - 1]?.date,
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
      <div className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-gray-900">New tracker</h2>
            <p className="text-xs text-gray-400 mt-0.5">Set Payments · name, dates and amounts</p>
          </div>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4 px-6 py-5">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Name *</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. contractor · tax instalments · tuition"
              autoFocus
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-gray-700">Payment schedule *</label>
              <button
                type="button"
                onClick={addSlot}
                className="text-xs text-amber-600 hover:text-amber-700 font-medium"
              >
                + Add date
              </button>
            </div>
            <div className="space-y-2">
              {slots.map((slot, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <input
                    type="date"
                    value={slot.date}
                    onChange={(e) => updateSlot(idx, "date", e.target.value)}
                    className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                  />
                  <div className="relative w-32 shrink-0">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">$</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={slot.amount}
                      onChange={(e) => updateSlot(idx, "amount", e.target.value)}
                      placeholder="Amount"
                      className="w-full rounded-lg border border-gray-200 pl-6 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                    />
                  </div>
                  {slots.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeSlot(idx)}
                      className="shrink-0 text-gray-300 hover:text-red-400 text-lg leading-none"
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

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
              className="flex-1 rounded-lg bg-amber-500 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-50"
            >
              {saving ? "Creating…" : "Create tracker"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Scheduled payment card ────────────────────────────────────────────────────

function ScheduledPaymentCard({
  ev,
  homeCurrency,
  onLog,
}: {
  ev: EventSummary;
  homeCurrency: string;
  onLog: (slotDate?: string, estimatedAmount?: number) => void;
}) {
  const router = useRouter();
  const cfg    = colorCfg(ev.color);
  const slots  = ev.scheduledPayments ?? [];
  const today  = new Date().toISOString().substring(0, 10);

  const paidCount = ev.scheduledPaidCount ?? 0;
  const totalSlots = slots.length;

  const nextUnpaid = [...slots]
    .sort((a, b) => a.date.localeCompare(b.date))
    .find((s) => s.date >= today);

  const totalEstimated = slots.reduce((sum, s) => sum + s.estimatedAmount, 0);
  const pct = totalEstimated > 0
    ? Math.min(100, Math.round(((ev.totalSpent) / totalEstimated) * 100))
    : null;

  return (
    <div
      onClick={() => router.push(`/account/events/${ev.id}`)}
      className="w-full cursor-pointer rounded-2xl border border-gray-100 bg-white p-5 shadow-sm transition hover:border-gray-200 hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <span className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${cfg.bg}`}>
            <svg className={`h-5 w-5 ${cfg.text}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[15px] font-semibold leading-snug text-gray-900">{ev.name}</p>
              <span className="inline-flex shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                {paidCount} of {totalSlots} paid
              </span>
            </div>
            {nextUnpaid ? (
              <p className="mt-0.5 text-xs text-gray-500">
                Next: {new Date(nextUnpaid.date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                {" · "}{fmt(nextUnpaid.estimatedAmount, homeCurrency)} due
              </p>
            ) : paidCount === totalSlots && totalSlots > 0 ? (
              <p className="mt-0.5 text-xs text-green-600">All payments complete</p>
            ) : null}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-lg font-bold tabular-nums text-gray-900">{fmt(ev.totalSpent, homeCurrency)}</p>
          <p className="text-xs text-gray-500">of {fmt(totalEstimated, homeCurrency)}</p>
        </div>
      </div>

      {/* Slot dots */}
      {slots.length > 0 && (
        <div className="mt-4 flex items-center gap-1.5 flex-wrap">
          {[...slots]
            .sort((a, b) => a.date.localeCompare(b.date))
            .map((slot, i) => {
              const isPast  = slot.date < today;
              const isDue   = slot.date === today;
              return (
                <div
                  key={i}
                  title={`${slot.date} · ${fmt(slot.estimatedAmount, homeCurrency)}`}
                  className={`h-2.5 w-2.5 rounded-full ${
                    isPast ? "bg-amber-500" : isDue ? "bg-amber-400 ring-2 ring-amber-200" : "bg-gray-200"
                  }`}
                />
              );
            })}
        </div>
      )}

      {pct !== null && (
        <div className="mt-3">
          <div className="h-1 w-full overflow-hidden rounded-full bg-gray-100">
            <div className="h-1 rounded-full bg-amber-400 transition-all" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}

      <div className="mt-4 flex items-center justify-between border-t border-gray-50 pt-4">
        <p className="text-xs text-gray-400">
          {totalSlots} payment{totalSlots !== 1 ? "s" : ""} · {fmt(totalEstimated, homeCurrency)} total est.
        </p>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onLog(nextUnpaid?.date, nextUnpaid?.estimatedAmount);
          }}
          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-800 shadow-sm hover:bg-gray-50"
        >
          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          Log payment
        </button>
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
  const [createPlanKind, setCreatePlanKind] = useState<"project" | "service" | "scheduled_payment" | null>(null);
  const [homeCurrency, setHomeCurrency] = useState(HOME_CURRENCY);
  const [listLogEventId, setListLogEventId] = useState<string | null>(null);
  const [listLogSlotDate, setListLogSlotDate] = useState<string | undefined>(undefined);
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
  const projectEvents          = events.filter((ev) => (ev.kind ?? "project") === "project");
  const serviceEvents          = events.filter((ev) => ev.kind === "service");
  const scheduledPaymentEvents = events.filter((ev) => ev.kind === "scheduled_payment");
  const addExpenseEvent = listAddExpenseEventId ? events.find((e) => e.id === listAddExpenseEventId) : undefined;

  return (
    <div>
      <div className="mx-auto max-w-3xl px-4 pt-4 pb-8 sm:py-8 sm:px-6">

        {/* Page header */}
        <div className="mb-8 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-gray-900">Trackers</h1>
            <p className="mt-1.5 text-sm leading-relaxed text-gray-500">
              Track events, recurring services, and scheduled payments in one place.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setCreateStep("pick")}
            className="shrink-0 rounded-lg bg-purple-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-purple-700"
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
              Create an event, a recurring service, or a set-payment schedule — then tag transactions and log payments on the detail page.
            </p>
            <button
              type="button"
              onClick={() => setCreateStep("pick")}
              className="rounded-lg bg-purple-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-purple-700 transition"
            >
              Create your first tracker
            </button>
          </div>
        ) : (
          <div className="space-y-12">
            {/* Events */}
            <section>
              <div className="mb-4">
                <h2 className="text-[11px] font-bold uppercase tracking-wider text-gray-400">
                  Events <span className="font-semibold text-gray-400">{projectEvents.length} active</span>
                </h2>
                <p className="mt-1 text-sm text-gray-500">
                  Trips, renovations, weddings — anything with a fixed budget.
                </p>
              </div>
              <div className="space-y-4">
                {projectEvents.length === 0 ? (
                  <p className="text-sm text-gray-400">No events yet.</p>
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

            {/* Services */}
            <section>
              <div className="mb-4">
                <h2 className="text-[11px] font-bold uppercase tracking-wider text-gray-400">
                  Services <span className="font-semibold text-gray-400">{serviceEvents.length} active</span>
                </h2>
                <p className="mt-1 text-sm text-gray-500">
                  Cleaners, lawn care, tutoring — anything that repeats on a cadence.
                </p>
              </div>
              <div className="space-y-4">
                {serviceEvents.length === 0 ? (
                  <p className="text-sm text-gray-400">No services yet.</p>
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

            {/* Set Payments */}
            <section>
              <div className="mb-4">
                <h2 className="text-[11px] font-bold uppercase tracking-wider text-gray-400">
                  Set Payments <span className="font-semibold text-gray-400">{scheduledPaymentEvents.length} active</span>
                </h2>
                <p className="mt-1 text-sm text-gray-500">
                  Contractors, tax instalments, tuition — fixed dates with known amounts.
                </p>
              </div>
              <div className="space-y-4">
                {scheduledPaymentEvents.length === 0 ? (
                  <p className="text-sm text-gray-400">No set payments yet.</p>
                ) : (
                  scheduledPaymentEvents.map((ev) => (
                    <ScheduledPaymentCard
                      key={ev.id}
                      ev={ev}
                      homeCurrency={homeCurrency}
                      onLog={(slotDate, estimatedAmount) => {
                        setListLogEventId(ev.id);
                        setListLogSlotDate(slotDate);
                      }}
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
      {createStep === "plan" && createPlanKind === "scheduled_payment" && (
        <CreateScheduledPaymentModal
          headers={headers}
          onCreated={handleCreated}
          onClose={() => {
            setCreateStep(null);
            setCreatePlanKind(null);
          }}
        />
      )}
      {createStep === "plan" && createPlanKind && createPlanKind !== "scheduled_payment" && (
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
          onClose={() => { setListLogEventId(null); setListLogSlotDate(undefined); }}
          eventId={listLogEventId}
          headers={headers}
          homeCurrency={homeCurrency}
          onAfterChange={() => load(token)}
          defaultDate={listLogSlotDate}
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
