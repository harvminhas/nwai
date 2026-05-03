"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseClient } from "@/lib/firebase";
import { useActiveProfile } from "@/contexts/ActiveProfileContext";
import type { EventSummary, EventColor, ServiceCadence, BillingMethod } from "@/lib/events/types";
import { EVENT_COLORS } from "@/lib/events/types";
import TagCashPaymentPanelShared from "@/components/events/TagCashPaymentPanel";
import { fmt, HOME_CURRENCY, getCurrencySymbol } from "@/lib/currencyUtils";

// ── constants ─────────────────────────────────────────────────────────────────

const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

type DatePick = "today" | "yesterday" | "custom";

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

function visitsPerMonthFloat(cadence: ServiceCadence): number {
  return cadence === "weekly" ? 4.33 : cadence === "biweekly" ? 2.17 : cadence === "monthly" ? 1 : 0.33;
}

function seasonMonthList(seasonStart = 1, seasonEnd = 12): number[] {
  const months: number[] = [];
  let m = seasonStart;
  for (let i = 0; i < 13; i++) {
    months.push(m);
    if (m === seasonEnd) break;
    m = m === 12 ? 1 : m + 1;
  }
  return months;
}

function expectedVisitsTotal(cadence: ServiceCadence, seasonStart = 1, seasonEnd = 12): number {
  return Math.round(seasonMonthList(seasonStart, seasonEnd).length * visitsPerMonthFloat(cadence));
}

function expectedVisitsSoFar(cadence: ServiceCadence, seasonStart = 1, seasonEnd = 12): number {
  const today = new Date();
  const cm = today.getMonth() + 1;
  const months = seasonMonthList(seasonStart, seasonEnd);
  // months elapsed in the season up to today
  const idx = months.indexOf(cm);
  if (idx === -1) {
    // Outside the season this year: if all season months are past → return total
    const allPast = months.every((m) => m < cm || (seasonEnd < seasonStart && m > cm));
    return allPast ? expectedVisitsTotal(cadence, seasonStart, seasonEnd) : 0;
  }
  const elapsed = idx + today.getDate() / 31;
  return Math.round(Math.min(elapsed, months.length) * visitsPerMonthFloat(cadence));
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
  headers,
  homeCurrency,
  onTransactionTagged,
  onLedgerAdded,
}: {
  ev: EventSummary;
  headers: Record<string, string>;
  homeCurrency: string;
  onTransactionTagged?: (evId: string, amount: number, date?: string) => void;
  onLedgerAdded?: (evId: string, amount: number) => void;
}) {
  const router = useRouter();
  const cfg    = colorCfg(ev.color);
  const pct    = ev.budget ? Math.min(100, Math.round((ev.totalSpent / ev.budget) * 100)) : null;
  const status = projectStatus(ev.startDate, ev.endDate);
  const isOver = pct !== null && pct >= 100;

  const dateRange = fmtDateRange(ev.startDate ?? ev.date, ev.endDate);
  const days = ev.startDate && ev.endDate ? daysBetween(ev.startDate, ev.endDate) : null;

  const [showPayment, setShowPayment] = useState(false);
  const hc = homeCurrency;

  function openPayment(e: React.MouseEvent) {
    e.stopPropagation();
    setShowPayment(true);
  }

  return (
    <div
      onClick={() => router.push(`/account/events/${ev.id}`)}
      className="w-full rounded-xl border border-gray-100 bg-white px-5 py-4 shadow-sm hover:shadow-md hover:border-gray-200 transition-all cursor-pointer"
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-3 min-w-0">
          <span className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${cfg.bg}`}>
            <svg className={`h-4 w-4 ${cfg.text}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-900 truncate">{ev.name}</p>
            {dateRange && (
              <p className="text-xs text-gray-400 mt-0.5">
                {dateRange}{days !== null && ` · ${days + 1} days`}
              </p>
            )}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-sm font-semibold text-gray-900">{fmt(ev.totalSpent, hc)}</p>
          {ev.budget && <p className="text-xs text-gray-400">of {fmt(ev.budget, hc)}</p>}
        </div>
      </div>

      {/* Budget bar */}
      {pct !== null && (
        <div className="mb-2.5">
          <div className="h-1.5 w-full rounded-full bg-gray-100 overflow-hidden">
            <div
              className={`h-1.5 rounded-full transition-all ${isOver ? "bg-red-400" : cfg.solidBg}`}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold bg-gray-100 text-gray-500">
            One-time
          </span>
          {pct !== null && (
            <span className={`text-xs ${isOver ? "text-red-500 font-medium" : "text-gray-400"}`}>
              {pct}% of budget
            </span>
          )}
          {status === "upcoming" && (
            <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium bg-purple-50 text-purple-600">
              upcoming
            </span>
          )}
          {status === "completed" && (
            <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium bg-gray-100 text-gray-500">
              completed
            </span>
          )}
        </div>
        <span className="text-xs text-gray-400 shrink-0">
          {((ev.txCount ?? 0) > 0 || (ev.ledgerEntryCount ?? 0) > 0)
            ? [
                (ev.txCount ?? 0) > 0 ? `${ev.txCount} tagged` : null,
                (ev.ledgerEntryCount ?? 0) > 0 ? `${ev.ledgerEntryCount} ledger` : null,
              ].filter(Boolean).join(" · ")
            : "No spending logged yet"}
        </span>
      </div>

      {/* Tag bank txns or cash (off-card) — budget & dates live on the detail page */}
      <div className="flex items-center gap-3 mt-3" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          onClick={openPayment}
          className="inline-flex items-center gap-1.5 rounded-lg bg-purple-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-purple-700 transition"
        >
          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          Log payment
        </button>
      </div>

      <TagCashPaymentPanel
        eventId={ev.id}
        headers={headers}
        homeCurrency={hc}
        isOpen={showPayment}
        onClose={() => setShowPayment(false)}
        onTransactionTagged={onTransactionTagged}
        postCashPayment={async (p) => {
          const res = await fetch(`/api/user/events/${ev.id}/ledger`, {
            method: "POST",
            headers: { ...headers, "Content-Type": "application/json" },
            body: JSON.stringify({
              date: p.date,
              amount: p.amount,
              entryType: "cash",
              ...(p.note ? { note: p.note } : {}),
            }),
          });
          return res.ok;
        }}
        onCashSaved={(amount, _date) => {
          onLedgerAdded?.(ev.id, amount);
        }}
      />
    </div>
  );
}

// ── Service timeline ──────────────────────────────────────────────────────────

function ServiceTimeline({
  cadence,
  seasonStart,
  seasonEnd,
  visitsByMonth,
  paymentsByMonth,
  lastVisitDate,
}: {
  cadence: ServiceCadence;
  seasonStart?: number;
  seasonEnd?: number;
  visitsByMonth?: Record<string, number>;
  paymentsByMonth?: Record<string, number>;
  lastVisitDate?: string;
}) {
  const today = new Date();
  const currentYM = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
  const year = today.getFullYear();

  const months = seasonMonthList(seasonStart ?? 1, seasonEnd ?? 12);
  const vpm = visitsPerMonthFloat(cadence);
  const expectedPerMonth = Math.max(1, Math.round(vpm));

  return (
    <div>
      <div className="flex gap-0.5 items-end">
        {months.map((monthNum) => {
          const ym = `${year}-${String(monthNum).padStart(2, "0")}`;
          const visits   = visitsByMonth?.[ym] ?? 0;
          const payments = paymentsByMonth?.[ym] ?? 0;
          const isPast   = ym < currentYM;
          const isCurrent = ym === currentYM;

          /** Bar height reflects either logged visits or recorded payments (tagged/cash), whichever is higher */
          const activity = Math.max(visits, payments);
          const totalFillPct = Math.min(100, Math.round((activity / expectedPerMonth) * 100));
          const paidFillPct =
            activity > 0
              ? Math.min(totalFillPct, Math.round((payments / expectedPerMonth) * 100))
              : 0;
          const unpaidFillPct = Math.max(0, totalFillPct - paidFillPct);

          return (
            <div key={monthNum} className="flex-1 flex flex-col items-center gap-1">
              <div className="relative w-full h-7 rounded-sm overflow-hidden bg-gray-100">
                {isPast && activity === 0 && (
                  <div className="absolute inset-0 border border-gray-200 rounded-sm" />
                )}
                {isCurrent && activity === 0 && (
                  <div className="absolute inset-0 bg-blue-50" />
                )}
                {/* Blue bar for event-only (unpaid) portion — sits on top of the paid bar */}
                {unpaidFillPct > 0 && (
                  <div
                    className="absolute left-0 right-0 bg-blue-400 transition-all"
                    style={{ height: `${unpaidFillPct}%`, bottom: `${paidFillPct}%` }}
                  />
                )}
                {/* Emerald bar for paid portion — at the bottom */}
                {paidFillPct > 0 && (
                  <div
                    className="absolute bottom-0 left-0 right-0 bg-emerald-400 transition-all"
                    style={{ height: `${paidFillPct}%` }}
                  />
                )}
              </div>
              <span className="text-[9px] text-gray-400 leading-none">{MONTH_NAMES[monthNum - 1]}</span>
            </div>
          );
        })}
      </div>

      {lastVisitDate && (
        <p className="text-[11px] text-gray-400 mt-1.5">
          Last visit:{" "}
          {new Date(lastVisitDate + "T00:00:00").toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
          })}
        </p>
      )}

      {/* Legend */}
      <div className="mt-1.5 flex items-center gap-3 text-[10px] text-gray-400">
        <span className="flex items-center gap-1">
          <span className="h-1.5 w-3 rounded-sm bg-emerald-400 inline-block" />
          Paid
        </span>
        <span className="flex items-center gap-1">
          <span className="h-1.5 w-3 rounded-sm bg-blue-400 inline-block" />
          Event only
        </span>
        <span className="flex items-center gap-1">
          <span className="h-1.5 w-3 rounded-sm bg-gray-100 border border-gray-200 inline-block" />
          Expected
        </span>
      </div>
    </div>
  );
}

// ── Service card ──────────────────────────────────────────────────────────────

function nextExpectedDate(lastVisit: string | undefined, cadence: ServiceCadence): string | null {
  if (!lastVisit) return null;
  const days = { weekly: 7, biweekly: 14, monthly: 30, quarterly: 91 }[cadence];
  const d = new Date(lastVisit + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().substring(0, 10);
}

function fmtShortDate(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const TagCashPaymentPanel = TagCashPaymentPanelShared;

function ServiceCard({
  ev,
  headers,
  homeCurrency,
  onVisitLogged,
  onTransactionTagged,
}: {
  ev: EventSummary;
  headers: Record<string, string>;
  homeCurrency: string;
  onVisitLogged?: (evId: string, date: string) => void;
  onTransactionTagged?: (evId: string, amount: number, date?: string) => void;
}) {
  const router = useRouter();
  const cfg    = colorCfg(ev.color);
  const hc     = homeCurrency;

  const cadence       = ev.cadence       ?? "monthly";
  const seasonStart   = ev.seasonStart;
  const seasonEnd     = ev.seasonEnd;
  const billingMethod = ev.billingMethod;
  const visitsByMonth = ev.visitsByMonth;
  const lastVisitDate = ev.lastVisitDate;

  const visitCount    = ev.visitCount ?? ev.txCount;
  const txCount       = ev.txCount ?? 0;
  const cashVisitCount = ev.cashVisitCount ?? 0;
  const paidCount     = ev.paidCount ?? txCount;
  const unbilled      = ev.unbilledCount ?? 0;
  const expectedTotal = expectedVisitsTotal(cadence, seasonStart, seasonEnd);
  const computedAvg   = ev.avgPerVisit ?? (paidCount > 0 ? ev.totalSpent / paidCount : null);
  const nextDate      = nextExpectedDate(lastVisitDate, cadence);

  const todayISO = new Date().toISOString().substring(0, 10);

  // ── Log event panel state ─────────────────────────────────────────────────
  const [showLog, setShowLog]       = useState(false);
  const [selectedDate, setSelectedDate] = useState(todayISO);
  const [note, setNote]             = useState("");
  const [saving, setSaving]         = useState(false);

  function resetLog() { setShowLog(false); setNote(""); setSelectedDate(todayISO); }

  async function handleSaveEvent(e: React.MouseEvent) {
    e.stopPropagation();
    setSaving(true);
    try {
      const body: Record<string, unknown> = { date: selectedDate };
      if (note.trim()) body.note = note.trim();
      const res = await fetch(`/api/user/events/${ev.id}/visits`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) { onVisitLogged?.(ev.id, selectedDate); resetLog(); }
    } finally { setSaving(false); }
  }

  const [showPayment, setShowPayment] = useState(false);

  function openPayment(e: React.MouseEvent) {
    e.stopPropagation();
    setShowLog(false);
    setShowPayment(true);
  }

  return (
    <div
      onClick={() => router.push(`/account/events/${ev.id}`)}
      className="w-full rounded-xl border border-gray-100 bg-white px-5 py-4 shadow-sm hover:shadow-md hover:border-gray-200 transition-all cursor-pointer"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-3 min-w-0">
          <span className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${cfg.bg}`}>
            <svg className={`h-4 w-4 ${cfg.text}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-900 truncate">{ev.name}</p>
            <p className="text-xs text-gray-400 mt-0.5">{cadenceLabel(cadence, seasonStart, seasonEnd, billingMethod)}</p>
          </div>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-sm font-semibold text-gray-900">{fmt(ev.totalSpent, hc)}</p>
          {computedAvg !== null && <p className="text-xs text-gray-400">{fmt(computedAvg, hc)} avg / visit</p>}
        </div>
      </div>

      {/* Timeline */}
      <div className="mb-3">
        <ServiceTimeline cadence={cadence} seasonStart={seasonStart} seasonEnd={seasonEnd} visitsByMonth={visitsByMonth} paymentsByMonth={ev.paymentsByMonth} lastVisitDate={lastVisitDate} />
      </div>

      {/* Balance banner — shows when there are unbilled visits */}
      {unbilled > 0 && computedAvg && (
        <div className="mb-2.5 flex items-center justify-between rounded-lg bg-amber-50 border border-amber-100 px-3 py-2">
          <p className="text-xs text-amber-700">Balance · {unbilled} event{unbilled !== 1 ? "s" : ""} since last payment</p>
          <p className="text-xs font-semibold text-amber-700">~{fmt(unbilled * computedAvg, hc)} owed</p>
        </div>
      )}

      {/* Stats row */}
      <div className="flex items-center justify-between gap-2 flex-wrap mb-2.5">
        <div className="flex items-center gap-2 flex-wrap text-xs text-gray-500">
          <span>Services <span className="font-semibold text-gray-800">{visitCount}</span></span>
          <span className="text-gray-200">·</span>
          <span>Payments <span className="font-semibold text-gray-800">{paidCount}</span>{ev.totalSpent > 0 ? ` (${fmt(ev.totalSpent, hc)})` : ""}</span>
        </div>
        <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold bg-gray-100 text-gray-500">Recurring</span>
      </div>

      {/* Action row */}
      <div className="flex items-center justify-between gap-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2">
          <button
            onClick={(e) => { e.stopPropagation(); setShowPayment(false); setShowLog((v) => !v); }}
            className="inline-flex items-center gap-1 rounded-lg bg-purple-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-purple-700 transition"
          >
            +Log
          </button>
          <button
            onClick={(e) => { setShowLog(false); openPayment(e); }}
            className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 transition"
          >
            +Payment
          </button>
        </div>
        {nextDate && !showLog && !showPayment && (
          <p className="text-xs text-gray-400 shrink-0">Next expected: <span className="font-medium text-gray-600">{fmtShortDate(nextDate)}</span></p>
        )}
      </div>

      {/* ── Log event panel ── */}
      {showLog && (
        <div className="mt-3 rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 space-y-3" onClick={(e) => e.stopPropagation()}>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1.5">When?</p>
            <input type="date" value={selectedDate} max={todayISO}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-400" />
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1.5">Note <span className="font-normal normal-case">(optional)</span></p>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. did the back hedge too"
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-purple-500" />
          </div>
          <div className="flex items-center justify-end gap-2">
            <button onClick={(e) => { e.stopPropagation(); resetLog(); }} className="rounded-lg px-3 py-1.5 text-xs font-medium text-gray-500 hover:text-gray-700 border border-gray-200 bg-white">Cancel</button>
            <button onClick={handleSaveEvent} disabled={saving} className="rounded-lg bg-indigo-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50 transition">
              {saving ? "Saving…" : "Save event"}
            </button>
          </div>
        </div>
      )}

      {/* ── Log payment panel ── */}
      <TagCashPaymentPanel
        eventId={ev.id}
        headers={headers}
        homeCurrency={hc}
        isOpen={showPayment}
        onClose={() => setShowPayment(false)}
        onTransactionTagged={onTransactionTagged}
        postCashPayment={async (p) => {
          const res = await fetch(`/api/user/events/${ev.id}/visits`, {
            method: "POST",
            headers: { ...headers, "Content-Type": "application/json" },
            body: JSON.stringify({
              date: p.date,
              paymentMethod: p.paymentMethod ?? "cash",
              amount: p.amount,
              ...(p.note ? { note: p.note } : {}),
            }),
          });
          return res.ok;
        }}
        onCashSaved={(amount, date) => {
          onVisitLogged?.(ev.id, date);
          onTransactionTagged?.(ev.id, amount, date);
        }}
      />
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

  function handleTransactionTagged(evId: string, amountDelta: number, date?: string) {
    // amountDelta is positive when tagging, negative when untagging
    const countDelta = amountDelta >= 0 ? 1 : -1;
    setEvents((prev) =>
      prev.map((ev) => {
        if (ev.id !== evId) return ev;
        const txCount       = Math.max(0, (ev.txCount ?? 0) + countDelta);
        const paidCount     = Math.max(0, (ev.paidCount ?? 0) + countDelta);
        const totalSpent    = Math.max(0, (ev.totalSpent ?? 0) + amountDelta);
        const unbilledCount = Math.max(0, (ev.unbilledCount ?? 0) - countDelta);
        // Update paymentsByMonth for the transaction's month
        let paymentsByMonth = { ...(ev.paymentsByMonth ?? {}) };
        let lastVisitDate = ev.lastVisitDate;
        if (date) {
          const ym = date.substring(0, 7);
          paymentsByMonth[ym] = Math.max(0, (paymentsByMonth[ym] ?? 0) + countDelta);
          // Keep lastVisitDate up to date when tagging
          if (countDelta > 0 && (!lastVisitDate || date > lastVisitDate)) lastVisitDate = date;
        }
        return { ...ev, txCount, paidCount, totalSpent, unbilledCount, paymentsByMonth, lastVisitDate };
      }),
    );
  }

  function handleVisitLogged(evId: string, date: string) {
    const ym = date.substring(0, 7);
    setEvents((prev) =>
      prev.map((ev) => {
        if (ev.id !== evId) return ev;
        const visitsByMonth = { ...ev.visitsByMonth, [ym]: (ev.visitsByMonth?.[ym] ?? 0) + 1 };
        const visitCount    = (ev.visitCount ?? ev.txCount) + 1;
        const unbilledCount = (ev.unbilledCount ?? 0) + 1;
        const lastVisitDate = !ev.lastVisitDate || date > ev.lastVisitDate ? date : ev.lastVisitDate;
        return { ...ev, visitCount, unbilledCount, visitsByMonth, lastVisitDate };
      }),
    );
  }

  function handleLedgerAdded(evId: string, amount: number) {
    setEvents((prev) =>
      prev.map((ev) =>
        ev.id === evId
          ? {
              ...ev,
              totalSpent: (ev.totalSpent ?? 0) + amount,
              ledgerEntryCount: (ev.ledgerEntryCount ?? 0) + 1,
            }
          : ev,
      ),
    );
  }

  const headers = token ? buildHeaders(token) : {};
  const recurringCount = events.filter((ev) => ev.kind === "service").length;
  const oneTimeCount   = events.filter((ev) => (ev.kind ?? "project") === "project").length;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-2xl lg:max-w-5xl px-4 py-8">

        {/* Page header */}
        <div className="mb-7 flex items-start justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Trackers</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              Budget events and recurring services — all in one place.
            </p>
          </div>
          <button
            onClick={() => setCreateStep("pick")}
            className="shrink-0 rounded-xl bg-purple-600 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-700 shadow-sm transition"
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
            <p className="text-sm text-gray-500 mb-6">
              Set a budget and dates, then tag transactions or log visits — same flow for trips and recurring services.
            </p>
            <button
              onClick={() => setCreateStep("pick")}
              className="rounded-xl bg-purple-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-purple-700"
            >
              Create your first tracker
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-baseline justify-between">
              <div>
                <h2 className="text-[11px] font-bold uppercase tracking-wider text-gray-500">Your trackers</h2>
                <p className="text-[11px] text-gray-400 mt-0.5">
                  {oneTimeCount} one-time
                  {recurringCount ? ` · ${recurringCount} recurring` : ""}
                </p>
              </div>
            </div>
            <div className="space-y-3">
              {events.map((ev) =>
                ev.kind === "service" ? (
                  <ServiceCard
                    key={ev.id}
                    ev={ev}
                    headers={headers}
                    homeCurrency={homeCurrency}
                    onVisitLogged={handleVisitLogged}
                    onTransactionTagged={handleTransactionTagged}
                  />
                ) : (
                  <ProjectCard
                    key={ev.id}
                    ev={ev}
                    headers={headers}
                    homeCurrency={homeCurrency}
                    onTransactionTagged={handleTransactionTagged}
                    onLedgerAdded={handleLedgerAdded}
                  />
                ),
              )}
            </div>
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
    </div>
  );
}
