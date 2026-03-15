import type { ParsedStatementData } from "@/lib/types";

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

function formatDelta(value: number): string {
  const abs = Math.abs(value);
  const sign = value >= 0 ? "+" : "−";
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${Math.round(abs / 1_000)}k`;
  return `${sign}${formatCurrency(abs)}`;
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
}: {
  label: string;
  value: number;
  delta: number | null;
  deltaLabel: string | ((delta: number) => string);
  positiveIsGood?: boolean;
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
      <p className="mt-2 font-bold text-2xl text-gray-900 md:text-3xl">{formatCurrency(value)}</p>
      {delta !== null && delta !== 0 && (
        <p className={`mt-1.5 text-xs font-medium ${isGood ? "text-green-600" : "text-red-500"}`}>
          {arrow} {formatDelta(Math.abs(delta))} {resolvedLabel}
        </p>
      )}
      {delta === null && (
        <p className="mt-1.5 text-xs text-gray-400">First month tracked</p>
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
}: {
  data: ParsedStatementData;
  previousMonth: PreviousMonth | null;
  monthLabel: string; // kept for API compat
}) {
  const netWorth = data.netWorth ?? 0;
  const assets = data.assets ?? Math.max(0, netWorth);
  const debts = data.debts ?? Math.max(0, -netWorth);

  const nwDelta = previousMonth != null ? netWorth - previousMonth.netWorth : null;
  const assetsDelta = previousMonth != null ? assets - previousMonth.assets : null;
  const debtsDelta = previousMonth != null ? debts - previousMonth.debts : null;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <KpiCard
        label="Net Worth"
        value={netWorth}
        delta={nwDelta}
        deltaLabel="this month"
        positiveIsGood
      />
      <KpiCard
        label="Total Assets"
        value={assets}
        delta={assetsDelta}
        deltaLabel="vs last month"
        positiveIsGood
      />
      <KpiCard
        label="Total Debts"
        value={debts}
        delta={debtsDelta}
        deltaLabel={(d) => d < 0 ? "paid down" : "more debt"}
        positiveIsGood={false}
      />
    </div>
  );
}
