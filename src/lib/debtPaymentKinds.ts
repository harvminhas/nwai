/**
 * Debt payment classification — maps account types to servicing kinds
 * matching the taxonomy in debtServicing.ts (card vs installment).
 * 
 * Card payments are excluded from core spending totals (purchases already counted).
 * Loan/installment payments are included (represent new money out).
 */

export type DebtPaymentKind = "loan" | "card";

/**
 * Classify a debt account by its type.
 * Card servicing: credit, credit_card, line_of_credit
 * Loan/installment servicing: mortgage, loan, auto_loan, student_loan, personal_loan
 */
export function classifyDebtAccount(accountType: string): DebtPaymentKind {
  const cardTypes = ["credit", "credit_card", "line_of_credit"];
  const loanTypes = ["mortgage", "loan", "auto_loan", "student_loan", "personal_loan"];

  if (cardTypes.includes(accountType)) {
    return "card";
  }
  if (loanTypes.includes(accountType)) {
    return "loan";
  }

  // Unknown type: default to 'loan' (safer — counts real cash out)
  return "loan";
}
