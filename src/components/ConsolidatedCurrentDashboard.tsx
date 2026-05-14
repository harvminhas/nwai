"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { collection, query, orderBy, limit, onSnapshot } from "firebase/firestore";
import { getFirebaseClient } from "@/lib/firebase";
import NetWorthChart from "@/components/NetWorthChart";
import AgentInsightCards from "@/components/AgentInsightCards";
import type { ParsedStatementData } from "@/lib/types";
import type { AgentCard } from "@/lib/agentTypes";
import { isBalanceMarker } from "@/lib/balanceMarkers";
import { isCoreExcluded } from "@/lib/spendingMetrics";
import { fmt, getCurrencySymbol } from "@/lib/currencyUtils";
import {
  getEmergencyFundLiquidMetrics,
  monthlyHistoryCoreExpenses,
  profileMedianCoreVersusIncome,
  type EmergencyFundMetrics,
} from "@/lib/profileMetrics";

// ── helpers ───────────────────────────────────────────────────────────────────

function fmtShort(v: number, ccy: string) {
  const sym = getCurrencySymbol(ccy);
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "+";
  if (abs >= 1_000_000) return `${sign}${sym}${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000)     return `${sign}${sym}${Math.round(abs / 1_000)}k`;
  return `${sign}${fmt(Math.abs(v), ccy)}`;
}
function fmtNW(v: number, ccy: string) {
  const sym = getCurrencySymbol(ccy);
  const abs = Math.abs(v);
  const neg = v < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${neg}${sym}${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000)     return `${neg}${sym}${Math.round(abs / 1_000)}k`;
  return fmt(v, ccy);
}
function monthLabel(ym: string) {
  const [y, m] = ym.split("-");
  if (!m) return ym;
  return new Date(parseInt(y), parseInt(m) - 1, 1)
    .toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

/** Median of positive values — used with consolidated `history` series only (same cache as charts). */
function medianPositive(vals: number[]): number {
  const v = vals.filter((x) => x > 0).sort((a, b) => a - b);
  if (v.length === 0) return 0;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 !== 0 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

/**
 * Latest history month suitable for Financial Health scoring — excludes partial months (`incompleteMonths`)
 * and prefers rows not marked estimated. Falls back if every row is flagged.
 */
function lastCompleteYearMonth(history: HistoryPoint[], incompleteMonths: string[]): string | null {
  const inc = new Set(incompleteMonths);
  const sortedDesc = [...history].sort((a, b) => b.yearMonth.localeCompare(a.yearMonth));

  const pick = (requireNonEstimate: boolean): string | null => {
    for (const h of sortedDesc) {
      if (inc.has(h.yearMonth)) continue;
      if (requireNonEstimate && h.isEstimate) continue;
      return h.yearMonth;
    }
    return null;
  };

  return pick(true) ?? pick(false);
}




// ── scoring engine ────────────────────────────────────────────────────────────

type SignalStatus = "pass" | "warning" | "fail" | "skip";
type TrackStatus  = "on-track" | "watch" | "off-track";

interface Signal {
  id: string;
  name: string;
  shortName: string; // abbreviated label for the strip card
  description: string;
  weight: number;    // nominal weight, redistributed if skipped
  status: SignalStatus;
  detail: string;    // one-line explanation of result
  fillPct: number;   // 0–100 meter fill, pre-computed
}

interface HistoryPoint {
  yearMonth: string;
  netWorth: number;
  totalAssets: number;
  totalDebts: number;
  incomeTotal: number;
  expensesTotal: number;
  coreExpensesTotal?: number;
  debtTotal: number;
  isEstimate?: boolean;
}

function computeSignals(
  currentYm: string,
  history: HistoryPoint[],
  liquidAssets: number,
  hasDebts: boolean,
  ccy: string = "USD",
  /** Same object as Goals / Overview (`json.emergencyFund`) — 6- or 9-month target from profile cache. */
  emergencyFundMetrics: EmergencyFundMetrics | null = null,
  /** Median monthly income (`json.typicalMonthlyIncome`) — paired with median core when this month has no deposits. */
  typicalMonthlyIncomeFromProfile = 0,
  /** Median monthly core spend (`json.typicalMonthlyExpenses`) — paired with median income for savings when needed. */
  typicalMonthlyCoreFromProfile = 0,
): Signal[] {
  const sorted = [...history].sort((a, b) => a.yearMonth.localeCompare(b.yearMonth));
  const idx    = sorted.findIndex((h) => h.yearMonth === currentYm);
  const cur    = idx >= 0 ? sorted[idx] : null;
  const prev   = idx > 0  ? sorted[idx - 1] : null;
  const prev3  = idx >= 3 ? sorted.slice(idx - 3, idx) : sorted.slice(0, idx);

  /** One structural check for typical income vs typical core (consolidated `typicalMonthly*` === profile cache). */
  const profileStructural = profileMedianCoreVersusIncome(
    typicalMonthlyIncomeFromProfile,
    typicalMonthlyCoreFromProfile,
  );
  const profileStructuralCaption =
    profileStructural.structuralDeficit
      ? `Typical core ${fmt(typicalMonthlyCoreFromProfile, ccy)} vs typical income ${fmt(typicalMonthlyIncomeFromProfile, ccy)} — ${fmt(profileStructural.coreOverIncome, ccy)} over (profile medians; excludes card/LOC servicing)`
      : null;

  /** Core for the scored month when `coreExpensesTotal` is missing/zero — shared by Savings + Spending. */
  function coreBurnForSignalMonthRow(row: HistoryPoint): { burn: number; imputed: boolean } {
    const direct = monthlyHistoryCoreExpenses(row);
    if (direct > 0) return { burn: direct, imputed: false };
    if (typicalMonthlyCoreFromProfile > 0) return { burn: typicalMonthlyCoreFromProfile, imputed: true };
    const medCore = medianPositive(history.map(monthlyHistoryCoreExpenses));
    if (medCore > 0) return { burn: medCore, imputed: true };
    return { burn: 0, imputed: false };
  }

  // ── 1. Net worth trend (30%) ──────────────────────────────────────────────
  const nwSignal: Signal = (() => {
    const base = { id: "nw_trend", name: "Net worth trend", shortName: "Net worth", description: "Growing month-over-month", weight: 30 };
    if (!cur || !prev) return { ...base, status: "skip", detail: "Not enough history yet", fillPct: 0 };
    const delta = (cur.netWorth ?? 0) - (prev.netWorth ?? 0);
    const pct   = (prev.netWorth ?? 0) !== 0 ? delta / Math.abs(prev.netWorth ?? 0) : 0;
    // fillPct: map [-10%, +10%] → [0, 100]; 0% = 50, +5% = 75, -5% = 25
    const fillPct = Math.round(Math.min(100, Math.max(0, (pct * 500 + 1) * 50)));
    if (pct > 0.005) return { ...base, status: "pass",    detail: `Up ${fmtShort(delta, ccy)} vs last month`,          fillPct };
    if (pct >= -0.005) return { ...base, status: "warning", detail: "Flat this month (within 0.5%)",               fillPct: 50 };
    return              { ...base, status: "fail",    detail: `Down ${fmtShort(Math.abs(delta), ccy)} vs last month`, fillPct };
  })();

  // ── 2. Savings rate (25%) — never mix median income with a single month's spend (that inflated bogus rates). ──
  const srSignal: Signal = (() => {
    const base = {
      id: "savings_rate",
      name: "Savings rate",
      shortName: "Savings rate",
      description: "Income minus core expenses — same month, or both medians from the financial profile",
      weight: 25,
    };
    if (!cur) return { ...base, status: "skip", detail: "No data for this month", fillPct: 0 };

    let incomeBasis = cur.incomeTotal > 0 ? cur.incomeTotal : 0;
    let coreBurn = 0;
    let basisNote = "";
    let usingProfileMedians = false;

    if (incomeBasis > 0) {
      const resolved = coreBurnForSignalMonthRow(cur);
      coreBurn = resolved.burn;
      if (resolved.imputed) {
        basisNote = " — core imputed (signal month had no expense totals)";
      }
      if (coreBurn <= 0) {
        return {
          ...base,
          status: "skip",
          detail: "No core expense baseline for this month — need statements or profile median core",
          fillPct: 0,
        };
      }
    } else if (typicalMonthlyIncomeFromProfile > 0 && typicalMonthlyCoreFromProfile > 0) {
      incomeBasis = typicalMonthlyIncomeFromProfile;
      coreBurn = typicalMonthlyCoreFromProfile;
      usingProfileMedians = true;
    } else {
      return {
        ...base,
        status: "skip",
        detail: "No income this month — upload statements or wait for median income/core from profile",
        fillPct: 0,
      };
    }

    const rate = (incomeBasis - coreBurn) / incomeBasis;
    // fillPct: map [-50%, +50%] → [0, 100]; 10% target ≈ 75% fill
    const fillPct = Math.round(Math.min(100, Math.max(0, (rate + 0.5) / 0.8 * 100)));
    if (rate >= 0.10) return { ...base, status: "pass",    detail: `Saving ${Math.round(rate * 100)}% of income after core expenses${basisNote}`, fillPct };
    if (rate >= 0)   return { ...base, status: "warning", detail: `Saving ${Math.round(rate * 100)}% after core expenses — target is 10%${basisNote}`, fillPct };
    if (rate < 0 && usingProfileMedians && profileStructuralCaption) {
      return { ...base, status: "fail", detail: profileStructuralCaption, fillPct };
    }
    return            { ...base, status: "fail",    detail: `Core expenses ${fmt(coreBurn - incomeBasis, ccy)} higher than income${basisNote}`, fillPct };
  })();

  // ── 3. Debt plan adherence (20%) ──────────────────────────────────────────
  /** Gross debt / gross assets — momentum alone doesn’t Pass if the load is still structurally high. */
  const DEBT_TO_ASSETS_PASS_MAX = 0.52;
  const DEBT_TO_ASSETS_FAIL_MIN = 0.68;

  const debtSignal: Signal = (() => {
    const base = {
      id: "debt_plan",
      name: "Debt plan adherence",
      shortName: "Debt",
      description: "Debt trending down and not disproportionate to assets",
      weight: 20,
    };
    if (!hasDebts || !cur || cur.debtTotal <= 0) return { ...base, status: "skip", detail: "No active debts — signal skipped", fillPct: 0 };
    if (!prev) return { ...base, status: "skip", detail: "Not enough history yet", fillPct: 0 };
    const delta = cur.debtTotal - prev.debtTotal;
    const assetsGross = cur.totalAssets ?? 0;
    const ratio = assetsGross > 0 ? cur.debtTotal / assetsGross : 1;
    const pctLoad = Math.round(ratio * 100);
    const changePct = cur.debtTotal > 0 ? delta / cur.debtTotal : 0;
    const fillPct = Math.round(Math.min(100, Math.max(0, (-changePct * 500 + 1) * 50)));

    if (delta > 50) {
      return { ...base, status: "fail", detail: `Debt increased by ${fmt(delta, ccy)} this month`, fillPct };
    }

    if (delta < -10) {
      if (ratio >= DEBT_TO_ASSETS_FAIL_MIN) {
        return {
          ...base,
          status: "fail",
          detail: `Paid down ${fmt(Math.abs(delta), ccy)} — debt still ${pctLoad}% of assets`,
          fillPct,
        };
      }
      if (ratio > DEBT_TO_ASSETS_PASS_MAX) {
        return {
          ...base,
          status: "warning",
          detail: `Paid down ${fmt(Math.abs(delta), ccy)} — debt still ${pctLoad}% of assets`,
          fillPct,
        };
      }
      return { ...base, status: "pass", detail: `Paid down ${fmt(Math.abs(delta), ccy)} this month`, fillPct };
    }

    // Flat or small move (includes tiny paydown)
    if (ratio >= DEBT_TO_ASSETS_FAIL_MIN) {
      return {
        ...base,
        status: "fail",
        detail: `Debt flat — still ${pctLoad}% of assets`,
        fillPct: Math.min(fillPct, 35),
      };
    }
    if (ratio > DEBT_TO_ASSETS_PASS_MAX) {
      return {
        ...base,
        status: "warning",
        detail: `Debt unchanged — ${pctLoad}% of assets`,
        fillPct: 50,
      };
    }
    return { ...base, status: "warning", detail: "Debt unchanged this month", fillPct: 50 };
  })();

  // ── 4. Spending (15%) — headline cash flow + core vs trend (short history uses prior mo or profile median) ──
  const spendSignal: Signal = (() => {
    const base = {
      id: "spending_vs_budget",
      name: "Spending vs income & trend",
      shortName: "Spending",
      description: "Total expenses vs income; core spend vs trailing average or median baseline",
      weight: 15,
    };
    if (!cur) return { ...base, status: "skip", detail: "No data for this month", fillPct: 0 };

    const { burn: curBurn, imputed: curBurnImputed } = coreBurnForSignalMonthRow(cur);
    const spendImputedNote = curBurnImputed
      ? " Core imputed — signal month had no expense totals in consolidated history."
      : "";

    if (curBurn <= 0) {
      return { ...base, status: "skip", detail: "No expense data for this month", fillPct: 0 };
    }

    const totalExp = cur.expensesTotal ?? 0;

    let avgCore = 0;
    let baselineLabel = "";
    if (prev3.length >= 2) {
      avgCore = prev3.reduce((s, h) => s + monthlyHistoryCoreExpenses(h), 0) / prev3.length;
      baselineLabel = `${prev3.length}-mo avg`;
    } else if (prev3.length === 1) {
      avgCore = monthlyHistoryCoreExpenses(prev3[0]);
      baselineLabel = "prior month";
    } else if (typicalMonthlyCoreFromProfile > 0) {
      avgCore = typicalMonthlyCoreFromProfile;
      baselineLabel = "median core (profile)";
    }

    if (avgCore <= 0 && typicalMonthlyCoreFromProfile > 0) {
      avgCore = typicalMonthlyCoreFromProfile;
      baselineLabel = "median core (profile)";
    }

    let incomeBasis = cur.incomeTotal > 0 ? cur.incomeTotal : 0;

    const buildTrend = (): Pick<Signal, "status" | "detail" | "fillPct"> => {
      const tail = spendImputedNote;
      if (avgCore <= 0 || curBurn <= 0) {
        return {
          status: "warning",
          detail:
            (avgCore <= 0
              ? "Spend vs trend — need another prior statement month or median core from profile"
              : "Core spend this month is minimal vs baseline") + tail,
          fillPct: 45,
        };
      }
      const ratioTrend = curBurn / avgCore;
      const trendFillPct = Math.round(Math.min(100, Math.max(0, 100 - Math.max(0, ratioTrend - 1) * 200)));
      if (ratioTrend <= 1.0) {
        return {
          status: "pass",
          detail: `Core spend at ${Math.round(ratioTrend * 100)}% of ${baselineLabel} — on target${tail}`,
          fillPct: trendFillPct,
        };
      }
      if (ratioTrend <= 1.10) {
        return {
          status: "warning",
          detail: `Core spend at ${Math.round(ratioTrend * 100)}% of ${baselineLabel} — slightly elevated${tail}`,
          fillPct: trendFillPct,
        };
      }
      return {
        status: "fail",
        detail: `Core spend at ${Math.round(ratioTrend * 100)}% of ${baselineLabel} — ${fmt(curBurn - avgCore, ccy)} over${tail}`,
        fillPct: trendFillPct,
      };
    };

    const trend = buildTrend();

    /* Same-period: this month's gross outflows vs this month's income (history row). */
    if (incomeBasis > 0 && totalExp > incomeBasis) {
      const overAmt = totalExp - incomeBasis;
      const cashFill = Math.round(Math.min(100, Math.max(0, (incomeBasis / totalExp) * 100)));
      return {
        ...base,
        status: "fail",
        detail: `Expenses ${fmt(totalExp, ccy)} exceed income ${fmt(incomeBasis, ccy)} — ${fmt(overAmt, ccy)} over. Also: ${trend.detail}`,
        fillPct: Math.min(cashFill, trend.fillPct),
      };
    }

    if (incomeBasis <= 0 && profileStructural.structuralDeficit && profileStructuralCaption) {
      return {
        ...base,
        status: "fail",
        detail: `${profileStructuralCaption}. Also: ${trend.detail}`,
        fillPct: Math.min(profileStructural.cashFillPct, trend.fillPct),
      };
    }

    return { ...base, ...trend };
  })();

  // ── 5. Goal trajectory (5%) ───────────────────────────────────────────────
  const goalSignal: Signal = {
    id: "goal_trajectory", name: "Goal trajectory", shortName: "Goals",
    description: "FI date within 12 months of original plan",
    weight: 5, status: "skip",
    detail: "Goals not set up yet", fillPct: 0,
  };

  // ── 6. Emergency fund vs profile goal (5%) — same target as Goals / Overview (`getEmergencyFundMetrics`) ──
  const efSignal: Signal = (() => {
    const base = {
      id: "emergency_fund",
      name: "Emergency fund buffer",
      shortName: "Emergency fund",
      description: "Liquid savings vs your emergency fund goal (6–9 mo core expenses)",
      weight: 5,
    };
    if (!emergencyFundMetrics) {
      return { ...base, status: "skip", detail: "Need expense history to set emergency fund goal", fillPct: 0 };
    }
    if (liquidAssets <= 0) {
      return { ...base, status: "skip", detail: "No linked savings/chequing balance", fillPct: 0 };
    }
    const { gap, monthsOfCoreCovered, pctFunded } = getEmergencyFundLiquidMetrics(liquidAssets, emergencyFundMetrics);
    const targetMo = emergencyFundMetrics.targetMonths;
    const fillPct = Math.round(Math.min(100, Math.max(0, pctFunded * 100)));

    if (pctFunded >= 1) {
      return {
        ...base,
        status: "pass",
        detail: `Goal met — ${monthsOfCoreCovered.toFixed(1)} mo liquid vs ${targetMo}-mo target`,
        fillPct: 100,
      };
    }
    if (pctFunded >= 0.5) {
      return {
        ...base,
        status: "warning",
        detail: `${fmtShort(gap, ccy)} below ${targetMo}-mo target (${monthsOfCoreCovered.toFixed(1)} mo covered)`,
        fillPct,
      };
    }
    return {
      ...base,
      status: "fail",
      detail: `${fmtShort(gap, ccy)} below ${targetMo}-mo target (${monthsOfCoreCovered.toFixed(1)} mo covered)`,
      fillPct,
    };
  })();

  return [nwSignal, srSignal, debtSignal, spendSignal, goalSignal, efSignal];
}

function computeScore(signals: Signal[]): number {
  const active = signals.filter((s) => s.status !== "skip");
  if (active.length === 0) return 0;
  const totalWeight = active.reduce((s, sig) => s + sig.weight, 0);
  const earned = active.reduce((s, sig) => {
    const pts = sig.status === "pass" ? 1 : sig.status === "warning" ? 0.5 : 0;
    return s + sig.weight * pts;
  }, 0);
  return Math.round((earned / totalWeight) * 100);
}

function rawStatus(score: number, signals: Signal[]): TrackStatus | null {
  const active = signals.filter((s) => s.status !== "skip");
  if (active.length < 2) return null; // not enough signals to score
  const hasFail    = active.some((s) => s.status === "fail");
  const hasWarning = active.some((s) => s.status === "warning");
  if (hasFail || score < 50)  return "off-track";
  if (hasWarning || score < 75) return "watch";
  return "on-track";
}

/** Lower = healthier — used to compare tiers for hysteresis. */
const TRACK_SEVERITY: Record<TrackStatus, number> = {
  "on-track": 0,
  watch: 1,
  "off-track": 2,
};

/**
 * Downgrades wait one month before the badge moves worse (noisy month tolerance).
 * Upgrades apply immediately so we never show “Off track” with a perfect score / all Pass.
 */
function applyHysteresis(
  currentStatus: TrackStatus | null,
  prevStatus: TrackStatus | null,
): TrackStatus | null {
  if (currentStatus === null) return null;
  if (prevStatus === null) return currentStatus;
  if (currentStatus === prevStatus) return currentStatus;

  if (TRACK_SEVERITY[currentStatus] < TRACK_SEVERITY[prevStatus]) return currentStatus;

  return prevStatus;
}

// ── status badge config ───────────────────────────────────────────────────────

const TRACK_CONFIG: Record<TrackStatus, {
  label: string; badge: string; dot: string;
}> = {
  "on-track":  { label: "On track",       badge: "bg-green-100 text-green-700 border-green-200",  dot: "bg-green-500" },
  /** Aggregate amber tier — any active warning or score &lt; 75 (see rawStatus). Not necessarily "Spending". */
  "watch":     { label: "Needs attention", badge: "bg-amber-100 text-amber-700 border-amber-200",  dot: "bg-amber-500" },
  "off-track": { label: "Off track",      badge: "bg-red-100 text-red-600 border-red-200",        dot: "bg-red-500" },
};

const SIGNAL_STATUS_CONFIG: Record<SignalStatus, { label: string; color: string; bg: string }> = {
  pass:    { label: "Pass",    color: "text-green-700",  bg: "bg-green-100 border-green-200" },
  warning: { label: "Warning", color: "text-amber-700",  bg: "bg-amber-100 border-amber-200" },
  fail:    { label: "Fail",    color: "text-red-600",    bg: "bg-red-100 border-red-200" },
  skip:    { label: "N/A",     color: "text-gray-400",   bg: "bg-gray-100 border-gray-200" },
};


// ── type-to-label maps ────────────────────────────────────────────────────────

const ASSET_TYPE_LABEL: Record<string, string> = {
  savings: "savings", investments: "investments", property: "property",
  RRSP: "RRSP", rrsp: "RRSP", tfsa: "TFSA",
};
const DEBT_TYPE_LABEL: Record<string, string> = {
  CC: "CC", mortgage: "mortgage", loan: "loan",
};

// ── signal strip ─────────────────────────────────────────────────────────────

const STRIP_BAR: Record<SignalStatus, string> = {
  pass:    "bg-green-500",
  warning: "bg-amber-400",
  fail:    "bg-red-500",
  skip:    "bg-gray-200",
};
const STRIP_LABEL: Record<SignalStatus, { text: string; cls: string }> = {
  pass:    { text: "Pass",    cls: "text-green-600" },
  warning: { text: "Watch",   cls: "text-amber-500" },
  fail:    { text: "Fail",    cls: "text-red-500"   },
  skip:    { text: "N/A",     cls: "text-gray-300"  },
};

function gridColsClassForSignalCount(n: number): string {
  if (n <= 1) return "grid-cols-1";
  if (n === 2) return "grid-cols-2";
  if (n === 3) return "grid-cols-2 sm:grid-cols-3";
  if (n === 4) return "grid-cols-2 sm:grid-cols-4";
  return "grid-cols-2 sm:grid-cols-3 lg:grid-cols-5";
}

function SignalStrip({ signals, score, status, periodLabel, onOpenModal }: {
  signals: Signal[];
  score: number;
  status: TrackStatus | null;
  /** Explains which statement month the scores use (last complete month). */
  periodLabel?: string | null;
  onOpenModal: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const active = signals.filter((s) => s.status !== "skip");
  if (active.length < 2) return null;

  const scoreColor = score >= 75 ? "text-green-600" : score >= 50 ? "text-amber-500" : "text-red-500";
  const scoreBar   = score >= 75 ? "bg-green-500"   : score >= 50 ? "bg-amber-400"   : "bg-red-500";
  const trackCfg   = status ? TRACK_CONFIG[status] : null;

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
      {/* Header row — always visible */}
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="mr-auto min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Financial health</p>
          {periodLabel ? (
            <p className="text-[10px] text-gray-400 mt-0.5 leading-snug max-w-[17rem]">{periodLabel}</p>
          ) : null}
        </div>

        {/* Status badge */}
        {trackCfg && (
          <span className={`shrink-0 flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${trackCfg.badge}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${trackCfg.dot}`} />
            {trackCfg.label}
          </span>
        )}

        {/* Score + expand toggle */}
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-2 rounded-lg px-2 py-1 hover:bg-gray-50 transition"
        >
          <div className="flex items-center gap-1.5">
            <div className="h-1.5 w-16 rounded-full bg-gray-100 overflow-hidden">
              <div className={`h-full rounded-full ${scoreBar} transition-all`} style={{ width: `${score}%` }} />
            </div>
            <span className={`text-xs font-bold tabular-nums ${scoreColor}`}>{score}/100</span>
          </div>
          <svg
            className={`h-3.5 w-3.5 text-gray-400 transition-transform ${expanded ? "rotate-180" : ""}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>

      {/* Signal grid — only when expanded */}
      {expanded && (
        <>
          <div
            className={`grid gap-px bg-gray-100 border-t border-gray-100 ${gridColsClassForSignalCount(active.length)}`}
          >
            {active.map((sig) => {
              const lb = STRIP_LABEL[sig.status];
              return (
                <div key={sig.id} className="bg-white px-3.5 py-3 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <p className="text-[11px] font-semibold text-gray-500 leading-tight truncate pr-1">{sig.shortName}</p>
                    <span className={`text-[10px] font-bold shrink-0 ${lb.cls}`}>{lb.text}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${STRIP_BAR[sig.status]}`}
                      style={{ width: `${sig.fillPct}%` }}
                    />
                  </div>
                  <p className="text-[11px] text-gray-400 leading-tight line-clamp-2">{sig.detail}</p>
                </div>
              );
            })}
          </div>
          {/* Full breakdown link */}
          <button
            onClick={onOpenModal}
            className="flex w-full items-center justify-center gap-1 border-t border-gray-100 py-2.5 text-xs font-medium text-purple-600 hover:bg-purple-50 transition"
          >
            View full breakdown
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </>
      )}
    </div>
  );
}

// ── signal breakdown modal ────────────────────────────────────────────────────

function SignalModal({
  signals, score, status, signalPeriodLabel, onClose,
}: {
  signals: Signal[];
  score: number;
  status: TrackStatus | null;
  signalPeriodLabel?: string | null;
  onClose: () => void;
}) {
  const trackCfg = status ? TRACK_CONFIG[status] : null;
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-md rounded-2xl bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <div>
            <h2 className="font-bold text-gray-900">Health check</h2>
            {signalPeriodLabel ? (
              <p className="mt-1 text-[11px] font-medium text-gray-500">{signalPeriodLabel}</p>
            ) : null}
            <p className="mt-2 text-xs text-gray-400">
              Signals use your <strong className="text-gray-500">last complete statement month</strong> (not the live month until every account has a statement).
              Each signal has a weight; the overall score sets the badge. When that month has pay deposits, savings compares its income to its core spend;
              otherwise it uses{" "}
              <strong className="text-gray-500">median income and median core spend</strong> from your financial profile (never median income + a different month&apos;s spend).
              Spending fails if total expenses exceed income for that month, or if median expenses exceed median income across your statement history.
              Emergency fund matches Goals / Overview. Debt uses balance change and debt vs gross assets.
            </p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Score summary */}
        <div className="flex items-center gap-4 border-b border-gray-100 px-5 py-3">
          <div className="flex-1">
            <div className="flex h-2 w-full overflow-hidden rounded-full bg-gray-100">
              <div
                className={`h-full rounded-full transition-all ${
                  score >= 75 ? "bg-green-500" : score >= 50 ? "bg-amber-500" : "bg-red-500"
                }`}
                style={{ width: `${score}%` }}
              />
            </div>
            <p className="mt-1 text-xs text-gray-400">Overall score: <span className="font-semibold text-gray-700">{score}/100</span></p>
          </div>
          {trackCfg && (
            <span className={`shrink-0 rounded-full border px-3 py-1 text-xs font-semibold ${trackCfg.badge}`}>
              {trackCfg.label}
            </span>
          )}
        </div>

        {/* Signals */}
        <div className="divide-y divide-gray-50 max-h-[60vh] overflow-y-auto">
          {signals.map((sig) => {
            const scfg = SIGNAL_STATUS_CONFIG[sig.status];
            const activeWeight = sig.status !== "skip" ? sig.weight : null;
            return (
              <div key={sig.id} className={`px-5 py-4 ${sig.status === "skip" ? "opacity-50" : ""}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-800">{sig.name}</p>
                    <p className="mt-0.5 text-xs text-gray-400">{sig.description}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <span className={`inline-block rounded-full border px-2 py-0.5 text-[10px] font-bold ${scfg.bg} ${scfg.color}`}>
                      {scfg.label}
                    </span>
                    {activeWeight != null && (
                      <p className="mt-1 text-[10px] text-gray-400">weight: {activeWeight}%</p>
                    )}
                  </div>
                </div>
                <p className={`mt-1.5 text-xs ${scfg.color}`}>{sig.detail}</p>
                {/* Weight bar */}
                {activeWeight != null && (
                  <div className="mt-2 h-0.5 w-full overflow-hidden rounded-full bg-gray-100">
                    <div
                      className={`h-full rounded-full ${
                        sig.status === "pass" ? "bg-green-400" : sig.status === "warning" ? "bg-amber-400" : "bg-red-400"
                      }`}
                      style={{ width: `${activeWeight * 3}%` }}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="border-t border-gray-100 px-5 py-3">
          <p className="text-[10px] text-gray-400">
            Improvements update the badge immediately. Downgrades wait until the lower tier also appeared last month, so one noisy month
            doesn&apos;t flip you red. Skipped signals are omitted from the weighted score.
          </p>
        </div>
      </div>
    </div>
  );
}

// ── component ─────────────────────────────────────────────────────────────────

export default function ConsolidatedCurrentDashboard({ refreshKey }: { refreshKey?: number }) {
  const router = useRouter();
  const [data, setData]               = useState<ParsedStatementData | null>(null);
  const [previousMonth, setPreviousMonth] = useState<{ netWorth: number; assets: number; debts: number; expenses: number } | null>(null);
  const [momDeltas, setMomDeltas] = useState<{ netWorth: number; assets: number; debts: number } | null>(null);
  const [yearMonth, setYearMonth]     = useState<string | null>(null);
  const [history, setHistory]         = useState<HistoryPoint[]>([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState<string | null>(null);
  const [statementCount, setStatementCount] = useState(0);
  const [accountCount, setAccountCount]     = useState(0);
  const [incompleteMonths, setIncompleteMonths] = useState<string[]>([]);
  const [assetLabels, setAssetLabels] = useState<string[]>([]);
  const [debtLabels, setDebtLabels]   = useState<string[]>([]);
  const [liquidAssets, setLiquidAssets] = useState(0);
  /** Matches consolidated `typicalMonthlyExpenses` / emergency-fund baseline (median core). */
  const [typicalMonthlyCoreExpenses, setTypicalMonthlyCoreExpenses] = useState(0);
  /** From consolidated API — median monthly income for savings signal when current month has no deposits. */
  const [typicalMonthlyIncome, setTypicalMonthlyIncome] = useState(0);
  /** Same payload as Goals / Overview emergency fund card (`getEmergencyFundMetrics`). */
  const [emergencyFundMetrics, setEmergencyFundMetrics] = useState<EmergencyFundMetrics | null>(null);
  const [homeCurrency, setHomeCurrency] = useState("USD");
  const [modalOpen, setModalOpen]     = useState(false);
  const [agentCards, setAgentCards]   = useState<AgentCard[]>([]);
  const [idToken, setIdToken]         = useState<string | null>(null);
  const [uid, setUid]                 = useState<string | null>(null);

  useEffect(() => {
    const { auth } = getFirebaseClient();
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) { router.push("/login"); return; }
      setLoading(true); setError(null);
      try {
        const token = await user.getIdToken();
        setIdToken(token);
        setUid(user.uid);
        const res = await fetch("/api/user/statements/consolidated", { headers: { Authorization: `Bearer ${token}` } });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) { setError(json.error || "Failed to load"); return; }

        setData(json.data ?? null);
        setStatementCount(json.count ?? 0);
        setAccountCount(json.accountCount ?? 0);
        setPreviousMonth(json.previousMonth ?? null);
        setMomDeltas(json.momDeltas ?? null);
        setYearMonth(json.yearMonth ?? null);
        setAssetLabels(json.assetLabels ?? []);
        setDebtLabels(json.debtLabels ?? []);
        setLiquidAssets(json.liquidAssets ?? 0);
        setTypicalMonthlyCoreExpenses(
          typeof json.typicalMonthlyExpenses === "number" ? json.typicalMonthlyExpenses : 0,
        );
        setTypicalMonthlyIncome(typeof json.typicalMonthlyIncome === "number" ? json.typicalMonthlyIncome : 0);
        setEmergencyFundMetrics((json.emergencyFund ?? null) as EmergencyFundMetrics | null);
        if (json.homeCurrency) setHomeCurrency(json.homeCurrency);
        const incomplete: string[] = json.incompleteMonths ?? [];
        setIncompleteMonths(incomplete);
        setHistory(Array.isArray(json.history)
          ? json.history.map((h: { yearMonth: string; netWorth: number; totalAssets?: number; totalDebts?: number; incomeTotal?: number; expensesTotal?: number; coreExpensesTotal?: number; debtTotal?: number }) => ({
              yearMonth: h.yearMonth,
              netWorth: h.netWorth,
              totalAssets: h.totalAssets ?? 0,
              totalDebts: h.totalDebts ?? 0,
              incomeTotal: h.incomeTotal ?? 0,
              expensesTotal: h.expensesTotal ?? 0,
              coreExpensesTotal: h.coreExpensesTotal,
              debtTotal: h.debtTotal ?? 0,
              isEstimate: incomplete.includes(h.yearMonth),
            }))
          : []);
      } catch { setError("Failed to load dashboard"); }
      finally { setLoading(false); }
    });
    return () => unsub();
  }, [router, refreshKey]);

  // Real-time listener for agent insight cards — fires immediately with cached
  // data and again whenever the pipeline writes new cards after an upload.
  useEffect(() => {
    if (!uid) return;
    const { db } = getFirebaseClient();
    const q = query(
      collection(db, `users/${uid}/agentInsights`),
      orderBy("createdAt", "desc"),
      limit(20)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const cards = snap.docs
          .map((d) => ({ id: d.id, ...d.data() } as AgentCard))
          .filter((c) => !c.dismissed);
        setAgentCards(cards);
      },
      () => {} // ignore listener errors silently
    );
    return unsub;
  }, [uid]);

  if (loading) return (
    <div className="flex min-h-[40vh] items-center justify-center">
      <div className="h-10 w-10 animate-spin rounded-full border-4 border-purple-600 border-t-transparent" />
    </div>
  );
  if (error || !data || !yearMonth) return (
    <div className="rounded-xl border border-gray-200 bg-white p-8 text-center">
      <p className="text-gray-600">{error || "No data yet."}</p>
      <Link href="/upload" className="mt-3 inline-block text-sm font-medium text-purple-600 hover:underline">
        Upload your first statement →
      </Link>
    </div>
  );

  // ── derived ────────────────────────────────────────────────────────────────

  const assets     = data.assets ?? Math.max(0, data.netWorth ?? 0);
  const debts      = data.debts ?? Math.max(0, -(data.netWorth ?? 0));
  // Always derive netWorth from assets - debts so hero card matches chart
  const netWorth   = (assets > 0 || debts > 0) ? assets - debts : (data.netWorth ?? 0);
  const income     = data.income?.total ?? 0;
  const hasDebts   = debts > 0;

  // Use pre-computed momDeltas (both months on the same carry-forward pipeline)
  // so the delta is consistent with the chart. Fall back to raw comparison only
  // if momDeltas is absent (first upload, no history).
  const nwDelta    = momDeltas?.netWorth ?? (previousMonth != null ? netWorth - previousMonth.netWorth : null);
  const assetDelta = momDeltas?.assets  ?? (previousMonth != null ? assets   - previousMonth.assets   : null);
  const debtDelta  = momDeltas?.debts   ?? (previousMonth != null ? debts    - previousMonth.debts    : null);

  // Onboarding: ≤3 months of real history
  const isOnboarding = history.filter((h) => !h.isEstimate).length <= 3;

  // Detect "new account added" vs genuine financial loss.
  // Primary signal: debt jumped significantly while net worth dropped
  //   → almost always means a mortgage, loan, or CC was just added.
  // Secondary signal: any negative delta during onboarding (incomplete data).
  const isLikelyNewAccount =
    nwDelta !== null && nwDelta < 0 && (
      (debtDelta !== null && debtDelta > 10_000) ||
      isOnboarding
    );

  const assetSubLabel = assetLabels.map((l) => ASSET_TYPE_LABEL[l] ?? l).slice(0, 3).join(", ") || null;
  const debtSubLabel  = debtLabels.map((l) => DEBT_TYPE_LABEL[l] ?? l).slice(0, 3).join(" + ")   || null;

  // ── avg income / spending from history (months with data) ─────────────────
  const incomeMonths = history.filter((h) => h.incomeTotal > 0);
  const avgIncome = incomeMonths.length > 0
    ? incomeMonths.reduce((s, h) => s + h.incomeTotal, 0) / incomeMonths.length
    : 0;

  // Median core spend from consolidated history rows (`coreExpensesTotal` only — matches profile cache).
  const effectiveExpenseMonths = history.filter((h) => monthlyHistoryCoreExpenses(h) > 0);
  const medianExpenses = (() => {
    if (effectiveExpenseMonths.length === 0) return 0;
    const sorted = [...effectiveExpenseMonths].map(monthlyHistoryCoreExpenses).sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  })();

  // Current-month discretionary expenses — core only (isCoreExcluded)
  const allExpenseTxns = data?.expenses?.transactions ?? [];
  const calendarMonthTxns = allExpenseTxns.filter(
    (t) => (!t.date || t.date.startsWith(yearMonth)) && !isBalanceMarker(t.merchant ?? "")
  );
  const expenses = calendarMonthTxns.length > 0
    ? calendarMonthTxns
        .filter(
          (t) =>
            !isCoreExcluded(t.category ?? "", {
              debtType: (t as { debtType?: string }).debtType,
              merchant: t.merchant,
            }),
        )
        .reduce((s, t) => s + t.amount, 0)
    : (data?.expenses?.total ?? 0);

  // saved uses the same filtered expense figure so the hero card stays consistent
  const saved = income - expenses;

  // ── scoring — always last complete statement month (partial current month excluded) ──
  const sortedHistAsc = [...history].sort((a, b) => a.yearMonth.localeCompare(b.yearMonth));
  const signalYm =
    lastCompleteYearMonth(history, incompleteMonths) ??
    (sortedHistAsc.length > 0 ? sortedHistAsc[sortedHistAsc.length - 1].yearMonth : null);

  const signals = signalYm
    ? computeSignals(
        signalYm,
        history,
        liquidAssets,
        hasDebts,
        homeCurrency,
        emergencyFundMetrics,
        typicalMonthlyIncome,
        typicalMonthlyCoreExpenses,
      )
    : [];
  const score = computeScore(signals);

  const sigIdx = signalYm ? sortedHistAsc.findIndex((h) => h.yearMonth === signalYm) : -1;
  const prevYm = sigIdx > 0 ? sortedHistAsc[sigIdx - 1].yearMonth : null;
  const prevSigs = prevYm
    ? computeSignals(
        prevYm,
        history,
        liquidAssets,
        hasDebts,
        homeCurrency,
        emergencyFundMetrics,
        typicalMonthlyIncome,
        typicalMonthlyCoreExpenses,
      )
    : null;
  const prevScore = prevSigs ? computeScore(prevSigs) : null;
  const curRaw    = rawStatus(score, signals);
  const prevRaw   = prevSigs && prevScore != null ? rawStatus(prevScore, prevSigs) : null;
  const trackStatus = applyHysteresis(curRaw, prevRaw);

  const signalPeriodStripLabel = signalYm ? `Last complete month: ${monthLabel(signalYm)}` : null;
  const signalPeriodModalLabel = signalYm ? `Statement month: ${monthLabel(signalYm)}` : null;

  const chartHistory  = history.map((h) => ({
    yearMonth:   h.yearMonth,
    // Recompute netWorth client-side from totalAssets/totalDebts so it is always
    // mathematically consistent — guards against any stale cache in the API response.
    netWorth:    (h.totalAssets > 0 || h.totalDebts > 0) ? h.totalAssets - h.totalDebts : h.netWorth,
    totalAssets: h.totalAssets,
    totalDebts:  h.totalDebts,
    isEstimate:  h.isEstimate,
  }));

  return (
    <>
      <div className="space-y-4">

        {/* ── Incomplete months banner — only shown when current month is estimated
             or the majority of history is estimated (suppressed for isolated
             historical gaps which are normal with multi-account setups) ───── */}
        {(() => {
          const currentIncomplete = yearMonth ? incompleteMonths.includes(yearMonth) : false;
          const totalMonths       = history.length;
          // Show only if current month is estimated, or >40% of history is estimated
          const manyIncomplete    = totalMonths > 0 && incompleteMonths.length / totalMonths > 0.4;
          if (!currentIncomplete && !manyIncomplete) return null;

          return (
            <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
              <svg className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              </svg>
              <div className="text-sm">
                <p className="font-medium text-amber-800">
                  {currentIncomplete ? "Current balance is estimated" : "Some months use estimated balances"}
                </p>
                <p className="mt-0.5 text-amber-700 text-xs">
                  {currentIncomplete
                    ? "Upload a statement for all accounts this month for an accurate net worth."
                    : `${incompleteMonths.length} month${incompleteMonths.length !== 1 ? "s" : ""} are missing a statement for at least one account.`}{" "}
                  <Link href="/account/accounts" className="font-medium underline hover:text-amber-900">Review accounts →</Link>
                </p>
              </div>
            </div>
          );
        })()}


        {/* ── NET WORTH hero ────────────────────────────────────────────────── */}
        <div className="rounded-2xl border border-gray-200 bg-white px-6 py-5 shadow-sm">
          <div className="flex items-baseline gap-2">
            <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">Net worth</p>
            <p className="text-xs text-gray-400">
              {monthLabel(yearMonth)}
              {statementCount > 0 && <> · {statementCount} statement{statementCount !== 1 ? "s" : ""}</>}
            </p>
          </div>
          <div className="mt-2 flex items-end gap-4">
            <p className="text-5xl font-extrabold tracking-tight text-gray-900 tabular-nums leading-none">
              {fmtNW(netWorth, homeCurrency)}
            </p>
            {nwDelta != null && (
              <div className="relative mb-1 group/nwbadge">
                <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-sm font-semibold cursor-default ${
                  nwDelta >= 0
                    ? "bg-green-100 text-green-700"
                    : isLikelyNewAccount
                      ? "bg-amber-50 text-amber-700"   // soften — likely new account added
                      : "bg-red-100 text-red-600"
                }`}>
                  {nwDelta >= 0
                    ? <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" /></svg>
                    : <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
                  }
                  {fmtShort(nwDelta, homeCurrency)} this month
                  {isLikelyNewAccount && (
                    <svg className="h-3.5 w-3.5 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  )}
                </span>
                {/* Tooltip — shown on hover when new account likely added */}
                {isLikelyNewAccount && (
                  <div className="pointer-events-none absolute left-0 top-full mt-2 z-10 hidden group-hover/nwbadge:block w-64">
                    <div className="rounded-xl border border-amber-200 bg-white px-3 py-2.5 shadow-lg text-xs text-gray-600 leading-relaxed">
                      <p className="font-semibold text-gray-800 mb-0.5">Why the drop?</p>
                      <p>Your debt increased this month — likely because a new account was added (mortgage, loan, or credit card), not an actual financial loss.</p>
                      <p className="mt-1 text-gray-400">Upload prior statements to fill in the history.</p>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
          {saved !== 0 && income > 0 && (
            <p className="mt-2 text-xs text-gray-400">
              {saved >= 0
                ? <><span className="font-medium text-blue-600">{fmt(saved, homeCurrency)}</span> saved this month</>
                : <><span className="font-medium text-red-500">{fmt(Math.abs(saved), homeCurrency)}</span> over budget this month</>
              }
            </p>
          )}
        </div>

        {/* ── Health signals strip ──────────────────────────────────────────── */}
        {statementCount >= 2 && signalYm && (
          <SignalStrip
            signals={signals}
            score={score}
            status={trackStatus}
            periodLabel={signalPeriodStripLabel}
            onOpenModal={() => setModalOpen(true)}
          />
        )}

        {/* ── 4 KPI cards ───────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {/* Assets */}
          <Link href="/account/assets" className="group rounded-xl border border-gray-200 bg-white p-4 shadow-sm hover:border-purple-200 hover:shadow transition">
            <p className="text-xs text-gray-400">Assets</p>
            <p className="mt-1 text-xl font-bold text-gray-900 tabular-nums">{fmtNW(assets, homeCurrency)}</p>
            {assetSubLabel && <p className="mt-1 text-xs text-gray-400 truncate">{assetSubLabel}</p>}
            {assetDelta != null && (
              <p className={`mt-0.5 text-xs font-medium ${assetDelta >= 0 ? "text-green-600" : "text-red-500"}`}>
                {assetDelta >= 0 ? "▲" : "▼"} {fmtShort(Math.abs(assetDelta), homeCurrency)} this month
              </p>
            )}
          </Link>

          {/* Debts */}
          <Link href="/account/liabilities" className="group rounded-xl border border-gray-200 bg-white p-4 shadow-sm hover:border-purple-200 hover:shadow transition">
            <p className="text-xs text-gray-400">Debts</p>
            <p className="mt-1 text-xl font-bold text-red-500 tabular-nums">{fmtNW(debts, homeCurrency)}</p>
            {debtSubLabel && <p className="mt-1 text-xs text-gray-400 truncate">{debtSubLabel}</p>}
            {debtDelta != null && debts > 0 && (
              <p className={`mt-0.5 text-xs font-medium ${debtDelta <= 0 ? "text-green-600" : "text-red-500"}`}>
                {debtDelta <= 0 ? `▼ ${fmtShort(Math.abs(debtDelta), homeCurrency)} paid down` : `▲ ${fmtShort(debtDelta, homeCurrency)} more`}
              </p>
            )}
          </Link>

          {/* Avg Income/mo */}
          <Link href="/account/income" className="group rounded-xl border border-gray-200 bg-white p-4 shadow-sm hover:border-purple-200 hover:shadow transition">
            <p className="text-xs text-gray-400">Avg income/mo</p>
            <p className="mt-1 text-xl font-bold text-green-600 tabular-nums">
              {avgIncome > 0 ? fmtNW(avgIncome, homeCurrency) : "—"}
            </p>
            {income > 0 && avgIncome > 0 ? (
              <p className={`mt-1 text-xs font-medium ${income >= avgIncome ? "text-green-600" : "text-amber-500"}`}>
                {fmt(income, homeCurrency)} this month
              </p>
            ) : (
              <p className="mt-1 text-xs text-gray-400">
                {incomeMonths.length > 0 ? `${incomeMonths.length} month avg` : "no income data"}
              </p>
            )}
          </Link>

          {/* Typical Spending/mo */}
          <Link href="/account/spending" className="group rounded-xl border border-gray-200 bg-white p-4 shadow-sm hover:border-purple-200 hover:shadow transition">
            <p className="text-xs text-gray-400">Typical spending/mo</p>
            <p className="mt-1 text-xl font-bold text-gray-900 tabular-nums">
              {medianExpenses > 0 ? fmtNW(medianExpenses, homeCurrency) : "—"}
            </p>
            {expenses > 0 && medianExpenses > 0 ? (
              <p className={`mt-1 text-xs font-medium ${expenses <= medianExpenses ? "text-green-600" : "text-red-500"}`}>
                {fmt(expenses, homeCurrency)} this month
              </p>
            ) : (
              <p className="mt-1 text-xs text-gray-400">
                {effectiveExpenseMonths.length > 0 ? `${effectiveExpenseMonths.length} month median` : "no spend data"}
              </p>
            )}
          </Link>
        </div>

        {/* ── Agent insight cards ───────────────────────────────────────────── */}
        {idToken && (
          <AgentInsightCards cards={agentCards} token={idToken} homeCurrency={homeCurrency} />
        )}

        {/* ── Net worth chart ───────────────────────────────────────────────── */}
        {chartHistory.length >= 2 && <NetWorthChart history={chartHistory} />}

      </div>

      {/* ── Signal breakdown modal ────────────────────────────────────────── */}
      {modalOpen && (
        <SignalModal
          signals={signals}
          score={score}
          status={trackStatus}
          signalPeriodLabel={signalPeriodModalLabel}
          onClose={() => setModalOpen(false)}
        />
      )}
    </>
  );
}
