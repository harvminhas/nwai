/**
 * Debts Summary — single source of truth for all debt computations.
 * 
 * Calculates total debt, monthly payments, interest paid, weighted average rate,
 * and payoff date estimates. Used by the Liabilities/Debts page and dashboard cards.
 */

import type { AccountSnapshot, DebtPaymentHistoryEntry } from "./extractTransactions";
import type { AccountBalanceHistory } from "./financialProfile";
import type { ManualLiability, DebtPaymentReview } from "./types";
import { fmtCompact } from "./currencyUtils";

export interface DebtAccount {
  slug: string;
  bankName: string;
  accountName?: string;
  accountType: string;
  balance: number; // negative
  currency: string;
  interestRate: number | null; // annual %
  statementMonth: string;
  monthlyPayment: number | null; // estimated from payment history
  minPayment: number | null; // from paymentsMade in latest statement
}

export interface DebtGroup {
  type: "mortgage" | "credit_card" | "loc" | "other";
  label: string;
  totalBalance: number; // negative (debt)
  accounts: DebtAccount[];
  manualLiabilities: ManualLiability[];
}

export interface InterestPeriod {
  period: string; // e.g. "Last 3 months", "2026"
  total: number;
}

export interface PayoffEstimate {
  accountSlug: string;
  monthsToPayoff: number | null; // null if can't calculate
  payoffDate: string | null; // YYYY-MM
}

export interface DebtsSummary {
  totalDebt: number; // positive value of total debt
  currency: string;
  changeVsLastMonth: number; // positive = increase (bad), negative = decrease (good)
  changeVs12Months: number;
  monthlyPayments: number; // total of all regular payments
  interestPaidLast3Months: number;
  interestPaidByYear: InterestPeriod[];
  weightedAvgRate: number | null; // weighted by balance
  groups: DebtGroup[];
  payoffEstimates: PayoffEstimate[];
  monthlyHistory: Array<{
    month: string;
    monthLabel: string;
    totalDebt: number;
    totalPayments: number;
    groups: Array<{
      type: string;
      balance: number;
    }>;
  }>;
}

const DEBT_TYPES = new Set(["mortgage", "credit_card", "loc", "line_of_credit", "auto_loan", "student_loan", "personal_loan", "other_debt"]);

function debtGroup(accountType: string): DebtGroup["type"] {
  if (accountType === "mortgage") return "mortgage";
  if (accountType === "credit_card") return "credit_card";
  if (accountType === "loc" || accountType === "line_of_credit") return "loc";
  return "other";
}

function groupLabel(type: DebtGroup["type"]): string {
  switch (type) {
    case "mortgage": return "Mortgage";
    case "credit_card": return "Credit Cards";
    case "loc": return "Line of Credit";
    case "other": return "Other Loans";
  }
}

function formatMonthLabel(ym: string): string {
  const [year, month] = ym.split("-");
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${monthNames[parseInt(month) - 1]} ${year}`;
}

function convertToHome(amount: number, currency: string, fxRates: Record<string, number>, homeCurrency: string): number {
  if (currency === homeCurrency) return amount;
  const rate = fxRates[currency];
  if (!rate || !Number.isFinite(rate)) return amount;
  return amount * rate;
}

function estimateMonthlyPayment(
  accountSlug: string,
  paymentHistory: DebtPaymentHistoryEntry[]
): number | null {
  const payments = paymentHistory.filter(p => p.accountSlug === accountSlug && p.paymentsMade > 0);
  if (payments.length === 0) return null;
  
  // Use median of last 6 months
  const recentPayments = payments.slice(-6).map(p => p.paymentsMade).sort((a, b) => a - b);
  const median = recentPayments[Math.floor(recentPayments.length / 2)];
  return median;
}

// Simplified payoff calculator - estimates months to pay off at current payment rate
function estimatePayoffMonths(
  balance: number, // positive value
  apr: number, // annual %
  monthlyPayment: number
): number | null {
  if (monthlyPayment <= 0) return null;
  
  const monthlyRate = apr / 100 / 12;
  const monthlyInterest = balance * monthlyRate;
  
  // Check if payment covers interest
  if (monthlyPayment <= monthlyInterest) return null; // Unpayable
  
  // Use amortization formula: n = -log(1 - (r * P) / M) / log(1 + r)
  // where P = principal, r = monthly rate, M = monthly payment
  const n = -Math.log(1 - (monthlyRate * balance) / monthlyPayment) / Math.log(1 + monthlyRate);
  
  if (!isFinite(n) || n <= 0) return null;
  if (n > 600) return null; // Cap at 50 years
  
  return Math.round(n);
}

function addMonthsToDate(baseMonth: string, monthsToAdd: number): string {
  const [year, month] = baseMonth.split("-").map(Number);
  const date = new Date(year, month - 1, 1);
  date.setMonth(date.getMonth() + monthsToAdd);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function buildDebtsSummary(
  accountSnapshots: AccountSnapshot[],
  balanceHistory: AccountBalanceHistory[],
  paymentHistory: DebtPaymentHistoryEntry[],
  manualLiabilities: ManualLiability[],
  fxRates: Record<string, number>,
  homeCurrency: string
): DebtsSummary {
  // Filter to debt accounts only (negative balance or debt types)
  const debtAccounts = accountSnapshots.filter(acc => 
    acc.balance < 0 || DEBT_TYPES.has(acc.accountType)
  );

  // Build debt account list
  const accounts: DebtAccount[] = debtAccounts.map(acc => {
    const balanceInHome = Math.abs(convertToHome(acc.balance, acc.currency || homeCurrency, fxRates, homeCurrency));
    const monthlyPayment = estimateMonthlyPayment(acc.slug, paymentHistory);
    
    // Get minPayment from latest statement's paymentsMade
    const latestPayment = paymentHistory
      .filter(p => p.accountSlug === acc.slug)
      .sort((a, b) => b.statementMonth.localeCompare(a.statementMonth))[0];
    
    return {
      slug: acc.slug,
      bankName: acc.bankName,
      accountName: acc.accountName,
      accountType: acc.accountType,
      balance: balanceInHome,
      currency: homeCurrency,
      interestRate: acc.interestRate,
      statementMonth: acc.statementMonth,
      monthlyPayment,
      minPayment: latestPayment?.paymentsMade || null,
    };
  });

  // Group by type
  const groupMap = new Map<DebtGroup["type"], DebtGroup>();
  
  for (const acc of accounts) {
    const type = debtGroup(acc.accountType);
    if (!groupMap.has(type)) {
      groupMap.set(type, {
        type,
        label: groupLabel(type),
        totalBalance: 0,
        accounts: [],
        manualLiabilities: [],
      });
    }
    const group = groupMap.get(type)!;
    group.accounts.push(acc);
    group.totalBalance += acc.balance;
  }

  // Add manual liabilities
  for (const ml of manualLiabilities) {
    const type: DebtGroup["type"] = 
      ml.category === "mortgage" ? "mortgage" :
      ml.category === "credit_card" ? "credit_card" :
      ml.category === "line_of_credit" ? "loc" : "other";
    
    if (!groupMap.has(type)) {
      groupMap.set(type, {
        type,
        label: groupLabel(type),
        totalBalance: 0,
        accounts: [],
        manualLiabilities: [],
      });
    }
    const group = groupMap.get(type)!;
    group.manualLiabilities.push(ml);
    group.totalBalance += ml.balance;
  }

  const groups = Array.from(groupMap.values());
  const totalDebt = groups.reduce((sum, g) => sum + g.totalBalance, 0);

  // Calculate changes from balance history
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  
  let lastMonthDate = new Date(now);
  lastMonthDate.setMonth(lastMonthDate.getMonth() - 1);
  const lastMonth = `${lastMonthDate.getFullYear()}-${String(lastMonthDate.getMonth() + 1).padStart(2, "0")}`;
  
  let year12Date = new Date(now);
  year12Date.setFullYear(year12Date.getFullYear() - 1);
  const month12Ago = `${year12Date.getFullYear()}-${String(year12Date.getMonth() + 1).padStart(2, "0")}`;

  const getDebtAtMonth = (month: string): number => {
    let total = 0;
    for (const history of balanceHistory) {
      const entry = history.entries.find((e: { yearMonth: string; balance: number }) => e.yearMonth === month);
      if (entry) {
        const acc = debtAccounts.find(a => a.slug === history.slug);
        if (acc && acc.balance < 0) {
          total += Math.abs(convertToHome(entry.balance, history.currency, fxRates, homeCurrency));
        }
      }
    }
    // Add manual liabilities (assume constant for now)
    total += manualLiabilities.reduce((sum, l) => sum + l.balance, 0);
    return total;
  };

  const lastMonthDebt = getDebtAtMonth(lastMonth);
  const month12Debt = getDebtAtMonth(month12Ago);

  // For debt, increase is bad (positive change), decrease is good (negative change)
  const changeVsLastMonth = lastMonthDebt > 0 ? totalDebt - lastMonthDebt : 0;
  const changeVs12Months = month12Debt > 0 ? totalDebt - month12Debt : 0;

  // Calculate total monthly payments
  const monthlyPayments = accounts.reduce((sum, acc) => {
    const payment = acc.minPayment || acc.monthlyPayment || 0;
    return sum + payment;
  }, 0);

  // Calculate weighted average rate
  let weightedRateSum = 0;
  let totalWithRate = 0;
  for (const acc of accounts) {
    if (acc.interestRate !== null && acc.interestRate > 0) {
      weightedRateSum += acc.interestRate * acc.balance;
      totalWithRate += acc.balance;
    }
  }
  const weightedAvgRate = totalWithRate > 0 ? weightedRateSum / totalWithRate : null;

  // Estimate interest paid (simplified - would need transaction-level data for accuracy)
  // For now, estimate based on balance * rate / 12
  const estimateMonthlyInterest = (balance: number, rate: number | null): number => {
    if (!rate || rate <= 0) return 0;
    return (balance * (rate / 100)) / 12;
  };

  const interestPaidLast3Months = accounts.reduce((sum, acc) => {
    return sum + estimateMonthlyInterest(acc.balance, acc.interestRate) * 3;
  }, 0);

  // Interest by year (last 3 years)
  const currentYear = now.getFullYear();
  const interestPaidByYear: InterestPeriod[] = [];
  for (let y = currentYear; y >= currentYear - 2; y--) {
    const yearInterest = accounts.reduce((sum, acc) => {
      return sum + estimateMonthlyInterest(acc.balance, acc.interestRate) * 12;
    }, 0);
    interestPaidByYear.push({
      period: y.toString(),
      total: yearInterest,
    });
  }

  // Calculate payoff estimates
  const payoffEstimates: PayoffEstimate[] = accounts
    .filter(acc => acc.balance > 0)
    .map(acc => {
      const payment = acc.minPayment || acc.monthlyPayment;
      const months = payment && acc.interestRate 
        ? estimatePayoffMonths(acc.balance, acc.interestRate, payment)
        : null;
      
      const payoffDate = months ? addMonthsToDate(currentMonth, months) : null;
      
      return {
        accountSlug: acc.slug,
        monthsToPayoff: months,
        payoffDate,
      };
    });

  // Build monthly history (last 12 months)
  const monthlyHistory: DebtsSummary["monthlyHistory"] = [];
  const allMonths = new Set<string>();
  for (const history of balanceHistory) {
    for (const entry of history.entries) {
      allMonths.add(entry.yearMonth);
    }
  }
  const sortedMonths = Array.from(allMonths).sort().reverse().slice(0, 12).reverse();

  for (const month of sortedMonths) {
    const groupTotals = new Map<string, number>();
    let monthDebt = 0;
    let monthPayments = 0;

    for (const history of balanceHistory) {
      const entry = history.entries.find((e: { yearMonth: string; balance: number }) => e.yearMonth === month);
      if (entry) {
        const acc = debtAccounts.find(a => a.slug === history.slug);
        if (acc && acc.balance < 0) {
          const type = debtGroup(acc.accountType);
          const balance = Math.abs(convertToHome(entry.balance, history.currency, fxRates, homeCurrency));
          groupTotals.set(type, (groupTotals.get(type) || 0) + balance);
          monthDebt += balance;
        }
      }
    }

    // Get payments for this month
    const monthPaymentEntries = paymentHistory.filter(p => p.statementMonth === month);
    for (const p of monthPaymentEntries) {
      monthPayments += convertToHome(p.paymentsMade, p.currency, fxRates, homeCurrency);
    }

    // Add manual liabilities to month total
    const manualTotal = manualLiabilities.reduce((sum, l) => sum + l.balance, 0);
    monthDebt += manualTotal;

    monthlyHistory.push({
      month,
      monthLabel: formatMonthLabel(month),
      totalDebt: monthDebt,
      totalPayments: monthPayments,
      groups: Array.from(groupTotals.entries()).map(([type, balance]) => ({ type, balance })),
    });
  }

  return {
    totalDebt,
    currency: homeCurrency,
    changeVsLastMonth,
    changeVs12Months,
    monthlyPayments,
    interestPaidLast3Months,
    interestPaidByYear,
    weightedAvgRate,
    groups,
    payoffEstimates,
    monthlyHistory,
  };
}
