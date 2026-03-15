import type { Income, IncomeSource } from "@/lib/types";

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

const DEPOSIT_PATTERNS = [
  /e[-\s]?transfer/i,
  /\bdeposit\b/i,
  /\bGC\s/i,
  /\bCRA\b/i,
  /\bCANADA\b/i,
  /\bGST\b/i,
  /\bOAS\b/i,
  /\bCPP\b/i,
  /\bEI\b/i,
  /\bCERB\b/i,
  /\bINTERACT?\b/i,
];

function normalizeIncomeLabel(description: string): string {
  const d = description.trim();
  if (!d) return "Cash / Deposit";
  if (DEPOSIT_PATTERNS.some((re) => re.test(d))) return "Cash / Deposit";
  // Title-case the label for readability
  return d.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}

/** Group sources by normalized label and sum amounts. */
function groupIncomeSources(sources: IncomeSource[]): { label: string; amount: number }[] {
  const byKey = new Map<string, { label: string; amount: number }>();
  for (const src of sources) {
    const label = normalizeIncomeLabel(src.description);
    const existing = byKey.get(label);
    if (existing) {
      existing.amount += src.amount;
    } else {
      byKey.set(label, { label, amount: src.amount });
    }
  }
  return Array.from(byKey.values());
}

export default function IncomeCard({ income }: { income: Income }) {
  const grouped = income.sources?.length
    ? groupIncomeSources(income.sources)
    : [];

  return (
    <div className="rounded-lg bg-white p-6 shadow-md transition hover:shadow-lg">
      <div className="flex items-center gap-3">
        <span className="text-3xl" role="img" aria-hidden>
          📈
        </span>
        <div>
          <p className="text-sm font-medium text-gray-500">Income</p>
          <p className="font-bold text-2xl text-gray-900">
            {formatCurrency(income.total)}
          </p>
        </div>
      </div>
      {grouped.length > 0 && (
        <ul className="mt-4 space-y-2 border-t border-gray-100 pt-4">
          {grouped.map((item, index) => (
            <li
              key={`${item.label}-${index}`}
              className="flex justify-between text-sm text-gray-700"
            >
              <span>{item.label}</span>
              <span className="font-medium">{formatCurrency(item.amount)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
