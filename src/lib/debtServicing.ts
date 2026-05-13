/**
 * Debt servicing taxonomy — installment vs revolving settlement.
 *
 * Installment Servicing (mortgage / auto / student / personal installment):
 *   underlying purchase is not otherwise in monthly category spend → include in core totals.
 *
 * Card Servicing (credit card + line-of-credit payments from checking):
 *   paired with charges already counted on the card → exclude from core (no double-count).
 *
 * Legacy rows may still use parent "Debt Payments" or old subtypes; routing helpers below
 * normalize consistently for txn-level vs aggregate-only (category label) contexts.
 */

import type { DebtType } from "./types";
import { getParentCategory, isSubtype, type ParentCategory } from "./categoryTaxonomy";

export const DEBT_PARENT: ParentCategory = "Debt";
export const INSTALLMENT_SERVICING = "Installment Servicing";
export const CARD_SERVICING = "Card Servicing";

export type DebtServicingKind = "installment" | "card";

/**
 * Map plain "Debt Payments" + metadata to servicing kind (txn-level — uses debtType/merchant).
 */
export function legacyPlainDebtPaymentsKind(
  debtType?: string,
  merchant?: string,
): DebtServicingKind {
  const dt = (debtType ?? "").toLowerCase().replace(/-/g, "_") as DebtType | string;
  if (dt === "credit_card" || dt === "line_of_credit") return "card";
  if (
    dt === "mortgage" ||
    dt === "auto_loan" ||
    dt === "personal_loan" ||
    dt === "student_loan" ||
    dt === "other_debt"
  ) {
    return "installment";
  }
  const m = (merchant ?? "").toLowerCase();
  if (
    /\bvisa\b|\bmastercard\b|master card|\bamex\b|american express|credit card|\bcc\b| pymt|payment thank|thank you| loc |\bloc\b|line of credit/i.test(
      m,
    )
  ) {
    return "card";
  }
  if (
    /mortgage|mtg\b|home\s*loan|student loan|\bosap\b|\bnssl\b|nelnet|auto loan|car loan|personal loan|installment/i.test(
      m,
    )
  ) {
    return "installment";
  }
  // Default: fixed obligations thesis — avoids hiding mortgage/auto mislabeled as generic Debt Payments
  return "installment";
}

/**
 * Classify a debt-servicing expense for core-spend exclusion.
 *
 * When `forAggregateLabel` is true (category rollup / no txn metadata), legacy bucket
 * "Debt Payments" is treated as card servicing so ambiguous rolled-up totals stay conservative.
 */
export function resolveDebtServicingKind(
  category: string,
  debtType?: string,
  merchant?: string,
  forAggregateLabel?: boolean,
): DebtServicingKind | null {
  const c = category.trim();
  if (/^installment servicing$/i.test(c)) return "installment";
  if (/^card servicing$/i.test(c)) return "card";
  if (/^credit card payment$/i.test(c)) return "card";
  if (/^line of credit$/i.test(c)) return "card";
  if (/^mortgage payment$/i.test(c)) return "installment";
  if (/^student loan$/i.test(c)) return "installment";
  if (/^loan payment$/i.test(c)) return "installment";
  if (/^debt payments$/i.test(c)) {
    if (forAggregateLabel) return "card";
    return legacyPlainDebtPaymentsKind(debtType, merchant);
  }
  const parent = getParentCategory(c);
  if (parent === DEBT_PARENT) {
    if (/^card servicing$/i.test(c)) return "card";
    if (/^installment servicing$/i.test(c)) return "installment";
    return null;
  }
  return null;
}

/** True if this expense category is any debt-servicing row (both kinds + legacy). */
export function isDebtServicingExpense(
  category: string,
  opts?: { debtType?: string; merchant?: string },
): boolean {
  const c = category.trim();
  if (resolveDebtServicingKind(c, opts?.debtType, opts?.merchant, false) != null) return true;
  if (/^debt payments$/i.test(c)) return true;
  if (getParentCategory(c) === DEBT_PARENT) return true;
  return false;
}

/**
 * Canonical stored category for new / migrated expense rows under Debt.
 */
export function normalizeDebtExpenseCategory(tx: {
  category?: string;
  debtType?: string;
  merchant?: string;
}): string {
  const cat = (tx.category ?? "").trim();
  if (/^installment servicing$/i.test(cat)) return INSTALLMENT_SERVICING;
  if (/^card servicing$/i.test(cat)) return CARD_SERVICING;
  if (/^credit card payment$/i.test(cat)) return CARD_SERVICING;
  if (/^line of credit$/i.test(cat)) return CARD_SERVICING;
  if (/^mortgage payment$/i.test(cat)) return INSTALLMENT_SERVICING;
  if (/^student loan$/i.test(cat)) return INSTALLMENT_SERVICING;
  if (/^loan payment$/i.test(cat)) return INSTALLMENT_SERVICING;
  if (/^debt payments$/i.test(cat)) {
    return legacyPlainDebtPaymentsKind(tx.debtType, tx.merchant) === "installment"
      ? INSTALLMENT_SERVICING
      : CARD_SERVICING;
  }
  return cat;
}

/**
 * Bucket label when grouping merchants under a parent category row (spending UI).
 * Legacy debt strings (e.g. Mortgage Payment) are not taxonomy subtypes; without this
 * the UI falls back to the parent name and shows "Debt" nested under "Debt".
 */
export function merchantSubtypeGroupLabel(
  parentRowName: string,
  merchantCategory: string | undefined,
  opts?: { debtType?: string; merchant?: string },
): string {
  const cat = (merchantCategory || "").trim();
  if (isSubtype(cat)) return cat;
  if (parentRowName !== DEBT_PARENT) return parentRowName;

  const kind = resolveDebtServicingKind(cat, opts?.debtType, opts?.merchant, false);
  if (kind === "installment") return INSTALLMENT_SERVICING;
  if (kind === "card") return CARD_SERVICING;
  if (getParentCategory(cat) === DEBT_PARENT && cat.toLowerCase() !== "debt") return cat;
  return INSTALLMENT_SERVICING;
}
