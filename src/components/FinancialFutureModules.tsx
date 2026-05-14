"use client";

/** Job loss runway + emergency fund + locked life-stage tiles — shared by Overview (Financial Health). */

import { useEffect, useState } from "react";
import Link from "next/link";
import { fmt } from "@/lib/currencyUtils";
import {
  EMERGENCY_FUND_INCOME_CV_THRESHOLD,
  EMERGENCY_FUND_TARGET_MONTHS_STABLE,
  EMERGENCY_FUND_TARGET_MONTHS_VARIABLE,
  type EmergencyFundMetrics,
} from "@/lib/profileMetrics";

const DISCRETIONARY_FACTOR = 0.65;

type InfoDrawerKind = "runway" | "ef-methodology";

export interface FinancialFutureHistoryRow {
  incomeTotal: number;
}

function fmtShort(v: number, sym: string): string {
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}${sym}${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}${sym}${Math.round(abs / 1_000)}k`;
  return `${sign}${sym}${Math.round(abs)}`;
}

function incomeCV(history: FinancialFutureHistoryRow[]): number {
  const vals = history.filter((h) => h.incomeTotal > 0).map((h) => h.incomeTotal);
  if (vals.length < 3) return 0;
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  if (mean === 0) return 0;
  const variance = vals.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / vals.length;
  return Math.sqrt(variance) / mean;
}

export interface FinancialFutureModulesProps {
  monthlyExpenses: number;
  liquidAssets: number;
  history: FinancialFutureHistoryRow[];
  currencySymbol: string;
  /** ISO currency code for full-precision amounts in drawers (optional). */
  homeCurrency?: string | null;
  /** From consolidated API — when set, runway + EF card match Goals / Brief exactly */
  emergencyFund?: EmergencyFundMetrics | null;
  onRetirementOpen: () => void;
  onInsuranceOpen: () => void;
}

function formatDrawerMoney(v: number, currencySymbol: string, homeCurrency?: string | null): string {
  if (homeCurrency) return fmt(v, homeCurrency);
  return fmtShort(v, currencySymbol);
}

/** Visually distinct “navigate elsewhere” control — avoids looking like in-drawer content. */
function DrawerContinueLink({
  href,
  title,
  hint,
  ariaLabel,
  onNavigate,
}: {
  href: string;
  title: string;
  hint: string;
  ariaLabel: string;
  onNavigate: () => void;
}) {
  return (
    <Link
      href={href}
      aria-label={ariaLabel}
      onClick={onNavigate}
      className="flex items-start gap-3 rounded-xl border border-gray-200 bg-gray-50/90 px-3.5 py-3 text-left shadow-sm transition hover:border-purple-200 hover:bg-purple-50/50 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-400 focus-visible:ring-offset-2"
    >
      <span className="mt-0.5 shrink-0 text-purple-600" aria-hidden>
        {/* Lucide-style “external link” — reads as another screen, not drawer chrome */}
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
          <polyline points="15 3 21 3 21 9" />
          <line x1="10" y1="14" x2="21" y2="3" />
        </svg>
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-xs font-semibold text-gray-900">{title}</span>
        <span className="text-[11px] leading-snug text-gray-500">{hint}</span>
      </span>
    </Link>
  );
}

export function FinancialFutureModules({
  monthlyExpenses,
  liquidAssets,
  history,
  currencySymbol,
  homeCurrency,
  emergencyFund,
  onRetirementOpen,
  onInsuranceOpen,
}: FinancialFutureModulesProps) {
  const [infoDrawer, setInfoDrawer] = useState<InfoDrawerKind | null>(null);

  useEffect(() => {
    if (!infoDrawer) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setInfoDrawer(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [infoDrawer]);

  const cvLocal = incomeCV(history);
  const baseline =
    emergencyFund?.baselineMonthlyCoreExpenses ?? monthlyExpenses;
  const efMonthsTarget =
    emergencyFund?.targetMonths ??
    (cvLocal > EMERGENCY_FUND_INCOME_CV_THRESHOLD
      ? EMERGENCY_FUND_TARGET_MONTHS_VARIABLE
      : EMERGENCY_FUND_TARGET_MONTHS_STABLE);
  const isVariable =
    emergencyFund?.isVariableIncome ??
    cvLocal > EMERGENCY_FUND_INCOME_CV_THRESHOLD;

  const essential = baseline;
  const essentialCut = baseline * DISCRETIONARY_FACTOR;
  const runway = essential > 0 ? liquidAssets / essential : 0;
  const runwayCut = essentialCut > 0 ? liquidAssets / essentialCut : 0;
  const runwayStatus =
    runway >= 6 ? "healthy" : runway >= 3 ? "watch" : "below";

  const efTarget = efMonthsTarget * baseline;
  const currentEfMonths = baseline > 0 ? liquidAssets / baseline : 0;
  const efShort = Math.max(0, efTarget - liquidAssets);
  const efPct = efTarget > 0 ? liquidAssets / efTarget : 0;
  const efStatus =
    efPct >= 1 ? "on_target" : efPct >= 0.5 ? "below" : "far_below";

  const sym = currencySymbol;
  const drawerOpen = infoDrawer !== null;
  const cvShown =
    emergencyFund?.incomeCoefficientOfVariation ?? cvLocal;
  const cvPct = (cvShown * 100).toFixed(0);

  return (
    <>
    <div>
      <div className="mb-4">
        <p className="font-semibold text-gray-900">Your financial future</p>
        <p className="text-xs text-gray-400 mt-0.5">Specific answers powered by your data</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {(() => {
          const hasData = baseline > 0;
          const badge =
            !hasData ? (
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-gray-400">
                Needs more data
              </span>
            ) : runwayStatus === "healthy" ? (
              <span className="rounded-full bg-emerald-50 border border-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-700">
                Healthy
              </span>
            ) : runwayStatus === "watch" ? (
              <span className="rounded-full bg-amber-50 border border-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-700">
                Watch
              </span>
            ) : (
              <span className="rounded-full bg-red-50 border border-red-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-red-700">
                Below target
              </span>
            );

          return (
            <div className="group flex flex-col rounded-xl border border-gray-200 bg-white overflow-hidden hover:border-gray-300 hover:-translate-y-px hover:shadow-[0_4px_12px_rgba(0,0,0,0.04)] transition">
              <div className="flex-1 px-5 pt-5 pb-4">
                <div className="flex items-start justify-between gap-2 mb-3">
                  <p className="text-sm font-semibold text-gray-800">Job loss runway</p>
                  {badge}
                </div>
                {hasData ? (
                  <>
                    <p className="text-[22px] font-bold text-gray-900 tabular-nums leading-tight">
                      {runway.toFixed(1)} months
                    </p>
                    <p className="mt-2 text-xs text-gray-500 leading-relaxed">
                      If income stopped tomorrow, your cash and emergency fund cover essentials for{" "}
                      <strong className="text-gray-700">{runway.toFixed(1)} months</strong>. Cut discretionary and you stretch to{" "}
                      <strong className="text-gray-700">{runwayCut.toFixed(1)}</strong>.
                    </p>
                  </>
                ) : (
                  <p className="text-sm text-gray-400 leading-snug">Upload statements to calculate your runway.</p>
                )}
              </div>
              <div className="border-t border-gray-100 px-5 py-3">
                <button
                  type="button"
                  aria-label="See job loss runway breakdown"
                  onClick={() => setInfoDrawer("runway")}
                  className="text-xs font-semibold text-gray-400 group-hover:text-purple-600 transition text-left w-full"
                >
                  See breakdown <span className="inline-block transition-transform group-hover:translate-x-0.5">→</span>
                </button>
              </div>
            </div>
          );
        })()}

        {(() => {
          const hasData = baseline > 0;
          const badge = !hasData ? (
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-gray-400">
              Needs more data
            </span>
          ) : efStatus === "on_target" ? (
            <span className="rounded-full bg-emerald-50 border border-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-700">
              On target
            </span>
          ) : efStatus === "below" ? (
            <span className="rounded-full bg-amber-50 border border-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-700">
              Below target
            </span>
          ) : (
            <span className="rounded-full bg-red-50 border border-red-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-red-700">
              Far below target
            </span>
          );

          return (
            <div className="group flex flex-col rounded-xl border border-gray-200 bg-white overflow-hidden hover:border-gray-300 hover:-translate-y-px hover:shadow-[0_4px_12px_rgba(0,0,0,0.04)] transition">
              <div className="flex-1 px-5 pt-5 pb-4">
                <div className="flex items-start justify-between gap-2 mb-3">
                  <p className="text-sm font-semibold text-gray-800">Emergency fund target</p>
                  {badge}
                </div>
                {hasData ? (
                  <>
                    {efStatus === "on_target" ? (
                      <p className="text-[22px] font-bold text-emerald-600 tabular-nums leading-tight">Fully funded</p>
                    ) : (
                      <p className="text-[22px] font-bold text-gray-900 tabular-nums leading-tight">{fmtShort(efShort, sym)} short</p>
                    )}
                    <p className="mt-2 text-xs text-gray-500 leading-relaxed">
                      Based on your median monthly core expenses ({fmtShort(baseline, sym)}) and{" "}
                      <strong className="text-gray-700">{isVariable ? "variable" : "stable salaried"}</strong> income, target is{" "}
                      {efMonthsTarget} months. You currently hold{" "}
                      <strong className="text-gray-700">{currentEfMonths.toFixed(1)} months</strong> in liquid savings.
                    </p>
                  </>
                ) : (
                  <p className="text-sm text-gray-400 leading-snug">Upload statements to calculate your emergency fund status.</p>
                )}
              </div>
              <div className="border-t border-gray-100 px-5 py-3">
                <button
                  type="button"
                  aria-label="See emergency fund methodology"
                  onClick={() => setInfoDrawer("ef-methodology")}
                  className="text-xs font-semibold text-gray-400 group-hover:text-purple-600 transition text-left w-full"
                >
                  See methodology <span className="inline-block transition-transform group-hover:translate-x-0.5">→</span>
                </button>
              </div>
            </div>
          );
        })()}

        <div className="flex flex-col rounded-xl border border-dashed border-gray-200 bg-white overflow-hidden">
          <div className="flex-1 px-5 pt-5 pb-4">
            <div className="flex items-start justify-between gap-2 mb-3">
              <p className="text-sm font-semibold text-gray-800">Retirement readiness</p>
              <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-gray-400">
                <svg className="h-2.5 w-2.5" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fillRule="evenodd"
                    d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z"
                    clipRule="evenodd"
                  />
                </svg>
                Locked
              </span>
            </div>
            <p className="text-sm font-medium text-gray-400 leading-snug">Are you on track for retirement?</p>
            <p className="mt-1.5 text-xs text-gray-400 leading-relaxed">
              We&apos;ll project your trajectory to retirement age and compare against the lifestyle you want. Needs your age and target
              retirement age.
            </p>
          </div>
          <div className="border-t border-gray-100 px-5 py-3">
            <button type="button" onClick={onRetirementOpen} className="text-xs font-semibold text-purple-600 hover:text-purple-800 transition">
              Takes 30 seconds →
            </button>
          </div>
        </div>

        <div className="flex flex-col rounded-xl border border-dashed border-gray-200 bg-white overflow-hidden">
          <div className="flex-1 px-5 pt-5 pb-4">
            <div className="flex items-start justify-between gap-2 mb-3">
              <p className="text-sm font-semibold text-gray-800">Life insurance gap</p>
              <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-gray-400">
                <svg className="h-2.5 w-2.5" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fillRule="evenodd"
                    d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z"
                    clipRule="evenodd"
                  />
                </svg>
                Locked
              </span>
            </div>
            <p className="text-sm font-medium text-gray-400 leading-snug">How much coverage do you need?</p>
            <p className="mt-1.5 text-xs text-gray-400 leading-relaxed">
              If something happened to you, would your family be OK financially? We&apos;ll calculate the gap between what you have and what
              they&apos;d need. Needs dependents and existing coverage.
            </p>
          </div>
          <div className="border-t border-gray-100 px-5 py-3">
            <button type="button" onClick={onInsuranceOpen} className="text-xs font-semibold text-purple-600 hover:text-purple-800 transition">
              Takes 1 minute →
            </button>
          </div>
        </div>
      </div>
    </div>

      {/* Runway / EF methodology drawers */}
      <div
        className={`fixed inset-0 z-40 bg-black/20 transition-opacity duration-300 ${drawerOpen ? "opacity-100" : "opacity-0 pointer-events-none"}`}
        aria-hidden={!drawerOpen}
        onClick={() => setInfoDrawer(null)}
      />
      <div
        className={`fixed right-0 top-0 z-50 h-full w-full max-w-lg bg-white shadow-2xl flex flex-col transition-transform duration-300 ${drawerOpen ? "translate-x-0" : "translate-x-full"}`}
        role="dialog"
        aria-modal="true"
        aria-hidden={!drawerOpen}
        aria-labelledby="financial-future-info-drawer-title"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-purple-600">Financial health</p>
            <h2 id="financial-future-info-drawer-title" className="text-lg font-bold text-gray-900 mt-0.5">
              {infoDrawer === "runway"
                ? "Job loss runway"
                : infoDrawer === "ef-methodology"
                  ? "Emergency fund target"
                  : "\u00a0"}
            </h2>
          </div>
          <button
            type="button"
            onClick={() => setInfoDrawer(null)}
            className="rounded-full p-2 text-gray-400 hover:bg-gray-100 transition"
            aria-label="Close"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 text-sm text-gray-600 leading-relaxed space-y-5">
          {infoDrawer === "runway" && (
            <>
              <p>
                Runway is how long your <strong className="text-gray-800">liquid cash</strong> could cover essentials if income stopped.
                Liquid balances include checking, savings, and cash accounts (converted to your home currency), consistent with your dashboard.
              </p>
              <div className="rounded-xl border border-gray-100 bg-gray-50/80 px-4 py-3 space-y-2 text-xs">
                <p>
                  <span className="font-semibold text-gray-700">Liquid assets</span>
                  <span className="tabular-nums float-right text-gray-900">{formatDrawerMoney(liquidAssets, sym, homeCurrency)}</span>
                </p>
                <p>
                  <span className="font-semibold text-gray-700">Median monthly core expenses</span>
                  <span className="tabular-nums float-right text-gray-900">{formatDrawerMoney(baseline, sym, homeCurrency)}</span>
                </p>
                <p className="text-gray-500 pt-1 border-t border-gray-200/80">
                  Core spend excludes transfers and card or line-of-credit servicing (minimum-style payments). It matches your Spending page
                  &quot;typical&quot; / Goals baseline when statements are loaded.
                </p>
              </div>
              <p className="font-mono text-xs bg-gray-50 border border-gray-100 rounded-lg px-3 py-2 text-gray-800">
                runway months = liquid ÷ median core ={" "}
                {formatDrawerMoney(liquidAssets, sym, homeCurrency)} ÷ {formatDrawerMoney(baseline, sym, homeCurrency)} ≈{" "}
                <strong>{runway.toFixed(1)}</strong>
              </p>
              <p>
                The <strong className="text-gray-800">stretch</strong> figure assumes discretionary cuts such that ongoing essentials settle at{" "}
                <strong className="text-gray-800">{(DISCRETIONARY_FACTOR * 100).toFixed(0)}%</strong> of that median core level (illustrative,
                not a forecast): stretch months ≈ liquid ÷ (median core × {DISCRETIONARY_FACTOR}) ≈{" "}
                <strong className="text-gray-900">{runwayCut.toFixed(1)}</strong>.
              </p>
              <DrawerContinueLink
                href="/account/spending"
                title="Go to Spending"
                hint="Opens your categories and trends. This panel closes."
                ariaLabel="Go to Spending page — closes this panel"
                onNavigate={() => setInfoDrawer(null)}
              />
            </>
          )}

          {infoDrawer === "ef-methodology" && (
            <>
              <p>
                The emergency fund target uses the same <strong className="text-gray-800">median monthly core expenses</strong> as runway (
                {formatDrawerMoney(baseline, sym, homeCurrency)} here). Months covered are{" "}
                <strong className="text-gray-900">{currentEfMonths.toFixed(1)}</strong> (= liquid ÷ baseline).
              </p>
              <div className="rounded-xl border border-gray-100 bg-gray-50/80 px-4 py-3 space-y-2 text-xs">
                <p>
                  <span className="font-semibold text-gray-700">Target duration</span>
                  <span className="float-right text-gray-900">
                    {efMonthsTarget} months ({isVariable ? "variable income" : "stable income"})
                  </span>
                </p>
                <p className="text-gray-500">
                  We look at the coefficient of variation (CV) of your monthly income totals (months with income &gt; 0). If CV is above{" "}
                  {(EMERGENCY_FUND_INCOME_CV_THRESHOLD * 100).toFixed(0)}%, income is treated as variable and the target is{" "}
                  {EMERGENCY_FUND_TARGET_MONTHS_VARIABLE} months; otherwise{" "}
                  {EMERGENCY_FUND_TARGET_MONTHS_STABLE} months. Your CV is about <strong className="text-gray-700">{cvPct}%</strong>.
                </p>
              </div>
              <p className="font-mono text-xs bg-gray-50 border border-gray-100 rounded-lg px-3 py-2 text-gray-800">
                target = baseline × months = {formatDrawerMoney(baseline, sym, homeCurrency)} × {efMonthsTarget} ≈{" "}
                <strong>{formatDrawerMoney(efTarget, sym, homeCurrency)}</strong>
              </p>
              <p>
                Shortfall is <span className="font-mono text-[11px] sm:text-xs">max(0, target − liquid)</span>
                {efShort > 0 ? (
                  <>
                    , currently <strong className="text-gray-900">{formatDrawerMoney(efShort, sym, homeCurrency)}</strong>.
                  </>
                ) : (
                  <> — you&apos;re at or above target.</>
                )}
              </p>
              <DrawerContinueLink
                href="/account/goals"
                title="Go to Goals"
                hint="Opens savings targets including emergency fund. This panel closes."
                ariaLabel="Go to Goals page — closes this panel"
                onNavigate={() => setInfoDrawer(null)}
              />
            </>
          )}
        </div>
      </div>
    </>
  );
}
