import type { ParsedStatementData } from "@/lib/types";
import { fmt } from "@/lib/currencyUtils";

export default function NetWorthCard({ data }: { data: ParsedStatementData }) {
  const formatStatementMonth = (dateStr: string | undefined): string => {
    if (!dateStr) return "Latest Net Worth";
    try {
      // Parse various date formats and extract year-month
      const match = dateStr.match(/^(\d{4})-(\d{2})(?:-\d{2})?$/);
      if (match) {
        const [, year, month] = match;
        const date = new Date(parseInt(year), parseInt(month) - 1, 1);
        const formatted = date.toLocaleDateString("en-US", { month: "short", year: "numeric" });
        return `Net worth as of ${formatted}`;
      }
      // Fallback for other date formats
      return "Latest Net Worth";
    } catch {
      return "Latest Net Worth";
    }
  };

  return (
    <div className="rounded-lg bg-white p-6 shadow-md transition hover:shadow-lg">
      <div className="flex items-center gap-3">
        <span className="text-3xl" role="img" aria-hidden>
          💰
        </span>
        <div>
          <p className="text-sm font-medium text-gray-500">{formatStatementMonth(data.statementDate)}</p>
          <p className="font-bold text-5xl text-gray-900">
            {fmt(data.netWorth ?? 0)}
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
