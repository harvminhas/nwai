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
  monthlyPayment: number | null; // null = needs to be set
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
    debts: Array<{
      debtId: string;
      balance: number;
    }>;
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
 * Simulate debt payoff using the specified strategy
 */
export function calculateDebtPayoff(
  debts: DebtInput[],
  extraMonthlyPayment: number,
  strategy: PayoffStrategy
): DebtPayoffResult {
  const warnings: string[] = [];
  
  // Filter to included debts with valid data
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
  
  // Check for missing data
  for (const debt of includedDebts) {
    if (debt.monthlyPayment === null || debt.monthlyPayment <= 0) {
      warnings.push(`${debt.name}: missing monthly payment`);
    }
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
    payment: number;
    interestPaid: number;
  }
  
  const debtStates: DebtState[] = includedDebts
    .filter(d => d.monthlyPayment !== null && d.monthlyPayment > 0)
    .map(d => ({
      id: d.id,
      name: d.name,
      balance: d.balance,
      rate: (d.interestRate || 0) / 100 / 12, // convert annual % to monthly decimal
      payment: d.monthlyPayment!,
      interestPaid: 0,
    }));
  
  if (debtStates.length === 0) {
    return {
      debtFreeDate: null,
      monthsToPayoff: null,
      totalInterestPaid: 0,
      payoffOrder: [],
      monthlyBalances: [],
      warnings,
    };
  }
  
  const payoffOrder: DebtPayoffResult["payoffOrder"] = [];
  const monthlyBalances: DebtPayoffResult["monthlyBalances"] = [];
  
  // Record initial state
  monthlyBalances.push({
    month: 0,
    debts: debtStates.map(d => ({ debtId: d.id, balance: d.balance })),
  });
  
  let month = 0;
  const maxMonths = 600; // 50 years cap
  let availableExtraPayment = extraMonthlyPayment;
  
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
    
    // Check if any debt is unpayable (payment <= interest)
    for (const debt of debtStates) {
      if (debt.balance > 0) {
        const monthlyInterest = debt.balance * debt.rate;
        if (debt.payment <= monthlyInterest) {
          warnings.push(`${debt.name}: payment ($${debt.payment.toFixed(2)}) doesn't cover monthly interest ($${monthlyInterest.toFixed(2)})`);
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
        const payment = Math.min(debt.payment, debt.balance);
        debt.balance -= payment;
      }
    }
    
    // Determine target debt for extra payment
    const activeDebts = debtStates.filter(d => d.balance > 0);
    
    if (activeDebts.length > 0 && availableExtraPayment > 0) {
      const target = strategy === "avalanche"
        ? activeDebts.reduce((highest, d) => d.rate > highest.rate ? d : highest)
        : activeDebts.reduce((smallest, d) => d.balance < smallest.balance ? d : smallest);
      
      const extraPayment = Math.min(availableExtraPayment, target.balance);
      target.balance -= extraPayment;
    }
    
    // Check for paid-off debts and roll over their payments
    for (const debt of debtStates) {
      if (debt.balance <= 0.01 && !payoffOrder.some(p => p.debtId === debt.id)) {
        payoffOrder.push({
          debtId: debt.id,
          debtName: debt.name,
          payoffMonth: month,
          interestPaid: debt.interestPaid,
        });
        // Roll over freed payment to extra payment pool
        availableExtraPayment += debt.payment;
        debt.balance = 0;
      }
    }
    
    // Record month-end balances
    monthlyBalances.push({
      month,
      debts: debtStates.map(d => ({ debtId: d.id, balance: Math.max(0, d.balance) })),
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
  extraMonthlyPayment: number,
  strategy: PayoffStrategy
): ComparisonResult {
  const strategyResult = calculateDebtPayoff(debts, extraMonthlyPayment, strategy);
  const minimumResult = calculateDebtPayoff(debts, 0, strategy);
  
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
