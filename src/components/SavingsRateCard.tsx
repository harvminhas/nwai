import type { ParsedStatementData } from "@/lib/types";
import { fmt } from "@/lib/currencyUtils";

export default function SavingsRateCard({ data }: { data: ParsedStatementData }) {
  // Derive totals from line items to guard against AI miscalculation
  const sources = data.income?.sources ?? [];
  const categories = data.expenses?.categories ?? [];
  const income = sources.length > 0
    ? sources.reduce((s, x) => s + x.amount, 0)
    : (data.income?.total ?? 0);
  const expenses = categories.length > 0
    ? categories.reduce((s, x) => s + x.amount, 0)
    : (data.expenses?.total ?? 0);
  const rate = income > 0 ? Math.round(((income - expenses) / income) * 100) : (data.savingsRate ?? 0);
  const monthlySavings = Math.max(0, income - expenses);
  const annualProjection = monthlySavings * 12;

  return (
    <div className="rounded-lg bg-white p-6 shadow-md transition hover:shadow-lg">
      <div className="flex items-center gap-3">
        <span className="text-3xl" role="img" aria-hidden>
          📊
        </span>
        <div>
          <p className="text-sm font-medium text-gray-500">Savings Rate</p>
          <p className="font-bold text-2xl text-gray-900">{rate}%</p>
        </div>
      </div>
      <div className="mt-4">
        <div className="h-3 overflow-hidden rounded-full bg-gray-100">
          <div
            className="h-full rounded-full bg-green-500"
            style={{ width: `${Math.min(rate, 100)}%` }}
          />
        </div>
        <p className="mt-2 text-sm text-gray-600">
          {rate >= 20 ? "Great! Aim for 20%+" : "Aim for 20%+"}
        </p>
      </div>
      <ul className="mt-4 space-y-1 border-t border-gray-100 pt-4 text-sm text-gray-700">
        <li>Monthly savings: {fmt(monthlySavings)}</li>
        <li>Annual projection: {fmt(annualProjection)}</li>
      </ul>
    </div>
  );
}
