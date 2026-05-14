"use client";

/** Job loss runway + emergency fund + locked life-stage tiles — shared by Overview (Financial Health). */

import {
  EMERGENCY_FUND_INCOME_CV_THRESHOLD,
  EMERGENCY_FUND_TARGET_MONTHS_STABLE,
  EMERGENCY_FUND_TARGET_MONTHS_VARIABLE,
  type EmergencyFundMetrics,
} from "@/lib/profileMetrics";

const DISCRETIONARY_FACTOR = 0.65;

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
  /** From consolidated API — when set, runway + EF card match Goals / Brief exactly */
  emergencyFund?: EmergencyFundMetrics | null;
  onRetirementOpen: () => void;
  onInsuranceOpen: () => void;
}

export function FinancialFutureModules({
  monthlyExpenses,
  liquidAssets,
  history,
  currencySymbol,
  emergencyFund,
  onRetirementOpen,
  onInsuranceOpen,
}: FinancialFutureModulesProps) {
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

  return (
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
                <p className="text-xs font-semibold text-gray-400 group-hover:text-purple-600 transition">
                  See breakdown <span className="inline-block transition-transform group-hover:translate-x-0.5">→</span>
                </p>
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
                <p className="text-xs font-semibold text-gray-400 group-hover:text-purple-600 transition">
                  See methodology <span className="inline-block transition-transform group-hover:translate-x-0.5">→</span>
                </p>
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
  );
}
