"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { IntactAmount } from "@/components/IntactAmount";
import { formatCurrency } from "@/lib/currencyUtils";
import { IN_PROGRESS_LABEL } from "@/lib/monthAnchor";
import { formatMonth } from "@/lib/dateFormatting";
import type {
  DailySpendBar,
  DailySpendDeltaKind,
  DailySpendMerchantRow,
  DailySpendSeriesPoint,
  DailySpendThemeRow,
} from "@/lib/dailySpend";
import {
  seeInSpendingLabel,
  visitsPerMonthLabel,
  windowAverageLabel,
} from "@/lib/dailySpend";
import {
  MODAL_BACKDROP_CLASS,
  MODAL_BODY_CLASS,
  MODAL_FOOTER_CLASS,
  MODAL_HANDLE_CLASS,
  MODAL_PANEL_CLASS,
  MODAL_SHELL_CLASS,
} from "./dailySpendReadLayout";

function money(amount: number, currency: string): string {
  return formatCurrency(amount, currency, undefined, true);
}

function moneyPerDay(amount: number, currency: string): string {
  return `${money(amount, currency)}/day`;
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

function ShareBar({
  segments,
}: {
  segments: Array<{ id: string; share: number; color: string }>;
}) {
  return (
    <div className="flex h-2 w-full min-w-0 overflow-hidden rounded-full bg-gray-100">
      {segments.map((seg) => (
        <div
          key={seg.id}
          className="h-full"
          style={{
            width: `${Math.min(100, Math.max(0, seg.share * 100))}%`,
            backgroundColor: seg.color,
          }}
        />
      ))}
    </div>
  );
}

function RateBar({
  bar,
  color,
  currency,
}: {
  bar: DailySpendBar;
  color: string;
  currency: string;
}) {
  return (
    <div className="min-w-0 py-1.5">
      <div className="flex min-w-0 items-baseline justify-between gap-3">
        <p className="min-w-0 break-words text-sm text-gray-800">{bar.label}</p>
        <p className="shrink-0 whitespace-nowrap text-sm tabular-nums text-gray-900">
          {moneyPerDay(bar.dailyRate, currency)}
        </p>
      </div>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
        <div
          className="h-full rounded-full"
          style={{
            width: `${Math.min(100, Math.max(0, bar.share * 100))}%`,
            backgroundColor: color,
          }}
        />
      </div>
    </div>
  );
}

function MonthSparkline({
  series,
  color,
}: {
  series: DailySpendSeriesPoint[];
  color: string;
}) {
  const W = 520;
  const H = 96;
  const padL = 8;
  const padR = 8;
  const padT = 14;
  const padB = 28;
  const values = series.map((s) => s.dailyRate);
  const max = Math.max(...values, 0.01);
  const n = Math.max(1, series.length - 1);
  const pts = series.map((s, i) => {
    const x = padL + (i / n) * (W - padL - padR);
    const y = padT + (1 - s.dailyRate / max) * (H - padT - padB);
    return { x, y, ...s };
  });
  const finished = pts.filter((p) => !p.isInProgress);
  const progress = pts.find((p) => p.isInProgress);
  const solidPath = finished
    .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(" ");
  const lastFinished = finished[finished.length - 1];
  const dashPath =
    lastFinished && progress
      ? `M${lastFinished.x.toFixed(1)} ${lastFinished.y.toFixed(1)} L${progress.x.toFixed(1)} ${progress.y.toFixed(1)}`
      : "";

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="h-24 w-full max-w-full"
      role="img"
      aria-label="Last 6 months in dollars per day"
    >
      {solidPath && (
        <path d={solidPath} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" />
      )}
      {dashPath && (
        <path
          d={dashPath}
          fill="none"
          stroke={color}
          strokeWidth={2}
          strokeLinecap="round"
          strokeDasharray="5 4"
        />
      )}
      {pts.map((p) => (
        <circle
          key={p.yearMonth}
          cx={p.x}
          cy={p.y}
          r={2.5}
          fill={p.isInProgress ? "white" : color}
          stroke={color}
          strokeWidth={1.5}
        />
      ))}
      {pts.map((p) => (
        <text
          key={`${p.yearMonth}-label`}
          x={p.x}
          y={H - 8}
          textAnchor="middle"
          className="fill-gray-400"
          fontSize="11"
        >
          {formatMonth(p.yearMonth)}
        </text>
      ))}
      {progress && (
        <text
          x={progress.x}
          y={Math.max(10, progress.y - 8)}
          textAnchor="end"
          className="fill-amber-800"
          fontSize="10"
        >
          {IN_PROGRESS_LABEL}
        </text>
      )}
    </svg>
  );
}

export function ThemeDetailModal({
  theme,
  currency,
  windowLabel,
  onClose,
}: {
  theme: DailySpendThemeRow | null;
  currency: string;
  windowLabel: string;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const open = theme != null;

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !panelRef.current) return;
      const focusable = panelRef.current.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!theme) return null;
  const { detail } = theme;
  const split = detail.foodSplit;
  const averageLabel = windowAverageLabel(windowLabel);

  return (
    <div className={MODAL_SHELL_CLASS}>
      <div
        className={MODAL_BACKDROP_CLASS}
        data-testid="theme-detail-backdrop"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="theme-detail-title"
        className={MODAL_PANEL_CLASS}
      >
        <div className={MODAL_HANDLE_CLASS} aria-hidden />
        <div className="flex min-w-0 shrink-0 items-start gap-3 px-5 pt-3 pb-3">
          <span
            className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: theme.color }}
            aria-hidden
          />
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 id="theme-detail-title" className="min-w-0 break-words text-base font-semibold text-gray-900">
                  {theme.label}
                </h2>
                <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2">
                  <IntactAmount className="text-lg font-semibold tabular-nums text-gray-900">
                    {moneyPerDay(theme.dailyRate, currency)}
                  </IntactAmount>
                  <DeltaPill kind={theme.deltaKind} delta={theme.delta} currency={currency} />
                </div>
                <p className="mt-1 text-xs text-gray-500">{averageLabel}</p>
              </div>
              <button
                ref={closeRef}
                type="button"
                onClick={onClose}
                className="shrink-0 rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                aria-label="Close"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        </div>

        <div className={MODAL_BODY_CLASS}>
          {split ? (
            <section className="min-w-0">
              <h3 className="text-sm font-semibold text-gray-900">Split</h3>
              <div className="mt-2 grid min-w-0 grid-cols-2 gap-2">
                <div className="min-w-0 rounded-xl border border-gray-100 bg-gray-50 px-3 py-2">
                  <p className="text-xs text-gray-500">{split.groceries.label}</p>
                  <p className="mt-0.5 break-words text-sm font-semibold tabular-nums text-gray-900">
                    {moneyPerDay(split.groceries.dailyRate, currency)}
                  </p>
                </div>
                <div className="min-w-0 rounded-xl border border-gray-100 bg-gray-50 px-3 py-2">
                  <p className="text-xs text-gray-500">{split.eatingOut.label}</p>
                  <p className="mt-0.5 break-words text-sm font-semibold tabular-nums text-gray-900">
                    {moneyPerDay(split.eatingOut.dailyRate, currency)}
                  </p>
                </div>
              </div>
              <div className="mt-3">
                <ShareBar
                  segments={[
                    { id: "groceries", share: split.groceries.share, color: "#22c55e" },
                    { id: "eating-out", share: split.eatingOut.share, color: "#fb923c" },
                  ]}
                />
              </div>
              <h4 className="mt-4 text-sm font-medium text-gray-900">Where eating out goes</h4>
              <div className="mt-1 min-w-0">
                {split.eatingOutSubcategories.map((bar) => (
                  <RateBar key={bar.id} bar={bar} color="#fb923c" currency={currency} />
                ))}
              </div>
            </section>
          ) : (
            <section className="min-w-0">
              <h3 className="text-sm font-semibold text-gray-900">Split</h3>
              <div className="mt-1 min-w-0">
                {detail.subcategories.length === 0 ? (
                  <p className="text-sm text-gray-500">No subcategory spend in this window.</p>
                ) : (
                  detail.subcategories.map((bar) => (
                    <RateBar key={bar.id} bar={bar} color={theme.color} currency={currency} />
                  ))
                )}
              </div>
            </section>
          )}

          <section className="mt-6 min-w-0">
            <h3 className="text-sm font-semibold text-gray-900">Top 5 merchants</h3>
            {detail.merchants.length === 0 ? (
              <p className="mt-2 text-sm text-gray-500">No merchants in this window.</p>
            ) : (
              <ul className="mt-1 divide-y divide-gray-100">
                {detail.merchants.map((merchant: DailySpendMerchantRow) => (
                  <li key={merchant.slug} className="flex min-w-0 items-start justify-between gap-3 py-2">
                    <p className="min-w-0 break-words text-sm text-gray-800">{merchant.name}</p>
                    <div className="shrink-0 text-right">
                      <p className="whitespace-nowrap text-sm font-medium tabular-nums text-gray-900">
                        {moneyPerDay(merchant.dailyRate, currency)}
                      </p>
                      <p className="text-xs text-gray-500">{visitsPerMonthLabel(merchant.visitsPerMonth)}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="mt-6 min-w-0">
            <h3 className="text-sm font-semibold text-gray-900">Last 6 months</h3>
            <p className="text-xs text-gray-500">$/day</p>
            <div className="mt-2 min-w-0 overflow-x-hidden">
              <MonthSparkline series={detail.series} color={theme.color} />
            </div>
            <p className="mt-1 text-xs text-gray-400">
              Finished months are solid. The current month is dashed, labelled {IN_PROGRESS_LABEL},
              and left out of the average.
            </p>
          </section>
        </div>

        <div className={MODAL_FOOTER_CLASS}>
          <Link
            href={detail.spendingHref}
            className="block w-full min-w-0 rounded-lg bg-gray-900 px-4 py-2.5 text-center text-sm font-semibold text-white hover:bg-gray-800"
          >
            {seeInSpendingLabel(theme.label)}
          </Link>
        </div>
      </div>
    </div>
  );
}
