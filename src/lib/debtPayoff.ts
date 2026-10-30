/**
 * Debt Payoff Calculator
 * 
 * Simulates debt payoff using avalanche (highest rate first) or snowball (smallest balance first) strategies.
 * Monthly simulation with interest compounding monthly, freed-up payments roll over to the next target debt.
 */

export interface DebtInput {
  id: string;
  name: string;
  balance: number;
  interestRate: number | null; // annual %, null = no rate
  monthlyPayment: number | null; // observed monthly payment from statements, null = unknown
  minPayment: number | null; // statement minimum payment, null = unknown
  accountType: string; // for minimum calculation
  included: boolean;
}

export type PayoffStrategy = "avalanche" | "snowball";

export interface DebtPayoffResult {
  debtFreeDate: string | null; // YYYY-MM format, null if unpayable
  monthsToPayoff: number | null;
  totalInterestPaid: number;
  payoffOrder: Array<{
    debtId: string;
    debtName: string;
    payoffMonth: number; // 1-based month when this debt is paid off
    interestPaid: number;
  }>;
  monthlyBalances: Array<{
    month: number; // 0 = now, 1 = next month, etc.
    totalBalance: number; // total across all debts
  }>;
  warnings: string[];
}

export interface ComparisonResult {
  strategy: PayoffResult;
  minimumOnly: PayoffResult;
  monthsSaved: number;
  interestSaved: number;
}

interface PayoffResult {
  monthsToPayoff: number | null;
  totalInterestPaid: number;
}

/**
 * Detect if a debt is a HELOC/line of credit (interest-only minimum).
 * Checks both account type and name for keywords.
 */
function isHELOC(debt: Pick<DebtInput, 'accountType' | 'name'>): boolean {
  const typeLower = debt.accountType.toLowerCase();
  const nameLower = debt.name.toLowerCase();
  
  return typeLower.includes('loc') || 
         typeLower.includes('line') || 
         typeLower.includes('heloc') ||
         nameLower.includes('flexline') ||
         nameLower.includes('heloc') ||
         nameLower.includes('line of credit');
}

/**
 * Calculate minimum payment for a debt based on type.
 * Never uses the statement "minPayment" field (which is actually paymentsMade, not a minimum).
 * Always calculates based on type and balance.
 */
export function calculateMinimumPayment(debt: Pick<DebtInput, 'balance' | 'interestRate' | 'accountType' | 'name'>): number {
  const rate = debt.interestRate || 0;
  const monthlyRate = rate / 100 / 12;
  const monthlyInterest = debt.balance * monthlyRate;
  
  // HELOC / Line of credit: interest-only (no +1%)
  if (isHELOC(debt)) {
    return monthlyInterest;
  }
  
  const typeLower = debt.accountType.toLowerCase();
  
  // Credit card: max(interest + 1% of balance, 3% of balance, $10)
  if (typeLower.includes('credit')) {
    const option1 = monthlyInterest + debt.balance * 0.01;
    const option2 = debt.balance * 0.03;
    return Math.max(option1, option2, 10);
  }
  
  // Loan / Mortgage: interest + 1% of balance
  if (typeLower.includes('loan') || typeLower.includes('mortgage')) {
    return monthlyInterest + debt.balance * 0.01;
  }
  
  // Default: interest + 1%
  return monthlyInterest + debt.balance * 0.01;
}

/**
 * Solve for the required monthly budget to reach debt-free by a target date.
 * Uses binary search to find the budget that results in payoff within 1 month of target.
 * Returns null if target is impossible even with 10x minimums.
 */
export function solveForTargetDate(
  debts: DebtInput[],
  targetMonths: number,
  strategy: PayoffStrategy
): { requiredBudget: number; result: DebtPayoffResult } | null {
  const includedDebts = debts.filter(d => d.included);
  if (includedDebts.length === 0) return null;
  
  const totalMinimums = includedDebts.reduce((sum, d) => sum + calculateMinimumPayment(d), 0);
  
  // Check if target is achievable with minimums
  const minimumsResult = calculateDebtPayoff(debts, totalMinimums, strategy);
  if (minimumsResult.monthsToPayoff !== null && minimumsResult.monthsToPayoff <= targetMonths) {
    return { requiredBudget: totalMinimums, result: minimumsResult };
  }
  
  // Binary search for required budget
  let low = totalMinimums;
  let high = totalMinimums * 10; // Cap at 10x minimums
  let bestBudget = high;
  let bestResult: DebtPayoffResult | null = null;
  
  const maxIterations = 50;
  for (let i = 0; i < maxIterations; i++) {
    const mid = (low + high) / 2;
    const result = calculateDebtPayoff(debts, mid, strategy);
    
    if (result.monthsToPayoff === null) {
      // Unpayable at this budget
      low = mid;
      continue;
    }
    
    if (Math.abs(result.monthsToPayoff - targetMonths) <= 1) {
      // Within 1 month - good enough
      return { requiredBudget: mid, result };
    }
    
    if (result.monthsToPayoff > targetMonths) {
      // Too slow, need more budget
      low = mid;
    } else {
      // Too fast, can reduce budget
      high = mid;
      bestBudget = mid;
      bestResult = result;
    }
    
    // Convergence check
    if (high - low < 1) break;
  }
  
  // Return best result found, or null if impossible
  if (bestResult && bestResult.monthsToPayoff !== null && bestResult.monthsToPayoff <= targetMonths + 2) {
    return { requiredBudget: bestBudget, result: bestResult };
  }
  
  return null;
}

/**
 * Classify plan status based on current vs projected balance.
 * Returns "on-track", "ahead", or "behind" with delta amount/months.
 */
export function classifyPlanStatus(
  currentBalance: number,
  projectedBalance: number,
  monthlyBudget: number,
  strategy: PayoffStrategy,
  debts: DebtInput[]
): {
  status: "on-track" | "ahead" | "behind";
  deltaAmount: number; // positive = ahead, negative = behind
  deltaMonths: number; // positive = ahead, negative = behind
} {
  const deltaAmount = projectedBalance - currentBalance;
  
  // On track if within 5% of projected
  const threshold = projectedBalance * 0.05;
  if (Math.abs(deltaAmount) <= threshold) {
    return { status: "on-track", deltaAmount: 0, deltaMonths: 0 };
  }
  
  // Estimate months ahead/behind by simulating from current balance
  const adjustedDebts = debts.map(d => ({
    ...d,
    balance: d.included ? (currentBalance / debts.filter(dd => dd.included).length) : d.balance,
  }));
  
  const currentResult = calculateDebtPayoff(adjustedDebts, monthlyBudget, strategy);
  const projectedResult = calculateDebtPayoff(debts, monthlyBudget, strategy);
  
  let deltaMonths = 0;
  if (currentResult.monthsToPayoff !== null && projectedResult.monthsToPayoff !== null) {
    deltaMonths = projectedResult.monthsToPayoff - currentResult.monthsToPayoff;
  }
  
  if (deltaAmount > 0) {
    return { status: "ahead", deltaAmount, deltaMonths: Math.abs(deltaMonths) };
  } else {
    return { status: "behind", deltaAmount: Math.abs(deltaAmount), deltaMonths: Math.abs(deltaMonths) };
  }
}

/**
 * Simulate debt payoff using the specified strategy
 */
export function calculateDebtPayoff(
  debts: DebtInput[],
  monthlyBudget: number,
  strategy: PayoffStrategy
): DebtPayoffResult {
  const warnings: string[] = [];
  
  // Filter to included debts
  const includedDebts = debts.filter(d => d.included);
  
  if (includedDebts.length === 0) {
    return {
      debtFreeDate: null,
      monthsToPayoff: null,
      totalInterestPaid: 0,
      payoffOrder: [],
      monthlyBalances: [],
      warnings: ["No debts included in calculation"],
    };
  }
  
  // Calculate minimums for all debts
  const debtsWithMinimums = includedDebts.map(d => ({
    ...d,
    calculatedMinimum: calculateMinimumPayment(d),
  }));
  
  const totalMinimums = debtsWithMinimums.reduce((sum, d) => sum + d.calculatedMinimum, 0);
  
  // Enforce budget >= minimums
  const effectiveBudget = Math.max(monthlyBudget, totalMinimums);
  
  if (effectiveBudget > monthlyBudget) {
    warnings.push(`Budget increased to ${effectiveBudget.toFixed(2)} (sum of minimums)`);
  }
  
  // Check for missing data
  for (const debt of includedDebts) {
    if (debt.interestRate === null) {
      warnings.push(`${debt.name}: missing interest rate (assumed 0%)`);
    }
  }
  
  // Initialize working state
  interface DebtState {
    id: string;
    name: string;
    balance: number;
    rate: number; // monthly rate
    minimum: number;
    interestPaid: number;
  }
  
  const debtStates: DebtState[] = debtsWithMinimums.map(d => ({
    id: d.id,
    name: d.name,
    balance: d.balance,
    rate: (d.interestRate || 0) / 100 / 12,
    minimum: d.calculatedMinimum,
    interestPaid: 0,
  }));
  
  const payoffOrder: DebtPayoffResult["payoffOrder"] = [];
  const monthlyBalances: DebtPayoffResult["monthlyBalances"] = [];
  
  // Record initial state
  monthlyBalances.push({
    month: 0,
    totalBalance: debtStates.reduce((sum, d) => sum + d.balance, 0),
  });
  
  let month = 0;
  const maxMonths = 600; // 50 years cap
  let budgetRemaining = effectiveBudget;
  
  while (debtStates.some(d => d.balance > 0) && month < maxMonths) {
    month++;
    
    // Apply interest to all debts
    for (const debt of debtStates) {
      if (debt.balance > 0) {
        const interest = debt.balance * debt.rate;
        debt.balance += interest;
        debt.interestPaid += interest;
      }
    }
    
    // Check if budget is unpayable (total minimums > budget AND any debt's minimum <= interest)
    const activeDebts = debtStates.filter(d => d.balance > 0);
    const currentMinimums = activeDebts.reduce((sum, d) => sum + d.minimum, 0);
    
    if (budgetRemaining < currentMinimums) {
      for (const debt of activeDebts) {
        const monthlyInterest = debt.balance * debt.rate;
        if (debt.minimum <= monthlyInterest) {
          warnings.push(`${debt.name}: minimum payment doesn't cover interest`);
          return {
            debtFreeDate: null,
            monthsToPayoff: null,
            totalInterestPaid: debtStates.reduce((sum, d) => sum + d.interestPaid, 0),
            payoffOrder,
            monthlyBalances,
            warnings,
          };
        }
      }
    }
    
    // Apply minimum payments to all debts
    for (const debt of debtStates) {
      if (debt.balance > 0) {
        const payment = Math.min(debt.minimum, debt.balance);
        debt.balance -= payment;
        budgetRemaining -= payment;
      }
    }
    
    // Determine target debt for extra payment
    const stillActiveDebts = debtStates.filter(d => d.balance > 0);
    
    if (stillActiveDebts.length > 0 && budgetRemaining > 0) {
      const target = strategy === "avalanche"
        ? stillActiveDebts.reduce((highest, d) => d.rate > highest.rate ? d : highest)
        : stillActiveDebts.reduce((smallest, d) => d.balance < smallest.balance ? d : smallest);
      
      const extraPayment = Math.min(budgetRemaining, target.balance);
      target.balance -= extraPayment;
      budgetRemaining -= extraPayment;
    }
    
    // Check for paid-off debts and reclaim their minimums
    for (const debt of debtStates) {
      if (debt.balance <= 0.01 && !payoffOrder.some(p => p.debtId === debt.id)) {
        payoffOrder.push({
          debtId: debt.id,
          debtName: debt.name,
          payoffMonth: month,
          interestPaid: debt.interestPaid,
        });
        // Free up this debt's minimum for next month
        budgetRemaining += debt.minimum;
        debt.balance = 0;
      }
    }
    
    // Reset budget for next month
    budgetRemaining = effectiveBudget;
    
    // Record month-end balance
    monthlyBalances.push({
      month,
      totalBalance: debtStates.reduce((sum, d) => sum + Math.max(0, d.balance), 0),
    });
  }
  
  const allPaidOff = debtStates.every(d => d.balance <= 0.01);
  const totalInterestPaid = debtStates.reduce((sum, d) => sum + d.interestPaid, 0);
  
  let debtFreeDate: string | null = null;
  if (allPaidOff && month < maxMonths) {
    const now = new Date();
    const payoffDate = new Date(now);
    payoffDate.setMonth(payoffDate.getMonth() + month);
    debtFreeDate = `${payoffDate.getFullYear()}-${String(payoffDate.getMonth() + 1).padStart(2, "0")}`;
  }
  
  return {
    debtFreeDate,
    monthsToPayoff: allPaidOff ? month : null,
    totalInterestPaid,
    payoffOrder,
    monthlyBalances,
    warnings,
  };
}

/**
 * Compare strategy vs minimum-payments-only
 */
export function compareWithMinimumOnly(
  debts: DebtInput[],
  monthlyBudget: number,
  strategy: PayoffStrategy
): ComparisonResult {
  // Calculate minimums
  const totalMinimums = debts
    .filter(d => d.included)
    .reduce((sum, d) => sum + calculateMinimumPayment(d), 0);
  
  const strategyResult = calculateDebtPayoff(debts, monthlyBudget, strategy);
  const minimumResult = calculateDebtPayoff(debts, totalMinimums, strategy);
  
  const monthsSaved = 
    strategyResult.monthsToPayoff !== null && minimumResult.monthsToPayoff !== null
      ? minimumResult.monthsToPayoff - strategyResult.monthsToPayoff
      : 0;
  
  const interestSaved = minimumResult.totalInterestPaid - strategyResult.totalInterestPaid;
  
  return {
    strategy: {
      monthsToPayoff: strategyResult.monthsToPayoff,
      totalInterestPaid: strategyResult.totalInterestPaid,
    },
    minimumOnly: {
      monthsToPayoff: minimumResult.monthsToPayoff,
      totalInterestPaid: minimumResult.totalInterestPaid,
    },
    monthsSaved,
    interestSaved,
  };
}
