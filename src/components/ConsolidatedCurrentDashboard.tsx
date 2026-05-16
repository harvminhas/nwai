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
  /** Dollar-/percent-specific “what helps” line for dashboard strip + modal (computed with scoring). */
  actionHelp?: string;
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
  /** Savings-rate Pass threshold — keep in sync with scoring branches below. */
  const SR_PASS_MIN = 0.1;
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
      ? `On a typical month you bring in ${fmt(typicalMonthlyIncomeFromProfile, ccy)}, but everyday bills run about ${fmt(typicalMonthlyCoreFromProfile, ccy)} — ${fmt(profileStructural.coreOverIncome, ccy)} short. Credit‑card payoff transfers aren’t counted in those bills.`
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
    const base = { id: "nw_trend", name: "Net worth trend", shortName: "Net worth", description: "Whether net worth moved up from last month", weight: 30 };
    if (!cur || !prev) return { ...base, status: "skip", detail: "Not enough history yet", fillPct: 0 };
    const delta = (cur.netWorth ?? 0) - (prev.netWorth ?? 0);
    const pct   = (prev.netWorth ?? 0) !== 0 ? delta / Math.abs(prev.netWorth ?? 0) : 0;
    // fillPct: map [-10%, +10%] → [0, 100]; 0% = 50, +5% = 75, -5% = 25
    const fillPct = Math.round(Math.min(100, Math.max(0, (pct * 500 + 1) * 50)));
    const prevNw = prev.netWorth ?? 0;
    if (pct > 0.005) {
      return {
        ...base,
        status: "pass",
        detail: `Up ${fmtShort(delta, ccy)} vs last month`,
        fillPct,
        actionHelp: `You rose ${fmtShort(delta, ccy)} vs last month — try to finish higher than ${fmt(cur.netWorth ?? 0, ccy)} again next month.`,
      };
    }
    if (pct >= -0.005) {
      const bump = Math.max(25, Math.round(Math.abs(prevNw) * 0.005));
      return {
        ...base,
        status: "warning",
        detail: "About flat versus last month (within half a percent).",
        fillPct: 50,
        actionHelp: `Target about ${fmtShort(bump, ccy)} higher net worth than ${fmt(prevNw, ccy)} next month (≈0.5%).`,
      };
    }
    return {
      ...base,
      status: "fail",
      detail: `Down ${fmtShort(Math.abs(delta), ccy)} vs last month`,
      fillPct,
      actionHelp: `Earn back about ${fmtShort(Math.abs(delta), ccy)} vs last month — aim above ${fmt(prevNw, ccy)} next month.`,
    };
  })();

  // ── 2. Savings rate (25%) — never mix median income with a single month's spend (that inflated bogus rates). ──
  const srSignal: Signal = (() => {
    const base = {
      id: "savings_rate",
      name: "Savings rate",
      shortName: "Savings rate",
      description: "How much of your income is left after everyday bills (same month, or your usual averages)",
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
        basisNote = " — we estimated bills because this statement month didn’t include full expense totals.";
      }
      if (coreBurn <= 0) {
        return {
          ...base,
          status: "skip",
          detail: "We couldn’t measure everyday bills for this month — add statements or wait until your usual averages are filled in.",
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
        detail: "No income showed up this month — upload statements or wait until typical income and spending are available.",
        fillPct: 0,
      };
    }

    const rate = (incomeBasis - coreBurn) / incomeBasis;
    const saveAmt = incomeBasis - coreBurn;
    const targetSave = Math.round(incomeBasis * SR_PASS_MIN);
    // fillPct: map [-50%, +50%] → [0, 100]; 10% target ≈ 75% fill
    const fillPct = Math.round(Math.min(100, Math.max(0, (rate + 0.5) / 0.8 * 100)));
    if (rate >= SR_PASS_MIN) {
      return {
        ...base,
        status: "pass",
        detail: `You’re saving ${Math.round(rate * 100)}% of income after everyday bills${basisNote}`,
        fillPct,
        actionHelp: `Keep at least ${fmt(targetSave, ccy)} left after bills each month (${SR_PASS_MIN * 100}% of ${fmt(incomeBasis, ccy)} income).`,
      };
    }
    if (rate >= 0) {
      const needExtra = Math.max(0, targetSave - saveAmt);
      return {
        ...base,
        status: "warning",
        detail: `You’re saving ${Math.round(rate * 100)}% after bills — aim for at least 10%${basisNote}`,
        fillPct,
        actionHelp: `Free about ${fmt(needExtra, ccy)} more per month after bills to hit ${SR_PASS_MIN * 100}% (${fmt(targetSave, ccy)} on ${fmt(incomeBasis, ccy)} income).`,
      };
    }
    if (rate < 0 && usingProfileMedians && profileStructural.structuralDeficit && profileStructuralCaption) {
      const cushion = Math.round(typicalMonthlyIncomeFromProfile * SR_PASS_MIN);
      const totalShift = profileStructural.coreOverIncome + cushion;
      return {
        ...base,
        status: "fail",
        detail: profileStructuralCaption,
        fillPct,
        actionHelp: `Raise income or cut everyday bills by about ${fmt(totalShift, ccy)} total — ${fmt(profileStructural.coreOverIncome, ccy)} to balance the typical month plus ${fmt(cushion, ccy)} for ${SR_PASS_MIN * 100}% savings.`,
      };
    }
    {
      const deficit = coreBurn - incomeBasis;
      const cushion = Math.round(incomeBasis * SR_PASS_MIN);
      return {
        ...base,
        status: "fail",
        detail: `Everyday bills run ${fmt(deficit, ccy)} higher than income${basisNote}`,
        fillPct,
        actionHelp: `Trim bills or lift income by about ${fmt(deficit + cushion, ccy)} — ${fmt(deficit, ccy)} to match this month’s income plus ${fmt(cushion, ccy)} for ${SR_PASS_MIN * 100}% savings.`,
      };
    }
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
      description: "Debt going down over time and not overwhelming compared with what you own",
      weight: 20,
    };
    if (!hasDebts || !cur || cur.debtTotal <= 0) return { ...base, status: "skip", detail: "No debt tracked — this item isn’t scored.", fillPct: 0 };
    if (!prev) return { ...base, status: "skip", detail: "Not enough history yet", fillPct: 0 };
    const delta = cur.debtTotal - prev.debtTotal;
    const assetsGross = cur.totalAssets ?? 0;
    const ratio = assetsGross > 0 ? cur.debtTotal / assetsGross : 1;
    const pctLoad = Math.round(ratio * 100);
    const changePct = cur.debtTotal > 0 ? delta / cur.debtTotal : 0;
    const fillPct = Math.round(Math.min(100, Math.max(0, (-changePct * 500 + 1) * 50)));
    const debtSoftCap = Math.round(assetsGross * DEBT_TO_ASSETS_PASS_MAX);
    const excessDebt = Math.max(0, cur.debtTotal - debtSoftCap);
    const pctPass = Math.round(DEBT_TO_ASSETS_PASS_MAX * 100);
    const pctFail = Math.round(DEBT_TO_ASSETS_FAIL_MIN * 100);

    if (delta > 50) {
      return {
        ...base,
        status: "fail",
        detail: `Debt grew by ${fmt(delta, ccy)} this month`,
        fillPct,
        actionHelp: `Pay down at least ${fmt(delta, ccy)} next month (erase this month’s increase) and pause balance growth.`,
      };
    }

    if (delta < -10) {
      if (ratio >= DEBT_TO_ASSETS_FAIL_MIN) {
        return {
          ...base,
          status: "fail",
          detail: `You paid down ${fmt(Math.abs(delta), ccy)}, but debt is still ${pctLoad}% of what you own`,
          fillPct,
          actionHelp:
            excessDebt > 0
              ? `Keep paying — chip away about ${fmt(excessDebt, ccy)} more to reach ~${fmt(debtSoftCap, ccy)} total owed (${pctPass}% of ${fmt(assetsGross, ccy)} assets).`
              : `Keep paying — aim for debt clearly below ${pctFail}% of assets (now ${pctLoad}%).`,
        };
      }
      if (ratio > DEBT_TO_ASSETS_PASS_MAX) {
        return {
          ...base,
          status: "warning",
          detail: `You paid down ${fmt(Math.abs(delta), ccy)}, but debt is still ${pctLoad}% of what you own`,
          fillPct,
          actionHelp:
            excessDebt > 0
              ? `Stay on paydown until total debt is near ${fmt(debtSoftCap, ccy)} (~${pctPass}% of ${fmt(assetsGross, ccy)} assets); about ${fmt(excessDebt, ccy)} left vs that cap.`
              : `Keep shaving balances until debt is comfortably under half of what you own.`,
        };
      }
      return {
        ...base,
        status: "pass",
        detail: `You paid down ${fmt(Math.abs(delta), ccy)} this month`,
        fillPct,
        actionHelp: `Keep paying down about ${fmt(Math.abs(delta), ccy)}+/month if you can — same pace as this month.`,
      };
    }

    // Flat or small move (includes tiny paydown)
    if (ratio >= DEBT_TO_ASSETS_FAIL_MIN) {
      return {
        ...base,
        status: "fail",
        detail: `Debt didn’t really move — still ${pctLoad}% of what you own`,
        fillPct: Math.min(fillPct, 35),
        actionHelp:
          excessDebt > 0
            ? `Target roughly ${fmt(Math.max(100, Math.round(excessDebt / 12)), ccy)}+/month paydown until debt is near ${fmt(debtSoftCap, ccy)} (${pctPass}% of ${fmt(assetsGross, ccy)} assets).`
            : `Lower total debt each month until it’s well under ${pctFail}% of assets.`,
      };
    }
    if (ratio > DEBT_TO_ASSETS_PASS_MAX) {
      return {
        ...base,
        status: "warning",
        detail: `Debt stayed flat — ${pctLoad}% of what you own`,
        fillPct: 50,
        actionHelp:
          excessDebt > 0
            ? `Pay down about ${fmt(Math.max(50, Math.round(excessDebt / 18)), ccy)}+/month toward ${fmt(debtSoftCap, ccy)} owed (${pctPass}% cap on ${fmt(assetsGross, ccy)} assets).`
            : `Make steady paydowns until debt is below ~half of assets.`,
      };
    }
    const nudge = Math.max(75, Math.round(cur.debtTotal * 0.012));
    return {
      ...base,
      status: "warning",
      detail: "Debt balance barely moved this month",
      fillPct: 50,
      actionHelp: `Aim for about ${fmt(nudge, ccy)}+ net paydown next month so the balance trends down.`,
    };
  })();

  // ── 4. Spending (15%) — headline cash flow + core vs trend (short history uses prior mo or profile median) ──
  const spendSignal: Signal = (() => {
    const base = {
      id: "spending_vs_budget",
      name: "Spending & habits",
      shortName: "Spending",
      description: "Whether total spending stayed under income and matches your usual pace",
      weight: 15,
    };
    if (!cur) return { ...base, status: "skip", detail: "No data for this month", fillPct: 0 };

    const { burn: curBurn, imputed: curBurnImputed } = coreBurnForSignalMonthRow(cur);
    const spendImputedNote = curBurnImputed
      ? " Note: we used your usual monthly spending because this statement didn’t show a full expense total."
      : "";

    if (curBurn <= 0) {
      return { ...base, status: "skip", detail: "No spending data for this month", fillPct: 0 };
    }

    const totalExp = cur.expensesTotal ?? 0;

    let avgCore = 0;
    let baselineLabel = "";
    if (prev3.length >= 2) {
      avgCore = prev3.reduce((s, h) => s + monthlyHistoryCoreExpenses(h), 0) / prev3.length;
      baselineLabel = "your recent monthly average";
    } else if (prev3.length === 1) {
      avgCore = monthlyHistoryCoreExpenses(prev3[0]);
      baselineLabel = "last month";
    } else if (typicalMonthlyCoreFromProfile > 0) {
      avgCore = typicalMonthlyCoreFromProfile;
      baselineLabel = "your usual monthly spending";
    }

    if (avgCore <= 0 && typicalMonthlyCoreFromProfile > 0) {
      avgCore = typicalMonthlyCoreFromProfile;
      baselineLabel = "your usual monthly spending";
    }

    let incomeBasis = cur.incomeTotal > 0 ? cur.incomeTotal : 0;

    const buildTrend = (): Pick<Signal, "status" | "detail" | "fillPct" | "actionHelp"> => {
      const tail = spendImputedNote;
      if (avgCore <= 0 || curBurn <= 0) {
        return {
          status: "warning",
          detail:
            (avgCore <= 0
              ? "We need another month of statements to learn your usual spending pace."
              : "Everyday spending looks very low compared with what we’d expect.") + tail,
          fillPct: 45,
          actionHelp:
            avgCore <= 0
              ? "Upload another full statement month so we can pin a dollar target for everyday spending."
              : "Double-check categories or missing accounts — everyday totals look unusually low.",
        };
      }
      const baselineAmt = Math.round(avgCore);
      const ratioTrend = curBurn / avgCore;
      const trendFillPct = Math.round(Math.min(100, Math.max(0, 100 - Math.max(0, ratioTrend - 1) * 200)));
      if (ratioTrend <= 1.0) {
        return {
          status: "pass",
          detail: `Everyday spending is about ${Math.round(ratioTrend * 100)}% of ${baselineLabel} — on track.${tail}`,
          fillPct: trendFillPct,
          actionHelp: `Stay at or below about ${fmt(baselineAmt, ccy)}/month everyday (${baselineLabel}).`,
        };
      }
      if (ratioTrend <= 1.10) {
        const trim = Math.round(curBurn - avgCore);
        return {
          status: "warning",
          detail: `Everyday spending is a bit above ${baselineLabel} (${Math.round(ratioTrend * 100)}%).${tail}`,
          fillPct: trendFillPct,
          actionHelp: `Trim everyday spending by about ${fmt(trim, ccy)} vs ${baselineLabel} (≈${fmt(baselineAmt, ccy)}/mo typical).`,
        };
      }
      const trim = Math.round(curBurn - avgCore);
      return {
        status: "fail",
        detail: `Everyday spending is ${Math.round(ratioTrend * 100)}% of ${baselineLabel} — about ${fmt(curBurn - avgCore, ccy)} higher than typical.${tail}`,
        fillPct: trendFillPct,
        actionHelp: `Cut everyday spending by about ${fmt(trim, ccy)} vs ${baselineLabel} (near ${fmt(baselineAmt, ccy)}/mo).`,
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
        detail: `Total spending (${fmt(totalExp, ccy)}) was higher than income (${fmt(incomeBasis, ccy)}) by ${fmt(overAmt, ccy)}. Versus your usual pace: ${trend.detail}`,
        fillPct: Math.min(cashFill, trend.fillPct),
        actionHelp: `Hold total month spending under ${fmt(incomeBasis, ccy)} next month — you were ${fmt(overAmt, ccy)} over; everyday aim stays ~${fmt(Math.round(avgCore), ccy)}.`,
      };
    }

    if (incomeBasis <= 0 && profileStructural.structuralDeficit && profileStructuralCaption) {
      return {
        ...base,
        status: "fail",
        detail: `${trend.detail} The bigger “typical month” income gap is explained under Savings rate.`,
        fillPct: Math.min(profileStructural.cashFillPct, trend.fillPct),
        actionHelp:
          typicalMonthlyIncomeFromProfile > 0 && typicalMonthlyCoreFromProfile > 0
            ? `Keep everyday spend near ${fmt(Math.round(avgCore), ccy)}/month; raise income or cut bills by ~${fmt(profileStructural.coreOverIncome, ccy)} to fix the typical-month deficit (see Savings rate).`
            : trend.actionHelp,
      };
    }

    return { ...base, ...trend };
  })();

  // ── 5. Goal trajectory (5%) ───────────────────────────────────────────────
  const goalSignal: Signal = {
    id: "goal_trajectory", name: "Goal trajectory", shortName: "Goals",
    description: "Financial independence timeline stays within about a year of your original plan",
    weight: 5, status: "skip",
    detail: "Add savings goals in the app to track progress.", fillPct: 0,
  };

  // ── 6. Emergency fund vs profile goal (5%) — same target as Goals / Overview (`getEmergencyFundMetrics`) ──
  const efSignal: Signal = (() => {
    const base = {
      id: "emergency_fund",
      name: "Emergency fund buffer",
      shortName: "Emergency fund",
      description: "Cash on hand for emergencies compared with your months-of-expenses goal",
      weight: 5,
    };
    if (!emergencyFundMetrics) {
      return { ...base, status: "skip", detail: "We need more spending history to suggest an emergency fund target.", fillPct: 0 };
    }
    if (liquidAssets <= 0) {
      return { ...base, status: "skip", detail: "No checking or savings balance linked yet.", fillPct: 0 };
    }
    const { gap, monthsOfCoreCovered, pctFunded } = getEmergencyFundLiquidMetrics(liquidAssets, emergencyFundMetrics);
    const targetMo = emergencyFundMetrics.targetMonths;
    const baselineMo = emergencyFundMetrics.baselineMonthlyCoreExpenses;
    const fillPct = Math.round(Math.min(100, Math.max(0, pctFunded * 100)));

    if (pctFunded >= 1) {
      return {
        ...base,
        status: "pass",
        detail: `You’re on track — about ${monthsOfCoreCovered.toFixed(1)} months of bills saved (goal was ${targetMo} months).`,
        fillPct: 100,
        actionHelp: `Hold at least ${fmt(emergencyFundMetrics.targetAmount, ccy)} accessible cash (${targetMo} × ~${fmt(baselineMo, ccy)}/mo typical bills).`,
      };
    }
    if (pctFunded >= 0.5) {
      return {
        ...base,
        status: "warning",
        detail: `About ${fmtShort(gap, ccy)} shy of your ${targetMo}-month safety cushion (${monthsOfCoreCovered.toFixed(1)} months covered).`,
        fillPct,
        actionHelp: `Add about ${fmt(gap, ccy)} to checking or savings (${monthsOfCoreCovered.toFixed(1)} → ${targetMo} mo at ~${fmt(baselineMo, ccy)}/mo bills).`,
      };
    }
    return {
      ...base,
      status: "fail",
      detail: `About ${fmtShort(gap, ccy)} shy of your ${targetMo}-month safety cushion (${monthsOfCoreCovered.toFixed(1)} months covered).`,
      fillPct,
      actionHelp: `Add about ${fmt(gap, ccy)} to checking or savings (${monthsOfCoreCovered.toFixed(1)} → ${targetMo} mo at ~${fmt(baselineMo, ccy)}/mo bills).`,
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

/** Points gained if this pillar alone moved to Pass (others unchanged). */
function marginalPointsToPass(signals: Signal[], signalId: string): number {
  const sig = signals.find((s) => s.id === signalId);
  if (!sig || sig.status === "skip" || sig.status === "pass") return 0;
  const base = computeScore(signals);
  const upgraded = signals.map((x) =>
    x.id === signalId && x.status !== "skip"
      ? { ...x, status: "pass" as SignalStatus, fillPct: 100 }
      : x,
  );
  return computeScore(upgraded) - base;
}

/** Plain-language tips for reaching Pass (pairs with {@link marginalPointsToPass}). */
function buildPassRoadmapHint(
  sig: Signal,
  ctx: { ccy: string; efGap?: number; efTargetMonths?: number },
): string {
  const mo = ctx.efTargetMonths ?? 6;
  switch (sig.id) {
    case "nw_trend":
      if (sig.status === "warning") {
        return "Next month, try to finish with a slightly higher net worth than the month before (even a small bump helps).";
      }
      return "Next month, aim for net worth to go up — earn more, spend less, or pay down debt.";
    case "savings_rate":
      return "Raise income or cut regular bills until you keep at least 10% of your income after everyday expenses. Credit‑card payoff transfers aren’t counted as regular bills here.";
    case "debt_plan":
      return "Keep paying balances down each month and work toward owing clearly less than about half of what you own.";
    case "spending_vs_budget": {
      const d = sig.detail.toLowerCase();
      if (d.includes("higher than income")) {
        return "Spend less than you earn that month, then check whether day‑to‑day habits match your usual pace.";
      }
      if (d.includes("a bit above")) {
        return "Ease everyday spending a little — small cuts across a few categories usually fix this.";
      }
      return "Keep everyday spending at or below your usual pace; trim categories where you’re spending more than normal.";
    }
    case "emergency_fund":
      if (ctx.efGap != null && ctx.efGap > 0) {
        return `Add about ${fmt(ctx.efGap, ctx.ccy)} to checking or savings to reach your ${mo}-month cushion.`;
      }
      return `Grow cash savings until they cover about ${mo} months of regular bills (same goal as on Goals / Overview).`;
    case "goal_trajectory":
      return "Set savings goals in the app and add money on schedule so targets stay realistic.";
    default:
      return "Upload fresh statements each month so this score stays up to date.";
  }
}

function passRoadmapHelpLine(sig: Signal, roadmapCtx: PassRoadmapCtx): string {
  const efGap =
    sig.id === "emergency_fund" && roadmapCtx.efGap != null && roadmapCtx.efGap > 0 ? roadmapCtx.efGap : undefined;
  return (
    sig.actionHelp ??
    buildPassRoadmapHint(sig, {
      ccy: roadmapCtx.ccy,
      efGap,
      efTargetMonths: roadmapCtx.efTargetMonths ?? undefined,
    })
  );
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
 * Upgrades apply immediately so we never show “Focus areas” with a perfect score / all Pass.
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
  /** Softer than “Off track” — headline tier still reads urgent via color. */
  "off-track": { label: "Focus areas",   badge: "bg-orange-100 text-orange-700 border-orange-200", dot: "bg-orange-500" },
};

const SIGNAL_STATUS_CONFIG: Record<SignalStatus, { label: string; color: string; bg: string }> = {
  pass:    { label: "Pass",    color: "text-green-700",  bg: "bg-green-100 border-green-200" },
  warning: { label: "Warning", color: "text-amber-700",  bg: "bg-amber-100 border-amber-200" },
  fail:    { label: "Focus",   color: "text-orange-700",  bg: "bg-orange-50 border-orange-200" },
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
  fail:    "bg-orange-400",
  skip:    "bg-gray-200",
};
const STRIP_LABEL: Record<SignalStatus, { text: string; cls: string }> = {
  pass:    { text: "Pass",    cls: "text-green-600" },
  warning: { text: "Watch",   cls: "text-amber-500" },
  fail:    { text: "Focus",   cls: "text-orange-500" },
  skip:    { text: "N/A",     cls: "text-gray-300"  },
};

function gridColsClassForSignalCount(n: number): string {
  if (n <= 1) return "grid-cols-1";
  if (n === 2) return "grid-cols-2";
  if (n === 3) return "grid-cols-2 sm:grid-cols-3";
  if (n === 4) return "grid-cols-2 sm:grid-cols-4";
  return "grid-cols-2 sm:grid-cols-3 lg:grid-cols-5";
}

type PassRoadmapCtx = { ccy: string; efGap: number | null; efTargetMonths: number | null };

/** Skip / Pass-only lines — fail & warning use {@link CollapsiblePassRoadmap}. */
function SignalPassRoadmap({ sig, compact }: { sig: Signal; compact?: boolean }) {
  if (sig.status === "skip") {
    return (
      <p className={`mt-2 ${compact ? "text-[10px]" : "text-[11px]"} text-gray-400 italic leading-snug`}>
        Not included in your weighted score right now.
      </p>
    );
  }
  if (sig.status === "pass") {
    return (
      <p className={`mt-2 ${compact ? "text-[10px]" : "text-[11px]"} font-medium text-green-700 leading-snug`}>
        Full credit — holding Pass.
      </p>
    );
  }
  return null;
}

/** Collapsed by default: shows +pts row; expands to Pass roadmap “what helps” (numbers — narrative lives in full breakdown). */
function CollapsiblePassRoadmap({
  signals,
  sig,
  roadmapCtx,
  compact,
}: {
  signals: Signal[];
  sig: Signal;
  roadmapCtx: PassRoadmapCtx;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const help = passRoadmapHelpLine(sig, roadmapCtx);
  const delta = marginalPointsToPass(signals, sig.id);

  const btnSz = compact ? "text-[10px]" : "text-[11px]";
  const bodySz = compact ? "text-[10px]" : "text-xs";
  const labelSz = compact ? "text-[9px]" : "text-[10px]";
  const btnLabel =
    delta >= 1 ? `+${delta} pt${delta === 1 ? "" : "s"} to Pass` : "What helps";

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={
          "flex w-full items-center justify-between gap-1.5 rounded-lg border border-purple-100 bg-purple-50/90 " +
          "px-2 py-1.5 text-left hover:bg-purple-50 transition " +
          (compact ? "" : "sm:px-3 sm:py-2")
        }
        aria-expanded={open}
        aria-label={open ? "Hide what helps" : "Show what helps"}
      >
        <span className={`${btnSz} font-semibold text-purple-950 tabular-nums tracking-tight`}>{btnLabel}</span>
        <svg
          className={`h-3 w-3 shrink-0 text-purple-600 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2.5}
          aria-hidden
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className={`mt-2 ${compact ? "" : "pl-0.5"}`}>
          <p className={`${labelSz} font-semibold uppercase tracking-wide text-purple-700/80`}>What helps</p>
          <p className={`${bodySz} mt-0.5 border-l-2 border-purple-200 pl-2 leading-snug text-purple-900/90`}>{help}</p>
        </div>
      )}
    </div>
  );
}

function SignalStrip({ signals, score, status, periodLabel, roadmapCtx, onOpenModal }: {
  signals: Signal[];
  score: number;
  status: TrackStatus | null;
  /** Explains which statement month the scores use (last complete month). */
  periodLabel?: string | null;
  roadmapCtx: PassRoadmapCtx;
  onOpenModal: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const active = signals.filter((s) => s.status !== "skip");
  if (active.length < 2) return null;

  const scoreColor = score >= 75 ? "text-green-600" : score >= 50 ? "text-amber-500" : "text-orange-500";
  const scoreBar   = score >= 75 ? "bg-green-500"   : score >= 50 ? "bg-amber-400"   : "bg-orange-400";
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
            className={`grid gap-px bg-gray-100 border-t border-gray-100 items-stretch ${gridColsClassForSignalCount(active.length)}`}
          >
            {active.map((sig) => {
              const lb = STRIP_LABEL[sig.status];
              return (
                <div
                  key={sig.id}
                  className="bg-white px-3 py-3 sm:px-3.5 flex flex-col min-h-0 h-full"
                >
                  <div className="flex items-center justify-between gap-1">
                    <p className="text-[11px] font-semibold text-gray-600 leading-tight min-w-0">{sig.shortName}</p>
                    <span className={`text-[10px] font-bold shrink-0 ${lb.cls}`}>{lb.text}</span>
                  </div>
                  <div className="mt-1.5 h-1.5 rounded-full bg-gray-100 overflow-hidden shrink-0">
                    <div
                      className={`h-full rounded-full transition-all ${STRIP_BAR[sig.status]}`}
                      style={{ width: `${sig.fillPct}%` }}
                    />
                  </div>
                  <div className="mt-auto pt-2">
                    {sig.status === "pass" ? (
                      <>
                        <p className="text-[11px] text-gray-600 leading-snug">{sig.detail}</p>
                        <SignalPassRoadmap sig={sig} compact />
                      </>
                    ) : (
                      <CollapsiblePassRoadmap
                        signals={signals}
                        sig={sig}
                        roadmapCtx={roadmapCtx}
                        compact
                      />
                    )}
                  </div>
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
  signals, score, status, signalPeriodLabel, roadmapCtx, onClose,
}: {
  signals: Signal[];
  score: number;
  status: TrackStatus | null;
  signalPeriodLabel?: string | null;
  roadmapCtx: PassRoadmapCtx;
  onClose: () => void;
}) {
  const trackCfg = status ? TRACK_CONFIG[status] : null;
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-lg rounded-2xl bg-white shadow-2xl max-h-[90dvh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-gray-100 px-5 py-4">
          <div className="min-w-0 flex-1 pr-2">
            <h2 className="font-bold text-gray-900">Health check</h2>
            {signalPeriodLabel ? (
              <p className="mt-1 text-[11px] font-medium text-gray-500">{signalPeriodLabel}</p>
            ) : null}
            <p className="mt-2 text-xs text-gray-400 leading-relaxed">
              Scores use your <strong className="text-gray-500">last full statement month</strong> (not the current calendar month until every account has a statement).
              Each row counts toward the total using its weight. When that month shows paycheck deposits, savings compares that month&apos;s income to its everyday bills.
              If there were no deposits, we pair your <strong className="text-gray-500">usual monthly income</strong> with your{" "}
              <strong className="text-gray-500">usual monthly bills</strong> — never mixing income from one pattern with spending from another.
              Spending checks total spending vs income and whether habits match your usual pace.
              Emergency savings matches Goals / Overview. Debt looks at balance changes vs how much you own.
            </p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Score summary */}
        <div className="flex shrink-0 items-center gap-4 border-b border-gray-100 px-5 py-3">
          <div className="flex-1">
            <div className="flex h-2 w-full overflow-hidden rounded-full bg-gray-100">
              <div
                className={`h-full rounded-full transition-all ${
                  score >= 75 ? "bg-green-500" : score >= 50 ? "bg-amber-500" : "bg-orange-400"
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
        <div className="divide-y divide-gray-50 flex-1 min-h-0 overflow-y-auto overscroll-contain">
          {signals.map((sig) => {
            const scfg = SIGNAL_STATUS_CONFIG[sig.status];
            const activeWeight = sig.status !== "skip" ? sig.weight : null;
            const ptsToPass = marginalPointsToPass(signals, sig.id);
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
                {sig.status === "pass" || sig.status === "skip" ? (
                  <>
                    <p className={`mt-1.5 text-xs leading-relaxed ${scfg.color}`}>{sig.detail}</p>
                    <SignalPassRoadmap sig={sig} />
                  </>
                ) : (
                  <>
                    <div className="mt-2">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                        What&apos;s going on
                      </p>
                      <p className={`mt-0.5 text-xs leading-relaxed ${scfg.color}`}>{sig.detail}</p>
                    </div>
                    {ptsToPass >= 1 ? (
                      <p className="mt-2 text-[11px] font-semibold text-purple-950 tabular-nums">
                        +{ptsToPass} pt{ptsToPass === 1 ? "" : "s"} to Pass
                      </p>
                    ) : null}
                    <div className="mt-2">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-purple-700/80">
                        What helps
                      </p>
                      <p className="mt-0.5 border-l-2 border-purple-200 pl-2 text-xs leading-snug text-purple-900/90">
                        {passRoadmapHelpLine(sig, roadmapCtx)}
                      </p>
                    </div>
                  </>
                )}
                {/* Weight bar */}
                {activeWeight != null && (
                  <div className="mt-2 h-0.5 w-full overflow-hidden rounded-full bg-gray-100">
                    <div
                      className={`h-full rounded-full ${
                        sig.status === "pass" ? "bg-green-400" : sig.status === "warning" ? "bg-amber-400" : "bg-orange-400"
                      }`}
                      style={{ width: `${activeWeight * 3}%` }}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="border-t border-gray-100 px-5 py-3 shrink-0">
          <p className="text-[10px] text-gray-400">
            Improvements update the badge immediately. Downgrades wait until the lower tier also appeared last month, so one noisy month
            doesn&apos;t flip you red. Skipped signals are omitted from the weighted score.
            {" "}
            Point bumps assume everything else stays the same while that pillar alone reaches Pass; roadmap lines are guidance, not an exact flip guarantee.
          </p>
        </div>
      </div>
    </div>
  );
}

// ── component ─────────────────────────────────────────────────────────────────

export default function ConsolidatedCurrentDashboard({
  refreshKey,
  onEstimatedWarning,
}: {
  refreshKey?: number;
  /** Called (once) with the warning message when estimated-balance conditions are met; null when cleared. */
  onEstimatedWarning?: (msg: string | null) => void;
}) {
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

  // Propagate estimated-balance warning to parent (for inline icon next to page title).
  useEffect(() => {
    if (!onEstimatedWarning) return;
    const currentIncomplete = yearMonth ? incompleteMonths.includes(yearMonth) : false;
    const totalMonths = history.length;
    const manyIncomplete = totalMonths > 0 && incompleteMonths.length / totalMonths > 0.4;
    if (currentIncomplete) {
      onEstimatedWarning("Upload a statement for all accounts this month for an accurate net worth.");
    } else if (manyIncomplete) {
      onEstimatedWarning(
        `${incompleteMonths.length} month${incompleteMonths.length !== 1 ? "s" : ""} are missing a statement for at least one account.`,
      );
    } else {
      onEstimatedWarning(null);
    }
  }, [yearMonth, incompleteMonths, history, onEstimatedWarning]);

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

  const passRoadmapCtx: PassRoadmapCtx = {
    ccy: homeCurrency,
    efGap:
      emergencyFundMetrics != null
        ? getEmergencyFundLiquidMetrics(liquidAssets, emergencyFundMetrics).gap
        : null,
    efTargetMonths: emergencyFundMetrics?.targetMonths ?? null,
  };

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
            roadmapCtx={passRoadmapCtx}
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
          roadmapCtx={passRoadmapCtx}
          onClose={() => setModalOpen(false)}
        />
      )}
    </>
  );
}
