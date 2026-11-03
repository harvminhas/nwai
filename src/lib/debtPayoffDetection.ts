/**
 * Debt payoff detection logic.
 * 
 * Strong signals (auto-mark with undo option):
 * - Balance <= 0 after previous statement carried a balance
 *   (Credit cards: only if balance carried for 3+ months)
 * - Statement text contains payoff indicators
 * 
 * Weak signals (prompt user):
 * - Regular payment from checking stops while balance was low
 * - No statement for 2+ months
 */

import type { ParsedStatementData } from "./types";
import type { AccountStatusRecord } from "./accountStatus";

export type DetectionStrength = "strong" | "weak" | "none";

export interface PayoffDetection {
  strength: DetectionStrength;
  reason: string;
  confidence: number; // 0-1
  suggestedStatusDate: string; // YYYY-MM-DD
}

/**
 * Detect if a debt account has been paid off based on statement data.
 */
export function detectDebtPayoff(
  currentStatement: ParsedStatementData,
  previousStatements: ParsedStatementData[],
  accountSlug: string
): PayoffDetection {
  const accountType = (currentStatement.accountType ?? "").toLowerCase();
  const isDebtAccount = ["credit", "loan", "mortgage", "line_of_credit"].includes(accountType);
  
  if (!isDebtAccount) {
    return { strength: "none", reason: "Not a debt account", confidence: 0, suggestedStatusDate: "" };
  }

  const currentBalance = currentStatement.netWorth ?? 0;
  const statementDate = currentStatement.statementDate ?? "";

  // Strong signal 1: Balance cleared after carrying a balance
  if (currentBalance >= 0) {
    const sortedPrevious = [...previousStatements].sort((a, b) => 
      (b.statementDate ?? "").localeCompare(a.statementDate ?? "")
    );

    if (sortedPrevious.length > 0) {
      const prevBalance = sortedPrevious[0].netWorth ?? 0;
      
      if (prevBalance < 0) {
        // For credit cards, check if balance was carried for 3+ months
        if (accountType === "credit") {
          const balanceMonths = sortedPrevious.slice(0, 3).filter(s => (s.netWorth ?? 0) < 0).length;
          
          if (balanceMonths >= 2) { // 2 previous + current would be 3 months
            return {
              strength: "strong",
              reason: "Balance cleared after carrying for 3+ months",
              confidence: 0.95,
              suggestedStatusDate: statementDate,
            };
          }
        } else {
          // For loans/mortgages, any balance clearing is strong
          return {
            strength: "strong",
            reason: "Loan balance cleared",
            confidence: 0.95,
            suggestedStatusDate: statementDate,
          };
        }
      }
    }
  }

  // Strong signal 2: Statement text indicates payoff
  const textIndicators = [
    "paid in full",
    "final payment",
    "account closed",
    "payoff confirmed",
    "loan satisfied",
    "mortgage discharged",
  ];

  // Check transaction descriptions and statement text if available
  const allText = [
    ...(currentStatement.expenses?.transactions ?? []).map(t => (t.merchant ?? "").toLowerCase()),
    ...(currentStatement.income?.transactions ?? []).map(t => (t.description ?? "").toLowerCase()),
  ].join(" ");

  for (const indicator of textIndicators) {
    if (allText.includes(indicator)) {
      return {
        strength: "strong",
        reason: `Statement text: "${indicator}"`,
        confidence: 0.90,
        suggestedStatusDate: statementDate,
      };
    }
  }

  // Weak signal 1: No recent statement (2+ months gap)
  const sortedPrevious = [...previousStatements].sort((a, b) => 
    (b.statementDate ?? "").localeCompare(a.statementDate ?? "")
  );

  if (sortedPrevious.length > 0) {
    const latestPrevDate = sortedPrevious[0].statementDate ?? "";
    const monthsDiff = getMonthsDifference(latestPrevDate, new Date().toISOString().slice(0, 10));
    
    const latestBalance = sortedPrevious[0].netWorth ?? 0;
    const isLowBalance = Math.abs(latestBalance) < 100;

    if (monthsDiff >= 2 && isLowBalance) {
      return {
        strength: "weak",
        reason: "No statement for 2+ months with low balance",
        confidence: 0.60,
        suggestedStatusDate: latestPrevDate,
      };
    }
  }

  return { strength: "none", reason: "", confidence: 0, suggestedStatusDate: "" };
}

/**
 * Calculate months difference between two YYYY-MM-DD dates.
 */
function getMonthsDifference(date1: string, date2: string): number {
  const [y1, m1] = date1.split("-").map(Number);
  const [y2, m2] = date2.split("-").map(Number);
  return (y2 - y1) * 12 + (m2 - m1);
}

/**
 * Check if user should be prompted about potential payoff.
 */
export function shouldPromptPayoff(
  detection: PayoffDetection,
  currentStatus: AccountStatusRecord | null
): boolean {
  // Don't prompt if already marked as paid off or closed
  if (currentStatus && currentStatus.status !== "open") {
    return false;
  }

  // Prompt on weak signals
  return detection.strength === "weak";
}

/**
 * Check if payoff should be auto-marked (with undo option).
 */
export function shouldAutoMarkPayoff(
  detection: PayoffDetection,
  currentStatus: AccountStatusRecord | null
): boolean {
  // Don't auto-mark if already marked
  if (currentStatus && currentStatus.status !== "open") {
    return false;
  }

  // Auto-mark on strong signals only
  return detection.strength === "strong" && detection.confidence >= 0.85;
}
