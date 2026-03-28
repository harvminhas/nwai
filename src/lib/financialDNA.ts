/**
 * Financial DNA inference.
 *
 * Builds a FinancialDNA profile from the user's full statement history.
 * Called at statement parse time so it's always up-to-date.
 * Pure function — no Firestore access. Caller is responsible for persisting.
 */

import type { ParsedStatementData } from "./types";
import type { FinancialDNA } from "./agentTypes";

interface StatementDoc {
  yearMonth: string;
  parsed: ParsedStatementData;
}

// ── helpers ───────────────────────────────────────────────────────────────────

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function containsAny(str: string, keywords: string[]): boolean {
  const lower = str.toLowerCase();
  return keywords.some((k) => lower.includes(k));
}

// ── inference ─────────────────────────────────────────────────────────────────

/**
 * Infer a FinancialDNA from all statement documents for a user.
 * @param docs Array of all completed statements, newest first.
 */
export function inferFinancialDNA(docs: StatementDoc[]): FinancialDNA {
  if (docs.length === 0) {
    return emptyDNA();
  }

  // Latest statement per account slug (for current balances / rates)
  const latestPerSlug = new Map<string, StatementDoc>();
  for (const doc of docs) {
    const slug = `${doc.parsed.bankName ?? ""}::${doc.parsed.accountId ?? ""}`;
    if (!latestPerSlug.has(slug)) latestPerSlug.set(slug, doc);
  }
  const currentStatements = Array.from(latestPerSlug.values()).map((d) => d.parsed);

  // ── Mortgage ──────────────────────────────────────────────────────────────
  const mortgageStmts = currentStatements.filter(
    (s) => s.accountType === "mortgage"
  );
  const hasMortgage = mortgageStmts.length > 0;
  const mortgageBalance = mortgageStmts.reduce(
    (sum, s) => sum + Math.abs(s.netWorth ?? s.debts ?? 0), 0
  );

  // Infer variable vs fixed: check if interest rate changed across mortgage statements
  let mortgageType: FinancialDNA["mortgageType"] = "unknown";
  if (hasMortgage) {
    const mortgageDocs = docs.filter(
      (d) => d.parsed.accountType === "mortgage" && d.parsed.interestRate != null
    );
    const rates = [...new Set(mortgageDocs.map((d) => d.parsed.interestRate))];
    if (rates.length > 1) mortgageType = "variable";
    else if (rates.length === 1 && rates[0] != null) mortgageType = "fixed";
  }

  // ── HELOC / Loans ─────────────────────────────────────────────────────────
  const hasHELOC = currentStatements.some(
    (s) => s.accountType === "loan" &&
    containsAny(s.accountName ?? s.bankName ?? "", ["heloc", "home equity", "flexline", "equity line"])
  );
  const loanStmts = currentStatements.filter((s) => s.accountType === "loan");
  const hasLoan = loanStmts.length > 0;
  const totalLoanDebt = loanStmts.reduce(
    (sum, s) => sum + Math.abs(s.netWorth ?? s.debts ?? 0), 0
  );

  // ── Credit cards ─────────────────────────────────────────────────────────
  const ccStmts = currentStatements.filter((s) => s.accountType === "credit");
  const hasCreditCard = ccStmts.length > 0;
  const totalCreditCardDebt = ccStmts.reduce(
    (sum, s) => sum + Math.abs(s.netWorth ?? s.debts ?? 0), 0
  );
  const ccRates = ccStmts.map((s) => s.interestRate).filter((r): r is number => r != null);
  const highestCreditCardAPR = ccRates.length > 0 ? Math.max(...ccRates) : null;
  const highInterestDebt = hasCreditCard && (highestCreditCardAPR ?? 0) > 15;

  // ── Investments / savings ─────────────────────────────────────────────────
  const hasInvestmentAccount = currentStatements.some(
    (s) => s.accountType === "investment"
  );
  const liquidAccounts = currentStatements.filter(
    (s) => s.accountType === "checking" || s.accountType === "savings"
  );
  const liquidCash = liquidAccounts.reduce(
    (sum, s) => sum + Math.max(0, s.netWorth ?? s.assets ?? 0), 0
  );

  // ── RRSP / TFSA detection ─────────────────────────────────────────────────
  const allTransactionDescs = docs.flatMap((d) => [
    ...(d.parsed.income?.transactions ?? []).map((t) => t.source ?? ""),
    ...(d.parsed.income?.sources ?? []).map((s) => s.description ?? ""),
    ...(d.parsed.expenses?.transactions ?? []).map((t) => t.merchant ?? ""),
  ]);
  const hasRRSP =
    allTransactionDescs.some((t) => containsAny(t, ["rrsp", "rsp deposit", "registered retirement"])) ||
    currentStatements.some((s) => containsAny(s.accountName ?? "", ["rrsp", "rsp"]));
  const hasTFSA =
    allTransactionDescs.some((t) => containsAny(t, ["tfsa", "tax-free savings", "tax free savings"])) ||
    currentStatements.some((s) => containsAny(s.accountName ?? "", ["tfsa"]));

  // ── Income ───────────────────────────────────────────────────────────────
  const incomeMonths = docs
    .filter((d) => (d.parsed.income?.total ?? 0) > 0)
    .map((d) => d.parsed.income!.total);
  const estimatedMonthlyIncome = incomeMonths.length > 0 ? median(incomeMonths) : 0;

  // Salaried = one consistent employer source; self-employed = multiple or irregular
  const incomeSources = docs.flatMap((d) =>
    (d.parsed.income?.sources ?? []).map((s) => s.description.toLowerCase())
  );
  const uniqueSources = new Set(incomeSources.map((s) =>
    s.replace(/\b(pay|payroll|salary|deposit)\b/g, "").trim()
  ));
  let incomeType: FinancialDNA["incomeType"] = "unknown";
  if (estimatedMonthlyIncome > 0) {
    const cv = incomeMonths.length > 1
      ? (Math.sqrt(incomeMonths.reduce((s, v) => s + Math.pow(v - estimatedMonthlyIncome, 2), 0) / incomeMonths.length) / estimatedMonthlyIncome)
      : 0;
    if (uniqueSources.size <= 2 && cv < 0.15) incomeType = "salaried";
    else if (uniqueSources.size > 3 || cv > 0.30) incomeType = "self-employed";
    else incomeType = "mixed";
  }

  // ── Spending ─────────────────────────────────────────────────────────────
  const expenseMonths = docs
    .filter((d) => (d.parsed.expenses?.total ?? 0) > 0)
    .map((d) => d.parsed.expenses!.total);
  const estimatedMonthlyExpenses = expenseMonths.length > 0 ? median(expenseMonths) : 0;

  // Top spending categories across all statements
  const categoryTotals = new Map<string, number>();
  for (const doc of docs) {
    for (const cat of doc.parsed.expenses?.categories ?? []) {
      categoryTotals.set(cat.name, (categoryTotals.get(cat.name) ?? 0) + cat.amount);
    }
  }
  const topSpendingCategories = Array.from(categoryTotals.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name]) => name);

  // Active subscriptions (from latest consolidated subscriptions)
  const activeSubscriptions = currentStatements
    .flatMap((s) => s.subscriptions ?? [])
    .filter((sub, i, arr) => arr.findIndex((s) => s.name === sub.name) === i);

  // ── Life signals ─────────────────────────────────────────────────────────
  const hasChildren =
    allTransactionDescs.some((t) =>
      containsAny(t, ["child benefit", "ccb", "cctb", "daycare", "ymca kids", "school fee", "camp"])
    );

  // Province inference from utility/tax merchant names
  let inferredProvince: string | null = null;
  const allMerchants = docs.flatMap((d) =>
    (d.parsed.expenses?.transactions ?? []).map((t) => t.merchant.toLowerCase())
  );
  if (allMerchants.some((m) => containsAny(m, ["hydro one", "union gas", "enbridge", "ontario"]))) inferredProvince = "ON";
  else if (allMerchants.some((m) => containsAny(m, ["bc hydro", "fortis bc", "telus bc"]))) inferredProvince = "BC";
  else if (allMerchants.some((m) => containsAny(m, ["atco", "enmax", "epcor", "alberta"]))) inferredProvince = "AB";
  else if (allMerchants.some((m) => containsAny(m, ["hydro quebec", "videotron", "bell quebec"]))) inferredProvince = "QC";

  // ── Derived metrics ───────────────────────────────────────────────────────
  const totalDebt = mortgageBalance + totalCreditCardDebt + totalLoanDebt;
  const debtToIncomeRatio =
    estimatedMonthlyIncome > 0 ? totalDebt / estimatedMonthlyIncome : null;

  const yearMonths = new Set(docs.map((d) => d.yearMonth));
  const statementMonthsCovered = yearMonths.size;

  return {
    updatedAt: new Date().toISOString(),
    hasMortgage, mortgageBalance, mortgageType,
    hasCreditCard, totalCreditCardDebt, highestCreditCardAPR,
    hasHELOC, hasLoan, totalLoanDebt,
    hasInvestmentAccount, liquidCash,
    hasRRSP, hasTFSA,
    incomeType, estimatedMonthlyIncome,
    estimatedMonthlyExpenses, topSpendingCategories, activeSubscriptions,
    hasChildren, inferredProvince,
    highInterestDebt, debtToIncomeRatio, statementMonthsCovered,
  };
}

function emptyDNA(): FinancialDNA {
  return {
    updatedAt: new Date().toISOString(),
    hasMortgage: false, mortgageBalance: 0, mortgageType: "unknown",
    hasCreditCard: false, totalCreditCardDebt: 0, highestCreditCardAPR: null,
    hasHELOC: false, hasLoan: false, totalLoanDebt: 0,
    hasInvestmentAccount: false, liquidCash: 0,
    hasRRSP: false, hasTFSA: false,
    incomeType: "unknown", estimatedMonthlyIncome: 0,
    estimatedMonthlyExpenses: 0, topSpendingCategories: [], activeSubscriptions: [],
    hasChildren: false, inferredProvince: null,
    highInterestDebt: false, debtToIncomeRatio: null, statementMonthsCovered: 0,
  };
}
