/**
 * Spending aggregation by category.
 *
 * Totals come from {@link computeMonthSpending} averaged over the window.
 * Loan payments are the actual installment transactions in those months,
 * not scheduled/estimated amounts.
 */

import { getParentCategory } from "./categoryTaxonomy";
import { computeMonthSpending } from "./spendingMetrics";
import type { AccountSnapshot, ExpenseTxnRecord, DebtPaymentHistoryEntry } from "./extractTransactions";
import {
  displayedMerchantName,
  type MerchantRenameContext,
} from "./merchantAliases";

export interface CategorySpendingSummary {
  category: string;
  /** Monthly amount (sum of {@link computeMonthSpending} lines / months) */
  monthlyAmount: number;
  /** Total over the period */
  total: number;
  /** Number of transactions */
  count: number;
  /** Whether this is computed from scheduled payments vs raw transactions */
  isScheduled?: boolean;
  /** Per-merchant breakdown */
  merchants?: Array<{ merchant: string; monthlyAmount: number; accountSlug?: string }>;
}

/**
 * Aggregate spending by parent category for a period.
 */
export function aggregateSpendingByCategory(
  expenseTxns: ExpenseTxnRecord[],
  _accountSnapshots: AccountSnapshot[],
  _debtPaymentHistory: DebtPaymentHistoryEntry[] | number,
  months: number,
  renameCtx?: MerchantRenameContext | null,
): CategorySpendingSummary[] {
  // Older tests passed `months` as the third argument.
  const monthCount = typeof _debtPaymentHistory === "number"
    ? Math.max(1, _debtPaymentHistory)
    : Math.max(1, months);

  const yearMonths = [...new Set(expenseTxns.map((t) => t.txMonth))].sort();
  const byParent = new Map<
    string,
    { total: number; count: number; merchants: Map<string, { amount: number; accountSlug?: string }> }
  >();

  for (const ym of yearMonths) {
    const { lines } = computeMonthSpending(ym, expenseTxns);
    for (const line of lines) {
      const parent = getParentCategory(line.category);
      if (!byParent.has(parent)) {
        byParent.set(parent, { total: 0, count: 0, merchants: new Map() });
      }
      const entry = byParent.get(parent)!;
      entry.total += line.amount;
      entry.count += line.transactions.length;
      for (const txn of line.transactions) {
        const name = displayedMerchantName(
          txn.merchant || "Unknown",
          renameCtx?.aliasResolver,
          renameCtx?.displayNames,
        );
        const prev = entry.merchants.get(name) ?? { amount: 0, accountSlug: txn.accountSlug };
        prev.amount += Math.abs(txn.amount);
        entry.merchants.set(name, prev);
      }
    }
  }

  const results: CategorySpendingSummary[] = [];
  for (const [category, data] of byParent) {
    const merchants = Array.from(data.merchants.entries())
      .map(([merchant, row]) => ({
        merchant,
        monthlyAmount: row.amount / monthCount,
        accountSlug: row.accountSlug,
      }))
      .sort((a, b) => b.monthlyAmount - a.monthlyAmount)
      .slice(0, 5);

    results.push({
      category,
      monthlyAmount: data.total / monthCount,
      total: data.total,
      count: data.count,
      isScheduled: false,
      merchants,
    });
  }

  return results.sort((a, b) => b.monthlyAmount - a.monthlyAmount);
}
