import type { Subscription } from "@/lib/types";

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

/** Group subscriptions by normalized name and sum amounts. */
function groupSubscriptions(
  subscriptions: Subscription[]
): { name: string; amount: number }[] {
  const byKey = new Map<string, { name: string; amount: number }>();
  for (const sub of subscriptions) {
    const key = sub.name.trim().toUpperCase() || "OTHER";
    const existing = byKey.get(key);
    if (existing) {
      existing.amount += sub.amount;
    } else {
      byKey.set(key, { name: sub.name.trim() || "Other", amount: sub.amount });
    }
  }
  return Array.from(byKey.values());
}

export default function SubscriptionsCard({
  subscriptions,
}: {
  subscriptions: Subscription[];
}) {
  const grouped = groupSubscriptions(subscriptions);
  const total = grouped.reduce((sum, s) => sum + s.amount, 0);
  const annual = total * 12;

  return (
    <div className="rounded-lg bg-white p-6 shadow-md transition hover:shadow-lg">
      <div className="flex items-center gap-3">
        <span className="text-3xl" role="img" aria-hidden>
          🔄
        </span>
        <div>
          <p className="text-sm font-medium text-gray-500">Subscriptions</p>
          <p className="font-bold text-2xl text-gray-900">
            {grouped.length} found
          </p>
        </div>
      </div>
      <p className="mt-2 text-sm text-gray-600">
        Total: {formatCurrency(total)}/mo ({formatCurrency(annual)}/year)
      </p>
      {grouped.length > 0 && (
        <div className="mt-4 max-h-48 overflow-y-auto border-t border-gray-100 pt-4">
          <ul className="space-y-2">
            {grouped.map((item, index) => (
              <li
                key={`${item.name}-${index}`}
                className="flex justify-between text-sm text-gray-700"
              >
                <span>{item.name}</span>
                <span className="font-medium">{formatCurrency(item.amount)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <button
        type="button"
        className="mt-4 w-full rounded-lg border-2 border-purple-600 py-2 font-semibold text-purple-600 transition hover:bg-purple-50"
      >
        Review All
      </button>
    </div>
  );
}
