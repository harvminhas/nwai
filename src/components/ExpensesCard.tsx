import type { Expenses, ExpenseCategory } from "@/lib/types";

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

/** Group categories by normalized name and sum amounts; recompute percentage from total. */
function groupExpenseCategories(
  categories: ExpenseCategory[],
  totalExpenses: number
): { name: string; amount: number; percentage: number }[] {
  const byKey = new Map<string, { name: string; amount: number }>();
  for (const cat of categories) {
    const key = cat.name.trim().toUpperCase() || "OTHER";
    const existing = byKey.get(key);
    if (existing) {
      existing.amount += cat.amount;
    } else {
      byKey.set(key, { name: cat.name.trim() || "Other", amount: cat.amount });
    }
  }
  const total = totalExpenses > 0 ? totalExpenses : 1;
  return Array.from(byKey.values()).map((item) => ({
    ...item,
    percentage: Math.round((item.amount / total) * 100),
  }));
}

export default function ExpensesCard({ expenses }: { expenses: Expenses }) {
  const raw = expenses.categories ?? [];
  const categories = groupExpenseCategories(raw, expenses.total);

  return (
    <div className="rounded-lg bg-white p-6 shadow-md transition hover:shadow-lg">
      <div className="flex items-center gap-3">
        <span className="text-3xl" role="img" aria-hidden>
          💳
        </span>
        <div>
          <p className="text-sm font-medium text-gray-500">Expenses</p>
          <p className="font-bold text-2xl text-gray-900">
            {formatCurrency(expenses.total)}
          </p>
        </div>
      </div>
      {categories.length > 0 && (
        <div className="mt-4 space-y-3 border-t border-gray-100 pt-4">
          {categories.map((cat, index) => (
            <div key={`${cat.name}-${index}`}>
              <div className="flex justify-between text-sm">
                <span className="text-gray-700">{cat.name}</span>
                <span className="font-medium text-gray-900">
                  {formatCurrency(cat.amount)} ({cat.percentage}%)
                </span>
              </div>
              <div className="mt-1 h-2 overflow-hidden rounded-full bg-gray-100">
                <div
                  className="h-full rounded-full bg-purple-500"
                  style={{ width: `${Math.min(cat.percentage, 100)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
      <p className="mt-4 text-sm">
        <a href="#" className="font-medium text-purple-600 hover:underline">
          View All Details
        </a>
      </p>
    </div>
  );
}
