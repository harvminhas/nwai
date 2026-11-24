"use client";

import Link from "next/link";
import { IntactAmount } from "@/components/IntactAmount";
import { formatCurrency } from "@/lib/currencyUtils";
import { formatMonthYear } from "@/lib/dateFormatting";
import {
  HOUSING_EXCLUDED_FROM_TARGET_NOTE,
  joinThemeLabels,
  PACE_NOT_FINAL_LABEL,
  TRACKER_HISTORY_HREF,
  type DailySpendTrackerView,
} from "@/lib/dailySpendTracker";
import { CARD_CLASS, PACE_PANEL_CLASS } from "./dailySpendReadLayout";

function money(amount: number, currency: string): string {
  return formatCurrency(amount, currency, undefined, true);
}

function moneyPerDay(amount: number, currency: string): string {
  return `${money(amount, currency)}/day`;
}

export function TrackerCard({
  view,
  currency,
  onStop,
  stopping,
}: {
  view: DailySpendTrackerView;
  currency: string;
  onStop: () => void;
  stopping?: boolean;
}) {
  const { record, pace, lastFinished, hitMiss } = view;
  const overLabels = lastFinished?.themesOverUsual.map((t) => t.label) ?? [];
  // An edited target applies from next month; say so while this month still uses the old one.
  const latestPeriod = record.periods[record.periods.length - 1];
  const pendingTarget =
    pace && record.periods.length > 1 && latestPeriod && latestPeriod.startMonth > pace.yearMonth
      ? latestPeriod
      : null;

  return (
    <div className={CARD_CLASS}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-400">
        Daily target
      </p>
      <IntactAmount className="mt-2 block text-3xl font-semibold tracking-tight text-gray-900">
        {moneyPerDay(record.targetDaily, currency)}
      </IntactAmount>
      <p className="mt-2 text-sm text-gray-600">
        {joinThemeLabels(record.trackedThemes)}. {HOUSING_EXCLUDED_FROM_TARGET_NOTE}
      </p>
      <p className="mt-1 text-sm text-gray-500">
        Usual when you started: {moneyPerDay(record.usualDailyAtStart, currency)}
      </p>
      {pendingTarget && pace && (
        <p className="mt-1 text-sm text-gray-500">
          New target starts in {formatMonthYear(pendingTarget.startMonth)}. This month still uses{" "}
          {moneyPerDay(pace.targetDaily, currency)}.
        </p>
      )}

      {pace && (
        <div className={`mt-4 ${PACE_PANEL_CLASS}`}>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold">This month so far</h3>
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">
              {PACE_NOT_FINAL_LABEL}
            </span>
          </div>
          {pace.hasEverydaySpend ? (
            <IntactAmount className="mt-2 block text-xl font-semibold tabular-nums">
              {moneyPerDay(pace.actualDaily, currency)}
            </IntactAmount>
          ) : (
            <p className="mt-2 text-sm">No spending in these themes yet this month.</p>
          )}
          <p className="mt-1 text-sm">
            Target {moneyPerDay(pace.targetDaily, currency)} · {pace.daysElapsed} days elapsed
          </p>
          {!pace.trackingHasStarted && (
            <p className="mt-1 text-sm">
              Tracking starts in {formatMonthYear(record.startMonth)}. This month does not count.
            </p>
          )}
        </div>
      )}

      <div className="mt-4 min-w-0">
        <h3 className="text-sm font-semibold text-gray-900">Last finished month</h3>
        {lastFinished ? (
          <div className="mt-2 space-y-2 text-sm text-gray-700">
            <p className="font-medium text-gray-900">{formatMonthYear(lastFinished.yearMonth)}</p>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1">
              <p className="text-gray-500">Actual / day</p>
              <IntactAmount className="text-right font-medium text-gray-900">
                {moneyPerDay(lastFinished.actualDaily, currency)}
              </IntactAmount>
              <p className="text-gray-500">Target / day</p>
              <IntactAmount className="text-right font-medium text-gray-900">
                {moneyPerDay(lastFinished.targetDaily, currency)}
              </IntactAmount>
              <p className="text-gray-500">Actual / month</p>
              <IntactAmount className="text-right font-medium text-gray-900">
                {money(lastFinished.actualMonth, currency)}
              </IntactAmount>
              <p className="text-gray-500">Target / month</p>
              <IntactAmount className="text-right font-medium text-gray-900">
                {money(lastFinished.targetMonth, currency)}
              </IntactAmount>
            </div>
            <p>
              Kept{" "}
              <IntactAmount className={lastFinished.kept < 0 ? "text-red-700" : "text-emerald-800"}>
                {money(lastFinished.kept, currency)}
              </IntactAmount>{" "}
              vs {money(lastFinished.promised, currency)} promised
            </p>
            <p className="text-gray-600">
              {overLabels.length > 0
                ? `${overLabels.join(", ")} went over the usual.`
                : "No theme went over the usual."}
            </p>
          </div>
        ) : (
          <p className="mt-2 text-sm text-gray-500">
            No finished month yet. Tracking starts in {formatMonthYear(record.startMonth)}.
          </p>
        )}
      </div>

      {hitMiss.length > 0 && (
        <div className="mt-4">
          <h3 className="text-sm font-semibold text-gray-900">Finished months</h3>
          <ol className="mt-2 flex min-w-0 flex-wrap gap-2">
            {hitMiss.map((month) => (
              <li key={month.yearMonth} className="flex flex-col items-center gap-1">
                <span
                  className={`h-2.5 w-2.5 rounded-full ${month.hit ? "bg-emerald-500" : "bg-red-400"}`}
                  title={`${month.label}: ${month.hit ? "hit" : "miss"}`}
                  aria-label={`${month.label} ${month.hit ? "hit" : "miss"}`}
                />
                <span className="text-[10px] text-gray-500">{month.label.replace(/ \d{4}$/, "")}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      <Link
        href={TRACKER_HISTORY_HREF}
        className="mt-4 inline-block text-sm font-medium text-emerald-800 hover:underline"
      >
        See month-by-month history
      </Link>

      <button
        type="button"
        onClick={onStop}
        disabled={stopping}
        className="mt-4 block text-sm text-gray-500 hover:text-gray-800 disabled:opacity-50"
      >
        Stop tracking
      </button>
    </div>
  );
}
