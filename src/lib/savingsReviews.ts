/**
 * Generate savings review items from financial profile.
 * Returns items that need user confirmation about whether they count as savings.
 */

import type { SavingsReviewItem } from "./reviewTypes";
import type { FinancialProfileCache } from "./financialProfile";
import { computeMonthlySavings } from "./savingsCalculations";

export function generateSavingsReviews(
  profile: FinancialProfileCache,
  reviewedIds: Set<string>
): SavingsReviewItem[] {
  const reviews: SavingsReviewItem[] = [];
  
  // Get the last 3 complete months
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const completeMonths = profile.monthlyHistory
    .filter(h => h.yearMonth < currentMonth)
    .slice(-3)
    .map(h => h.yearMonth);
  
  // Compute savings for each month to get confirmation items
  for (const month of completeMonths) {
    const result = computeMonthlySavings(
      profile.monthlyHistory,
      profile.accountBalanceHistory,
      profile.expenseTxns,
      month
    );
    
    // Add unreviewed confirmation items
    for (const item of result.needsConfirmation) {
      if (!reviewedIds.has(item.id)) {
        reviews.push({
          id: item.id,
          type: "savings_item",
          merchant: item.merchant,
          category: item.category,
          accountSlug: item.accountSlug,
          accountName: item.accountName,
          date: item.date,
          amount: item.amount,
          txMonth: item.txMonth,
          reason: "Ambiguous savings item - please confirm",
        });
      }
    }
  }
  
  // Dedupe by ID (same item may appear in multiple months)
  const seen = new Set<string>();
  return reviews.filter(r => {
    if (seen.has(r.id)) return false;
    seen.add(r.id);
    return true;
  });
}
