/**
 * Debts Summary — single source of truth for all debt computations.
 * 
 * Calculates total debt, monthly payments, interest paid, weighted average rate,
 * and payoff date estimates. Used by the Liabilities/Debts page and dashboard cards.
 */

import type { AccountSnapshot, DebtPaymentHistoryEntry } from "./extractTransactions";
import type { AccountBalanceHistory } from "./financialProfile";
import type { ManualLiability, DebtPaymentReview } from "./types";
import { computeScheduledDebtPayments, type ScheduledDebtPayment } from "./debtPayments";
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
  scheduledPayments?: ScheduledDebtPayment[]; // For diagnostic output
  /** Per-account balance history from profile.accountBalanceHistory */
  accountBalanceHistory: Array<{
    slug: string;
    label: string;
    entries: Array<{ yearMonth: string; balance: number; derived?: boolean; sourceStatement?: string }>;
  }>;
  /** Transactions for month-detail view */
  expenseTxns: Array<{
    date: string;
    txMonth: string;
    amount: number;
    merchant: string;
    accountSlug: string;
  }>;
  incomeTxns: Array<{
    date: string;
    txMonth: string;
    amount: number;
    source: string;
    accountSlug: string;
  }>;
}

const DEBT_TYPES = new Set(["mortgage", "credit", "credit_card", "loc", "line_of_credit", "loan", "auto_loan", "student_loan", "personal_loan", "other_debt"]);

function debtGroup(accountType: string, accountName?: string): DebtGroup["type"] {
  // Use the actual account type from the snapshot
  if (accountType === "mortgage") return "mortgage";
  if (accountType === "line_of_credit" || accountType === "loc") return "loc";
  if (accountType === "credit" || accountType === "credit_card") return "credit_card";
  
  // Check account name for HELOC/equity line indicators
  const nameLower = (accountName || "").toLowerCase();
  if (nameLower.includes("equity") || nameLower.includes("heloc") || nameLower.includes("flexline")) {
    return "loc";
  }
  
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
  homeCurrency: string,
  profileMonthlyHistory?: Array<{ yearMonth: string; totalDebts: number; debtPaymentsTotal: number }>, // From profile
  expenseTxns?: Array<{ date: string; txMonth: string; amount: number; merchant: string; accountSlug: string }>,
  incomeTxns?: Array<{ date: string; txMonth: string; amount: number; source: string; accountSlug: string }>
): DebtsSummary {
  // Compute scheduled debt payments using the same logic as computeMonthlyBuckets
  const scheduledPayments = computeScheduledDebtPayments(
    accountSnapshots,
    paymentHistory,
    [], // No user reviews for now
    fxRates,
    homeCurrency
  );
  
  // Build a map of scheduled payments by account
  const scheduledPaymentMap = new Map(
    scheduledPayments.map(p => [p.accountSlug, p])
  );
  
  // Filter to debt accounts only
  const debtAccounts = accountSnapshots.filter(acc => 
    acc.balance < 0 || DEBT_TYPES.has(acc.accountType)
  );

  // Build debt account list
  const accounts: DebtAccount[] = debtAccounts.map(acc => {
    const balanceInHome = Math.abs(convertToHome(acc.balance, acc.currency || homeCurrency, fxRates, homeCurrency));
    
    // Get scheduled payment from computeScheduledDebtPayments
    const scheduled = scheduledPaymentMap.get(acc.slug);
    const monthlyPayment = scheduled?.amount || null;
    
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
    const type = debtGroup(acc.accountType, acc.accountName);
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

  // Calculate total monthly payments from scheduled payments
  const monthlyPayments = scheduledPayments.reduce((sum, p) => sum + p.amount, 0);

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

  // Build monthly history (last 12 months) - use profile's monthlyHistory for totals
  const monthlyHistory: DebtsSummary["monthlyHistory"] = [];
  
  if (profileMonthlyHistory && profileMonthlyHistory.length > 0) {
    // Use profile's totalDebts which already has correct carry-forward logic
    const last12Months = profileMonthlyHistory.slice(-12);
    
    for (const profileMonth of last12Months) {
      const month = profileMonth.yearMonth;
      
      // Compute per-group breakdown with carry-forward
      const groupTotals = new Map<string, number>();
      const accountLastBalance = new Map<string, number>();
      
      // For each debt account, find its balance at this month (with carry-forward)
      for (const acc of debtAccounts) {
        const history = balanceHistory.find(h => h.slug === acc.slug);
        if (!history) continue;
        
        // Find balance at or before this month (carry-forward)
        let balance = 0;
        for (const entry of history.entries) {
          if (entry.yearMonth <= month) {
            balance = Math.abs(convertToHome(entry.balance, history.currency, fxRates, homeCurrency));
          } else {
            break;
          }
        }
        
        if (balance > 0) {
          const type = debtGroup(acc.accountType, acc.accountName);
          groupTotals.set(type, (groupTotals.get(type) || 0) + balance);
        }
      }
      
      monthlyHistory.push({
        month,
        monthLabel: formatMonthLabel(month),
        totalDebt: profileMonth.totalDebts, // Use profile's value which includes manual assets
        totalPayments: profileMonth.debtPaymentsTotal || 0,
        groups: Array.from(groupTotals.entries()).map(([type, balance]) => ({ type, balance })),
      });
    }
  }
  
  // Filter transactions to only those belonging to debt accounts
  const debtAccountSlugs = new Set(debtAccounts.map(a => a.slug));
  const filteredExpenseTxns = (expenseTxns || []).filter(t => debtAccountSlugs.has(t.accountSlug));
  const filteredIncomeTxns = (incomeTxns || []).filter(t => debtAccountSlugs.has(t.accountSlug));

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
    scheduledPayments, // For diagnostic output,
    accountBalanceHistory: balanceHistory
      .filter(h => debtAccountSlugs.has(h.slug))
      .map(h => ({
        slug: h.slug,
        label: h.label,
        entries: h.entries,
      })),
    expenseTxns: filteredExpenseTxns,
    incomeTxns: filteredIncomeTxns,
  };
}
