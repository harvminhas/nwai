import type { ParsedStatementData } from "@/lib/types";

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export default function NetWorthCard({ data }: { data: ParsedStatementData }) {
  return (
    <div className="rounded-lg bg-white p-6 shadow-md transition hover:shadow-lg">
      <div className="flex items-center gap-3">
        <span className="text-3xl" role="img" aria-hidden>
          💰
        </span>
        <div>
          <p className="text-sm font-medium text-gray-500">Current Net Worth</p>
          <p className="font-bold text-5xl text-gray-900">
            {formatCurrency(data.netWorth ?? 0)}
          </p>
          <p className="mt-1 text-sm text-gray-500">
            As of {data.statementDate}
            {data.bankName ? ` · ${data.bankName}` : ""}
          </p>
        </div>
      </div>
    </div>
  );
}
