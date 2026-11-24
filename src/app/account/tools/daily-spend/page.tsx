"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseClient } from "@/lib/firebase";
import { formatCurrency } from "@/lib/currencyUtils";
import { IntactAmount } from "@/components/IntactAmount";
import type { Plan } from "@/app/api/user/plans/route";
import {
  isPlanCompleted,
  monthlySetAside,
  todayISO,
} from "@/app/account/tools/planner/planList";
import type {
  DailySpendDeltaKind,
  DailySpendRange,
  DailySpendResult,
  DailySpendThemeId,
} from "@/lib/dailySpend";
import {
  DAILY_SPEND_RANGES,
  DAILY_SPEND_INCLUDED_NOTE,
  DAILY_SPEND_THEMES,
  monthlyKeep,
  monthsSooner,
  fullySavedSoonerLabel,
  NO_SPEND_THIS_MONTH_MESSAGE,
  whatIfSliderBounds,
  yearlyKeep,
} from "@/lib/dailySpend";
import {
  CARD_CLASS,
  COLUMNS_CLASS,
  HEADER_CLASS,
  PAGE_CLASS,
  PAGE_INNER_CLASS,
  RANGE_TOGGLE_CLASS,
  STACK_CLASS,
  SUBTITLE_CLASS,
  THEME_AMOUNT_CLASS,
  THEME_CHEVRON_CLASS,
  THEME_NAME_CLASS,
  THEME_ROW_CLASS,
  TITLE_CLASS,
} from "./dailySpendReadLayout";
import { ThemeDetailModal } from "./ThemeDetailModal";

const RANGE_BUTTON_LABEL: Record<DailySpendRange, string> = {
  "3m": "3M",
  "6m": "6M",
  "12m": "12M",
};

function money(amount: number, currency: string): string {
  return formatCurrency(amount, currency, undefined, true);
}

function moneyPerDay(amount: number, currency: string): string {
  return `${money(amount, currency)}/day`;
}

function planProgress(plan: Plan): number {
  return (
    plan.linkedTransactions.reduce((sum, tx) => sum + tx.amount, 0) +
    plan.cashEntries.reduce((sum, entry) => sum + entry.amount, 0)
  );
}

function upcomingPlans(plans: Plan[], today: string): Plan[] {
  return plans.filter((plan) => {
    if (isPlanCompleted(plan)) return false;
    if (plan.startDate <= today) return false;
    return monthlySetAside(plan, planProgress(plan), today) != null;
  });
}

function DeltaPill({
  kind,
  delta,
  currency,
}: {
  kind: DailySpendDeltaKind | null;
  delta: number | null;
  currency: string;
}) {
  if (kind == null || delta == null) return null;
  if (kind === "even") {
    return (
      <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-500">
        About even
      </span>
    );
  }
  const up = kind === "up";
  return (
    <span
      className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums ${
        up ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"
      }`}
    >
      {up ? "▲" : "▼"} {money(Math.abs(delta), currency)}
    </span>
  );
}

export default function DailySpendPage() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<DailySpendRange>("3m");
  const [data, setData] = useState<DailySpendResult | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [selectedThemeIds, setSelectedThemeIds] = useState<Set<DailySpendThemeId>>(
    () => new Set(DAILY_SPEND_THEMES.map((t) => t.id)),
  );
  const [targetDaily, setTargetDaily] = useState<number | null>(null);
  const [planPickerOpen, setPlanPickerOpen] = useState(false);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [openThemeId, setOpenThemeId] = useState<DailySpendThemeId | null>(null);
  const themeRowRefs = useRef<Partial<Record<DailySpendThemeId, HTMLButtonElement | null>>>({});

  useEffect(() => {
    const { auth } = getFirebaseClient();
    return onAuthStateChanged(auth, async (user) => {
      if (!user) {
        router.push("/login");
        return;
      }
      const tok = await user.getIdToken();
      setToken(tok);
    });
  }, [router]);

  useEffect(() => {
    if (!token) return;
    const abort = new AbortController();
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const res = await fetch(`/api/user/daily-spend?range=${range}`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: abort.signal,
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(typeof body.error === "string" ? body.error : "Failed to load daily spend");
        }
        const json = (await res.json()) as DailySpendResult;
        if (!abort.signal.aborted) setData(json);
      } catch (err) {
        if (abort.signal.aborted) return;
        setError(err instanceof Error ? err.message : "Failed to load daily spend");
      } finally {
        if (!abort.signal.aborted) setLoading(false);
      }
    })();
    return () => abort.abort();
  }, [token, range]);

  useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        const res = await fetch("/api/user/plans", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const body = await res.json();
        setPlans(body.items || []);
      } catch {
        // Plans are optional for the what-if card.
      }
    })();
  }, [token]);

  const usualDaily = useMemo(() => {
    if (!data) return 0;
    return data.themes
      .filter((theme) => selectedThemeIds.has(theme.id))
      .reduce((sum, theme) => sum + theme.dailyRate, 0);
  }, [data, selectedThemeIds]);

  useEffect(() => {
    if (!data) return;
    setTargetDaily(usualDaily);
  }, [data, usualDaily]);

  const bounds = whatIfSliderBounds(usualDaily);
  const target = targetDaily ?? usualDaily;
  const keepMonthly = monthlyKeep(usualDaily, target);
  const keepYearly = yearlyKeep(usualDaily, target);
  const today = todayISO();
  const plansForWhatIf = upcomingPlans(plans, today);
  const selectedPlan = plansForWhatIf.find((p) => p.id === selectedPlanId) ?? null;
  const planSetAside = selectedPlan
    ? monthlySetAside(selectedPlan, planProgress(selectedPlan), today)
    : null;
  const sooner =
    selectedPlan && planSetAside != null
      ? monthsSooner(selectedPlan.budget - planProgress(selectedPlan), planSetAside, keepMonthly)
      : null;

  if (loading && !data) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-purple-600 border-t-transparent" />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className={PAGE_CLASS}>
        <div className={PAGE_INNER_CLASS}>
          <p className="text-red-600">{error}</p>
        </div>
      </div>
    );
  }

  if (!data || !data.hasData) {
    return (
      <div className={PAGE_CLASS}>
        <div className={PAGE_INNER_CLASS}>
          <Header range={range} onRangeChange={setRange} />
          <div className={CARD_CLASS}>
            <p className="text-sm text-gray-600">
              Upload a statement to see what everyday spending costs per day.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const currency = data.currency;
  const tickPct =
    bounds.max > bounds.min ? ((usualDaily - bounds.min) / (bounds.max - bounds.min)) * 100 : 50;

  return (
    <>
    <div className={PAGE_CLASS}>
      <div className={PAGE_INNER_CLASS}>
        <Header range={range} onRangeChange={setRange} />

        <div className={COLUMNS_CLASS}>
          <div className={STACK_CLASS}>
            <div className={CARD_CLASS}>
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-400">
                Everyday spend · {data.rangeLabel}
              </p>
              <div className="mt-2 flex min-w-0 flex-wrap items-end gap-3">
                <IntactAmount className="text-4xl font-semibold tracking-tight text-gray-900 sm:text-5xl">
                  {moneyPerDay(data.everydayDailyRate, currency)}
                </IntactAmount>
                <DeltaPill
                  kind={data.everydayDeltaKind}
                  delta={data.everydayDelta}
                  currency={currency}
                />
              </div>
              <p className="mt-3 text-sm text-gray-500">
                {data.monthRangeLabel || "No finished months"} · finished months only · divided by
                calendar days
              </p>
            </div>

            {data.currentMonth && (
              <div className={CARD_CLASS}>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-sm font-semibold text-gray-900">This month so far</h2>
                  <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800">
                    {data.currentMonth.inProgressLabel}
                  </span>
                </div>
                {data.currentMonth.hasEverydaySpend ? (
                  <IntactAmount className="mt-2 block text-2xl font-semibold tabular-nums text-gray-900">
                    {moneyPerDay(data.currentMonth.dailyRate, currency)}
                  </IntactAmount>
                ) : (
                  <p className="mt-2 text-sm text-gray-500">{NO_SPEND_THIS_MONTH_MESSAGE}</p>
                )}
                <p className="mt-2 text-sm text-gray-500">
                  {data.currentMonth.rangeLabel} · {data.currentMonth.daysElapsed} days · not used
                  in the average
                </p>
              </div>
            )}

            <div className={CARD_CLASS}>
              <h2 className="text-sm font-semibold text-gray-900">Where a day goes</h2>
              <ul className="mt-1 divide-y divide-gray-100">
                {data.themes.map((theme) => (
                  <li key={theme.id}>
                    <button
                      type="button"
                      ref={(el) => {
                        themeRowRefs.current[theme.id] = el;
                      }}
                      className={THEME_ROW_CLASS}
                      onClick={() => setOpenThemeId(theme.id)}
                      aria-haspopup="dialog"
                      aria-label={`${theme.label} details`}
                    >
                      <span
                        className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: theme.color }}
                        aria-hidden
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className={THEME_NAME_CLASS}>{theme.label}</p>
                            {theme.id === "food" && (
                              <p className="mt-0.5 break-words text-xs text-gray-500">
                                Groceries {money(theme.groceriesDaily ?? 0, currency)} · Eating out{" "}
                                {money(theme.eatingOutDaily ?? 0, currency)}
                              </p>
                            )}
                          </div>
                          <div className={`${THEME_AMOUNT_CLASS} space-y-1`}>
                            <p className="font-semibold text-gray-900">
                              {moneyPerDay(theme.dailyRate, currency)}
                            </p>
                            <div className="flex justify-end">
                              <DeltaPill
                                kind={theme.deltaKind}
                                delta={theme.delta}
                                currency={currency}
                              />
                            </div>
                          </div>
                        </div>
                        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${Math.min(100, Math.max(0, theme.share * 100))}%`,
                              backgroundColor: theme.color,
                            }}
                          />
                        </div>
                      </div>
                      <svg
                        className={THEME_CHEVRON_CLASS}
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                        aria-hidden
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                      </svg>
                    </button>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-gray-400">
                {DAILY_SPEND_INCLUDED_NOTE}
              </p>
            </div>
          </div>

          <div className={STACK_CLASS}>
            <div className={CARD_CLASS}>
              <h2 className="text-sm font-semibold text-gray-900">What if</h2>
              <div className="mt-3 flex min-w-0 flex-wrap gap-2">
                {DAILY_SPEND_THEMES.map((theme) => {
                  const on = selectedThemeIds.has(theme.id);
                  return (
                    <button
                      key={theme.id}
                      type="button"
                      onClick={() => {
                        setSelectedThemeIds((prev) => {
                          const next = new Set(prev);
                          if (next.has(theme.id)) next.delete(theme.id);
                          else next.add(theme.id);
                          return next;
                        });
                      }}
                      className={`rounded-full border px-3 py-1 text-xs font-medium ${
                        on
                          ? "border-gray-900 bg-gray-900 text-white"
                          : "border-gray-200 bg-white text-gray-600"
                      }`}
                    >
                      {theme.label}
                    </button>
                  );
                })}
              </div>

              <div className="mt-5">
                <label htmlFor="daily-target" className="text-sm text-gray-600">
                  Daily target
                </label>
                <div className="relative mt-3">
                  <div
                    className="pointer-events-none absolute -top-1 h-4 w-px bg-gray-400"
                    style={{ left: `clamp(0%, ${tickPct}%, 100%)` }}
                    aria-hidden
                    title="Usual"
                  />
                  <input
                    id="daily-target"
                    type="range"
                    min={bounds.min}
                    max={Math.max(bounds.max, bounds.min + 0.01)}
                    step={0.5}
                    value={Math.min(bounds.max, Math.max(bounds.min, target))}
                    disabled={usualDaily <= 0}
                    onChange={(e) => setTargetDaily(Number(e.target.value))}
                    className="w-full accent-emerald-600"
                  />
                </div>
                <div className="mt-2 flex min-w-0 flex-wrap items-center justify-between gap-2 text-sm">
                  <IntactAmount className="font-semibold text-gray-900">
                    {moneyPerDay(target, currency)}
                  </IntactAmount>
                  <p className="text-gray-500">Your usual is {money(usualDaily, currency)}</p>
                </div>
              </div>

              {keepMonthly > 0 ? (
                <div className="mt-4 rounded-xl bg-emerald-50 px-4 py-3 text-emerald-900">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-700">
                    You&apos;d keep
                  </p>
                  <p className="mt-1 text-lg font-semibold">
                    <IntactAmount>{money(keepMonthly, currency)}</IntactAmount> more a month
                    <span className="text-sm font-medium text-emerald-800">
                      {" "}
                      / <IntactAmount>{money(keepYearly, currency)}</IntactAmount> a year
                    </span>
                  </p>
                </div>
              ) : (
                <p className="mt-4 text-sm text-gray-500">
                  Slide below your usual to see how much you&apos;d keep.
                </p>
              )}

              {plansForWhatIf.length > 0 && (
                <div className="mt-4">
                  <button
                    type="button"
                    onClick={() => {
                      if (!planPickerOpen && !selectedPlanId && plansForWhatIf[0]) {
                        setSelectedPlanId(plansForWhatIf[0].id);
                      }
                      setPlanPickerOpen((open) => !open);
                    }}
                    className="w-full rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-900 hover:bg-gray-50"
                  >
                    Put it toward a plan
                  </button>
                  {planPickerOpen && (
                    <ul className="mt-2 min-w-0 divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-200">
                      {plansForWhatIf.map((plan) => (
                        <li key={plan.id}>
                          <button
                            type="button"
                            onClick={() => setSelectedPlanId(plan.id)}
                            className={`block w-full min-w-0 break-words px-3 py-2 text-left text-sm ${
                              selectedPlan?.id === plan.id
                                ? "bg-violet-50 font-medium text-violet-800"
                                : "text-gray-700 hover:bg-gray-50"
                            }`}
                          >
                            {plan.name}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {selectedPlan && sooner != null && keepMonthly > 0 && (
                    <p className="mt-3 text-sm text-gray-700">
                      {fullySavedSoonerLabel(sooner)}
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
    <ThemeDetailModal
      theme={data.themes.find((t) => t.id === openThemeId) ?? null}
      currency={currency}
      windowLabel={data.monthRangeLabel}
      onClose={() => {
        const closedId = openThemeId;
        setOpenThemeId(null);
        if (closedId) requestAnimationFrame(() => themeRowRefs.current[closedId]?.focus());
      }}
    />
    </>
  );
}

function Header({
  range,
  onRangeChange,
}: {
  range: DailySpendRange;
  onRangeChange: (range: DailySpendRange) => void;
}) {
  return (
    <div className={HEADER_CLASS}>
      <div className="min-w-0">
        <h1 className={TITLE_CLASS}>Daily spend</h1>
        <p className={SUBTITLE_CLASS}>What your everyday spending costs per day</p>
      </div>
      <div className={RANGE_TOGGLE_CLASS} role="group" aria-label="Average window">
        {DAILY_SPEND_RANGES.map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => onRangeChange(value)}
            className={`rounded-full px-3 py-1 text-sm font-medium ${
              range === value ? "bg-gray-900 text-white" : "text-gray-600 hover:text-gray-900"
            }`}
          >
            {RANGE_BUTTON_LABEL[value]}
          </button>
        ))}
      </div>
    </div>
  );
}
