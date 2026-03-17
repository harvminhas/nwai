"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseClient } from "@/lib/firebase";
import { usePlan } from "@/contexts/PlanContext";
import UpgradePrompt from "@/components/UpgradePrompt";
import {
  ComposedChart, Area, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";

// ── constants ─────────────────────────────────────────────────────────────────

// Conservative 4% annual return applied monthly to existing net worth
const MONTHLY_RETURN_RATE = 0.04 / 12;
// How many recent months to average for baseline savings calculation
const LOOKBACK_MONTHS = 3;
// Optimized scenario: 20% improvement on monthly savings
const OPTIMIZED_BOOST = 0.20;

// ── helpers ───────────────────────────────────────────────────────────────────

function fmt(v: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD",
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(v);
}
function fmtShort(v: number) {
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(0)}k`;
  return fmt(v);
}
function fmtAxis(v: number) {
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${Math.round(abs / 1_000)}k`;
  return `$${v}`;
}
function pct(from: number, to: number) {
  if (from === 0) return 0;
  return Math.round(((to - from) / Math.abs(from)) * 100);
}

// ── projection engine ─────────────────────────────────────────────────────────

/**
 * Project net worth month-by-month.
 * Each month: nw = nw × (1 + monthlyReturn) + monthlySavings
 * Returns array of length months+1 (index 0 = current).
 */
function projectNetWorth(
  startNetWorth: number,
  monthlySavings: number,
  months: number,
): number[] {
  const values = [startNetWorth];
  let nw = startNetWorth;
  for (let m = 0; m < months; m++) {
    nw = nw * (1 + MONTHLY_RETURN_RATE) + monthlySavings;
    values.push(Math.round(nw));
  }
  return values;
}

interface ChartPoint {
  label: string;
  currentPace: number;
  optimized: number;
}

function buildChartData(
  currentNetWorth: number,
  monthlySavings: number,
  optimizedSavings: number,
  horizonYears: number,
): ChartPoint[] {
  const totalMonths = horizonYears * 12;
  const currentValues  = projectNetWorth(currentNetWorth, monthlySavings, totalMonths);
  const optimizedValues = projectNetWorth(currentNetWorth, optimizedSavings, totalMonths);

  const now = new Date();
  const points: ChartPoint[] = [];
  // Show a tick every 6 months
  for (let m = 0; m <= totalMonths; m += 6) {
    let label: string;
    if (m === 0) {
      label = "Now";
    } else {
      const d = new Date(now.getFullYear(), now.getMonth() + m, 1);
      label = d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
    }
    points.push({
      label,
      currentPace: currentValues[m],
      optimized: optimizedValues[m],
    });
  }
  return points;
}

// ── custom tooltip ────────────────────────────────────────────────────────────

function CustomTooltip({ active, payload, label }: {
  active?: boolean;
  payload?: { name: string; value: number; color: string }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3 shadow-lg text-xs">
      <p className="mb-2 font-semibold text-gray-700">{label}</p>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center justify-between gap-4">
          <span style={{ color: p.color }} className="font-medium">{p.name}</span>
          <span className="font-semibold text-gray-900 tabular-nums">{fmtShort(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

// ── page ──────────────────────────────────────────────────────────────────────

type Horizon = 1 | 5 | 10;

export default function ForecastPage() {
  const router = useRouter();
  const { can, loading: planLoading } = usePlan();

  const [loading, setLoading]               = useState(true);
  const [error, setError]                   = useState<string | null>(null);
  const [currentNetWorth, setCurrentNetWorth] = useState(0);
  const [avgSavings, setAvgSavings]         = useState<number | null>(null);
  const [horizon, setHorizon]               = useState<Horizon>(5);

  useEffect(() => {
    const { auth } = getFirebaseClient();
    return onAuthStateChanged(auth, async (user) => {
      if (!user) { router.push("/account/login"); return; }
      setLoading(true); setError(null);
      try {
        const token = await user.getIdToken();
        const res = await fetch("/api/user/statements/consolidated", {
          headers: { Authorization: `Bearer ${token}` },
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) { setError(json.error || "Failed to load"); return; }

        setCurrentNetWorth(json.data?.netWorth ?? 0);

        // Compute avg monthly savings from recent history
        const history: { yearMonth: string; incomeTotal: number; expensesTotal: number }[] =
          json.history ?? [];
        const recentMonths = history
          .filter((h) => h.incomeTotal > 0)
          .slice(-LOOKBACK_MONTHS);

        if (recentMonths.length > 0) {
          const totalSavings = recentMonths.reduce(
            (s, h) => s + (h.incomeTotal - h.expensesTotal), 0
          );
          setAvgSavings(Math.round(totalSavings / recentMonths.length));
        }
      } catch { setError("Failed to load forecast data"); }
      finally { setLoading(false); }
    });
  }, [router]);

  // ── derived ──────────────────────────────────────────────────────────────────

  const monthlySavings   = avgSavings ?? 0;
  const optimizedSavings = Math.round(monthlySavings * (1 + OPTIMIZED_BOOST));
  const totalMonths      = horizon * 12;

  const currentPaceValues  = projectNetWorth(currentNetWorth, monthlySavings, totalMonths);
  const optimizedValues    = projectNetWorth(currentNetWorth, optimizedSavings, totalMonths);

  const proj1yr_opt  = optimizedValues[Math.min(12, totalMonths)];
  const proj5yr_opt  = optimizedValues[Math.min(60, totalMonths)];
  const proj1yr_curr = currentPaceValues[Math.min(12, totalMonths)];

  const delta1yr     = proj1yr_opt - currentNetWorth;
  const delta5yr     = proj5yr_opt - currentNetWorth;
  const pct5yr       = pct(currentNetWorth, proj5yr_opt);

  const chartData = buildChartData(
    currentNetWorth, monthlySavings, optimizedSavings, horizon
  );

  const isSavingsNegative = monthlySavings < 0;
  const hasData = avgSavings !== null;

  // ── render ───────────────────────────────────────────────────────────────────

  if (planLoading || loading) return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <div className="h-10 w-10 animate-spin rounded-full border-4 border-purple-600 border-t-transparent" />
    </div>
  );
  if (!can("forecast")) return (
    <UpgradePrompt feature="forecast" description="See where your net worth is heading with 1, 5, and 10-year projections." />
  );
  if (error) return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <p className="text-red-600">{error}</p>
    </div>
  );

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900">Forecast</h1>
        <p className="mt-0.5 text-sm text-gray-400">
          Where your finances are headed based on current trends
        </p>
      </div>

      {/* No-data state */}
      {!hasData && (
        <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-12 text-center">
          <p className="text-sm text-gray-500">Not enough history to generate a forecast.</p>
          <p className="mt-1 text-xs text-gray-400">
            Upload at least 1 month of income statements to unlock projections.
          </p>
        </div>
      )}

      {hasData && (
        <div className="space-y-5">

          {/* ── Spending-more-than-earning warning ─────────────────────────── */}
          {isSavingsNegative && (
            <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
              <span className="mt-0.5 text-red-500">⚠</span>
              <div>
                <p className="text-sm font-semibold text-red-700">Spending exceeds income</p>
                <p className="text-xs text-red-600 mt-0.5">
                  At current pace you&apos;re drawing down{" "}
                  <span className="font-medium">{fmtShort(Math.abs(monthlySavings))}/mo</span>.
                  Net worth will decline without changes.
                </p>
              </div>
            </div>
          )}

          {/* ── KPI cards ──────────────────────────────────────────────────── */}
          <div className="grid grid-cols-3 gap-3">
            {/* Current */}
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
              <p className="text-xs font-medium text-gray-400">Net worth now</p>
              <p className="mt-1.5 text-xl font-bold text-gray-900 tabular-nums">
                {fmtShort(currentNetWorth)}
              </p>
              <p className="mt-1 text-xs text-gray-400">current</p>
            </div>
            {/* 1 yr */}
            <div className="rounded-xl border border-gray-200 bg-white p-4">
              <p className="text-xs font-medium text-gray-400">Projected (1 yr)</p>
              <p className="mt-1.5 text-xl font-bold text-gray-900 tabular-nums">
                {fmtShort(proj1yr_opt)}
              </p>
              <p className={`mt-1 text-xs font-medium ${delta1yr >= 0 ? "text-green-600" : "text-red-500"}`}>
                {delta1yr >= 0 ? "+" : ""}{fmtShort(delta1yr)}{" "}
                <span className="font-normal text-gray-400">
                  {isSavingsNegative ? "decline" : "on track"}
                </span>
              </p>
            </div>
            {/* 5 yr */}
            <div className="rounded-xl border border-gray-200 bg-white p-4">
              <p className="text-xs font-medium text-gray-400">Projected (5 yr)</p>
              <p className="mt-1.5 text-xl font-bold text-gray-900 tabular-nums">
                {fmtShort(proj5yr_opt)}
              </p>
              <p className={`mt-1 text-xs font-medium ${pct5yr >= 0 ? "text-green-600" : "text-red-500"}`}>
                {pct5yr >= 0 ? "+" : ""}{pct5yr}%{" "}
                <span className="font-normal text-gray-400">
                  {pct5yr >= 0 ? "growth" : "decline"}
                </span>
              </p>
            </div>
          </div>

          {/* ── Trajectory chart ───────────────────────────────────────────── */}
          <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-start justify-between">
              <div>
                <p className="font-semibold text-gray-900">Net worth trajectory</p>
                <p className="mt-0.5 text-xs text-gray-400">
                  Assumes {fmt(monthlySavings)}/mo savings · 4% annual return ·{" "}
                  Optimized = 20% savings boost
                </p>
              </div>
              {/* Horizon selector */}
              <div className="flex gap-1 rounded-lg border border-gray-200 p-0.5 bg-gray-50">
                {([1, 5, 10] as Horizon[]).map((h) => (
                  <button key={h} onClick={() => setHorizon(h)}
                    className={`rounded px-2.5 py-1 text-xs font-semibold transition ${
                      horizon === h
                        ? "bg-white text-gray-900 shadow-sm"
                        : "text-gray-400 hover:text-gray-600"
                    }`}
                  >
                    {h}yr
                  </button>
                ))}
              </div>
            </div>

            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 11, fill: "#9ca3af" }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    tickFormatter={fmtAxis}
                    tick={{ fontSize: 11, fill: "#9ca3af" }}
                    tickLine={false}
                    axisLine={false}
                    width={58}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend
                    iconType="line"
                    iconSize={16}
                    wrapperStyle={{ fontSize: "11px", paddingTop: "12px" }}
                    formatter={(value) => (
                      <span style={{ color: "#6b7280" }}>{value}</span>
                    )}
                  />
                  {/* Optimized: filled area */}
                  <Area
                    type="monotone"
                    dataKey="optimized"
                    name="Optimized"
                    stroke="#3b82f6"
                    strokeWidth={2}
                    fill="rgba(59,130,246,0.08)"
                    dot={false}
                    activeDot={{ r: 4, fill: "#3b82f6", stroke: "#fff", strokeWidth: 2 }}
                  />
                  {/* Current pace: dashed line, no fill */}
                  <Line
                    type="monotone"
                    dataKey="currentPace"
                    name="Current pace"
                    stroke="#9ca3af"
                    strokeWidth={1.5}
                    strokeDasharray="5 4"
                    dot={false}
                    activeDot={{ r: 4, fill: "#9ca3af", stroke: "#fff", strokeWidth: 2 }}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* ── Assumptions + uplift card ───────────────────────────────────── */}
          <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">
              How optimized is calculated
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="rounded-lg bg-gray-50 p-3">
                <p className="text-xs text-gray-400">Current savings/mo</p>
                <p className={`mt-1 text-lg font-bold tabular-nums ${monthlySavings < 0 ? "text-red-500" : "text-gray-900"}`}>
                  {fmt(monthlySavings)}
                </p>
                <p className="text-[10px] text-gray-400">avg last {LOOKBACK_MONTHS} months</p>
              </div>
              <div className="rounded-lg bg-blue-50 p-3 border border-blue-100">
                <p className="text-xs text-blue-400">Optimized savings/mo</p>
                <p className="mt-1 text-lg font-bold tabular-nums text-blue-700">
                  {fmt(optimizedSavings)}
                </p>
                <p className="text-[10px] text-blue-400">+{Math.round(OPTIMIZED_BOOST * 100)}% improvement</p>
              </div>
              <div className="rounded-lg bg-gray-50 p-3">
                <p className="text-xs text-gray-400">5yr uplift</p>
                <p className="mt-1 text-lg font-bold tabular-nums text-green-600">
                  {fmtShort(proj5yr_opt - (currentPaceValues[Math.min(60, totalMonths)]))}
                </p>
                <p className="text-[10px] text-gray-400">vs current pace at 5 yrs</p>
              </div>
            </div>
            <p className="mt-3 text-[11px] text-gray-400 leading-relaxed">
              Projections assume a 4% annual return on existing net worth and a{" "}
              {Math.round(OPTIMIZED_BOOST * 100)}% increase in monthly savings for the optimized scenario.
              Actual results will vary. These are directional estimates, not financial advice.
            </p>
          </div>

        </div>
      )}
    </div>
  );
}
