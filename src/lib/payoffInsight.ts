/**
 * Payoff Insight Calculation
 * 
 * Compares current debt payoff with accelerated payment scenarios.
 * Shows interest saved and months saved by adding extra payments.
 */

export interface PayoffScenario {
  accountSlug: string;
  accountName?: string;
  balance: number;
  rate: number; // annual %
  currentPayment: number;
  currentMonths: number;
  currentTotalPaid: number;
  currentInterestPaid: number;
  
  extraPayment: number; // e.g. +200
  acceleratedMonths: number;
  acceleratedTotalPaid: number;
  acceleratedInterestPaid: number;
  
  monthsSaved: number;
  interestSaved: number;
}

export interface PayoffInsightSummary {
  hasInsight: boolean;
  scenarios: PayoffScenario[];
  highestRateAccount?: {
    accountSlug: string;
    accountName?: string;
    rate: number;
  };
}

/**
 * Calculate months to payoff and total interest paid for a debt.
 * Uses standard amortization formula with monthly compounding.
 */
function calculatePayoff(
  balance: number,
  monthlyPayment: number,
  annualRate: number
): { months: number; totalPaid: number; interestPaid: number } | null {
  if (balance <= 0 || monthlyPayment <= 0 || annualRate < 0) {
    return null;
  }

  const monthlyRate = annualRate / 100 / 12;
  
  // If payment is less than monthly interest, debt will never be paid off
  const monthlyInterest = balance * monthlyRate;
  if (monthlyPayment <= monthlyInterest) {
    return null;
  }

  // Amortization formula: n = -log(1 - (r * P) / M) / log(1 + r)
  // where P = principal, M = monthly payment, r = monthly rate
  const months = Math.ceil(
    -Math.log(1 - (monthlyRate * balance) / monthlyPayment) / Math.log(1 + monthlyRate)
  );

  if (!Number.isFinite(months) || months <= 0 || months > 1200) {
    // Cap at 100 years to prevent overflow
    return null;
  }

  const totalPaid = monthlyPayment * months;
  const interestPaid = totalPaid - balance;

  return { months, totalPaid, interestPaid };
}

export interface DebtForPayoff {
  accountSlug: string;
  accountName?: string;
  balance: number;
  interestRate: number | null;
  monthlyPayment: number | null;
}

/**
 * Calculate payoff insight for all eligible debts.
 * Only includes debts with known rate and payment.
 * Suggests extra payment on highest-rate debt.
 */
export function calculatePayoffInsight(
  debts: DebtForPayoff[],
  extraPaymentAmount: number = 200 // Default: suggest +$200/mo
): PayoffInsightSummary {
  // Filter to debts with known rate and payment
  const eligible = debts.filter(
    d => d.interestRate !== null && d.monthlyPayment !== null && d.balance > 0
  );

  if (eligible.length === 0) {
    return { hasInsight: false, scenarios: [] };
  }

  // Find highest-rate debt
  const highestRate = eligible.reduce((max, d) => 
    (d.interestRate! > (max.interestRate || 0)) ? d : max
  );

  const scenarios: PayoffScenario[] = [];

  for (const debt of eligible) {
    const current = calculatePayoff(debt.balance, debt.monthlyPayment!, debt.interestRate!);
    if (!current) continue;

    // Calculate accelerated scenario (add extra payment to highest-rate debt only)
    const isHighestRate = debt.accountSlug === highestRate.accountSlug;
    const acceleratedPayment = debt.monthlyPayment! + (isHighestRate ? extraPaymentAmount : 0);
    const accelerated = calculatePayoff(debt.balance, acceleratedPayment, debt.interestRate!);
    if (!accelerated) continue;

    scenarios.push({
      accountSlug: debt.accountSlug,
      accountName: debt.accountName,
      balance: debt.balance,
      rate: debt.interestRate!,
      currentPayment: debt.monthlyPayment!,
      currentMonths: current.months,
      currentTotalPaid: current.totalPaid,
      currentInterestPaid: current.interestPaid,
      extraPayment: isHighestRate ? extraPaymentAmount : 0,
      acceleratedMonths: accelerated.months,
      acceleratedTotalPaid: accelerated.totalPaid,
      acceleratedInterestPaid: accelerated.interestPaid,
      monthsSaved: current.months - accelerated.months,
      interestSaved: current.interestPaid - accelerated.interestPaid,
    });
  }

  return {
    hasInsight: scenarios.length > 0,
    scenarios,
    highestRateAccount: {
      accountSlug: highestRate.accountSlug,
      accountName: highestRate.accountName,
      rate: highestRate.interestRate!,
    },
  };
}
