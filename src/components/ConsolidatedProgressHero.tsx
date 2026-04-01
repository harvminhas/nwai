import type { ParsedStatementData } from "@/lib/types";
import { fmt, getCurrencySymbol } from "@/lib/currencyUtils";

function formatDelta(value: number): string {
  const sym = getCurrencySymbol();
  const abs = Math.abs(value);
  const sign = value >= 0 ? "+" : "−";
  if (abs >= 1_000_000) return `${sign}${sym}${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}${sym}${Math.round(abs / 1_000)}k`;
  return `${sign}${fmt(abs)}`;
}

export type PreviousMonth = {
  netWorth: number;
  assets: number;
  debts: number;
};

function KpiCard({
  label,
  value,
  delta,
  deltaLabel,
  positiveIsGood = true,
  suppressReason,
}: {
  label: string;
  value: number;
  delta: number | null;
  deltaLabel: string | ((delta: number) => string);
  positiveIsGood?: boolean;
  suppressReason?: string;
}) {
  const isGood = delta !== null && (positiveIsGood ? delta > 0 : delta < 0);
  // Arrow shows the direction the number moved: up = increased, down = decreased
  const arrow = delta !== null && delta > 0 ? "↑" : "↓";
  const resolvedLabel = typeof deltaLabel === "function" && delta !== null
    ? deltaLabel(delta)
    : (deltaLabel as string);

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">{label}</p>
      <p className="mt-2 font-bold text-2xl text-gray-900 md:text-3xl">{fmt(value)}</p>
      {delta !== null && delta !== 0 && (
        <p className={`mt-1.5 text-xs font-medium ${isGood ? "text-green-600" : "text-red-500"}`}>
          {arrow} {formatDelta(Math.abs(delta))} {resolvedLabel}
        </p>
      )}
      {delta === null && (
        <p className="mt-1.5 text-xs text-gray-400">{suppressReason ?? "First month tracked"}</p>
      )}
      {delta === 0 && (
        <p className="mt-1.5 text-xs text-gray-400">No change</p>
      )}
    </div>
  );
}

export default function ConsolidatedProgressHero({
  data,
  previousMonth,
  currentMonthIncomplete = false,
}: {
  data: ParsedStatementData;
  previousMonth: PreviousMonth | null;
  monthLabel: string; // kept for API compat
  currentMonthIncomplete?: boolean;
}) {
  const netWorth = data.netWorth ?? 0;
  const assets = data.assets ?? Math.max(0, netWorth);
  const debts = data.debts ?? Math.max(0, -netWorth);

  // Suppress deltas if the current month is incomplete — they'd be misleading
  const nwDelta    = (!currentMonthIncomplete && previousMonth != null) ? netWorth - previousMonth.netWorth : null;
  const assetsDelta = (!currentMonthIncomplete && previousMonth != null) ? assets - previousMonth.assets : null;
  const debtsDelta  = (!currentMonthIncomplete && previousMonth != null) ? debts - previousMonth.debts : null;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <KpiCard
        label="Net Worth"
        value={netWorth}
        delta={nwDelta}
        deltaLabel="this month"
        positiveIsGood
        suppressReason={currentMonthIncomplete ? "Estimated month" : undefined}
      />
      <KpiCard
        label="Total Assets"
        value={assets}
        delta={assetsDelta}
        deltaLabel="vs last month"
        positiveIsGood
        suppressReason={currentMonthIncomplete ? "Estimated month" : undefined}
      />
      <KpiCard
        label="Total Debts"
        value={debts}
        delta={debtsDelta}
        deltaLabel={(d) => d < 0 ? "paid down" : "more debt"}
        positiveIsGood={false}
        suppressReason={currentMonthIncomplete ? "Estimated month" : undefined}
      />
    </div>
  );
}
