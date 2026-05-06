import type { ParsedStatementData, ExpenseCategory, ExpenseTransaction, IncomeTransaction } from "./types";

/** Stable key for a merchant name used as Firestore doc ID and rule lookup. */
export function merchantSlug(merchant: string): string {
  if (!merchant) return "";
  return merchant
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Returns true when a category string means "this transaction is income, not spending".
 * Handles both AI-assigned values ("Salary", "Government", "Transfer In", "Other")
 * and user-assigned values from the CategoryPicker ("Income - Salary", "Income - Other").
 */
export function isIncomeCategory(cat: string): boolean {
  if (!cat) return false;
  const c = cat.trim().toLowerCase();
  return (
    c === "salary" ||
    c === "government" ||
    c === "transfer in" ||
    c === "other income" ||
    c.startsWith("income -") ||
    c.startsWith("income—") ||
    c === "income"
  );
}

/**
 * Maps a user-facing income category label to an income transaction category string.
 * "Income - Salary" → "Salary", "Income - Other" → "Other", etc.
 */
export function toIncomeCategoryLabel(cat: string): "Salary" | "Government" | "Transfer In" | "Other" {
  const c = cat.trim().toLowerCase();
  if (c === "salary" || c === "income - salary") return "Salary";
  if (c === "government" || c === "income - government") return "Government";
  if (c === "transfer in" || c === "income - transfer in") return "Transfer In";
  return "Other";
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
 * Stable composite key that uniquely identifies an income transaction for
 * category overrides. Mirrors txnKey but uses source slug instead of merchant.
 * "cash" is used as accountSlug for synthetic cash-income entries.
 */
export function incomeTxnKey(accountSlug: string, txn: Pick<IncomeTransaction, "date" | "amount" | "source">): string {
  return `${accountSlug}::${txn.date ?? ""}::${Math.round(Math.abs(txn.amount) * 100)}::${merchantSlug(txn.source ?? "")}`;
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
 * If a rule or override assigns an income category (e.g. "Income - Salary"),
 * the transaction is moved from expenses.transactions → income.transactions
 * so it no longer inflates spending totals.
 */
export function applyRulesAndRecalculate(
  data: ParsedStatementData,
  rules: Map<string, string>,
  txnOverrides?: Map<string, string>,
): ParsedStatementData {
  const categorized = (data.expenses?.transactions ?? []).map((tx) => {
    const key = tx.accountSlug ? txnKey(tx.accountSlug, tx) : null;
    return {
      ...tx,
      category:
        (key && txnOverrides?.get(key))         // 1. per-transaction user override
        ?? rules.get(merchantSlug(tx.merchant)) // 2. merchant-level rule
        ?? tx.category,                         // 3. AI-assigned
    };
  });

  // Rescue any expense transaction that is now labelled as income
  const rescuedIncomeTxns: IncomeTransaction[] = categorized
    .filter((tx) => isIncomeCategory(tx.category ?? ""))
    .map((tx) => ({
      source: tx.merchant ?? "Unknown",
      amount: tx.amount,
      date: tx.date,
      category: toIncomeCategoryLabel(tx.category ?? "Other"),
      accountSlug: tx.accountSlug,
      accountLabel: tx.accountLabel,
      currency: tx.currency,
    }));

  const expenseTxns = categorized.filter((tx) => !isIncomeCategory(tx.category ?? ""));

  // Re-aggregate expense categories from remaining expense transactions
  const categoryMap = new Map<string, number>();
  for (const tx of expenseTxns) {
    const key = tx.category || "Other";
    categoryMap.set(key, (categoryMap.get(key) ?? 0) + tx.amount);
  }

  const expenseTotal = expenseTxns.reduce((s, tx) => s + tx.amount, 0);
  const categories: ExpenseCategory[] = Array.from(categoryMap.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([name, amount]) => ({
      name,
      amount,
      percentage: expenseTotal > 0 ? Math.round((amount / expenseTotal) * 100) : 0,
    }));

  // Merge rescued transactions into income (dedup by source+date+amount key)
  const existingIncomeTxns = (data.income?.transactions ?? []).filter((t) => (t.amount ?? 0) > 0);
  const existingKeys = new Set(
    existingIncomeTxns.map((t) => `${t.source}::${t.date}::${Math.round((t.amount ?? 0) * 100)}`)
  );
  const newIncomeTxns = rescuedIncomeTxns.filter(
    (t) => !existingKeys.has(`${t.source}::${t.date}::${Math.round((t.amount ?? 0) * 100)}`)
  );
  const allIncomeTxns = [...existingIncomeTxns, ...newIncomeTxns];

  // Rebuild income sources and total
  const sourceMap = new Map<string, number>();
  for (const t of allIncomeTxns) {
    const k = (t.source ?? "Unknown").trim();
    sourceMap.set(k, (sourceMap.get(k) ?? 0) + (t.amount ?? 0));
  }
  const incomeTotal = allIncomeTxns.reduce((s, t) => s + (t.amount ?? 0), 0);
  const sources = Array.from(sourceMap.entries()).map(([description, amount]) => ({ description, amount }));

  const savingsRate =
    incomeTotal > 0 ? Math.round(((incomeTotal - expenseTotal) / incomeTotal) * 100) : data.savingsRate;

  return {
    ...data,
    income: { ...data.income, transactions: allIncomeTxns, sources, total: incomeTotal },
    expenses: { ...data.expenses, transactions: expenseTxns, categories, total: expenseTotal },
    savingsRate,
  };
}
