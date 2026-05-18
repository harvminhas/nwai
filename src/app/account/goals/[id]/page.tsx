"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseClient } from "@/lib/firebase";
import { fmt, getCurrencySymbol, HOME_CURRENCY } from "@/lib/currencyUtils";
import type { AccountRateEntry } from "@/app/api/user/account-rates/route";
import type { AccountSnapshot } from "@/lib/extractTransactions";
import type { AccountBalanceHistory } from "@/lib/financialProfile";
import { monthlyDebtTotalsFromBalanceHistory } from "@/lib/monthlyDebtFromBalanceHistory";

// ── types ─────────────────────────────────────────────────────────────────────

type HistoryPoint = {
  yearMonth: string;
  debtTotal: number;
  netWorth?: number;
};

type LiabilitySnap = AccountSnapshot & { balance: number };

type GoalConfig = {
  id: string;
  title: string;
  targetDate: string | null; // "YYYY-MM"
  linkedLiabilitySlugs?: string[] | null;
  isAutoDebtGoal?: boolean;
};

// ── date helpers ──────────────────────────────────────────────────────────────

function currentYM(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function ymToMonthIndex(ym: string): number {
  const [y, m] = ym.split("-").map(Number);
  return y * 12 + m;
}

function monthIndexToYM(idx: number): string {
  const y = Math.floor(idx / 12);
  const m = idx % 12;
  return `${y}-${String(m).padStart(2, "0")}`;
}

function monthsBetween(startYM: string, endYM: string): number {
  return ymToMonthIndex(endYM) - ymToMonthIndex(startYM);
}

function addMonthsToYM(ym: string, n: number): string {
  return monthIndexToYM(ymToMonthIndex(ym) + n);
}

function fmtYM(ym: string): string {
  if (!ym || !/^\d{4}-\d{2}$/.test(ym)) return ym;
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

function monthsAway(ym: string): string {
  const diff = monthsBetween(currentYM(), ym);
  if (diff <= 0) return "now";
  if (diff < 12) return `${diff} mo away`;
  const yrs = Math.floor(diff / 12);
  const mo = diff % 12;
  return mo > 0 ? `${yrs} yr ${mo} mo away` : `${yrs} yr away`;
}

/** Relative time looking back from this month (`ym` ≤ today). */
function monthsAgoLabel(ym: string): string {
  const diff = monthsBetween(ym, currentYM());
  if (diff <= 0) return "now";
  if (diff < 12) return `${diff} mo ago`;
  const yrs = Math.floor(diff / 12);
  const mo = diff % 12;
  return mo > 0 ? `${yrs} yr ${mo} mo ago` : `${yrs} yr ago`;
}

function defaultTargetDate(): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() + 5);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Firestore / clients may store "YYYY-M", ISO prefixes, or empty — normalize for `fmtYM` + comparisons. */
function normalizeMonthYM(raw: unknown): string | null {
  if (raw == null) return null;
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (s === "") return null;
  if (/^\d{4}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{4})-(\d{1,2})(?:-\d|$|T)/);
  if (m) {
    const mo = String(parseInt(m[2], 10)).padStart(2, "0");
    return `${m[1]}-${mo}`;
  }
  return null;
}

// ── math helpers ──────────────────────────────────────────────────────────────

// ── per-debt simulation (mirrors liabilities/page.tsx exactly) ───────────────

type SimDebt = {
  id: string;
  label: string;
  balance: number;
  apr: number;        // percent, e.g. 19.99
  minPayment: number;
  isCredit: boolean;  // credit card uses dynamic 2%-min rule
};

function calcAmortisedPayment(balance: number, apr: number, months: number): number {
  const r = apr / 100 / 12;
  if (r === 0 || months === 0) return balance / Math.max(months, 1);
  const pow = Math.pow(1 + r, months);
  return (balance * r * pow) / (pow - 1);
}

const DEFAULT_TERMS: Record<string, number> = {
  mortgage: 25 * 12, loan: 5 * 12, credit: 0,
};

const APR_DEFAULTS: Record<string, number> = {
  credit: 19.99, mortgage: 4.5, loan: 8.99,
};

function estimateMinPaymentForType(balance: number, apr: number | null, accountType: string): number {
  if (accountType === "credit") return Math.max(Math.ceil(balance * 0.02), 25);
  const rate = apr ?? APR_DEFAULTS[accountType] ?? 8;
  const terms = DEFAULT_TERMS[accountType] ?? 60;
  if (terms === 0) return Math.max(25, Math.round(balance * ((rate / 100) / 12)));
  return Math.round(calcAmortisedPayment(balance, rate, terms));
}

/**
 * Exact port of the liabilities-page simulation (avalanche strategy).
 * extraMonthly is applied to the highest-APR remaining debt each month.
 */
function simulateDebts(
  debts: SimDebt[],
  extraMonthly: number,
): { payoffMonths: Map<string, number>; totalMonths: number } {
  if (debts.length === 0) return { payoffMonths: new Map(), totalMonths: 0 };

  // Avalanche order: highest APR first
  const order = [...debts].sort((a, b) => b.apr - a.apr).map((d) => d.id);
  const state = new Map(debts.map((d) => [d.id, { ...d, remaining: d.balance }]));
  const finished = new Map<string, number>();

  for (let m = 1; m <= 600; m++) {
    const alive = order.filter((id) => (state.get(id)?.remaining ?? 0) > 0.01);
    if (alive.length === 0) break;

    const priorityId = alive[0];

    for (const id of alive) {
      const d = state.get(id)!;
      const interest = d.remaining * (d.apr / 100 / 12);
      const dynamicMin = d.isCredit
        ? Math.max(Math.ceil(d.remaining * 0.02), 25)
        : d.minPayment;
      const extra = id === priorityId ? extraMonthly : 0;
      const payment = Math.min(d.remaining + interest, dynamicMin + extra);
      d.remaining = Math.max(0, d.remaining + interest - payment);
    }

    for (const id of alive) {
      if ((state.get(id)?.remaining ?? 0) <= 0.01 && !finished.has(id)) {
        finished.set(id, m);
      }
    }
  }

  for (const [id] of state) {
    if (!finished.has(id)) finished.set(id, 600);
  }

  const totalMonths = Math.max(0, ...Array.from(finished.values()));
  return { payoffMonths: finished, totalMonths };
}

/**
 * Month‑end totals remaining across all simulated debts (index 0 = today, then each month forward).
 */
function simulateDebtsTotalRemainingMonthly(
  debts: SimDebt[],
  extraMonthly: number,
  maxMonths: number,
): number[] {
  if (debts.length === 0) return [];
  const order = [...debts].sort((a, b) => b.apr - a.apr).map((d) => d.id);
  const state = new Map(
    debts.map((d) => [
      d.id,
      { apr: d.apr, minPayment: d.minPayment, isCredit: d.isCredit, remaining: d.balance },
    ]),
  );

  let t0 = 0;
  for (const s of state.values()) t0 += s.remaining;

  const out: number[] = [t0];
  for (let m = 1; m <= maxMonths; m++) {
    const alive = order.filter((id) => (state.get(id)?.remaining ?? 0) > 0.01);
    if (alive.length === 0) break;

    const priorityId = alive[0];

    for (const id of alive) {
      const d = state.get(id)!;
      const interest = d.remaining * (d.apr / 100 / 12);
      const dynamicMin = d.isCredit
        ? Math.max(Math.ceil(d.remaining * 0.02), 25)
        : d.minPayment;
      const extra = id === priorityId ? extraMonthly : 0;
      const payment = Math.min(d.remaining + interest, dynamicMin + extra);
      d.remaining = Math.max(0, d.remaining + interest - payment);
    }

    let tot = 0;
    for (const v of state.values()) tot += v.remaining;
    out.push(tot);
  }
  return out;
}

function medianOfSorted(sorted: number[]): number | null {
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Median month-over-month debt balance drops from history.
 * Uses IQR outlier filtering (same as goals list page) so one-off lump
 * paydowns / initial-import spikes don't dominate.
 */
function medianDebtReductionFromHistory(history: { debtTotal: number }[]): number | null {
  const withDebt = history.filter((h) => h.debtTotal > 0);
  if (withDebt.length < 2) return null;
  const reductions: number[] = [];
  for (let i = 1; i < withDebt.length; i++) {
    const r = withDebt[i - 1].debtTotal - withDebt[i].debtTotal;
    if (r > 0) reductions.push(r);
  }
  if (reductions.length === 0) return null;
  if (reductions.length >= 4) {
    const sorted = [...reductions].sort((a, b) => a - b);
    const lo = Math.floor((sorted.length - 1) * 0.25);
    const hi = Math.floor((sorted.length - 1) * 0.75);
    const iqr = sorted[hi] - sorted[lo];
    const low = sorted[lo] - 1.5 * iqr;
    const high = sorted[hi] + 1.5 * iqr;
    const filt = reductions.filter((x) => x >= low && x <= high);
    if (filt.length > 0) {
      filt.sort((a, b) => a - b);
      return medianOfSorted(filt);
    }
  }
  reductions.sort((a, b) => a - b);
  return medianOfSorted(reductions);
}

/**
 * Reconciled monthly debt-payment estimate — same logic as the goals list
 * payoff planner. Takes the median of the balance-history derived pace and
 * the transaction-based pace so neither dominates on its own.
 */
function typicalMonthlyDebtPaymentEstimate(
  history: { debtTotal: number }[],
  txnTypicalMedian: number,
): number | null {
  const fromBalances = medianDebtReductionFromHistory(history);
  const parts = [
    fromBalances != null && fromBalances > 0 ? fromBalances : null,
    txnTypicalMedian > 0 ? txnTypicalMedian : null,
  ].filter((x): x is number => x != null);
  if (parts.length === 0) return null;
  parts.sort((a, b) => a - b);
  return medianOfSorted(parts);
}

/** Same liability rows as liabilities page + financialProfile debt bucket (incl. LOC, negative-bal accounts). */
const PROFILE_DEBT_ACCOUNT_TYPES = new Set(["credit", "mortgage", "loan", "line_of_credit"]);

function isConsolidatedLiabilitySnapshot(s: AccountSnapshot): boolean {
  return PROFILE_DEBT_ACCOUNT_TYPES.has(s.accountType ?? "") || s.balance < 0;
}

/** Mirrors getNetWorth() snapshot debt — converted to home currency when FX is present. */
function snapshotDebtInHome(s: AccountSnapshot, home: string, fxRates: Record<string, number>): number {
  const raw = s.parsedDebts != null ? s.parsedDebts : Math.max(0, -s.balance);
  if (raw <= 0) return 0;
  const cur = (s.currency ?? home).toUpperCase();
  const h = home.toUpperCase();
  if (cur === h) return raw;
  const rate = fxRates[cur];
  return rate != null ? raw * rate : raw;
}

/** Build avalanche-style sim debts from snapshots + rates (aligned with payoff planner defaults). */
function buildSimDebtsFromSnaps(
  liabilitySnaps: LiabilitySnap[],
  debtRates: AccountRateEntry[],
  homeCurrency: string,
  fxRates: Record<string, number>,
): SimDebt[] {
  return liabilitySnaps.map((s) => {
    const rateEntry = debtRates.find(
      (r) => r.accountName === s.accountName || r.bankName === s.bankName,
    );
    const debtApr = rateEntry?.effectiveRate ?? APR_DEFAULTS[s.accountType] ?? 8;
    const bal = snapshotDebtInHome(s, homeCurrency, fxRates);
    const revolving = s.accountType === "credit" || s.accountType === "line_of_credit";
    return {
      id: s.slug,
      label: s.accountName ?? s.bankName ?? s.slug,
      balance: bal,
      apr: debtApr,
      minPayment: estimateMinPaymentForType(bal, debtApr, s.accountType),
      isCredit: revolving,
    };
  });
}

/**
 * Months until all simulated debts cleared at reconciled pace, or null if unreachable in 600 months.
 */
function projectedDebtFreeMonthsForSnaps(params: {
  liabilitySnaps: LiabilitySnap[];
  debtRates: AccountRateEntry[];
  sortedDebtHistory: { debtTotal: number }[];
  typicalDebtPayments: number;
  todayYM: string;
  homeCurrency: string;
  fxRates: Record<string, number>;
}): { monthsToFree: number | null; payoffYM: string | null } {
  const {
    liabilitySnaps,
    debtRates,
    sortedDebtHistory,
    typicalDebtPayments,
    todayYM,
    homeCurrency,
    fxRates,
  } = params;
  if (liabilitySnaps.length === 0) return { monthsToFree: null, payoffYM: null };

  const simDebts = buildSimDebtsFromSnaps(liabilitySnaps, debtRates, homeCurrency, fxRates);
  const totalMinPayments = simDebts.reduce((s, d) => s + d.minPayment, 0);
  const currentPace = typicalMonthlyDebtPaymentEstimate(sortedDebtHistory, typicalDebtPayments);
  const extraAboveMin = currentPace != null ? Math.max(0, currentPace - totalMinPayments) : 0;

  const sim = simulateDebts(simDebts, extraAboveMin);
  if (sim.totalMonths >= 600) return { monthsToFree: null, payoffYM: null };
  return {
    monthsToFree: sim.totalMonths,
    payoffYM: addMonthsToYM(todayYM, sim.totalMonths),
  };
}

function fmtShort(v: number, hc: string): string {
  const sym = getCurrencySymbol(hc);
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${sym}${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sym}${Math.round(abs / 1_000)}k`;
  return fmt(Math.abs(v), hc);
}

// ── milestone helpers (wireframe-style timeline + behind / pacing states) ───

/** Dot + connector styling keyed to milestone kind */
type MilestoneVisual = "check" | "warning" | "here" | "future" | "goal";

type Milestone = {
  key: string;
  visual: MilestoneVisual;
  label: string;
  sublabel: string;
  dateLabel: string;
  distLabel: string;
};

function buildMilestones(
  history: HistoryPoint[],
  _startingDebt: number,
  currentDebt: number,
  currentPace: number | null,
  targetDateYM: string | null,
  _liabilitySnaps: LiabilitySnap[],
  hc: string,
): Milestone[] {
  const sorted = [...history]
    .filter((h) => h.yearMonth && h.debtTotal >= 0)
    .sort((a, b) => a.yearMonth.localeCompare(b.yearMonth));

  const today = currentYM();
  const milestones: Milestone[] = [];

  if (sorted.length === 0) return milestones;

  const startPoint = sorted[0];
  const startBal = startPoint.debtTotal;
  if (startBal <= 0) return milestones;

  const anchor = startBal;

  milestones.push({
    key: "start",
    visual: "check",
    label: "Started tracking",
    sublabel: `${fmt(startBal, hc)} owed`,
    dateLabel: fmtYM(startPoint.yearMonth),
    distLabel: monthsAgoLabel(startPoint.yearMonth),
  });

  /** Same logic as timeline: owing more than the first tracked month-end. */
  if (currentDebt > startBal + 1) {
    milestones.push({
      key: "behind",
      visual: "warning",
      label: "Past starting balance",
      sublabel: `Currently ${fmt(currentDebt - startBal, hc)} above where you began`,
      dateLabel: "Today",
      distLabel: "",
    });
  }

  milestones.push({
    key: "here",
    visual: "here",
    label: "You are here",
    sublabel: `${fmt(currentDebt, hc)} owed`,
    dateLabel: fmtYM(today),
    distLabel: "",
  });

  const tiers = [
    { key: "q1", label: "First quarter paid off", remainingRatio: 0.75 },
    { key: "half", label: "Halfway", remainingRatio: 0.5 },
    { key: "q3", label: "Three-quarters paid off", remainingRatio: 0.25 },
  ] as const;

  const eps = 1;
  const pace = currentPace != null && currentPace > 0 ? currentPace : null;

  for (const tier of tiers) {
    const targetBal = Math.max(0, anchor * tier.remainingRatio);
    const attained = currentDebt <= targetBal + eps;
    const hitHist = attained
      ? sorted.find((h) => h.debtTotal <= targetBal + eps)
      : undefined;

    if (attained) {
      const ymReach = hitHist?.yearMonth ?? today;
      milestones.push({
        key: tier.key,
        visual: "check",
        label: tier.label,
        sublabel: `${fmt(targetBal, hc)} owed`,
        dateLabel: fmtYM(ymReach),
        distLabel: monthsAgoLabel(ymReach),
      });
    } else if (pace != null && currentDebt - targetBal > eps) {
      const moNeed = Math.ceil((currentDebt - targetBal) / pace);
      const ymProj = addMonthsToYM(today, moNeed);
      milestones.push({
        key: tier.key,
        visual: "future",
        label: tier.label,
        sublabel: `${fmt(targetBal, hc)} owed`,
        dateLabel: fmtYM(ymProj),
        distLabel: monthsAway(ymProj),
      });
    } else {
      milestones.push({
        key: tier.key,
        visual: "future",
        label: tier.label,
        sublabel: `${fmt(targetBal, hc)} owed`,
        dateLabel: "—",
        distLabel: "awaiting paydown pace",
      });
    }
  }

  // Debt-free (goal marker)
  if (currentDebt <= eps) {
    milestones.push({
      key: "debtfree",
      visual: "check",
      label: "Debt-free",
      sublabel: "Zero balance",
      dateLabel: fmtYM(today),
      distLabel: "",
    });
  } else if (targetDateYM) {
    milestones.push({
      key: "debtfree-goal",
      visual: "goal",
      label: "Debt-free",
      sublabel: "Target date",
      dateLabel: fmtYM(targetDateYM),
      distLabel:
        targetDateYM > today
          ? monthsAway(targetDateYM)
          : targetDateYM === today
            ? "now"
            : monthsAgoLabel(targetDateYM),
    });
  } else if (pace != null) {
    const moFree = Math.ceil(currentDebt / pace);
    const ymFree = addMonthsToYM(today, moFree);
    milestones.push({
      key: "debtfree-proj",
      visual: "goal",
      label: "Debt-free",
      sublabel: "At recent paydown pace",
      dateLabel: fmtYM(ymFree),
      distLabel: monthsAway(ymFree),
    });
  } else {
    milestones.push({
      key: "debtfree-unknown",
      visual: "goal",
      label: "Debt-free",
      sublabel: "Set a payoff target to lock a date here",
      dateLabel: "—",
      distLabel: "awaiting paydown pace",
    });
  }

  return milestones;
}

// ── SVG chart ─────────────────────────────────────────────────────────────────

const CHART_W = 800;
const CHART_H = 260;
const PAD = { top: 24, right: 70, bottom: 36, left: 64 };
const CW = CHART_W - PAD.left - PAD.right;
const CH = CHART_H - PAD.top - PAD.bottom;

function DebtPayoffChart({
  history,
  yAxisDebtMax,
  targetDateYM,
  projectionRemainingMonthly,
  projPayoffMs,
  homeCurrency,
}: {
  history: HistoryPoint[];
  /** Ceiling for Y-axis scale — max outstanding debt on the chart window */
  yAxisDebtMax: number;
  targetDateYM: string | null;
  /** Index 0 = today total remaining (matches currentDebt); each step = planner simulation */
  projectionRemainingMonthly: number[];
  projPayoffMs: number | null;
  homeCurrency: string;
}) {
  const sorted = [...history]
    .filter((h) => h.yearMonth && h.debtTotal >= 0)
    .sort((a, b) => a.yearMonth.localeCompare(b.yearMonth));

  const denom = Math.max(1e-9, yAxisDebtMax);
  const debtAtTimelineStart = sorted[0]?.debtTotal ?? 0;

  if (sorted.length === 0 || debtAtTimelineStart <= 0) return null;

  const chartStartYM = sorted[0].yearMonth;
  const todayYM = currentYM();

  // Cap projected line at 20 years to avoid a runaway chart
  const projEndYM = projPayoffMs != null
    ? addMonthsToYM(todayYM, Math.min(projPayoffMs, 240))
    : addMonthsToYM(todayYM, 36);
  const chartEndYM = [targetDateYM, projEndYM, addMonthsToYM(todayYM, 6)]
    .filter(Boolean)
    .reduce((a, b) => (a! > b! ? a : b), chartStartYM)!;

  const totalMs = Math.max(1, monthsBetween(chartStartYM, chartEndYM));

  function xFor(ym: string): number {
    return PAD.left + (monthsBetween(chartStartYM, ym) / totalMs) * CW;
  }
  /** Y from total owed (same framing as Debts › Debt Growth: high debt toward top). */
  function yForOwed(owed: number): number {
    const v = Math.max(0, owed);
    return PAD.top + CH - Math.min(1, v / denom) * CH;
  }

  // Historical path — carries same month-end totals as Liabilities rollup
  const histPts = sorted.map((h) => ({
    x: xFor(h.yearMonth),
    y: yForOwed(h.debtTotal),
  }));
  const histPath = histPts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");

  // Straight-line payoff needed to reach $0 by target (vs first month on timeline)
  const reqLine = targetDateYM && targetDateYM > chartStartYM ? {
    x1: xFor(chartStartYM), y1: yForOwed(debtAtTimelineStart),
    x2: xFor(targetDateYM), y2: yForOwed(0),
  } : null;

  // Projected remaining balance from payoff planner simulation
  const projPts: { x: number; y: number }[] = [];
  if (projectionRemainingMonthly.length >= 2) {
    for (let i = 0; i < projectionRemainingMonthly.length; i++) {
      const ym = addMonthsToYM(todayYM, i);
      if (ym > chartEndYM) break;
      const rem = projectionRemainingMonthly[i] ?? 0;
      projPts.push({ x: xFor(ym), y: yForOwed(rem) });
    }
  }
  const projPath = projPts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");

  // Today x
  const todayX = xFor(todayYM);

  // X axis tick labels (every year)
  const startYear = parseInt(chartStartYM.slice(0, 4));
  const endYear   = parseInt(chartEndYM.slice(0, 4));
  const xTicks: { ym: string; label: string }[] = [];
  for (let yr = startYear; yr <= endYear + 1; yr++) {
    const ym = `${yr}-01`;
    if (ym >= chartStartYM && ym <= chartEndYM) {
      xTicks.push({ ym, label: String(yr) });
    }
  }

  // Y axis tick labels
  const sym = getCurrencySymbol(homeCurrency);
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((frac) => ({
    value: frac * denom,
    y: PAD.top + CH - frac * CH,
    label: frac === 0 ? `${sym}0` : fmtShort(frac * denom, homeCurrency),
  }));

  const targetCircle = targetDateYM ? {
    x: xFor(targetDateYM),
    y: yForOwed(0),
  } : null;

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 sm:p-5 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between mb-4">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-gray-500">
          What you owe over time
        </p>
        <Link
          href="/account/liabilities"
          className="text-xs font-medium text-purple-600 hover:text-purple-800 hover:underline shrink-0"
        >
          How this is calculated →
        </Link>
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-2 mb-1">
        <span className="flex items-center gap-2 text-[12px] text-gray-600">
          <span className="inline-block w-8 border-t-[2.5px] border-gray-900" aria-hidden />
          So far
        </span>
        <span className="flex items-center gap-2 text-[12px] text-gray-600">
          <span className="inline-block w-8 border-t-2 border-dashed border-gray-400" aria-hidden />
          Target line
        </span>
        <span className="flex items-center gap-2 text-[12px] text-gray-600">
          <span className="inline-block w-8 border-t-2 border-dashed border-emerald-500" aria-hidden />
          If patterns hold
        </span>
      </div>
      <svg
        viewBox={`0 0 ${CHART_W} ${CHART_H}`}
        className="w-full"
        style={{ height: "auto", maxHeight: 280 }}
        aria-label="What you owe over time"
      >
        {/* Grid lines */}
        {yTicks.map((t) => (
          <line key={t.value} x1={PAD.left} y1={t.y} x2={PAD.left + CW} y2={t.y}
            stroke="#e5e7eb" strokeWidth={1} />
        ))}

        {/* Y axis labels */}
        {yTicks.map((t) => (
          <text key={t.value} x={PAD.left - 6} y={t.y + 4}
            textAnchor="end" fontSize={11} fill="#9ca3af">{t.label}</text>
        ))}

        {/* X axis labels */}
        {xTicks.map((t) => (
          <text key={t.ym} x={xFor(t.ym)} y={CHART_H - 6}
            textAnchor="middle" fontSize={11} fill="#9ca3af">{t.label}</text>
        ))}

        {/* Target line (straight path to debt-free by target month) */}
        {reqLine && (
          <line x1={reqLine.x1} y1={reqLine.y1} x2={reqLine.x2} y2={reqLine.y2}
            stroke="#d1d5db" strokeWidth={2} strokeDasharray="7 5" />
        )}

        {/* If patterns hold */}
        {projPath && (
          <path d={projPath} fill="none" stroke="#10b981" strokeWidth={2}
            strokeDasharray="7 5" strokeLinecap="round" />
        )}

        {/* So far (history) */}
        {histPath && (
          <path d={histPath} fill="none" stroke="#111827" strokeWidth={2.5}
            strokeLinecap="round" strokeLinejoin="round" />
        )}

        {/* Today */}
        <line x1={todayX} y1={PAD.top} x2={todayX} y2={PAD.top + CH}
          stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="5 4" />
        <text x={todayX} y={PAD.top - 6} textAnchor="middle" fontSize={10}
          fill="#64748b" fontWeight="600">TODAY</text>

        {projPts.length > 0 && (
          <circle cx={projPts[0].x} cy={projPts[0].y} r={5}
            fill="white" stroke="#111827" strokeWidth={2} />
        )}

        {targetCircle && (
          <>
            <circle cx={targetCircle.x} cy={targetCircle.y} r={5}
              fill="white" stroke="#d1d5db" strokeWidth={2} />
            <text x={targetCircle.x + 8} y={targetCircle.y + 3}
              fontSize={10} fill="#9ca3af">0</text>
          </>
        )}
      </svg>
    </div>
  );
}

// ── main page ─────────────────────────────────────────────────────────────────

export default function GoalDetailPage() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const isAutoDebt = id === "auto-debt";
  const isAutoEf   = id === "auto-ef";
  const isAutoNw   = id === "auto-nw";

  // ── auth / data state ──────────────────────────────────────────────────────
  const [authToken, setAuthToken]       = useState<string | null>(null);
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState<string | null>(null);

  // ── financial data ─────────────────────────────────────────────────────────
  const [history, setHistory]           = useState<HistoryPoint[]>([]);
  const [consolidatedTotalDebts, setConsolidatedTotalDebts] = useState(0);
  const [snapshots, setSnapshots]       = useState<AccountSnapshot[]>([]);
  const [fxRatesState, setFxRatesState] = useState<Record<string, number>>({});
  const [accountBalanceHistory, setAccountBalanceHistory] = useState<AccountBalanceHistory[]>([]);
  const [rates, setRates]               = useState<AccountRateEntry[]>([]);
  const [homeCurrency, setHomeCurrency] = useState(HOME_CURRENCY);
  const [typicalDebtPay, setTypicalDebtPay] = useState(0);
  // Extra financial data for savings/EF/NW goal pages
  const [netWorthState, setNetWorthState]           = useState(0);
  const [monthlyExpensesState, setMonthlyExpensesState] = useState(0);
  const [monthlySavingsState, setMonthlySavingsState]   = useState(0);

  // ── goal config ────────────────────────────────────────────────────────────
  const [goalConfig, setGoalConfig]     = useState<GoalConfig | null>(null);
  const [savingConfig, setSavingConfig] = useState(false);

  // ── non-debt (savings / EF / NW) goal ──────────────────────────────────────
  type NonDebtGoal = {
    id: string; goalType: string; title: string; emoji?: string;
    targetAmount?: number | null; targetDate?: string | null;
    linkedAccountSlugs?: string[] | null; description?: string;
  };
  const [nonDebtGoal, setNonDebtGoal] = useState<NonDebtGoal | null>(null);

  // ── edit modal ─────────────────────────────────────────────────────────────
  const [showEdit, setShowEdit]         = useState(false);
  const [editTitle, setEditTitle]       = useState("");
  const [editTargetDate, setEditTargetDate] = useState("");

  const routeKey = isAutoDebt ? "auto-debt" : id;

  /** One automatic baseline seal per navigation; target date is never reassigned by projections */
  const baselineSealSessionRef = useRef(false);

  useEffect(() => {
    baselineSealSessionRef.current = false;
  }, [routeKey]);

  // ── load data ──────────────────────────────────────────────────────────────
  const loadData = useCallback(async (user: { getIdToken: () => Promise<string> }) => {
    setLoading(true);
    setError(null);
    try {
      const token = await user.getIdToken();
      setAuthToken(token);
      const headers = { Authorization: `Bearer ${token}` };

      const [consRes, ratesRes, goalsRes] = await Promise.all([
        fetch("/api/user/statements/consolidated", { headers }),
        fetch("/api/user/account-rates", { headers }),
        fetch("/api/user/goals", { headers }),
      ]);

      if (consRes.ok) {
        const j = await consRes.json();
        setHistory(Array.isArray(j.history) ? j.history : []);
        setConsolidatedTotalDebts(typeof j.data?.debts === "number" ? j.data.debts : 0);
        setSnapshots(Array.isArray(j.accountSnapshots) ? j.accountSnapshots : []);
        setFxRatesState(
          j.fxRates && typeof j.fxRates === "object" ? (j.fxRates as Record<string, number>) : {},
        );
        setAccountBalanceHistory(
          Array.isArray(j.accountBalanceHistory) ? j.accountBalanceHistory : [],
        );
        setHomeCurrency(j.homeCurrency || HOME_CURRENCY);
        setTypicalDebtPay(j.typicalMonthlyDebtPayments ?? 0);
        setNetWorthState(j.data?.netWorth ?? 0);
        setMonthlyExpensesState(j.data?.monthlyExpenses ?? 0);
        setMonthlySavingsState(j.data?.monthlySavings ?? 0);
      }
      if (ratesRes.ok) {
        const j = await ratesRes.json();
        setRates(j.rates ?? []);
      }
      if (goalsRes.ok) {
        const j = await goalsRes.json();
        const goals: Array<{ id: string; goalType?: string; title?: string; targetDate?: string | null; linkedLiabilitySlugs?: string[] | null; isAutoDebtGoal?: boolean }> =
          Array.isArray(j.goals) ? j.goals : [];

        if (isAutoDebt) {
          const cfg = goals.find((g) => g.isAutoDebtGoal === true);
          if (cfg) {
            setGoalConfig({
              id: cfg.id,
              title: cfg.title ?? "Pay off debt",
              targetDate: normalizeMonthYM(cfg.targetDate),
              linkedLiabilitySlugs: cfg.linkedLiabilitySlugs,
              isAutoDebtGoal: true,
            });
          } else {
            setGoalConfig(null);
          }
        } else if (isAutoEf) {
          setNonDebtGoal({ id: "auto-ef", goalType: "emergency_fund", title: "Emergency fund", emoji: "🛡️" });
        } else if (isAutoNw) {
          setNonDebtGoal({ id: "auto-nw", goalType: "net_worth", title: "Net worth", emoji: "📈" });
        } else {
          const g = goals.find((g) => g.id === id);
          if (!g) { setError("Goal not found"); setLoading(false); return; }
          if (g.goalType !== "debt_payoff") {
            setNonDebtGoal({
              id: g.id,
              goalType: g.goalType ?? "savings",
              title: g.title ?? "Goal",
              emoji: (g as { emoji?: string }).emoji,
              targetAmount: (g as { targetAmount?: number | null }).targetAmount,
              targetDate: g.targetDate,
              linkedAccountSlugs: (g as { linkedAccountSlugs?: string[] | null }).linkedAccountSlugs,
              description: (g as { description?: string }).description,
            });
          } else {
            setGoalConfig({
              id: g.id,
              title: g.title ?? "Pay off debt",
              targetDate: normalizeMonthYM(g.targetDate),
              linkedLiabilitySlugs: g.linkedLiabilitySlugs,
            });
          }
        }
      }
    } catch {
      setError("Failed to load goal data");
    } finally {
      setLoading(false);
    }
  }, [id, isAutoDebt, isAutoEf, isAutoNw, router]);

  useEffect(() => {
    const { auth } = getFirebaseClient();
    return onAuthStateChanged(auth, (user) => {
      if (!user) { router.push("/login"); return; }
      loadData(user);
    });
  }, [router, loadData]);

  /**
   * One-time baseline: persist `targetDate` from payoff-planner projection when missing.
   * Future debt changes only move projected dates — baseline stays until user edits.
   */
  useEffect(() => {
    async function sealBaselineFromProjection() {
      if (loading || !authToken || error) return;
      if (!isAutoDebt && !goalConfig?.id) return;
      if (normalizeMonthYM(goalConfig?.targetDate)) return;
      if (baselineSealSessionRef.current) return;

      const today = currentYM();
      const allLiabSnaps = snapshots.filter(isConsolidatedLiabilitySnapshot) as LiabilitySnap[];

      const linked = goalConfig?.linkedLiabilitySlugs;
      if (Array.isArray(linked) && linked.length === 0) return;

      const trackedSeal = Array.isArray(linked) && linked.length > 0
        ? allLiabSnaps.filter((s) => linked.includes(s.slug))
        : allLiabSnaps;

      const hcSeal = homeCurrency;
      const debtSeal = trackedSeal.reduce((s, a) => s + snapshotDebtInHome(a, hcSeal, fxRatesState), 0);
      if (trackedSeal.length === 0 || debtSeal <= 0) return;

      const slugFilterSeal =
        Array.isArray(linked) && linked.length > 0 ? new Set(linked) : null;
      const reconstructedSeal = monthlyDebtTotalsFromBalanceHistory(
        accountBalanceHistory,
        fxRatesState,
        hcSeal,
        slugFilterSeal,
      );
      const sortedSeal = (
        reconstructedSeal.length > 0
          ? reconstructedSeal
          : [...history].filter((h) => h.debtTotal > 0 && h.yearMonth)
      )
        .sort((a, b) => a.yearMonth.localeCompare(b.yearMonth));

      const { payoffYM } = projectedDebtFreeMonthsForSnaps({
        liabilitySnaps: trackedSeal,
        debtRates: rates,
        sortedDebtHistory: sortedSeal,
        typicalDebtPayments: typicalDebtPay,
        todayYM: today,
        homeCurrency: hcSeal,
        fxRates: fxRatesState,
      });
      const sealYM = payoffYM ?? defaultTargetDate();

      baselineSealSessionRef.current = true;
      try {
        if (goalConfig?.id) {
          const res = await fetch(`/api/user/goals/${goalConfig.id}`, {
            method: "PUT",
            headers: { Authorization: `Bearer ${authToken}`, "Content-Type": "application/json" },
            body: JSON.stringify({ targetDate: sealYM }),
          });
          if (res.ok) {
            setGoalConfig((prev) => prev ? { ...prev, targetDate: sealYM } : prev);
          } else {
            baselineSealSessionRef.current = false;
          }
        } else if (isAutoDebt) {
          const res = await fetch("/api/user/goals", {
            method: "POST",
            headers: { Authorization: `Bearer ${authToken}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              title: "Pay off debt",
              goalType: "debt_payoff",
              emoji: "💳",
              targetDate: sealYM,
              isAutoDebtGoal: true,
            }),
          });
          const j = (await res.json()) as {
            id?: string;
            title?: string;
            targetDate?: string | null;
            linkedLiabilitySlugs?: string[] | null;
          };
          if (res.ok && j.id) {
            setGoalConfig({
              id: j.id,
              title: j.title ?? "Pay off debt",
              targetDate: sealYM,
              linkedLiabilitySlugs: j.linkedLiabilitySlugs ?? null,
              isAutoDebtGoal: true,
            });
          } else {
            baselineSealSessionRef.current = false;
          }
        }
      } catch {
        baselineSealSessionRef.current = false;
      }
    }
    void sealBaselineFromProjection();
  }, [
    loading,
    authToken,
    error,
    isAutoDebt,
    snapshots,
    rates,
    typicalDebtPay,
    history,
    goalConfig?.id,
    goalConfig?.targetDate,
    goalConfig?.linkedLiabilitySlugs,
    homeCurrency,
    fxRatesState,
    accountBalanceHistory,
  ]);

  // ── save goal config ───────────────────────────────────────────────────────
  async function saveGoalConfig() {
    if (!authToken) return;
    setSavingConfig(true);
    try {
      const rawMonth = editTargetDate.trim();
      const payload = {
        title: editTitle.trim() || "Pay off debt",
        goalType: "debt_payoff",
        emoji: "💳",
        targetDate: normalizeMonthYM(rawMonth) ?? (rawMonth === "" ? null : rawMonth),
        isAutoDebtGoal: isAutoDebt,
      };

      if (goalConfig?.id) {
        await fetch(`/api/user/goals/${goalConfig.id}`, {
          method: "PUT",
          headers: { Authorization: `Bearer ${authToken}`, "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        setGoalConfig((prev) => prev ? {
          ...prev,
          title: payload.title,
          targetDate: normalizeMonthYM(payload.targetDate),
        } : prev);
      } else {
        const res = await fetch("/api/user/goals", {
          method: "POST",
          headers: { Authorization: `Bearer ${authToken}`, "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const j = await res.json();
        if (res.ok && j.id) {
          setGoalConfig({
            id: j.id,
            title: payload.title,
            targetDate: normalizeMonthYM((j as { targetDate?: unknown }).targetDate ?? payload.targetDate),
            isAutoDebtGoal: isAutoDebt,
          });
        }
      }
      setShowEdit(false);
    } finally {
      setSavingConfig(false);
    }
  }

  if (loading) return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <div className="h-10 w-10 animate-spin rounded-full border-4 border-purple-600 border-t-transparent" />
    </div>
  );
  if (error) return (
    <div className="mx-auto max-w-2xl px-4 pt-8">
      <p className="text-red-600">{error}</p>
      <Link href="/account/goals" className="mt-4 inline-block text-sm text-purple-600 hover:underline">← Back to goals</Link>
    </div>
  );

  // ── derived values ─────────────────────────────────────────────────────────
  const hc = homeCurrency;
  const liabilitySnaps = snapshots.filter(isConsolidatedLiabilitySnapshot) as LiabilitySnap[];

  const linkedSlugs = goalConfig?.linkedLiabilitySlugs;
  const hasLinkedLiabilities = Array.isArray(linkedSlugs) && linkedSlugs.length > 0;

  const trackedSnaps = hasLinkedLiabilities
    ? liabilitySnaps.filter((s) => linkedSlugs!.includes(s.slug))
    : liabilitySnaps;

  /** Matches Total Debt on Today — `data.debts` from consolidated (profile monthlyHistory). Subset goals sum linked accounts in home currency. */
  const currentDebt = hasLinkedLiabilities
    ? trackedSnaps.reduce((sum, s) => sum + snapshotDebtInHome(s, hc, fxRatesState), 0)
    : consolidatedTotalDebts;

  /** Liabilities-page pipeline: rollup from balance history (+optional slug subset), fallback to consolidated chart history. */
  const slugFilterForDebtHistory =
    hasLinkedLiabilities && linkedSlugs!.length > 0 ? new Set(linkedSlugs!) : null;
  const debtHistoryPrimary = monthlyDebtTotalsFromBalanceHistory(
    accountBalanceHistory,
    fxRatesState,
    hc,
    slugFilterForDebtHistory,
  );
  const fallbackHistoryPts: HistoryPoint[] = [...history]
    .filter((h) => h.debtTotal > 0 && h.yearMonth)
    .map((h) => ({ yearMonth: h.yearMonth, debtTotal: h.debtTotal }));

  const sortedHistory = [...(debtHistoryPrimary.length > 0 ? debtHistoryPrimary : fallbackHistoryPts)]
    .sort((a, b) => a.yearMonth.localeCompare(b.yearMonth));

  /** First chronological month owed on this timeline (same rollup as Debts › Debt Growth). */
  const startingTrackedDebt =
    sortedHistory.length > 0 ? sortedHistory[0].debtTotal : currentDebt;

  // Same reconciled estimate the payoff planner uses: median of balance-history
  // drops AND transaction-based payments, so a one-off import spike doesn't
  // inflate the pace and project an unrealistically early payoff date.
  const currentPace = typicalMonthlyDebtPaymentEstimate(sortedHistory, typicalDebtPay);

  const savedTargetYM = normalizeMonthYM(goalConfig?.targetDate ?? null);
  const today = currentYM();

  // Build per-debt simulation objects (mirrors liabilities page)
  const simDebts: SimDebt[] = buildSimDebtsFromSnaps(trackedSnaps, rates, hc, fxRatesState);

  const totalMinPayments = simDebts.reduce((s, d) => s + d.minPayment, 0);

  // Extra above minimums that the user typically pays (reconciled current pace)
  const extraAboveMin = currentPace != null ? Math.max(0, currentPace - totalMinPayments) : 0;

  // Projected payoff at current pace
  const simAtCurrentPace = simulateDebts(simDebts, extraAboveMin);
  const projPayoffMs = simAtCurrentPace.totalMonths < 600 ? simAtCurrentPace.totalMonths : null;
  const projPayoffYM = projPayoffMs != null ? addMonthsToYM(today, projPayoffMs) : null;

  /** Header + pace: saved month, else planner month, else same default as Edit goal (5 yr). Seal persists when empty. */
  const effectiveTargetYM =
    savedTargetYM ??
    (currentDebt > 0 ? (projPayoffYM ?? defaultTargetDate()) : null);
  const monthsToTarget = effectiveTargetYM ? Math.max(1, monthsBetween(today, effectiveTargetYM)) : null;

  const projChartHorizon = projPayoffMs != null ? Math.min(projPayoffMs, 240) : 240;
  const projectionRemainingMonthly =
    simDebts.length > 0
      ? simulateDebtsTotalRemainingMonthly(simDebts, extraAboveMin, projChartHorizon)
      : [];

  /** Scale Y by peak owed on chart (balances only). */
  const historicalPeakOwed =
    sortedHistory.length === 0
      ? 0
      : Math.max(...sortedHistory.map((h) => h.debtTotal));
  const projectedPeakOwed =
    projectionRemainingMonthly.length === 0
      ? 0
      : Math.max(...projectionRemainingMonthly);
  const chartYAxisDebtMax = Math.max(
    startingTrackedDebt,
    currentDebt,
    historicalPeakOwed,
    projectedPeakOwed,
    1,
  );

  // Required monthly to hit target: binary search for extra that gives totalMonths <= monthsToTarget
  const requiredExtra = (() => {
    if (!monthsToTarget || simDebts.length === 0) return null;
    if (simAtCurrentPace.totalMonths <= monthsToTarget) return 0;
    let lo = 0, hi = currentDebt;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      const ms = simulateDebts(simDebts, extraAboveMin + mid).totalMonths;
      if (ms <= monthsToTarget) hi = mid; else lo = mid;
    }
    return Math.ceil(hi);
  })();
  const requiredMonthly = requiredExtra != null ? totalMinPayments + extraAboveMin + requiredExtra : null;

  const effectivePace = currentPace ?? totalMinPayments;

  const paceRatio = requiredMonthly && requiredMonthly > 0 ? effectivePace / requiredMonthly : null;
  const paceStatus: "ahead" | "on_pace" | "behind" | "way_behind" | "unknown" =
    paceRatio == null ? "unknown" :
    paceRatio >= 1.02 ? "ahead" :
    paceRatio >= 0.97 ? "on_pace" :
    paceRatio >= 0.80 ? "behind" : "way_behind";
  const pctOffPace = paceRatio != null ? Math.round(Math.abs(1 - paceRatio) * 100) : null;

  const pageTitle = goalConfig?.title ?? "Pay off debt";

  function openEdit() {
    setEditTitle(goalConfig?.title ?? "Debt-free");
    const prefill = savedTargetYM ?? effectiveTargetYM ?? defaultTargetDate();
    setEditTargetDate(prefill);
    setShowEdit(true);
  }

  const milestones = buildMilestones(
    sortedHistory, startingTrackedDebt, currentDebt, currentPace ?? null,
    effectiveTargetYM, trackedSnaps, hc,
  );

  const paceCardAccent = paceStatus === "ahead" ? {
    bg: "bg-emerald-50", border: "border-emerald-100", titleColor: "text-emerald-700", msgColor: "text-emerald-700",
  } : paceStatus === "on_pace" ? {
    bg: "bg-emerald-50", border: "border-emerald-100", titleColor: "text-emerald-700", msgColor: "text-emerald-700",
  } : {
    bg: "bg-amber-50", border: "border-amber-100", titleColor: "text-amber-700", msgColor: "text-amber-700",
  };

  const paceTitle =
    paceStatus === "ahead"   ? "Ahead of pace." :
    paceStatus === "on_pace" ? "Right on pace." :
    paceStatus === "behind"  ? "Slightly behind pace." :
    paceStatus === "way_behind" ? "Behind pace." : "On track.";

  const paceDescription = (() => {
    if (!requiredMonthly || !currentPace) return null;
    const req = fmt(requiredMonthly, hc);
    const cur = fmt(currentPace, hc);
    const targetLabel = effectiveTargetYM ? fmtYM(effectiveTargetYM) : "your target";
    if (paceStatus === "ahead" || paceStatus === "on_pace") {
      return `To hit ${targetLabel}, you need about ${req}/mo toward balances on average. You've averaged ${cur} over the last 6 months — great pace!`;
    }
    return `To hit ${targetLabel}, you need about ${req}/mo toward balances on average. You've averaged ${cur} over the last 6 months — about ${pctOffPace}% below that pace.`;
  })();

  const behindBadge = effectiveTargetYM && (paceStatus === "behind" || paceStatus === "way_behind")
    ? (() => {
        const diff = projPayoffYM ? monthsBetween(effectiveTargetYM, projPayoffYM) : 0;
        return diff > 0 ? `${diff} MONTH${diff > 1 ? "S" : ""} BEHIND` : null;
      })()
    : null;

  const deltaVsStart = currentDebt - startingTrackedDebt;
  const trendLabel =
    sortedHistory.length === 0 || Math.abs(deltaVsStart) < 1
      ? null
      : deltaVsStart > 0
        ? { text: `↑ up ${fmtShort(Math.abs(deltaVsStart), hc)}`, warn: true }
        : { text: `↓ down ${fmtShort(Math.abs(deltaVsStart), hc)}`, warn: false };

  /** Positive = projected payoff later than goal month (behind). */
  const monthsVsTarget =
    effectiveTargetYM && projPayoffYM ? monthsBetween(effectiveTargetYM, projPayoffYM) : null;

  const targetVsProjLabel =
    monthsVsTarget === null ? null :
    monthsVsTarget === 0 ? { text: "On target", warn: false as const } :
    monthsVsTarget > 0
      ? { text: `${monthsVsTarget} mo behind target`, warn: true as const }
      : { text: `${Math.abs(monthsVsTarget)} mo ahead of target`, warn: false as const };

  // ── Savings / EF / NW detail render ──────────────────────────────────────
  if (nonDebtGoal) {
    const hcLocal = homeCurrency;
    const EF_MONTHS_TARGET = 6;
    const FI_MULT = 25;

    // Savings goal: linked accounts
    const savingAccounts = snapshots.filter(
      (s) => s.accountType === "savings" || s.accountType === "checking",
    );
    const linkedSlugs: string[] | null = nonDebtGoal.linkedAccountSlugs ?? null;
    const activeSavingsAccounts = linkedSlugs === null
      ? savingAccounts.filter((s) => s.balance > 0)
      : savingAccounts.filter((s) => linkedSlugs.includes(s.slug));
    const selectedBalance = activeSavingsAccounts.reduce((sum, s) => sum + Math.max(0, s.balance), 0);

    // EF values
    const efTarget    = monthlyExpensesState > 0 ? monthlyExpensesState * EF_MONTHS_TARGET : 0;
    const efPct       = efTarget > 0 ? Math.min(100, Math.round((selectedBalance / efTarget) * 100)) : 0;
    const efRunway    = monthlyExpensesState > 0 ? (selectedBalance / monthlyExpensesState) : 0;

    // NW values
    const annualExp   = monthlyExpensesState * 12;
    const fiTarget    = annualExp > 0 ? FI_MULT * annualExp : 0;
    const fiProgress  = fiTarget > 0 ? Math.min(100, Math.round((Math.max(0, netWorthState) / fiTarget) * 100)) : 0;

    // Generic savings values
    const tgtAmt  = nonDebtGoal.targetAmount;
    const savPct  = tgtAmt && tgtAmt > 0 ? Math.min(100, Math.round((selectedBalance / tgtAmt) * 100)) : 0;
    const savRemaining = tgtAmt && tgtAmt > 0 ? Math.max(0, tgtAmt - selectedBalance) : null;

    const isEf = nonDebtGoal.goalType === "emergency_fund";
    const isNw = nonDebtGoal.goalType === "net_worth";

    const pct = isEf ? efPct : isNw ? fiProgress : savPct;
    const pageTitle = nonDebtGoal.title;

    const targetDateLabel = nonDebtGoal.targetDate
      ? (() => { try { return new Date(nonDebtGoal.targetDate! + "-01").toLocaleDateString("en-US", { month: "short", year: "numeric" }); } catch { return null; } })()
      : null;

    const projMonths = savRemaining != null && monthlySavingsState > 0
      ? Math.ceil(savRemaining / monthlySavingsState)
      : null;

    return (
      <div className="mx-auto max-w-2xl lg:max-w-3xl px-4 pt-4 pb-8 sm:py-8 sm:px-6">
        {/* Breadcrumb */}
        <nav className="mb-5 flex items-center gap-1.5 text-xs text-gray-400">
          <Link href="/account/goals" className="hover:text-purple-600 transition">Goals</Link>
          <span>/</span>
          <span className="text-gray-600">{pageTitle}</span>
        </nav>

        {/* Header */}
        <div className="mb-6 flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            {nonDebtGoal.emoji && (
              <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-2xl ${
                isEf ? "bg-amber-50" : isNw ? "bg-indigo-50" : "bg-teal-50"
              }`}>{nonDebtGoal.emoji}</span>
            )}
            <div>
              <p className={`text-[10px] font-bold uppercase tracking-widest mb-1 ${
                isEf ? "text-amber-600" : isNw ? "text-indigo-600" : "text-teal-600"
              }`}>
                {isEf ? "Emergency fund" : isNw ? "Net worth" : "Savings goal"}
              </p>
              <h1 className="text-2xl font-extrabold text-gray-900">{pageTitle}</h1>
              {(targetDateLabel || nonDebtGoal.description) && (
                <p className="mt-1 text-sm text-gray-500">
                  {nonDebtGoal.description || (targetDateLabel ? `Target ${targetDateLabel}` : "")}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Progress card */}
        <div className="rounded-2xl border border-gray-200 bg-white shadow-sm px-6 py-6 mb-4">
          {isEf ? (
            <>
              <p className="text-4xl font-bold tabular-nums text-gray-900">{fmtShort(selectedBalance, hcLocal)}</p>
              <p className="text-sm text-gray-500 mt-1">of {fmtShort(efTarget, hcLocal)} target ({EF_MONTHS_TARGET}-month runway)</p>
            </>
          ) : isNw ? (
            <>
              <p className="text-4xl font-bold tabular-nums text-gray-900">{fmtShort(Math.max(0, netWorthState), hcLocal)}</p>
              <p className="text-sm text-gray-500 mt-1">current net worth{fiTarget > 0 ? ` · FI target ${fmtShort(fiTarget, hcLocal)}` : ""}</p>
            </>
          ) : (
            <>
              <p className="text-4xl font-bold tabular-nums text-gray-900">{fmtShort(selectedBalance, hcLocal)}</p>
              <p className="text-sm text-gray-500 mt-1">
                {tgtAmt && tgtAmt > 0 ? `of ${fmtShort(tgtAmt, hcLocal)} target` : "saved"}
              </p>
            </>
          )}

          {/* Progress bar */}
          <div className="mt-5">
            <div className="flex justify-between text-xs text-gray-500 mb-2">
              <span>{pct}% there</span>
              {isEf && efRunway > 0 && (
                <span className="tabular-nums">{efRunway.toFixed(1)} months of runway</span>
              )}
              {isNw && fiTarget > 0 && (
                <span className="tabular-nums">{fmtShort(Math.max(0, fiTarget - netWorthState), hcLocal)} remaining</span>
              )}
              {!isEf && !isNw && savRemaining != null && savRemaining > 0 && (
                <span className="tabular-nums">{fmtShort(savRemaining, hcLocal)} to go</span>
              )}
              {!isEf && !isNw && savRemaining != null && savRemaining <= 0 && (
                <span className="text-emerald-600 font-semibold">Goal reached 🎉</span>
              )}
            </div>
            <div className={`h-3 w-full rounded-full overflow-hidden ${
              isEf ? "bg-amber-100" : isNw ? "bg-indigo-100" : "bg-teal-100"
            }`}>
              <div className={`h-full rounded-full transition-all ${
                isEf ? "bg-amber-500" : isNw ? "bg-indigo-500" : "bg-teal-500"
              }`} style={{ width: `${pct}%` }} />
            </div>
          </div>

          {/* Projection hint */}
          {projMonths != null && projMonths > 0 && monthlySavingsState > 0 && (
            <p className="mt-3 text-xs text-gray-500">
              At {fmtShort(monthlySavingsState, hcLocal)}/mo savings rate →{" "}
              <span className="font-medium text-gray-700">
                ~{projMonths} months ({new Date(Date.now() + projMonths * 30.44 * 86400000).toLocaleDateString("en-US", { month: "short", year: "numeric" })})
              </span>
            </p>
          )}
          {isEf && efTarget > 0 && monthlySavingsState > 0 && efRunway < EF_MONTHS_TARGET && (
            <p className="mt-3 text-xs text-gray-500">
              At {fmtShort(monthlySavingsState, hcLocal)}/mo →{" "}
              <span className="font-medium text-gray-700">
                ~{Math.ceil((efTarget - selectedBalance) / monthlySavingsState)} months to full runway
              </span>
            </p>
          )}
        </div>

        {/* Stats grid */}
        <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden divide-y divide-gray-100 mb-4">
          {isEf ? (
            <div className="grid grid-cols-3 divide-x divide-gray-100">
              <div className="px-5 py-4">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Saved</p>
                <p className="text-xl font-bold text-gray-900 mt-1 tabular-nums">{fmtShort(selectedBalance, hcLocal)}</p>
              </div>
              <div className="px-5 py-4">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Monthly expenses</p>
                <p className="text-xl font-bold text-gray-900 mt-1 tabular-nums">{fmtShort(monthlyExpensesState, hcLocal)}</p>
              </div>
              <div className="px-5 py-4">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Runway</p>
                <p className="text-xl font-bold text-gray-900 mt-1 tabular-nums">{efRunway.toFixed(1)} mo</p>
              </div>
            </div>
          ) : isNw ? (
            <div className="grid grid-cols-3 divide-x divide-gray-100">
              <div className="px-5 py-4">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Net worth</p>
                <p className="text-xl font-bold text-gray-900 mt-1 tabular-nums">{fmtShort(netWorthState, hcLocal)}</p>
              </div>
              <div className="px-5 py-4">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">FI target</p>
                <p className="text-xl font-bold text-gray-900 mt-1 tabular-nums">{fiTarget > 0 ? fmtShort(fiTarget, hcLocal) : "—"}</p>
              </div>
              <div className="px-5 py-4">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Savings/mo</p>
                <p className="text-xl font-bold text-gray-900 mt-1 tabular-nums">
                  {monthlySavingsState > 0 ? fmtShort(monthlySavingsState, hcLocal) : "—"}
                </p>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 divide-x divide-gray-100">
              <div className="px-5 py-4">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Saved so far</p>
                <p className="text-xl font-bold text-gray-900 mt-1 tabular-nums">{fmtShort(selectedBalance, hcLocal)}</p>
              </div>
              <div className="px-5 py-4">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                  {tgtAmt && tgtAmt > 0 ? "Target" : "Savings/mo"}
                </p>
                <p className="text-xl font-bold text-gray-900 mt-1 tabular-nums">
                  {tgtAmt && tgtAmt > 0 ? fmtShort(tgtAmt, hcLocal) : monthlySavingsState > 0 ? `${fmtShort(monthlySavingsState, hcLocal)}/mo` : "—"}
                </p>
              </div>
            </div>
          )}

          {/* Accounts */}
          {activeSavingsAccounts.length > 0 && (
            <div className="px-5 py-4">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-3">Accounts counting toward this goal</p>
              <div className="space-y-2">
                {activeSavingsAccounts.map((s) => (
                  <div key={s.slug} className="flex items-center justify-between">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">{s.accountName ?? s.bankName}</p>
                      <p className="text-xs text-gray-400">{s.bankName} · {s.accountType}</p>
                    </div>
                    <p className="text-sm font-semibold tabular-nums text-gray-700 ml-3">{fmt(Math.max(0, s.balance), hcLocal)}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Target date */}
          {targetDateLabel && (
            <div className="px-5 py-4">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Target date</p>
              <p className="text-base font-bold text-gray-900 mt-1">{targetDateLabel}</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl lg:max-w-3xl px-4 pt-4 pb-8 sm:py-8 sm:px-6">

      {/* Breadcrumb */}
      <nav className="mb-5 flex items-center gap-1.5 text-xs text-gray-400">
        <Link href="/account/goals" className="hover:text-purple-600 transition">Goals</Link>
        <span>/</span>
        <span className="text-gray-600">{pageTitle}</span>
      </nav>

      {/* Header */}
      <div className="mb-5 flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <h1 className="text-2xl font-extrabold text-gray-900">{pageTitle}</h1>
          <p className="mt-1.5 flex flex-wrap items-center gap-x-1 gap-y-1 text-sm text-gray-500">
            {sortedHistory.length > 0 && (
              <span>Started {fmtYM(sortedHistory[0].yearMonth)}</span>
            )}
            {sortedHistory.length > 0 && effectiveTargetYM && (
              <span className="text-gray-300">·</span>
            )}
            {effectiveTargetYM && (
              <span className="inline-flex items-center gap-1">
                Target {fmtYM(effectiveTargetYM)}
                <span
                  title="This date is your goal baseline. It stays fixed until you edit the goal — only the projection updates as your balances change."
                  className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-gray-300 text-[9px] font-bold text-gray-400 cursor-help"
                  aria-label="About target date"
                >i</span>
              </span>
            )}
            {trackedSnaps.length > 0 && (
              <>
                <span className="text-gray-300">·</span>
                <Link href="/account/liabilities" className="hover:text-purple-600 transition">
                  {trackedSnaps.length} account{trackedSnaps.length > 1 ? "s" : ""} →
                </Link>
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={openEdit}
            className="rounded-xl border border-gray-200 bg-white px-3.5 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition shadow-sm"
          >
            Edit goal
          </button>
        </div>
      </div>

      {/* Pace card */}
      {currentDebt <= 0 ? (
        <div className="rounded-2xl border border-emerald-100 bg-emerald-50 px-6 py-5 mb-4">
          <h2 className="text-xl font-bold text-emerald-700">Debt-free! 🎉</h2>
          <p className="mt-1 text-sm text-emerald-600">You&apos;ve paid off all tracked debts.</p>
        </div>
      ) : requiredMonthly != null && currentPace != null ? (() => {
        const isBehind = paceStatus === "behind" || paceStatus === "way_behind";
        const isAhead  = paceStatus === "ahead";
        const shortfall = requiredMonthly - currentPace;
        const targetLabel = effectiveTargetYM ? fmtYM(effectiveTargetYM) : "your target";
        return (
          <div className={`rounded-2xl border mb-4 px-5 py-4 flex items-start gap-4 ${
            isBehind ? "bg-amber-50 border-amber-200" :
            isAhead  ? "bg-emerald-50 border-emerald-100" :
                       "bg-gray-50 border-gray-200"
          }`}>
            <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white text-sm font-bold ${
              isBehind ? "bg-amber-500" :
              isAhead  ? "bg-emerald-500" :
                         "bg-gray-400"
            }`}>
              {isBehind ? "!" : isAhead ? "✓" : "·"}
            </div>
            <div className="flex-1 min-w-0">
              <p className={`text-[11px] font-bold uppercase tracking-wide mb-1 ${
                isBehind ? "text-amber-600" : isAhead ? "text-emerald-600" : "text-gray-500"
              }`}>
                {isBehind ? "Behind pace" : isAhead ? "Ahead of pace" : "On pace"}
              </p>
              <p className="text-sm text-gray-900">
                To hit {targetLabel}, you&apos;d need{" "}
                <span className="font-bold">{fmt(requiredMonthly, hc)}/mo</span>.
              </p>
              <p className={`mt-0.5 text-sm font-mono ${isBehind ? "text-amber-700" : "text-gray-500"}`}>
                You&apos;re averaging {fmt(currentPace, hc)}
                {isBehind && shortfall > 0 && (
                  <> — <span className="text-amber-700">{fmt(shortfall, hc)} short.</span></>
                )}
                {isAhead && <> — nicely ahead.</>}
                {!isBehind && !isAhead && <> — right on track.</>}
              </p>
            </div>
            {isBehind && (
              <Link
                href="/account/liabilities"
                className="shrink-0 self-center rounded-xl bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-700 transition whitespace-nowrap"
              >
                Get back on pace →
              </Link>
            )}
          </div>
        );
      })() : null}

      {/* Chart */}
      {sortedHistory.length >= 2 && startingTrackedDebt > 0 && (
        <div className="mb-4">
          <DebtPayoffChart
            history={sortedHistory}
            yAxisDebtMax={chartYAxisDebtMax}
            targetDateYM={effectiveTargetYM}
            projectionRemainingMonthly={projectionRemainingMonthly}
            projPayoffMs={projPayoffMs}
            homeCurrency={hc}
          />
        </div>
      )}

      {/* At a glance (plain-language summary) */}
      <div className="mb-4 grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-gray-100 rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        <div className="px-4 py-4 sm:px-5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Where you started</p>
          {sortedHistory.length > 0 ? (
            <>
              <p className="mt-1 text-sm font-medium text-gray-600">{fmtYM(sortedHistory[0].yearMonth)}</p>
              <p className="mt-0.5 text-2xl font-bold text-gray-900 tabular-nums">{fmtShort(startingTrackedDebt, hc)}</p>
            </>
          ) : (
            <>
              <p className="mt-1 text-sm text-gray-500">Soon</p>
              <p className="mt-0.5 text-sm text-gray-400 leading-snug">
                Once we have two months on the chart, your first balance here shows up automatically.
              </p>
            </>
          )}
        </div>
        <div className="px-4 py-4 sm:px-5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Where you are now</p>
          <p className="mt-1 text-sm font-medium text-gray-600">Today</p>
          <p className="mt-0.5 text-2xl font-bold text-gray-900 tabular-nums">{fmt(currentDebt, hc)}</p>
          {trendLabel && (
            <p className="mt-2">
              <span
                className={`inline-flex rounded-full border px-2.5 py-0.5 text-[11px] font-medium tabular-nums ${
                  trendLabel.warn
                    ? "border-amber-100 bg-amber-50 text-amber-900"
                    : "border-emerald-100 bg-emerald-50 text-emerald-800"
                }`}
              >
                {trendLabel.text}
              </span>
              <span className="sr-only"> compared to where you started</span>
            </p>
          )}
        </div>
        <div className="px-4 py-4 sm:px-5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">If patterns hold</p>
          <p className="mt-1 text-sm font-medium text-gray-600">Debt-free</p>
          {projPayoffYM && currentDebt > 0 ? (
            <>
              <p className="mt-0.5 text-2xl font-bold text-emerald-600 tabular-nums">{fmtYM(projPayoffYM)}</p>
              {targetVsProjLabel && (
                <p className="mt-2">
                  <span
                    className={`inline-flex rounded-full border px-2.5 py-0.5 text-[11px] font-medium tabular-nums ${
                      targetVsProjLabel.warn
                        ? "border-amber-100 bg-amber-50 text-amber-900"
                        : "border-emerald-100 bg-emerald-50 text-emerald-800"
                    }`}
                  >
                    {targetVsProjLabel.text}
                  </span>
                </p>
              )}
            </>
          ) : currentDebt <= 0 ? (
            <p className="mt-0.5 text-lg font-semibold text-emerald-600">Already there</p>
          ) : (
            <p className="mt-1 text-sm text-gray-400">We&apos;ll estimate this once repayment patterns clear up.</p>
          )}
        </div>
      </div>

      {/* Milestones */}
      {milestones.length > 0 && (
        <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden mb-4">
          <div className="flex items-center justify-between px-6 pt-5 pb-3">
            <h2 className="text-sm font-semibold text-gray-800">Milestones</h2>
            <span className="text-xs text-gray-400">Key moments along the way</span>
          </div>
          <div className="px-6 pb-5">
            {milestones.map((m, i) => {
              const titleClass =
                m.visual === "check" ? "text-emerald-800" :
                m.visual === "warning" ? "text-amber-900" :
                m.visual === "here" ? "text-gray-900" :
                m.visual === "goal" ? "text-gray-800" :
                "text-gray-700";

              const dot = (() => {
                switch (m.visual) {
                  case "check":
                    return (
                      <div className="w-4 h-4 rounded-full bg-emerald-500 border-2 border-emerald-500 flex items-center justify-center shrink-0 mt-0.5">
                        <svg className="h-2 w-2 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      </div>
                    );
                  case "warning":
                    return (
                      <div className="w-4 h-4 rounded-full bg-amber-200 border-2 border-amber-500 flex items-center justify-center shrink-0 mt-0.5">
                        <span className="block w-2 h-[2px] bg-amber-900 rounded-[1px]" aria-hidden />
                      </div>
                    );
                  case "here":
                    return (
                      <div className="w-4 h-4 rounded-full border-[2.5px] border-gray-900 bg-white ring-4 ring-gray-100 flex items-center justify-center shrink-0 mt-0.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-gray-900" aria-hidden />
                      </div>
                    );
                  case "goal":
                    return (
                      <div
                        className="w-4 h-4 rounded-full bg-white border-2 border-dashed border-gray-400 shrink-0 mt-0.5"
                        aria-hidden
                      />
                    );
                  default:
                    return (
                      <div className="w-4 h-4 rounded-full bg-white border-2 border-gray-300 shrink-0 mt-0.5" aria-hidden />
                    );
                }
              })();

              return (
                <div key={`${m.key}-${i}`} className="flex gap-4">
                  <div className="flex flex-col items-center w-5 shrink-0">
                    {dot}
                    {i < milestones.length - 1 && (
                      <div className="w-0.5 flex-1 my-1 min-h-[12px] bg-gray-100" />
                    )}
                  </div>

                  <div className={`pb-5 flex-1 min-w-0 ${i === milestones.length - 1 ? "pb-0" : ""}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className={`text-sm font-semibold ${titleClass}`}>{m.label}</p>
                        <p className="text-xs text-gray-400 mt-0.5">{m.sublabel}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <p
                          className={`text-sm font-medium tabular-nums ${
                            m.dateLabel === "—" ? "text-gray-300" : "text-gray-700"
                          }`}
                        >
                          {m.dateLabel}
                        </p>
                        {m.distLabel ? (
                          <p className="text-xs text-gray-400 mt-0.5">{m.distLabel}</p>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Edit modal ── */}
      {showEdit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white shadow-xl overflow-hidden">
            <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-gray-100">
              <h2 className="text-base font-semibold text-gray-900">Edit goal</h2>
              <button type="button" onClick={() => setShowEdit(false)}
                className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 transition">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="px-5 py-5 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1.5">Goal name</label>
                <input
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  placeholder="e.g. Debt-free by 2028"
                  autoFocus
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                  Target payoff date
                  <span className="ml-1 font-normal text-gray-400">(used to calculate required monthly payment)</span>
                </label>
                <input
                  type="month"
                  value={editTargetDate}
                  onChange={(e) => setEditTargetDate(e.target.value)}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
                {editTargetDate && requiredMonthly != null && (() => {
                  const moLeft = Math.max(1, monthsBetween(today, editTargetDate));
                  const req = currentDebt / moLeft;
                  return (
                    <p className="mt-1.5 text-xs text-gray-500">
                      To hit this date, you&apos;d need to pay{" "}
                      <span className="font-semibold text-gray-700">{fmt(req, hc)}/mo</span> on average.
                    </p>
                  );
                })()}
              </div>
              <div className="flex gap-2 pt-1">
                <button type="button" onClick={() => setShowEdit(false)}
                  className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 transition">
                  Cancel
                </button>
                <button type="button" disabled={savingConfig} onClick={saveGoalConfig}
                  className="flex-1 rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-700 disabled:opacity-50 transition">
                  {savingConfig ? "Saving…" : "Save"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
