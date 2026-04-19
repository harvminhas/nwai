import type { ParsedStatementData, ExpenseCategory } from "./types";

/** Stable key for a merchant name used as Firestore doc ID and rule lookup. */
export function merchantSlug(merchant: string): string {
  if (!merchant) return "";
  return merchant
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Apply a map of { merchantSlug → category } rules to all expense transactions,
 * then re-aggregate expense categories and totals from the updated transactions.
 *
 * income is never touched — income data comes from the AI extraction and is
 * preserved as-is. Only expense categories and totals are recalculated.
 *
 * Priority: user rules > AI-assigned category.
 */
export function applyRulesAndRecalculate(
  data: ParsedStatementData,
  rules: Map<string, string>
): ParsedStatementData {
  const transactions = (data.expenses?.transactions ?? []).map((tx) => ({
    ...tx,
    category:
      rules.get(merchantSlug(tx.merchant)) ??   // 1. user rule
      tx.category,                               // 2. AI-assigned
  }));

  // Re-aggregate categories from updated transactions
  const categoryMap = new Map<string, number>();
  for (const tx of transactions) {
    const key = tx.category || "Other";
    categoryMap.set(key, (categoryMap.get(key) ?? 0) + tx.amount);
  }

  const total = transactions.reduce((s, tx) => s + tx.amount, 0);
  const categories: ExpenseCategory[] = Array.from(categoryMap.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([name, amount]) => ({
      name,
      amount,
      percentage: total > 0 ? Math.round((amount / total) * 100) : 0,
    }));

  // Recalculate savings rate with new expense total
  const incomeTotal = data.income?.total ?? 0;
  const savingsRate =
    incomeTotal > 0 ? Math.round(((incomeTotal - total) / incomeTotal) * 100) : data.savingsRate;

  return {
    ...data,
    expenses: { ...data.expenses, transactions, categories, total },
    savingsRate,
  };
}
