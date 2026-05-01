"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseClient } from "@/lib/firebase";
import { usePlan } from "@/contexts/PlanContext";
import UpgradePrompt from "@/components/UpgradePrompt";
import Link from "next/link";
import {
  ComposedChart, Area, Line, XAxis, YAxis,
  Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";
import { fmt, getCurrencySymbol, HOME_CURRENCY } from "@/lib/currencyUtils";
import type { AccountSnapshot } from "@/lib/extractTransactions";

// ── constants ─────────────────────────────────────────────────────────────────

const MONTHLY_RETURN_RATE = 0.04 / 12;  // 4% annual
const CONFIDENCE_SOLID_MONTHS = 12;      // solid line for first 12 months
const DISCRETIONARY_FACTOR = 0.65;       // essentials ≈ 65% of typical expenses
const INCOME_CV_THRESHOLD = 0.25;
const EF_MONTHS_STABLE = 6;
const EF_MONTHS_VARIABLE = 9;

// ── types ─────────────────────────────────────────────────────────────────────

type Horizon = 1 | 5 | 10 | 20;
type ConfidenceTier = "high" | "medium" | "directional" | "insufficient";

interface HistoryEntry {
  yearMonth: string;
  netWorth: number;
  debtTotal: number;
  incomeTotal: number;
}

interface AccountBalanceEntry {
  yearMonth: string;
  balance: number;         // raw account balance (negative for debt accounts)
}

interface AccountBalanceHistoryItem {
  slug: string;
  label: string;
  accountType: string;
  currency: string;
  entries: AccountBalanceEntry[];
}

interface MilestoneSubItem {
  name: string;
  dateLabel: string;
  detail: string;
  growing?: boolean;
}

interface Milestone {
  dateLabel: string;
  description: string;
  assumption: string;
  tag: "debt" | "milestone" | "long_range";
  monthsOut: number;
  confidence: ConfidenceTier;
  subItems?: MilestoneSubItem[];
}

interface ChartPoint {
  month: number;
  xLabel: string;
  solid: number | null;
  dashed: number | null;
  lowerBand: number;
  bandDiff: number;
}

// ── helpers ───────────────────────────────────────────────────────────────────

function fmtShort(v: number, sym: string): string {
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}${sym}${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}${sym}${Math.round(abs / 1_000)}k`;
  return `${sign}${sym}${Math.round(abs)}`;
}

function fmtAxis(v: number, sym: string): string {
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${sym}${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sym}${Math.round(abs / 1_000)}k`;
  return `${sym}${v}`;
}

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const hours = Math.floor(diffMs / 3_600_000);
  if (hours < 24) return `${hours} hour${hours !== 1 ? "s" : ""} ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days !== 1 ? "s" : ""} ago`;
  const months = Math.floor(days / 30);
  return `${months} month${months !== 1 ? "s" : ""} ago`;
}

function addMonthsLabel(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() + months);
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

function yearFromNow(months: number): number {
  return new Date().getFullYear() + Math.floor(months / 12);
}

function nextRoundMilestone(nw: number): number {
  const levels = [
    100_000, 250_000, 500_000, 750_000, 1_000_000,
    1_250_000, 1_500_000, 2_000_000, 2_500_000, 3_000_000,
    4_000_000, 5_000_000, 7_500_000, 10_000_000,
  ];
  return levels.find((l) => l > nw) ?? Math.ceil(nw * 1.5 / 1_000_000) * 1_000_000;
}

// ── projection engine ─────────────────────────────────────────────────────────

function projectNetWorth(start: number, monthlySavings: number, months: number): number[] {
  const vals = [start];
  let nw = start;
  for (let m = 0; m < months; m++) {
    nw = nw * (1 + MONTHLY_RETURN_RATE) + monthlySavings;
    vals.push(Math.round(nw));
  }
  return vals;
}

// ── chart data builder ────────────────────────────────────────────────────────

function buildChartData(
  currentNW: number,
  monthlySavings: number,
  horizonYears: Horizon,
): ChartPoint[] {
  const totalMonths = horizonYears * 12;
  const predicted = projectNetWorth(currentNW, monthlySavings, totalMonths);

  const projectedGrowth = Math.abs(predicted[totalMonths] - currentNW);
  // Band widens from 0% at month 0 to ~20% of growth at horizon
  const widthFactor = Math.max(projectedGrowth * 0.20, Math.abs(currentNW) * 0.04, 1_000);

  const tickInterval = horizonYears <= 1 ? 2 : horizonYears <= 5 ? 12 : 24;
  const now = new Date();

  return predicted.map((pred, m) => {
    const t = totalMonths > 0 ? m / totalMonths : 0;
    const halfBand = Math.pow(t, 1.4) * widthFactor * 0.5;

    const showTick = m === 0 || m % tickInterval === 0 || m === totalMonths;
    let xLabel = "";
    if (m === 0) xLabel = "Now";
    else if (showTick) {
      const d = new Date(now.getFullYear(), now.getMonth() + m, 1);
      xLabel = horizonYears >= 5
        ? d.getFullYear().toString()
        : d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
    }

    return {
      month: m,
      xLabel,
      solid: m <= CONFIDENCE_SOLID_MONTHS ? pred : null,
      dashed: m >= CONFIDENCE_SOLID_MONTHS ? pred : null,
      lowerBand: pred - halfBand,
      bandDiff: halfBand * 2,
    };
  });
}

// ── milestone detection ───────────────────────────────────────────────────────

function toHome(amount: number, currency: string | undefined, fxRates: Record<string, number>, hc: string): number {
  if (!currency || currency.toUpperCase() === hc.toUpperCase()) return amount;
  const rate = fxRates[currency.toUpperCase()];
  return rate != null ? amount * rate : amount;
}

function detectMilestones(
  currentNW: number,
  monthlySavings: number,
  history: HistoryEntry[],
  snapshots: AccountSnapshot[],
  accountHistory: AccountBalanceHistoryItem[],
  sym: string,
  fxRates: Record<string, number>,
  hc: string,
): Milestone[] {
  const maxMonths = 20 * 12;
  const predicted = projectNetWorth(currentNW, monthlySavings, maxMonths);
  const milestones: Milestone[] = [];

  // 1. Net worth round milestone
  const nextRound = nextRoundMilestone(currentNW);
  const crossMonth = predicted.findIndex((v, i) => i > 0 && v >= nextRound);
  if (crossMonth > 0) {
    const isLong = crossMonth > 60;
    milestones.push({
      dateLabel: isLong ? `~ ${yearFromNow(crossMonth)}` : addMonthsLabel(crossMonth),
      description: `Net worth crosses ${fmtShort(nextRound, sym)}`,
      assumption: "assuming 4% return on investments",
      tag: isLong ? "long_range" : "milestone",
      monthsOut: crossMonth,
      confidence: crossMonth <= 12 ? "high" : crossMonth <= 60 ? "medium" : "directional",
    });
  }

  // 2. Per-account debt milestones — build sub-items for each account, surface as one row
  const debtSnaps = snapshots.filter((s) =>
    ["credit", "mortgage", "loan"].includes(s.accountType) && s.balance < 0
  );

  interface DebtAccountResult {
    name: string;
    owed: number;
    monthlyPaydown: number;
    months: number;
    growing: boolean;
    noHistory: boolean;
    isMortgage: boolean;
  }
  const debtResults: DebtAccountResult[] = [];

  for (const snap of debtSnaps) {
    const owed = Math.abs(toHome(snap.balance, snap.currency, fxRates, hc));
    if (owed <= 0) continue;
    const name = snap.accountName ?? snap.bankName ?? "Debt";
    const isMortgage = snap.accountType === "mortgage";

    // Use accountBalanceHistory — only real uploaded months, no carry-forwards
    const acctRecord = accountHistory.find((a) => a.slug === snap.slug);
    const acctCurrency = acctRecord?.currency ?? snap.currency;
    const acctEntries = (acctRecord?.entries ?? []).slice(-12);

    if (acctEntries.length < 2) {
      debtResults.push({ name, owed, monthlyPaydown: 0, months: 0, growing: false, noHistory: true, isMortgage });
      continue;
    }

    // Convert each balance entry to home currency before computing trend
    const oldestHome = toHome(acctEntries[0].balance, acctCurrency, fxRates, hc);
    const newestHome = toHome(acctEntries[acctEntries.length - 1].balance, acctCurrency, fxRates, hc);
    const span = acctEntries.length - 1;
    // monthlyChange > 0 means balance moved toward 0 = debt decreasing = good
    const monthlyChange = (newestHome - oldestHome) / span;
    // For debt: monthlyPaydown positive = getting paid down
    // e.g. oldestHome=-25000, newestHome=-21000 → monthlyChange=+333 → paydown=+333 ✓
    const monthlyPaydown = monthlyChange;

    if (monthlyPaydown <= 0) {
      debtResults.push({ name, owed, monthlyPaydown, months: 0, growing: true, noHistory: false, isMortgage });
    } else {
      const months = Math.ceil(owed / monthlyPaydown);
      debtResults.push({ name, owed, monthlyPaydown, months, growing: false, noHistory: false, isMortgage });
    }
  }

  if (debtResults.length > 0) {
    const payingDown = debtResults.filter((r) => !r.growing && !r.noHistory && r.months <= maxMonths);
    const growing = debtResults.filter((r) => r.growing);
    const noHistory = debtResults.filter((r) => r.noHistory);

    // Summary row: earliest payoff account drives the top-level date
    const earliest = payingDown.sort((a, b) => a.months - b.months)[0];
    const allGrowing = growing.length === debtResults.length;

    const debtSubItems: MilestoneSubItem[] = [
      ...payingDown.map((r) => ({
        name: r.name,
        dateLabel: r.months > 60 ? `~ ${yearFromNow(r.months)}` : addMonthsLabel(r.months),
        detail: `${fmtShort(r.monthlyPaydown, sym)}/mo avg paydown`,
        growing: false,
      })),
      ...growing.map((r) => ({
        name: r.name,
        dateLabel: "—",
        detail: `balance growing +${fmtShort(Math.abs(r.monthlyPaydown), sym)}/mo`,
        growing: true,
      })),
      ...noHistory.map((r) => ({
        name: r.name,
        dateLabel: "—",
        detail: "not enough history",
        growing: false,
      })),
    ];

    milestones.push({
      dateLabel: allGrowing ? "—" : (earliest ? (earliest.months > 60 ? `~ ${yearFromNow(earliest.months)}` : addMonthsLabel(earliest.months)) : "—"),
      description: allGrowing
        ? "Debt growing at current pace"
        : earliest
          ? `${earliest.name} cleared first`
          : "Debt accounts tracked",
      assumption: `${debtResults.length} account${debtResults.length !== 1 ? "s" : ""} · ${payingDown.length} paying down${growing.length > 0 ? ` · ${growing.length} trending up` : ""}`,
      tag: "debt",
      monthsOut: earliest?.months ?? maxMonths + 1,
      confidence: allGrowing ? "directional" : earliest ? (earliest.months <= 12 ? "high" : earliest.months <= 60 ? "medium" : "directional") : "directional",
      subItems: debtSubItems.length > 1 ? debtSubItems : undefined,
    });
  }

  // 3. Investment portfolio doubles — aggregate with per-account sub-items
  const investSnaps = snapshots.filter((s) => s.accountType === "investment" && s.balance > 0);
  // Convert each account's balance to home currency before aggregating
  const totalInvestment = investSnaps.reduce(
    (sum, s) => sum + toHome(s.balance, s.currency, fxRates, hc), 0
  );
  if (totalInvestment > 0) {
    let val = totalInvestment;
    let months = 0;
    while (val < totalInvestment * 2 && months < maxMonths) {
      val *= (1 + MONTHLY_RETURN_RATE);
      months++;
    }
    if (months > 0 && months <= maxMonths) {
      const isLong = months > 60;

      // Per-account sub-items — each account in home currency
      const investSubItems: MilestoneSubItem[] = investSnaps.map((s) => {
        const balHome = toHome(s.balance, s.currency, fxRates, hc);
        let v = balHome; let m = 0;
        while (v < balHome * 2 && m < maxMonths) { v *= (1 + MONTHLY_RETURN_RATE); m++; }
        const acctName = s.accountName ?? s.bankName ?? "Account";
        return {
          name: acctName,
          dateLabel: m > 60 ? `~ ${yearFromNow(m)}` : addMonthsLabel(m),
          detail: `${fmtShort(balHome, sym)} → ${fmtShort(balHome * 2, sym)}`,
          growing: false,
        };
      });

      milestones.push({
        dateLabel: isLong ? `~ ${yearFromNow(months)}` : addMonthsLabel(months),
        description: `Investment portfolio doubles to ${fmtShort(totalInvestment * 2, sym)}`,
        assumption: `4% annual return · ${investSnaps.length} account${investSnaps.length !== 1 ? "s" : ""} · no new contributions`,
        tag: isLong ? "long_range" : "milestone",
        monthsOut: months,
        confidence: months <= 12 ? "high" : months <= 60 ? "medium" : "directional",
        subItems: investSnaps.length > 1 ? investSubItems : undefined,
      });
    }
  }

  // Sort: confidence first, then date
  const confOrder: Record<ConfidenceTier, number> = { high: 0, medium: 1, directional: 2, insufficient: 3 };
  milestones.sort((a, b) => {
    const c = confOrder[a.confidence] - confOrder[b.confidence];
    return c !== 0 ? c : a.monthsOut - b.monthsOut;
  });
  return milestones.slice(0, 5);
}

// ── income variance ───────────────────────────────────────────────────────────

function incomeCV(history: HistoryEntry[]): number {
  const vals = history.filter((h) => h.incomeTotal > 0).map((h) => h.incomeTotal);
  if (vals.length < 3) return 0;
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  if (mean === 0) return 0;
  const variance = vals.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / vals.length;
  return Math.sqrt(variance) / mean;
}

// ── custom tooltip ────────────────────────────────────────────────────────────

function ForecastTooltip({ active, payload, label, sym }: {
  active?: boolean;
  payload?: { dataKey: string; value: number }[];
  label?: string;
  sym: string;
}) {
  if (!active || !payload?.length) return null;
  const pt = payload.find((p) => p.dataKey === "solid" || p.dataKey === "dashed");
  if (!pt || pt.value == null) return null;
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 shadow-lg text-xs">
      <p className="text-gray-400 mb-0.5">{label}</p>
      <p className="font-semibold text-gray-900 tabular-nums">{fmtShort(pt.value, sym)} predicted</p>
    </div>
  );
}

// ── page ──────────────────────────────────────────────────────────────────────

export default function ForecastPage() {
  const router = useRouter();
  const { can, loading: planLoading } = usePlan();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [horizon, setHorizon] = useState<Horizon>(5);

  // core financial data
  const [netWorth, setNetWorth] = useState(0);
  const [monthlySavings, setMonthlySavings] = useState(0);
  const [monthlyExpenses, setMonthlyExpenses] = useState(0);
  const [liquidAssets, setLiquidAssets] = useState(0);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [snapshots, setSnapshots] = useState<AccountSnapshot[]>([]);
  const [accountHistory, setAccountHistory] = useState<AccountBalanceHistoryItem[]>([]);
  const [patternDepth, setPatternDepth] = useState(0);
  const [accountCount, setAccountCount] = useState(0);
  const [lastVerified, setLastVerified] = useState<string | null>(null);
  const [hc, setHc] = useState(HOME_CURRENCY);
  const [fxRates, setFxRates] = useState<Record<string, number>>({});

  // locked module modal state
  const [retirementOpen, setRetirementOpen] = useState(false);
  const [insuranceOpen, setInsuranceOpen] = useState(false);

  // milestone expand state — keyed by milestone index
  const [expandedMilestones, setExpandedMilestones] = useState<Set<number>>(new Set());
  function toggleMilestone(i: number) {
    setExpandedMilestones((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });
  }

  useEffect(() => {
    const { auth } = getFirebaseClient();
    return onAuthStateChanged(auth, async (user) => {
      if (!user) { router.push("/login"); return; }
      setLoading(true); setError(null);
      try {
        const token = await user.getIdToken();
        const res = await fetch("/api/user/statements/consolidated", {
          headers: { Authorization: `Bearer ${token}` },
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) { setError(json.error ?? "Failed to load"); return; }

        const income = json.typicalMonthlyIncome ?? 0;
        const expenses = json.typicalMonthlyExpenses ?? 0;

        setNetWorth(json.data?.netWorth ?? 0);
        setMonthlySavings(income - expenses);
        setMonthlyExpenses(expenses);
        setLiquidAssets(json.liquidAssets ?? 0);
        setHistory(Array.isArray(json.history) ? json.history : []);
        setSnapshots(Array.isArray(json.accountSnapshots) ? json.accountSnapshots : []);
        setAccountHistory(Array.isArray(json.accountBalanceHistory) ? json.accountBalanceHistory : []);
        setPatternDepth(json.totalMonthsTracked ?? 0);
        setAccountCount(json.accountCount ?? 0);
        setLastVerified(json.lastUploadedAt ?? null);
        setHc(json.homeCurrency ?? HOME_CURRENCY);
        setFxRates(json.fxRates ?? {});
      } catch {
        setError("Failed to load forecast data");
      } finally {
        setLoading(false);
      }
    });
  }, [router]);

  // ── derived ──────────────────────────────────────────────────────────────────

  const sym = getCurrencySymbol(hc);
  const hasEnoughData = patternDepth >= 6;
  const confidenceDowngraded = patternDepth < 12;

  const daysSinceVerified = lastVerified
    ? Math.floor((Date.now() - new Date(lastVerified).getTime()) / 86_400_000)
    : null;

  // Confidence tier with optional downgrade
  function tierFor(monthsAhead: number): ConfidenceTier {
    const raw: ConfidenceTier =
      monthsAhead <= 12 ? "high" :
      monthsAhead <= 60 ? "medium" :
      "directional";
    if (!confidenceDowngraded) return raw;
    const downgrade: Record<ConfidenceTier, ConfidenceTier> = {
      high: "medium", medium: "directional", directional: "insufficient", insufficient: "insufficient",
    };
    return downgrade[raw];
  }

  // Endpoint predictions (always all 4 regardless of horizon toggle)
  const predicted240 = hasEnoughData ? projectNetWorth(netWorth, monthlySavings, 240) : [];
  const pred1yr  = predicted240[12]  ?? 0;
  const pred5yr  = predicted240[60]  ?? 0;
  const pred10yr = predicted240[120] ?? 0;

  const chartData = hasEnoughData ? buildChartData(netWorth, monthlySavings, horizon) : [];

  // Y-axis domain: 10% padding below min lowerBand, 10% above max upperBand
  const chartYMin = hasEnoughData
    ? Math.min(...chartData.map((p) => p.lowerBand)) * 0.95
    : 0;
  const chartYMax = hasEnoughData
    ? Math.max(...chartData.map((p) => p.lowerBand + p.bandDiff)) * 1.05
    : 0;

  const milestones = hasEnoughData
    ? detectMilestones(netWorth, monthlySavings, history, snapshots, accountHistory, sym, fxRates, hc)
    : [];

  // Job loss runway
  const essential = monthlyExpenses;
  const essentialCut = monthlyExpenses * DISCRETIONARY_FACTOR;
  const runway    = essential > 0 ? liquidAssets / essential : 0;
  const runwayCut = essentialCut > 0 ? liquidAssets / essentialCut : 0;
  const runwayStatus =
    runway >= 6 ? "healthy" :
    runway >= 3 ? "watch" :
    "below";

  // Emergency fund
  const cv = incomeCV(history);
  const isVariable = cv > INCOME_CV_THRESHOLD;
  const efMonthsTarget = isVariable ? EF_MONTHS_VARIABLE : EF_MONTHS_STABLE;
  const efTarget = efMonthsTarget * monthlyExpenses;
  const currentEfMonths = monthlyExpenses > 0 ? liquidAssets / monthlyExpenses : 0;
  const efShort = Math.max(0, efTarget - liquidAssets);
  const efPct = efTarget > 0 ? liquidAssets / efTarget : 0;
  const efStatus =
    efPct >= 1 ? "on_target" :
    efPct >= 0.5 ? "below" :
    "far_below";

  // Income pattern description for methodology
  function incomePatternDesc(): string {
    const incomePts = history.filter((h) => h.incomeTotal > 0);
    if (incomePts.length === 0) return "Income patterns not yet detected";
    const avg = incomePts.reduce((s, h) => s + h.incomeTotal, 0) / incomePts.length;
    if (cv <= 0.10) return `Regular income (~${fmtShort(avg, sym)}/mo), recurring bills, seasonal adjustments`;
    if (cv <= 0.25) return `Variable income (~${fmtShort(avg, sym)}/mo avg), recurring expenses detected`;
    return `Irregular income (~${fmtShort(avg, sym)}/mo avg), self-employed or variable`;
  }

  // ── render helpers ────────────────────────────────────────────────────────────

  function ConfidenceDot({ tier }: { tier: ConfidenceTier }) {
    const cls =
      tier === "high" ? "bg-emerald-500" :
      tier === "medium" ? "bg-amber-500" :
      "bg-gray-400";
    return <span className={`inline-block w-2 h-2 rounded-full ${cls} mr-1.5 shrink-0`} />;
  }

  // ── render ────────────────────────────────────────────────────────────────────

  if (planLoading || loading) return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <div className="h-10 w-10 animate-spin rounded-full border-4 border-purple-600 border-t-transparent" />
    </div>
  );

  if (!can("forecast")) return (
    <UpgradePrompt
      feature="forecast"
      description="See where your net worth is headed — confidence-adjusted projections, milestone predictions, and life-stage readiness checks."
    />
  );

  if (error) return (
    <div className="mx-auto max-w-2xl lg:max-w-5xl px-4 pt-4 pb-8">
      <p className="text-red-600 text-sm">{error}</p>
    </div>
  );

  return (
    <div className="mx-auto max-w-2xl lg:max-w-5xl px-4 pt-4 pb-12 sm:py-8 sm:px-6 space-y-5">

      {/* ── 1. Page header ────────────────────────────────────────────────── */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Forecast</h1>
        <p className="mt-0.5 text-sm text-gray-500">
          Where you&apos;re headed if patterns hold — and what that means for the people who depend on you.
        </p>
      </div>

      {/* Stale patterns warning */}
      {daysSinceVerified !== null && daysSinceVerified > 7 && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5">
          <svg className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          </svg>
          <p className="text-xs text-amber-700">
            Patterns last refreshed {daysSinceVerified} days ago — consider uploading recent statements for more accurate projections.
          </p>
        </div>
      )}

      {/* ── 2. Trajectory card ───────────────────────────────────────────── */}
      <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        {/* Header */}
        <div className="px-6 pt-5 pb-0 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <p className="font-semibold text-gray-900">Predicted net worth</p>
            <p className="mt-0.5 text-xs text-gray-400">
              Based on {patternDepth} months of statement history
              {lastVerified ? ` · last verified ${timeAgo(lastVerified)}` : ""}
            </p>
          </div>
          {/* Horizon toggle */}
          <div className="flex items-center gap-0.5 rounded-lg border border-gray-200 bg-gray-50 p-0.5 shrink-0">
            {([1, 5, 10, 20] as Horizon[]).map((h) => (
              <button
                key={h}
                onClick={() => setHorizon(h)}
                className={`rounded px-2.5 py-1 text-xs font-semibold transition ${
                  horizon === h ? "bg-white text-gray-900 shadow-sm" : "text-gray-400 hover:text-gray-600"
                }`}
              >
                {h}Y
              </button>
            ))}
          </div>
        </div>

        {/* Insufficient history state */}
        {!hasEnoughData ? (
          <div className="px-6 py-12 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-gray-100">
              <svg className="h-5 w-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
              </svg>
            </div>
            <p className="text-sm font-semibold text-gray-700">More history needed</p>
            <p className="mt-1 text-xs text-gray-400 max-w-sm mx-auto">
              We need at least 6 months of statement history to forecast reliably.
              Upload earlier statements to unlock this.
            </p>
          </div>
        ) : (
          <>
            {/* Endpoints row — always all 4 regardless of horizon */}
            <div className="mt-4 grid grid-cols-4 divide-x divide-gray-100 border-y border-gray-100">
              {([
                { label: "TODAY",      value: netWorth, tier: null  as ConfidenceTier | null, meta: "current" },
                { label: "+ 1 YEAR",   value: pred1yr,  tier: tierFor(12),  meta: "high confidence" },
                { label: "+ 5 YEARS",  value: pred5yr,  tier: tierFor(60),  meta: "medium confidence" },
                { label: "+ 10 YEARS", value: pred10yr, tier: tierFor(120), meta: "directional only" },
              ] as { label: string; value: number; tier: ConfidenceTier | null; meta: string }[]).map(({ label, value, tier, meta }) => (
                <div key={label} className="px-4 py-3">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">{label}</p>
                  <p className="mt-1 text-base font-bold tabular-nums text-gray-900 truncate">
                    {tier === "insufficient" ? "—" : fmtShort(value, sym)}
                  </p>
                  <p className="mt-0.5 text-[10px] text-gray-400 flex items-center">
                    {tier && tier !== "insufficient" && <ConfidenceDot tier={tier} />}
                    {tier === "insufficient" ? "insufficient data" : meta}
                  </p>
                </div>
              ))}
            </div>

            {/* Chart */}
            <div className="px-4 pt-4" style={{ height: 256 }}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
                  {/* Grid first (lowest layer) */}
                  <CartesianGrid strokeDasharray="1 4" stroke="#e5e7eb" vertical={false} />

                  <XAxis
                    dataKey="xLabel"
                    tick={{ fontSize: 10, fill: "#9ca3af" }}
                    tickLine={false}
                    axisLine={false}
                    interval={0}
                  />
                  <YAxis
                    tickFormatter={(v: number) => fmtAxis(v, sym)}
                    tick={{ fontSize: 10, fill: "#9ca3af" }}
                    tickLine={false}
                    axisLine={false}
                    width={56}
                    domain={[chartYMin, chartYMax]}
                  />
                  <Tooltip content={<ForecastTooltip sym={sym} />} />

                  {/* Confidence band: stacked — white base then blue diff */}
                  <Area
                    type="monotone"
                    dataKey="lowerBand"
                    stackId="band"
                    stroke="none"
                    fill="white"
                    fillOpacity={1}
                    dot={false}
                    legendType="none"
                    activeDot={false}
                    isAnimationActive={false}
                  />
                  <Area
                    type="monotone"
                    dataKey="bandDiff"
                    stackId="band"
                    stroke="none"
                    fill="rgba(37,99,235,0.08)"
                    fillOpacity={1}
                    dot={false}
                    legendType="none"
                    activeDot={false}
                    isAnimationActive={false}
                  />

                  {/* Solid line (high confidence — first 12 months) */}
                  <Line
                    type="monotone"
                    dataKey="solid"
                    stroke="#2563eb"
                    strokeWidth={2}
                    dot={false}
                    legendType="none"
                    connectNulls={false}
                    activeDot={{ r: 4, fill: "#2563eb", stroke: "#fff", strokeWidth: 2 }}
                  />

                  {/* Dashed line (medium / directional) */}
                  <Line
                    type="monotone"
                    dataKey="dashed"
                    stroke="#2563eb"
                    strokeWidth={2}
                    strokeDasharray="5 4"
                    dot={false}
                    legendType="none"
                    connectNulls={false}
                    activeDot={{ r: 4, fill: "#2563eb", stroke: "#fff", strokeWidth: 2 }}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            {/* Legend */}
            <div className="px-6 pb-5 pt-2 flex flex-wrap items-center gap-5 text-xs text-gray-500">
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-0.5 w-5 bg-blue-600 rounded-full" />
                Predicted (high confidence)
              </span>
              <span className="flex items-center gap-1.5">
                <svg width="20" height="4" viewBox="0 0 20 4" className="shrink-0">
                  <line x1="0" y1="2" x2="20" y2="2" stroke="#2563eb" strokeWidth="2" strokeDasharray="5 3" />
                </svg>
                Predicted (medium confidence)
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-5 rounded" style={{ height: 8, background: "rgba(37,99,235,0.15)" }} />
                Range of likely outcomes
              </span>
            </div>

            {/* Confidence downgrade notice */}
            {confidenceDowngraded && (
              <div className="mx-6 mb-5 rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                Confidence levels are reduced — fewer than 12 months of history available. Upload earlier statements to improve accuracy.
              </div>
            )}
          </>
        )}
      </div>

      {/* ── 3. Milestones card ───────────────────────────────────────────── */}
      {hasEnoughData && (
        <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
          <div className="px-6 pt-5 pb-4 border-b border-gray-100">
            <p className="font-semibold text-gray-900">Predicted milestones</p>
            <p className="mt-0.5 text-xs text-gray-400">
              Moments worth knowing about, based on current trajectory.
            </p>
          </div>

          {milestones.length === 0 ? (
            <div className="px-6 py-5">
              <p className="text-sm text-gray-400">
                No major milestones predicted in this window — patterns are stable.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {milestones.map((m, i) => {
                const isExpanded = expandedMilestones.has(i);
                const hasSubItems = (m.subItems?.length ?? 0) > 0;
                return (
                  <div key={i}>
                    {/* Summary row */}
                    <div
                      className={`flex items-start gap-4 px-6 py-3.5 ${hasSubItems ? "cursor-pointer hover:bg-gray-50 transition-colors" : ""}`}
                      onClick={() => hasSubItems && toggleMilestone(i)}
                    >
                      {/* Date */}
                      <div className="w-24 shrink-0 pt-0.5">
                        <p className="text-xs tabular-nums text-gray-600" style={{ fontFamily: "monospace" }}>{m.dateLabel}</p>
                      </div>

                      {/* Description */}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-gray-800">
                          <strong className="font-semibold">{m.description}</strong>
                          {m.assumption && (
                            <span className="text-gray-400"> — {m.assumption}</span>
                          )}
                        </p>
                      </div>

                      {/* Tag + chevron */}
                      <div className="shrink-0 pt-0.5 flex items-center gap-2">
                        {m.tag === "debt" && (
                          <span className="inline-flex rounded-full bg-emerald-50 border border-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-700">
                            Debt
                          </span>
                        )}
                        {m.tag === "milestone" && (
                          <span className="inline-flex rounded-full bg-indigo-50 border border-indigo-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-indigo-700">
                            Milestone
                          </span>
                        )}
                        {m.tag === "long_range" && (
                          <span className="inline-flex rounded-full bg-amber-50 border border-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-700">
                            Long range
                          </span>
                        )}
                        {hasSubItems && (
                          <svg
                            className={`w-3.5 h-3.5 text-gray-400 transition-transform duration-200 ${isExpanded ? "rotate-180" : ""}`}
                            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                          </svg>
                        )}
                      </div>
                    </div>

                    {/* Expanded sub-items */}
                    {hasSubItems && isExpanded && (
                      <div className="bg-gray-50 border-t border-gray-100 divide-y divide-gray-100">
                        {m.subItems!.map((sub, j) => (
                          <div key={j} className="flex items-center gap-4 px-6 py-2.5 pl-10">
                            <div className="w-24 shrink-0">
                              <p className={`text-xs tabular-nums ${sub.growing ? "text-red-500" : "text-gray-500"}`} style={{ fontFamily: "monospace" }}>
                                {sub.dateLabel}
                              </p>
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs text-gray-700">
                                <span className="font-medium">{sub.name}</span>
                                <span className={`ml-2 ${sub.growing ? "text-red-400" : "text-gray-400"}`}>
                                  — {sub.detail}
                                </span>
                              </p>
                            </div>
                            {sub.growing && (
                              <span className="shrink-0 inline-flex rounded-full bg-red-50 border border-red-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-red-600">
                                Growing
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── 4. Life-stage modules grid ───────────────────────────────────── */}
      <div>
        <div className="mb-4">
          <p className="font-semibold text-gray-900">Your financial future</p>
          <p className="text-xs text-gray-400 mt-0.5">Specific answers powered by your data</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

          {/* 4a. Job loss runway */}
          {(() => {
            const hasData = monthlyExpenses > 0;
            const badge =
              !hasData ? (
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-gray-400">Needs more data</span>
              ) : runwayStatus === "healthy" ? (
                <span className="rounded-full bg-emerald-50 border border-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-700">Healthy</span>
              ) : runwayStatus === "watch" ? (
                <span className="rounded-full bg-amber-50 border border-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-700">Watch</span>
              ) : (
                <span className="rounded-full bg-red-50 border border-red-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-red-700">Below target</span>
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
                    See breakdown{" "}
                    <span className="inline-block transition-transform group-hover:translate-x-0.5">→</span>
                  </p>
                </div>
              </div>
            );
          })()}

          {/* 4b. Emergency fund target */}
          {(() => {
            const hasData = monthlyExpenses > 0;
            const badge = !hasData
              ? <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-gray-400">Needs more data</span>
              : efStatus === "on_target"
              ? <span className="rounded-full bg-emerald-50 border border-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-700">On target</span>
              : efStatus === "below"
              ? <span className="rounded-full bg-amber-50 border border-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-700">Below target</span>
              : <span className="rounded-full bg-red-50 border border-red-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-red-700">Far below target</span>;

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
                        <p className="text-[22px] font-bold text-gray-900 tabular-nums leading-tight">
                          {fmtShort(efShort, sym)} short
                        </p>
                      )}
                      <p className="mt-2 text-xs text-gray-500 leading-relaxed">
                        Based on your monthly expenses ({fmtShort(monthlyExpenses, sym)}) and{" "}
                        <strong className="text-gray-700">{isVariable ? "variable" : "stable salaried"}</strong> income,
                        target is {efMonthsTarget} months. You currently hold{" "}
                        <strong className="text-gray-700">{currentEfMonths.toFixed(1)} months</strong> in liquid savings.
                      </p>
                    </>
                  ) : (
                    <p className="text-sm text-gray-400 leading-snug">Upload statements to calculate your emergency fund status.</p>
                  )}
                </div>
                <div className="border-t border-gray-100 px-5 py-3">
                  <p className="text-xs font-semibold text-gray-400 group-hover:text-purple-600 transition">
                    See methodology{" "}
                    <span className="inline-block transition-transform group-hover:translate-x-0.5">→</span>
                  </p>
                </div>
              </div>
            );
          })()}

          {/* 4c. Retirement readiness (LOCKED) */}
          <div className="flex flex-col rounded-xl border border-dashed border-gray-200 bg-white overflow-hidden">
            <div className="flex-1 px-5 pt-5 pb-4">
              <div className="flex items-start justify-between gap-2 mb-3">
                <p className="text-sm font-semibold text-gray-800">Retirement readiness</p>
                <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-gray-400">
                  <svg className="h-2.5 w-2.5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                  </svg>
                  Locked
                </span>
              </div>
              <p className="text-sm font-medium text-gray-400 leading-snug">Are you on track for retirement?</p>
              <p className="mt-1.5 text-xs text-gray-400 leading-relaxed">
                We&apos;ll project your trajectory to retirement age and compare against the lifestyle you want.
                Needs your age and target retirement age.
              </p>
            </div>
            <div className="border-t border-gray-100 px-5 py-3">
              <button
                onClick={() => setRetirementOpen(true)}
                className="text-xs font-semibold text-purple-600 hover:text-purple-800 transition"
              >
                Takes 30 seconds →
              </button>
            </div>
          </div>

          {/* 4d. Life insurance gap (LOCKED) */}
          <div className="flex flex-col rounded-xl border border-dashed border-gray-200 bg-white overflow-hidden">
            <div className="flex-1 px-5 pt-5 pb-4">
              <div className="flex items-start justify-between gap-2 mb-3">
                <p className="text-sm font-semibold text-gray-800">Life insurance gap</p>
                <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-gray-400">
                  <svg className="h-2.5 w-2.5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                  </svg>
                  Locked
                </span>
              </div>
              <p className="text-sm font-medium text-gray-400 leading-snug">How much coverage do you need?</p>
              <p className="mt-1.5 text-xs text-gray-400 leading-relaxed">
                If something happened to you, would your family be OK financially? We&apos;ll calculate the gap
                between what you have and what they&apos;d need. Needs dependents and existing coverage.
              </p>
            </div>
            <div className="border-t border-gray-100 px-5 py-3">
              <button
                onClick={() => setInsuranceOpen(true)}
                className="text-xs font-semibold text-purple-600 hover:text-purple-800 transition"
              >
                Takes 1 minute →
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── 5. Methodology card ──────────────────────────────────────────── */}
      <div className="rounded-2xl border border-gray-200 bg-gray-50 overflow-hidden">
        <div className="px-6 pt-5 pb-3">
          <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-gray-500">
            How this prediction is built
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-gray-200 border-t border-gray-200">
          <div className="px-5 py-4">
            <p className="text-xs font-semibold text-gray-700 mb-1">Pattern depth</p>
            <p className="text-xs text-gray-500">
              {patternDepth} months of statements across {accountCount} account{accountCount !== 1 ? "s" : ""}
            </p>
          </div>
          <div className="px-5 py-4">
            <p className="text-xs font-semibold text-gray-700 mb-1">Income &amp; expense model</p>
            <p className="text-xs text-gray-500">{incomePatternDesc()}</p>
          </div>
          <div className="px-5 py-4">
            <p className="text-xs font-semibold text-gray-700 mb-1">Investment assumptions</p>
            <p className="text-xs text-gray-500">4% real return, no contribution increases, no market shocks</p>
          </div>
        </div>
        <div className="border-t border-gray-200 px-6 py-4">
          <p className="text-[11px] text-gray-400 leading-relaxed">
            Predictions assume current patterns hold. Actual outcomes vary with income changes, market returns,
            and life events. These are educational estimates, not financial advice.{" "}
            Want to model changes?{" "}
            <Link href="/account/whatif" className="font-medium text-purple-600 hover:text-purple-800">
              Try Scenarios
            </Link>.
          </p>
        </div>
      </div>

      {/* ── Retirement modal (placeholder) ─────────────────────────────── */}
      {retirementOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 px-4">
          <div className="w-full max-w-md rounded-2xl bg-white shadow-xl p-6">
            <h2 className="text-base font-semibold text-gray-900 mb-2">Retirement readiness</h2>
            <p className="text-sm text-gray-500 mb-4">
              Coming soon — we&apos;ll project your trajectory to retirement and show if you&apos;re on track.
            </p>
            <button
              onClick={() => setRetirementOpen(false)}
              className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-700 transition"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* ── Life insurance modal (placeholder) ─────────────────────────── */}
      {insuranceOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 px-4">
          <div className="w-full max-w-md rounded-2xl bg-white shadow-xl p-6">
            <h2 className="text-base font-semibold text-gray-900 mb-2">Life insurance gap</h2>
            <p className="text-sm text-gray-500 mb-4">
              Coming soon — we&apos;ll calculate the coverage gap to keep your family financially secure.
            </p>
            <button
              onClick={() => setInsuranceOpen(false)}
              className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-700 transition"
            >
              Close
            </button>
          </div>
        </div>
      )}

    </div>
  );
}
