/**
 * Pure computation over a single ParsedStatementData.
 *
 * Used exclusively by the anonymous /dashboard/[id] view — no UID, no DB,
 * no cache.  Imports only constants and helpers from the lib layer so the
 * same category/exclusion logic is consistent with the full pipeline.
 */

import type { ParsedStatementData, ExpenseCategory } from "./types";
import { isCoreExcluded, INCOME_TRANSFER_RE } from "./spendingMetrics";
import { isDebtServicingExpense } from "./debtServicing";
import { getCategoryBucket, type MoneyCoachBucket } from "./moneyCoachBuckets";

// ── Account classification ────────────────────────────────────────────────────

const ASSET_TYPES     = new Set(["checking", "savings", "investment", "cash"]);
const DEBT_ONLY_TYPES = new Set(["mortgage", "loan", "heloc", "loc", "line_of_credit", "line of credit"]);
const REVOLVING_TYPES = new Set(["credit", "credit_card", "heloc", "loc", "line_of_credit", "line of credit"]);

export function classifyAccount(rawType: string | undefined) {
  const t = (rawType ?? "other").toLowerCase();
  return {
    type:        t,
    isAsset:     ASSET_TYPES.has(t),
    isDebt:      DEBT_ONLY_TYPES.has(t),
    isRevolving: REVOLVING_TYPES.has(t),
    isChecking:  t === "checking",
    isSavings:   t === "savings",
    isInvestment: t === "investment",
  };
}

export function balanceLabelFor(type: string): string {
  if (type === "mortgage")        return "Mortgage Balance";
  if (type === "loan")            return "Loan Balance";
  if (type === "heloc")           return "HELOC Balance";
  if (type === "loc" || type === "line_of_credit" || type === "line of credit") return "Line of Credit Balance";
  if (type === "credit" || type === "credit_card") return "Balance Owing";
  if (type === "investment")      return "Portfolio Value";
  return "Account Balance";
}

// ── Spending buckets (Fixed/Essentials/Flexible) ──────────────────────────────

export interface SpendingBucket {
  key:         MoneyCoachBucket;
  label:       string;
  amount:      number;
  /** Percentage of core spending (excl. transfers). */
  pct:         number;
}

/**
 * Build Fixed/Essentials/Flexible breakdown using the same category-to-bucket
 * mapping as the signed-in Spending page (moneyCoachBuckets.ts).
 */
function buildBuckets(
  categories: ExpenseCategory[],
  coreExpenses: number,
): SpendingBucket[] {
  const sums: Record<"fixed" | "essentials" | "flexible", number> = {
    fixed:       0,
    essentials:  0,
    flexible:    0,
  };
  
  for (const cat of categories) {
    // Skip non-core categories (transfers, interest, etc.) - same as financial profile
    if (isCoreExcluded(cat.name.trim(), { forAggregateLabel: true })) continue;
    
    const bucket = getCategoryBucket(cat.name.trim());
    if (bucket === "fixed" || bucket === "essentials" || bucket === "flexible") {
      sums[bucket] += cat.amount;
    }
  }

  const safe = coreExpenses > 0 ? coreExpenses : 1;
  return [
    {
      key:    "fixed",
      label:  "Fixed",
      amount: sums.fixed,
      pct:    Math.round((sums.fixed / safe) * 100),
    },
    {
      key:    "essentials",
      label:  "Essentials",
      amount: sums.essentials,
      pct:    Math.round((sums.essentials / safe) * 100),
    },
    {
      key:    "flexible",
      label:  "Flexible",
      amount: sums.flexible,
      pct:    Math.round((sums.flexible / safe) * 100),
    },
  ];
}

// ── Minimum debt payments (best-effort from categories, no user tags) ─────────

/**
 * Estimate minimum debt payments from expense categories alone.
 * Without user tags we apply `defaultDebtTag` which treats mortgages / auto /
 * personal loans as "scheduled" and credit cards / LOCs as "minimum".
 * For the anonymous view this is accurate enough.
 */
function estimateMinDebtPayments(categories: ExpenseCategory[], data: ParsedStatementData): number {
  // If there are typed expense transactions available, use them for accuracy
  const txns = data.expenses?.transactions ?? [];
  if (txns.length > 0) {
    const debtTxns = txns.filter((t) =>
      isDebtServicingExpense(t.category ?? "", { debtType: t.debtType, merchant: t.merchant }),
    );
    // Use scheduled types as "min" proxy; credit/loc default to "minimum" too (all are min here)
    // In the anonymous view all debt payments are treated as minimum obligations
    return debtTxns.reduce((sum, tx) => sum + tx.amount, 0);
  }

  // Fallback: use the Debt Payments category total as a proxy
  const debtCat = categories.find((c) =>
    /^(debt payments|installment servicing|card servicing)$/i.test(c.name),
  );
  return debtCat?.amount ?? 0;
}

// ── Highlights ────────────────────────────────────────────────────────────────

export interface StatementHighlight {
  icon:  string;
  text:  string;
  type:  "positive" | "neutral" | "warning";
}

function buildHighlights(
  categories: ExpenseCategory[],
  buckets:    SpendingBucket[],
  incomeTotal: number,
  coreExpenses: number,
): StatementHighlight[] {
  const highlights: StatementHighlight[] = [];
  const fixed = buckets.find((b) => b.key === "fixed");

  // 1. Fixed costs share (housing, debt, etc.)
  if (fixed && fixed.amount > 0 && coreExpenses > 0) {
    const pct = fixed.pct;
    highlights.push({
      icon: "🏠",
      text: `Fixed costs (housing, debt, subscriptions) are ${pct}% of spending — ${fmtAmt(fixed.amount)}/mo`,
      type: pct > 50 ? "warning" : "neutral",
    });
  }

  // 2. Savings / investments
  const investCat = categories.find((c) => /^investments & savings$/i.test(c.name));
  if (investCat && investCat.amount > 0) {
    const pct = incomeTotal > 0 ? Math.round((investCat.amount / incomeTotal) * 100) : 0;
    highlights.push({
      icon: "📈",
      text: pct > 0
        ? `You directed ${pct}% of your income (${fmtAmt(investCat.amount)}) into savings & investments`
        : `You moved ${fmtAmt(investCat.amount)} into savings & investments`,
      type: "positive",
    });
  }

  // 3. Top flexible category
  const flexibleCats = categories
    .filter((c) => !isCoreExcluded(c.name.trim(), { forAggregateLabel: true }))
    .filter((c) => getCategoryBucket(c.name.trim()) === "flexible" && c.amount > 0);
  flexibleCats.sort((a, b) => b.amount - a.amount);
  if (flexibleCats.length > 0) {
    const top = flexibleCats[0];
    highlights.push({
      icon: "🎭",
      text: `${top.name} was your #1 flexible expense at ${fmtAmt(top.amount)}`,
      type: "neutral",
    });
  }

  // Keep only top 3
  return highlights.slice(0, 3);
}

// ── Savings rate ──────────────────────────────────────────────────────────────

function calcRate(income: number, expenses: number): number | null {
  if (income <= 0) return null;
  return Math.round(((income - expenses) / income) * 100);
}

// ── Tiny formatter (no Intl dependency — mirrors fmt from currencyUtils) ───────

function fmtAmt(n: number): string {
  return new Intl.NumberFormat("en-CA", {
    style:    "currency",
    currency: "CAD",
    maximumFractionDigits: 0,
  }).format(n);
}

// ── Main export ───────────────────────────────────────────────────────────────

export interface StatementSnapshot {
  // Account info
  accountType:  string;
  balanceLabel: string;
  balance:      number;
  balanceDisplay: string;
  balanceColor:   string;
  isDebt:       boolean;
  isAsset:      boolean;

  // Top-line numbers
  incomeTotal:          number;
  expenseTotal:         number;
  /** Expenses excluding transfers, Card Servicing, and interest (matches coreExpensesTotal). */
  coreExpenses:         number;
  minDebtPayments:      number;
  hasIncome:            boolean;
  hasExpenses:          boolean;

  // Why income/savings is unavailable (null = available)
  incomeUnavailableReason:   string | null;
  expenseUnavailableReason:  string | null;
  savingsUnavailableReason:  string | null;

  // Savings rate variants (null = cannot compute)
  /** Core savings rate: excl. transfers, revolving settlement (Card Servicing), interest */
  savingsRateCore:     number | null;
  /** Including min debt payments as an expense */
  savingsRateWithDebt: number | null;

  // Spending breakdown
  buckets:    SpendingBucket[];
  categories: ExpenseCategory[];
  highlights: StatementHighlight[];

  // Subscriptions
  subscriptions: { name: string; amount: number; frequency: string }[];
}

export function computeStatementSnapshot(data: ParsedStatementData): StatementSnapshot {
  const acct = classifyAccount(data.accountType);

  // ── Balance ──────────────────────────────────────────────────────────────
  const balance    = data.netWorth ?? 0;
  const absBalance = Math.abs(balance);
  const balLabel   = balanceLabelFor(acct.type);
  const balDisplay = acct.isDebt || acct.isRevolving ? fmtAmt(absBalance) : fmtAmt(balance);
  const balColor   = acct.isDebt || acct.isRevolving
    ? (absBalance > 0 ? "text-red-600" : "text-gray-900")
    : (balance >= 0   ? "text-gray-900" : "text-red-600");

  // ── Income filtering (matches financial profile logic) ───────────────────
  // Filter out transfers and non-core income categories to match signed-in dashboard
  const incomeTxns = data.income?.transactions ?? [];
  const filteredIncomeTxns = incomeTxns.filter((txn) => {
    const src = (txn.source ?? "").trim();
    // Exclude transfers (same regex as financial profile)
    if (INCOME_TRANSFER_RE.test(src)) return false;
    // Exclude non-core categories (Transfer, Transfer In, Other)
    const cat = (txn.category ?? "").trim().toLowerCase();
    if (cat === "transfer" || cat === "transfer in" || cat === "other") return false;
    return true;
  });
  const incomeTotal = filteredIncomeTxns.reduce((sum, txn) => sum + txn.amount, 0);

  // ── Expense totals ───────────────────────────────────────────────────────
  const expenseTotal = data.expenses?.total ?? 0;
  const categories   = data.expenses?.categories ?? [];

  // ── Core expenses — matches financial profile's coreExpensesTotal exactly ─
  // Uses isCoreExcluded (single source of truth) — category rows only (aggregate-safe).
  const coreExpenses = categories
    .filter((c) => !isCoreExcluded(c.name.trim(), { forAggregateLabel: true }))
    .reduce((sum, c) => sum + c.amount, 0);

  // ── Buckets (Fixed/Essentials/Flexible) ──────────────────────────────────
  const buckets = buildBuckets(categories, coreExpenses);

  // ── Min debt payments ────────────────────────────────────────────────────
  const minDebtPayments = estimateMinDebtPayments(categories, data);

  // ── Availability reasons ─────────────────────────────────────────────────
  const incomeUnavailableReason =
    acct.isDebt && !acct.isRevolving
      ? "Income isn't tracked on debt statements. Upload a chequing account to see income."
      : incomeTotal === 0
      ? "No income transactions found in this statement."
      : null;

  const expenseUnavailableReason =
    expenseTotal === 0 && !acct.isRevolving
      ? "No expense transactions found. Upload a chequing or credit card statement to see spending."
      : null;

  const savingsUnavailableReason =
    incomeTotal <= 0 || expenseTotal <= 0
      ? incomeTotal <= 0 && expenseTotal <= 0
        ? "Savings rate needs both income and expenses. Upload a chequing account statement."
        : incomeTotal <= 0
        ? "No income found — savings rate requires income data from a chequing account."
        : "No expenses found — savings rate requires spending data."
      : null;

  // ── Savings rates ────────────────────────────────────────────────────────
  // Core = income vs coreExpenses (CORE_EXCLUDE_RE: excl. transfers + debt + interest)
  // This matches monthlyHistory.coreExpensesTotal in the financial profile exactly.
  const savingsRateCore     = savingsUnavailableReason ? null : calcRate(incomeTotal, coreExpenses);
  // With debt = also subtract min debt payments (user toggle)
  const savingsRateWithDebt = savingsUnavailableReason ? null : calcRate(incomeTotal, coreExpenses + minDebtPayments);

  // ── Highlights ───────────────────────────────────────────────────────────
  const highlights = buildHighlights(categories, buckets, incomeTotal, coreExpenses);

  return {
    accountType:  acct.type,
    balanceLabel: balLabel,
    balance,
    balanceDisplay: balDisplay,
    balanceColor:   balColor,
    isDebt:  acct.isDebt || acct.isRevolving,
    isAsset: acct.isAsset,

    incomeTotal,
    expenseTotal,
    coreExpenses,
    minDebtPayments,
    hasIncome:   incomeTotal > 0,
    hasExpenses: expenseTotal > 0,

    incomeUnavailableReason,
    expenseUnavailableReason,
    savingsUnavailableReason,

    savingsRateCore,
    savingsRateWithDebt,

    buckets,
    categories,
    highlights,

    subscriptions: data.subscriptions ?? [],
  };
}
