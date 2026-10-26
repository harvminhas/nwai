/**
 * Income review detection — identifies transactions needing classification.
 * 
 * Returns review items for:
 * - Ambiguous credits (e-transfers, possible refunds)
 * - Possible one-offs that should be confirmed
 * - Source merge suggestions (similar names)
 */

import type { IncomeTxnRecord } from "./extractTransactions";
import type { IncomeClassificationReviewItem } from "./reviewTypes";
import { INCOME_TRANSFER_RE } from "./spendingMetrics";

/** Detect if a transaction might be a transfer (ambiguous e-transfer) */
function isPossibleTransfer(source: string, amount: number): boolean {
  const lower = source.toLowerCase();
  
  // E-transfer patterns (ambiguous - could be income or transfer)
  if (/e[-\s]?transfer|interac/i.test(source)) {
    // Small amounts more likely to be personal transfers
    return amount < 1000;
  }
  
  return false;
}

/** Detect if a transaction might be a refund */
function isPossibleRefund(source: string, category: string | undefined): boolean {
  const lower = source.toLowerCase();
  
  // Refund keywords
  if (/refund|return|credit|reimburs/i.test(lower)) {
    return true;
  }
  
  // Merchant names that are typically expenses showing up as credits
  const merchantPatterns = [
    /amazon/i, /walmart/i, /target/i, /best buy/i,
    /apple/i, /google/i, /microsoft/i,
    /uber/i, /lyft/i, /doordash/i
  ];
  
  return merchantPatterns.some(p => p.test(lower));
}

/** Detect if category classification is ambiguous */
function hasAmbiguousCategory(source: string, category: string | undefined): boolean {
  // If category is already set and specific, probably fine
  if (category && !["Other", "Transfer", "Transfer In"].includes(category)) {
    return false;
  }
  
  // Generic deposit descriptions need classification
  const genericPatterns = [
    /^deposit$/i,
    /^credit$/i,
    /^income$/i,
    /^payroll$/i,
    /^payment$/i
  ];
  
  return genericPatterns.some(p => p.test(source.trim()));
}

/**
 * Generate income classification review items from transactions.
 * 
 * @param incomeTxns - All income transactions
 * @param reviewedIds - Set of transaction IDs already reviewed
 * @returns Array of review items needing user classification
 */
export function generateIncomeReviews(
  incomeTxns: IncomeTxnRecord[],
  reviewedIds: Set<string>
): IncomeClassificationReviewItem[] {
  const reviews: IncomeClassificationReviewItem[] = [];
  
  // Group by source to avoid duplicate reviews for same source
  const seenSources = new Set<string>();
  
  for (const txn of incomeTxns) {
    const source = txn.source || "Unknown";
    
    // Skip if we've already reviewed this source
    if (seenSources.has(source.toLowerCase())) continue;
    
    // Build review ID (using source + date for uniqueness)
    const reviewId = `income_${source.toLowerCase().replace(/[^a-z0-9]+/g, "_")}_${txn.date}`;
    
    // Skip if already reviewed
    if (reviewedIds.has(reviewId)) continue;
    
    let reason: "possible_transfer" | "possible_refund" | "ambiguous_category" | null = null;
    let suggestedCategory: string | undefined;
    
    // Check for ambiguous classifications
    if (isPossibleTransfer(source, txn.amount)) {
      reason = "possible_transfer";
      suggestedCategory = "Transfer";
    } else if (isPossibleRefund(source, txn.category)) {
      reason = "possible_refund";
      suggestedCategory = "Other";
    } else if (hasAmbiguousCategory(source, txn.category)) {
      reason = "ambiguous_category";
      // Try to infer category from source name
      if (/salary|payroll|paych/i.test(source)) {
        suggestedCategory = "Salary";
      } else if (/freelance|contract|consulting/i.test(source)) {
        suggestedCategory = "Freelance";
      } else if (/bonus|incentive/i.test(source)) {
        suggestedCategory = "Bonus";
      }
    }
    
    // Only add review if we detected an issue
    if (reason) {
      reviews.push({
        id: reviewId,
        type: "income_classification",
        accountSlug: txn.accountSlug,
        date: txn.date,
        amount: txn.amount,
        txMonth: txn.txMonth,
        source,
        reason,
        suggestedCategory
      });
      
      seenSources.add(source.toLowerCase());
      
      // Limit to 10 reviews at a time to avoid overwhelming the user
      if (reviews.length >= 10) break;
    }
  }
  
  return reviews;
}
