/**
 * Income review detection — identifies transactions needing classification.
 * 
 * Returns review items for:
 * - Ambiguous credits (e-transfers without matching outgoing transfer, not recurring payroll)
 * - Possible refunds (merchant returns)
 * - Source merge suggestions (similar names)
 */

import type { IncomeTxnRecord, AccountSnapshot } from "./extractTransactions";
import type { IncomeClassificationReviewItem } from "./reviewTypes";
import { INCOME_TRANSFER_RE } from "./spendingMetrics";

/** Detect if source name indicates it's likely an e-transfer or interac */
function isETransferPattern(source: string): boolean {
  return /e[-\s]?transfer|interac/i.test(source);
}

/** 
 * Detect if a transaction might be a transfer based on ambiguous characteristics.
 * Only flags if: e-transfer pattern AND not part of recurring payroll pattern.
 */
function isPossibleTransfer(
  source: string,
  transactions: IncomeTxnRecord[]
): boolean {
  if (!isETransferPattern(source)) return false;
  
  // If it's recurring (3+ occurrences), likely payroll not transfers
  const sourceOccurrences = transactions.filter(t => t.source === source).length;
  if (sourceOccurrences >= 3) return false;
  
  // Otherwise it's ambiguous - could be personal transfer or one-time income
  return true;
}

/** Detect if a transaction might be a refund */
function isPossibleRefund(source: string): boolean {
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
 * Detect similar source names that might be the same entity.
 * Uses fuzzy matching with thresholds.
 */
function findSimilarSources(
  sources: string[],
  threshold: number = 0.7
): Array<{ canonical: string; aliases: string[] }> {
  const normalized = sources.map(s => s.toLowerCase().trim());
  const groups: Array<{ canonical: string; aliases: string[] }> = [];
  const processed = new Set<string>();
  
  for (let i = 0; i < sources.length; i++) {
    if (processed.has(sources[i])) continue;
    
    const similar: string[] = [];
    const base = normalized[i];
    
    for (let j = i + 1; j < sources.length; j++) {
      if (processed.has(sources[j])) continue;
      
      const compare = normalized[j];
      
      // Simple similarity: one is substring of other, or share significant prefix
      const isSubstring = base.includes(compare) || compare.includes(base);
      const sharedPrefix = findCommonPrefix(base, compare);
      const prefixRatio = sharedPrefix.length / Math.min(base.length, compare.length);
      
      if (isSubstring || prefixRatio > threshold) {
        similar.push(sources[j]);
        processed.add(sources[j]);
      }
    }
    
    if (similar.length > 0) {
      groups.push({
        canonical: sources[i],
        aliases: similar
      });
      processed.add(sources[i]);
    }
  }
  
  return groups;
}

function findCommonPrefix(a: string, b: string): string {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) {
    i++;
  }
  return a.slice(0, i);
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
  const allSources: string[] = [];
  
  // First pass: collect all unique sources
  for (const txn of incomeTxns) {
    const source = txn.source || "Unknown";
    if (!allSources.includes(source)) {
      allSources.push(source);
    }
  }
  
  // Detect similar sources for merge suggestions
  const mergeSuggestions = findSimilarSources(allSources);
  
  // Add merge suggestion reviews
  for (const group of mergeSuggestions) {
    for (const alias of group.aliases) {
      const reviewId = `income_merge_${alias.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`;
      if (reviewedIds.has(reviewId)) continue;
      
      const aliasTxn = incomeTxns.find(t => t.source === alias);
      if (!aliasTxn) continue;
      
      reviews.push({
        id: reviewId,
        type: "income_classification",
        accountSlug: aliasTxn.accountSlug,
        date: aliasTxn.date,
        amount: aliasTxn.amount,
        txMonth: aliasTxn.txMonth,
        source: `${alias} → ${group.canonical}?`,
        reason: "ambiguous_category",
        suggestedCategory: "merge"
      });
      
      // Limit merge suggestions
      if (reviews.length >= 5) break;
    }
    if (reviews.length >= 5) break;
  }
  
  // Second pass: check for ambiguous classifications
  for (const txn of incomeTxns) {
    const source = txn.source || "Unknown";
    
    // Skip if we've already reviewed this source
    if (seenSources.has(source.toLowerCase())) continue;
    
    // Build review ID
    const reviewId = `income_${source.toLowerCase().replace(/[^a-z0-9]+/g, "_")}_${txn.date}`;
    
    // Skip if already reviewed
    if (reviewedIds.has(reviewId)) continue;
    
    let reason: "possible_transfer" | "possible_refund" | "ambiguous_category" | null = null;
    let suggestedCategory: string | undefined;
    
    // Check for ambiguous classifications
    if (isPossibleTransfer(source, incomeTxns)) {
      reason = "possible_transfer";
      suggestedCategory = "Transfer";
    } else if (isPossibleRefund(source)) {
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
