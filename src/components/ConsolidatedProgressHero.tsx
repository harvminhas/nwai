import type { ParsedStatementData } from "@/lib/types";

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

export type PreviousMonth = {
  netWorth: number;
  assets: number;
  debts: number;
};

export default function ConsolidatedProgressHero({
  data,
  previousMonth,
  monthLabel,
}: {
  data: ParsedStatementData;
  previousMonth: PreviousMonth | null;
  monthLabel: string;
}) {
  const netWorth = data.netWorth ?? 0;
  const assets = data.assets ?? Math.max(0, netWorth);
  const debts = data.debts ?? Math.max(0, -netWorth);

  const change =
    previousMonth != null ? netWorth - previousMonth.netWorth : null;
  const assetsChange =
    previousMonth != null ? assets - previousMonth.assets : null;
  const debtsChange =
    previousMonth != null ? debts - previousMonth.debts : null;

  return (
    <div className="mb-8 space-y-6">
      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-md">
        <p className="text-sm font-medium text-gray-500">{monthLabel}</p>
        <p className="mt-1 font-bold text-4xl text-gray-900 md:text-5xl">
          {formatCurrency(netWorth)}
        </p>
        <p className="mt-1 text-sm text-gray-600">Net worth</p>
        {change !== null && (
          <p
            className={`mt-2 text-sm font-medium ${
              change >= 0 ? "text-green-600" : "text-red-600"
            }`}
          >
            {change >= 0 ? "+" : ""}
            {formatCurrency(change)} from last month
          </p>
        )}
        {change === null && (
          <p className="mt-2 text-sm text-gray-500">First month tracked</p>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
          <p className="text-sm font-medium text-gray-500">Assets</p>
          <p className="mt-1 text-2xl font-bold text-gray-900">
            {formatCurrency(assets)}
          </p>
          {assetsChange !== null && assetsChange !== 0 && (
            <p
              className={`mt-1 text-xs font-medium ${
                assetsChange >= 0 ? "text-green-600" : "text-red-600"
              }`}
            >
              {assetsChange >= 0 ? "+" : ""}
              {formatCurrency(assetsChange)} vs last month
            </p>
          )}
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
          <p className="text-sm font-medium text-gray-500">Debts</p>
          <p className="mt-1 text-2xl font-bold text-gray-900">
            {formatCurrency(debts)}
          </p>
          {debtsChange !== null && debtsChange !== 0 && (
            <p
              className={`mt-1 text-xs font-medium ${
                debtsChange <= 0 ? "text-green-600" : "text-red-600"
              }`}
            >
              {debtsChange <= 0 ? "" : "+"}
              {formatCurrency(debtsChange)} vs last month
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
