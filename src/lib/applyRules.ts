import type { ParsedStatementData, ExpenseCategory, ExpenseTransaction } from "./types";

/** Stable key for a merchant name used as Firestore doc ID and rule lookup. */
export function merchantSlug(merchant: string): string {
  if (!merchant) return "";
  return merchant
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Stable composite key that uniquely identifies a transaction for category overrides.
 * Uses `accountSlug` (bankName + accountId — stable across statement re-uploads) rather than
 * `stmtId` (which changes with every re-upload) so overrides survive re-uploads.
 */
export function txnKey(accountSlug: string, txn: Pick<ExpenseTransaction, "date" | "amount" | "merchant">): string {
  return `${accountSlug}::${txn.date ?? ""}::${Math.round(Math.abs(txn.amount) * 100)}::${merchantSlug(txn.merchant)}`;
}

/**
 * Apply category overrides to all expense transactions, then re-aggregate
 * expense categories and totals from the updated transactions.
 *
 * Priority (highest → lowest):
 *   1. Per-transaction user override  (txnOverrides keyed by txnKey)
 *   2. Merchant-level rule            (rules keyed by merchantSlug)
 *   3. AI-assigned category           (stored on the transaction)
 *
 * income is never touched — income data comes from the AI extraction and is
 * preserved as-is. Only expense categories and totals are recalculated.
 */
export function applyRulesAndRecalculate(
  data: ParsedStatementData,
  rules: Map<string, string>,
  txnOverrides?: Map<string, string>,
): ParsedStatementData {
  const transactions = (data.expenses?.transactions ?? []).map((tx) => {
    const key = tx.accountSlug ? txnKey(tx.accountSlug, tx) : null;
    return {
      ...tx,
      category:
        (key && txnOverrides?.get(key))    // 1. per-transaction user override
        ?? rules.get(merchantSlug(tx.merchant)) // 2. merchant-level rule
        ?? tx.category,                         // 3. AI-assigned
    };
  });

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

  const incomeTotal = data.income?.total ?? 0;
  const savingsRate =
    incomeTotal > 0 ? Math.round(((incomeTotal - total) / incomeTotal) * 100) : data.savingsRate;

  return {
    ...data,
    expenses: { ...data.expenses, transactions, categories, total },
    savingsRate,
  };
}
