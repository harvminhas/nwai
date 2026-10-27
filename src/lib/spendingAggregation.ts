/**
 * Spending aggregation with proper debt payment handling.
 * 
 * For loan/mortgage payments: uses computeScheduledDebtPayments (learned regular payment)
 * instead of summing raw transactions. This ensures:
 * - Scotia Plan shows 1142 (regular payment), not 858 (averaged over months)
 * - FlexLine shows ~2849 (regular), not inflated by CA$32K prepayment
 * - Extra prepayments are excluded (go to Savings & debt, not spending)
 */

import { getParentCategory } from "./categoryTaxonomy";
import { computeScheduledDebtPayments, type ScheduledDebtPayment } from "./debtPayments";
import type { AccountSnapshot, ExpenseTxnRecord, DebtPaymentHistoryEntry } from "./extractTransactions";
import { merchantSlug } from "./applyRules";

export interface CategorySpendingSummary {
  category: string;
  /** Monthly amount (for debt: scheduled payment; for others: average) */
  monthlyAmount: number;
  /** Total over the period (monthlyAmount × months, or scheduled × months for debt) */
  total: number;
  /** Number of transactions (for debt: conceptually 1 per account per month) */
  count: number;
  /** Whether this is computed from scheduled payments vs raw transactions */
  isScheduled?: boolean;
  /** Per-merchant breakdown */
  merchants?: Array<{ merchant: string; monthlyAmount: number; accountSlug?: string }>;
}

/**
 * Aggregate spending by category with proper debt handling.
 * 
 * @param expenseTxns Expense transactions for the period
 * @param accountSnapshots Account snapshots (for debt payment computation)
 * @param months Number of months in the period (for averaging)
 * @returns Category summaries with proper debt handling
 */
export function aggregateSpendingByCategory(
  expenseTxns: ExpenseTxnRecord[],
  accountSnapshots: AccountSnapshot[],
  debtPaymentHistory: DebtPaymentHistoryEntry[],
  months: number
): CategorySpendingSummary[] {
  const monthCount = Math.max(1, months);
  
  // Compute scheduled debt payments (learned regular amounts)
  const scheduledPayments = computeScheduledDebtPayments(accountSnapshots, debtPaymentHistory);
  const scheduledByAccount = new Map(
    scheduledPayments.map(p => [p.accountSlug, p])
  );
  
  // Group transactions by parent category
  const byCategory = new Map<string, ExpenseTxnRecord[]>();
  for (const txn of expenseTxns) {
    const parent = getParentCategory(txn.category ?? "Other");
    if (!byCategory.has(parent)) byCategory.set(parent, []);
    byCategory.get(parent)!.push(txn);
  }
  
  const results: CategorySpendingSummary[] = [];
  
  for (const [category, txns] of byCategory) {
    // Special handling for debt categories
    if (category === "Debt") {
      // Use scheduled payments instead of summing raw transactions
      const loanPayments = scheduledPayments.filter(p => p.debtType === "loan");
      const creditPayments = scheduledPayments.filter(p => p.debtType === "credit");
      
      if (loanPayments.length > 0) {
        const loanMonthly = loanPayments.reduce((s, p) => s + p.amount, 0);
        results.push({
          category: "Loan payments",
          monthlyAmount: loanMonthly,
          total: loanMonthly * monthCount,
          count: loanPayments.length * monthCount,
          isScheduled: true,
          merchants: loanPayments.map(p => ({
            merchant: p.accountName || p.accountSlug,
            monthlyAmount: p.amount,
            accountSlug: p.accountSlug,
          })),
        });
      }
      
      if (creditPayments.length > 0) {
        const creditMonthly = creditPayments.reduce((s, p) => s + p.amount, 0);
        results.push({
          category: "Credit card minimums",
          monthlyAmount: creditMonthly,
          total: creditMonthly * monthCount,
          count: creditPayments.length * monthCount,
          isScheduled: true,
          merchants: creditPayments.map(p => ({
            merchant: p.accountName || p.accountSlug,
            monthlyAmount: p.amount,
            accountSlug: p.accountSlug,
          })),
        });
      }
    } else {
      // Regular category: sum transactions and average
      const total = txns.reduce((s, t) => s + Math.abs(t.amount), 0);
      const monthlyAvg = total / monthCount;
      
      // Top merchants in this category
      const merchantMap = new Map<string, number>();
      for (const txn of txns) {
        const name = txn.merchant || "Unknown";
        merchantMap.set(name, (merchantMap.get(name) ?? 0) + Math.abs(txn.amount));
      }
      
      const merchants = Array.from(merchantMap.entries())
        .map(([merchant, amount]) => ({
          merchant,
          monthlyAmount: amount / monthCount,
        }))
        .sort((a, b) => b.monthlyAmount - a.monthlyAmount)
        .slice(0, 5);
      
      results.push({
        category,
        monthlyAmount: monthlyAvg,
        total,
        count: txns.length,
        merchants,
      });
    }
  }
  
  return results.sort((a, b) => b.monthlyAmount - a.monthlyAmount);
}
