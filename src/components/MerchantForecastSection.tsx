"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import { usePlan } from "@/contexts/PlanContext";
import {
  annualFromEstimated,
  annualFromRecurring,
  defaultForecastDoc,
  recurringToVisitsPeriod,
  roundMoney,
  FORECAST_FREQUENCY_OPTIONS,
  type ForecastMode,
  type MerchantForecastDoc,
  type RecurringFrequency,
  type VisitsPeriod,
} from "@/lib/merchantForecast";
import { fmt } from "@/lib/currencyUtils";

// ── Real spend cadence (header) — separate from Pro planning calculator ───────

type MerchantCadenceContextValue = {
  spendCadence: RecurringFrequency;
  onCadenceChange: (freq: RecurringFrequency) => void;
  cadenceLoaded: boolean;
  planLoading: boolean;
};

const MerchantCadenceContext = createContext<MerchantCadenceContextValue | null>(null);

/** How often you actually spend here — persisted to merchantCadence, not the forecast doc. */
export function MerchantSpendCadencePill() {
  const ctx = useContext(MerchantCadenceContext);
  if (!ctx) return null;

  const { spendCadence, onCadenceChange, cadenceLoaded, planLoading } = ctx;
  const disabled = planLoading || !cadenceLoaded;

  return (
    <div className="relative shrink-0">
      <select
        value={spendCadence}
        disabled={disabled}
        onChange={(e) => onCadenceChange(e.target.value as RecurringFrequency)}
        aria-label="How often you actually spend here"
        title="How often you actually spend here"
        className="appearance-none cursor-pointer rounded-full border border-gray-200 bg-gray-50 py-1 pl-2.5 pr-7 text-xs font-medium text-gray-700 focus:border-purple-400 focus:outline-none focus:ring-1 focus:ring-purple-400 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {FORECAST_FREQUENCY_OPTIONS.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
      <span className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] text-gray-400">
        ▾
      </span>
    </div>
  );
}

/** @deprecated Use MerchantSpendCadencePill */
export const MerchantForecastFrequencyPill = MerchantSpendCadencePill;

// ── Provider: cadence load/save + forecast calculator state ───────────────────

export function MerchantForecastProvider({
  slug,
  merchantName,
  avgAmount,
  lastSeenDate,
  idToken,
  children,
}: {
  slug: string;
  merchantName?: string;
  avgAmount: number;
  /** ISO date of the most recent transaction at this merchant (YYYY-MM-DD). Used as the subscription anchor. */
  lastSeenDate?: string | null;
  idToken: string | null;
  children: ReactNode;
}) {
  const { can, loading: planLoading } = usePlan();
  const canForecast = can("forecast");

  const baseDefaults = useMemo(() => defaultForecastDoc(avgAmount), [avgAmount]);

  const [spendCadence, setSpendCadence] = useState<RecurringFrequency>("monthly");
  const [cadenceLoaded, setCadenceLoaded] = useState(false);

  const [mode, setMode] = useState<ForecastMode>(baseDefaults.mode);
  const [recurringFrequency, setRecurringFrequency] = useState<RecurringFrequency>(
    baseDefaults.recurringFrequency,
  );
  const [recurringAmount, setRecurringAmount] = useState(strMoney(baseDefaults.recurringAmount));
  const [perVisitAmount, setPerVisitAmount] = useState(strMoney(baseDefaults.perVisitAmount));
  const [visitsPerPeriod, setVisitsPerPeriod] = useState(String(baseDefaults.visitsPerPeriod || 1));
  const [visitsPeriod, setVisitsPeriod] = useState<VisitsPeriod>(baseDefaults.visitsPeriod);

  const [forecastLoaded, setForecastLoaded] = useState(false);

  const applyForecastDoc = useCallback((d: MerchantForecastDoc) => {
    setMode(d.mode);
    const freq = (d.recurringFrequency as RecurringFrequency) ?? "monthly";
    setRecurringFrequency(
      ["weekly", "biweekly", "monthly", "quarterly", "yearly", "oneoff"].includes(freq)
        ? freq
        : "monthly",
    );
    setRecurringAmount(strMoney(Number(d.recurringAmount) || 0));
    setPerVisitAmount(strMoney(Number(d.perVisitAmount) || 0));
    setVisitsPerPeriod(String(d.visitsPerPeriod ?? 1));
    setVisitsPeriod(d.visitsPeriod ?? "month");
  }, []);

  const onCalculatorPeriodChange = useCallback((freq: RecurringFrequency) => {
    setRecurringFrequency(freq);
    if (freq !== "oneoff") {
      setVisitsPeriod(recurringToVisitsPeriod(freq));
    }
    if (freq === "oneoff") {
      setMode("recurring");
    }
  }, []);

  const persistCadence = useCallback(
    async (freq: RecurringFrequency) => {
      if (!idToken || !slug) return;
      try {
        await fetch("/api/user/spending/merchant-cadence", {
          method: "PUT",
          headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            slug,
            frequency: freq,
            ...(merchantName ? { merchantName, amount: avgAmount } : {}),
            ...(lastSeenDate ? { lastSeenDate } : {}),
          }),
        });
      } catch {
        /* best-effort */
      }
    },
    [idToken, slug],
  );

  const onCadenceChange = useCallback(
    (freq: RecurringFrequency) => {
      setSpendCadence(freq);
      void persistCadence(freq);
    },
    [persistCadence],
  );

  useEffect(() => {
    if (!idToken || !slug) {
      setCadenceLoaded(true);
      return;
    }
    setCadenceLoaded(false);
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/user/spending/merchant-cadence?slug=${encodeURIComponent(slug)}`,
          { headers: { Authorization: `Bearer ${idToken}` } },
        );
        const json = await res.json().catch(() => ({}));
        if (cancelled) return;
        const f = json.cadence?.frequency as RecurringFrequency | undefined;
        if (f && FORECAST_FREQUENCY_OPTIONS.some((o) => o.id === f)) {
          setSpendCadence(f);
        }
      } catch {
        /* keep default */
      } finally {
        if (!cancelled) setCadenceLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [idToken, slug]);

  useEffect(() => {
    if (planLoading) return;
    if (!canForecast || !idToken || !slug) {
      setForecastLoaded(true);
      applyForecastDoc(baseDefaults);
      return;
    }
    setForecastLoaded(false);
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/user/spending/merchant-forecast?slug=${encodeURIComponent(slug)}`,
          { headers: { Authorization: `Bearer ${idToken}` } },
        );
        const json = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (json.forecast) {
          applyForecastDoc({ ...baseDefaults, ...json.forecast });
        } else {
          applyForecastDoc(baseDefaults);
        }
      } catch {
        if (!cancelled) applyForecastDoc(baseDefaults);
      } finally {
        if (!cancelled) setForecastLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [planLoading, canForecast, idToken, slug, baseDefaults, applyForecastDoc]);

  const showLock = !planLoading && !canForecast;

  const cadenceCtx = useMemo<MerchantCadenceContextValue>(
    () => ({
      spendCadence,
      onCadenceChange,
      cadenceLoaded,
      planLoading,
    }),
    [spendCadence, onCadenceChange, cadenceLoaded, planLoading],
  );

  return (
    <MerchantCadenceContext.Provider value={cadenceCtx}>
      <MerchantForecastInnerState
        slug={slug}
        idToken={idToken}
        canForecast={canForecast}
        planLoading={planLoading}
        forecastLoaded={forecastLoaded}
        mode={mode}
        setMode={setMode}
        recurringFrequency={recurringFrequency}
        isOneOff={recurringFrequency === "oneoff"}
        recurringAmount={recurringAmount}
        setRecurringAmount={setRecurringAmount}
        perVisitAmount={perVisitAmount}
        setPerVisitAmount={setPerVisitAmount}
        visitsPerPeriod={visitsPerPeriod}
        setVisitsPerPeriod={setVisitsPerPeriod}
        visitsPeriod={visitsPeriod}
        showLock={showLock}
        onCalculatorPeriodChange={onCalculatorPeriodChange}
      >
        {children}
      </MerchantForecastInnerState>
    </MerchantCadenceContext.Provider>
  );
}

// ── Forecast calculator (Pro) — what-if yearly estimate only ──────────────────

type ForecastFormState = {
  slug: string;
  idToken: string | null;
  canForecast: boolean;
  planLoading: boolean;
  forecastLoaded: boolean;
  mode: ForecastMode;
  setMode: (m: ForecastMode) => void;
  recurringFrequency: RecurringFrequency;
  isOneOff: boolean;
  recurringAmount: string;
  setRecurringAmount: (s: string) => void;
  perVisitAmount: string;
  setPerVisitAmount: (s: string) => void;
  visitsPerPeriod: string;
  setVisitsPerPeriod: (s: string) => void;
  visitsPeriod: VisitsPeriod;
  showLock: boolean;
  onCalculatorPeriodChange: (freq: RecurringFrequency) => void;
};

const ForecastFormContext = createContext<ForecastFormState | null>(null);

function useForecastForm(): ForecastFormState {
  const v = useContext(ForecastFormContext);
  if (!v) throw new Error("Merchant forecast form state missing");
  return v;
}

function MerchantForecastInnerState({
  children,
  ...state
}: ForecastFormState & { children: ReactNode }) {
  return <ForecastFormContext.Provider value={state}>{children}</ForecastFormContext.Provider>;
}

function num(v: string): number {
  const n = parseFloat(v.replace(/,/g, ""));
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

function strMoney(n: number): string {
  return n === 0 ? "" : String(roundMoney(n));
}

function periodLabel(freq: Exclude<RecurringFrequency, "oneoff">): string {
  const labels: Record<typeof freq, string> = {
    weekly: "week",
    biweekly: "2 weeks",
    monthly: "month",
    quarterly: "quarter",
    yearly: "year",
  };
  return labels[freq];
}

export function MerchantForecastSection() {
  const {
    slug,
    idToken,
    canForecast,
    planLoading,
    forecastLoaded,
    mode,
    setMode,
    recurringFrequency,
    isOneOff,
    recurringAmount,
    setRecurringAmount,
    perVisitAmount,
    setPerVisitAmount,
    visitsPerPeriod,
    setVisitsPerPeriod,
    visitsPeriod,
    showLock,
    onCalculatorPeriodChange,
  } = useForecastForm();

  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  const estimatedAnnual = useMemo(() => {
    if (isOneOff) {
      return roundMoney(annualFromRecurring(num(recurringAmount), "oneoff"));
    }
    if (mode === "recurring") {
      return roundMoney(
        annualFromRecurring(num(recurringAmount), recurringFrequency as Exclude<RecurringFrequency, "oneoff">),
      );
    }
    return roundMoney(
      annualFromEstimated(num(perVisitAmount), num(visitsPerPeriod), visitsPeriod),
    );
  }, [
    isOneOff,
    mode,
    recurringAmount,
    recurringFrequency,
    perVisitAmount,
    visitsPerPeriod,
    visitsPeriod,
  ]);

  async function handleSave() {
    if (!canForecast || !idToken) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      const body: MerchantForecastDoc & { slug: string } = {
        slug,
        mode: isOneOff ? "recurring" : mode,
        recurringFrequency,
        recurringAmount: num(recurringAmount),
        perVisitAmount: num(perVisitAmount),
        visitsPerPeriod: num(visitsPerPeriod),
        visitsPeriod,
      };
      const res = await fetch("/api/user/spending/merchant-forecast", {
        method: "PUT",
        headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setSaveMsg(j.error === "Pro feature" ? "Upgrade to Pro to save." : "Could not save.");
        return;
      }
      setSaveMsg("Saved.");
      setTimeout(() => setSaveMsg(null), 2500);
    } finally {
      setSaving(false);
    }
  }

  const collapsibleInner = (
    <>
      <p className="text-xs leading-relaxed text-gray-500">
        Rough <span className="font-medium text-gray-700">what-if</span> math for planning — not your statement
        totals. Separate from how often you actually shop here (header).
      </p>

      <div className="mt-4">
        <label className="text-[11px] font-medium uppercase tracking-wide text-gray-400">
          Calculator period
        </label>
        <select
          value={recurringFrequency}
          disabled={showLock}
          onChange={(e) => onCalculatorPeriodChange(e.target.value as RecurringFrequency)}
          aria-label="Period for this estimate"
          className="mt-1 w-full max-w-xs rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm disabled:bg-gray-50 disabled:text-gray-500"
        >
          {FORECAST_FREQUENCY_OPTIONS.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      {!isOneOff && (
        <div className="mt-4 flex flex-wrap gap-2">
          {(["recurring", "estimated"] as const).map((m) => (
            <button
              key={m}
              type="button"
              disabled={showLock}
              onClick={() => setMode(m)}
              className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
                mode === m
                  ? "border-purple-500 bg-purple-600 text-white"
                  : "border-gray-200 bg-white text-gray-700 hover:border-gray-300"
              } ${showLock ? "cursor-default opacity-90" : ""}`}
            >
              {m === "recurring" ? "Recurring payment" : "By visits"}
            </button>
          ))}
        </div>
      )}

      {isOneOff ? (
        <div className="mt-4 space-y-3">
          <div>
            <label className="text-[11px] font-medium uppercase tracking-wide text-gray-400">
              One-time amount
            </label>
            <input
              type="text"
              inputMode="decimal"
              disabled={showLock}
              value={recurringAmount}
              onChange={(e) => setRecurringAmount(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm disabled:bg-gray-50"
              placeholder="0"
            />
          </div>
        </div>
      ) : mode === "recurring" ? (
        <div className="mt-4 space-y-3">
          <div>
            <label className="text-[11px] font-medium uppercase tracking-wide text-gray-400">
              Amount per {periodLabel(recurringFrequency as Exclude<RecurringFrequency, "oneoff">)}
            </label>
            <input
              type="text"
              inputMode="decimal"
              disabled={showLock}
              value={recurringAmount}
              onChange={(e) => setRecurringAmount(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm disabled:bg-gray-50"
              placeholder="0"
            />
          </div>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          <div>
            <label className="text-[11px] font-medium uppercase tracking-wide text-gray-400">Per visit</label>
            <input
              type="text"
              inputMode="decimal"
              disabled={showLock}
              value={perVisitAmount}
              onChange={(e) => setPerVisitAmount(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm disabled:bg-gray-50"
              placeholder="0"
            />
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[4rem] flex-1">
              <label className="text-[11px] font-medium uppercase tracking-wide text-gray-400">Times</label>
              <input
                type="text"
                inputMode="decimal"
                disabled={showLock}
                value={visitsPerPeriod}
                onChange={(e) => setVisitsPerPeriod(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm disabled:bg-gray-50"
                placeholder="1"
              />
            </div>
            <div className="min-w-[8rem] flex-[2]">
              <label className="text-[11px] font-medium uppercase tracking-wide text-gray-400">
                Per {periodLabel(recurringFrequency as Exclude<RecurringFrequency, "oneoff">)}
              </label>
              <p className="mt-1 rounded-lg border border-gray-100 bg-white px-3 py-2 text-xs text-gray-500">
                Matches calculator period above
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="mt-5 rounded-lg bg-purple-50 px-4 py-3.5">
        <p className="text-[11px] font-medium uppercase tracking-wide text-purple-800/70">
          {isOneOff ? "What-if yearly impact" : "What-if yearly total"}
        </p>
        <p className="mt-0.5 text-2xl font-bold tracking-tight text-purple-950 tabular-nums">{fmt(estimatedAnnual)}</p>
        <p className="mt-1 text-[11px] text-purple-800/60">
          {isOneOff ? "From the one-time amount above" : "From the calculator inputs"}
        </p>
      </div>

      {canForecast && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={saving || !idToken || !forecastLoaded}
            onClick={handleSave}
            className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-purple-700 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save calculator"}
          </button>
          {saveMsg && <span className="text-xs text-gray-600">{saveMsg}</span>}
        </div>
      )}
    </>
  );

  if (planLoading || (!forecastLoaded && canForecast && idToken)) {
    return (
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-100 px-5 py-4">
          <div className="h-3 w-44 animate-pulse rounded bg-gray-100" />
        </div>
        <div className="px-5 py-3.5">
          <div className="h-4 w-48 animate-pulse rounded bg-gray-100" />
        </div>
      </div>
    );
  }

  return (
    <div className="relative overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-5 py-4">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-400">Planning calculator</p>
          <p className="mt-0.5 text-[11px] text-gray-400">Pro — rough yearly estimate from your inputs</p>
        </div>
        {showLock && (
          <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-800">
            Pro
          </span>
        )}
      </div>

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-5 py-3.5 text-left transition-colors hover:bg-gray-50/80"
        aria-expanded={open}
      >
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900">What-if amounts</p>
          <p className="text-[11px] text-gray-400">{open ? "Tap to hide" : "Open the calculator"}</p>
        </div>
        <svg
          className={`h-5 w-5 shrink-0 text-gray-400 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className={`relative border-t border-gray-100 bg-gray-50/60 px-5 py-4 ${showLock ? "select-none" : ""}`}>
          <div className={showLock ? "blur-[5px] pointer-events-none opacity-60" : ""}>{collapsibleInner}</div>
          {showLock && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2.5 px-6 text-center">
              <p className="text-sm font-semibold text-gray-900">Unlock calculator</p>
              <p className="max-w-xs text-xs text-gray-600">
                Pro: save what-if amounts and a rough yearly figure per merchant.
              </p>
              <Link
                href="/account/billing"
                className="mt-1 rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-purple-700"
              >
                View plans
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
