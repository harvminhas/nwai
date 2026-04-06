/**
 * Pure computation over a single ParsedStatementData.
 *
 * Used exclusively by the anonymous /dashboard/[id] view — no UID, no DB,
 * no cache.  Imports only constants and helpers from the lib layer so the
 * same category/exclusion logic is consistent with the full pipeline.
 */

import type { ParsedStatementData, ExpenseCategory } from "./types";
import { CORE_EXCLUDE_RE } from "./spendingMetrics";
import { SCHEDULED_DEBT_TYPES } from "./debtUtils";

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

// ── Spending buckets ──────────────────────────────────────────────────────────

/** Category names that belong in the "Committed obligations" bucket. */
const COMMITTED_RE  = /^(debt payments|housing|mortgage payment)$/i;
/** Categories that are transfers or savings moves — not discretionary. */
const TRANSFERS_RE  = /^(transfers|transfers & payments|investments & savings|transfer in)$/i;
/** Interest charges — excluded from discretionary (same as CORE_EXCLUDE_RE). */
const INTEREST_RE   = /^interest$/i;

export interface SpendingBucket {
  key:         "committed" | "transfers_savings" | "discretionary";
  label:       string;
  description: string;
  amount:      number;
  /** Percentage of total outflows (not discretionary — total). */
  pct:         number;
}

function bucketFor(categoryName: string): SpendingBucket["key"] {
  const n = categoryName.trim();
  if (COMMITTED_RE.test(n))         return "committed";
  if (TRANSFERS_RE.test(n))         return "transfers_savings";
  if (INTEREST_RE.test(n))          return "transfers_savings"; // interest excluded like a transfer
  return "discretionary";
}

function buildBuckets(
  categories: ExpenseCategory[],
  total: number,
): SpendingBucket[] {
  const sums: Record<SpendingBucket["key"], number> = {
    committed:          0,
    transfers_savings:  0,
    discretionary:      0,
  };
  for (const cat of categories) {
    sums[bucketFor(cat.name)] += cat.amount;
  }

  const safe = total > 0 ? total : 1;
  return [
    {
      key:         "committed",
      label:       "Committed Obligations",
      description: "Debt payments, mortgage, housing",
      amount:      sums.committed,
      pct:         Math.round((sums.committed / safe) * 100),
    },
    {
      key:         "transfers_savings",
      label:       "Transfers & Savings",
      description: "Investments, inter-account transfers",
      amount:      sums.transfers_savings,
      pct:         Math.round((sums.transfers_savings / safe) * 100),
    },
    {
      key:         "discretionary",
      label:       "Discretionary Spending",
      description: "Shopping, dining, groceries, entertainment",
      amount:      sums.discretionary,
      pct:         Math.round((sums.discretionary / safe) * 100),
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
    const debtTxns = txns.filter((t) => /^debt payments$/i.test(t.category ?? ""));
    // Use scheduled types as "min" proxy; credit/loc default to "minimum" too (all are min here)
    // In the anonymous view all debt payments are treated as minimum obligations
    return debtTxns.reduce((sum, tx) => sum + tx.amount, 0);
  }

  // Fallback: use the Debt Payments category total as a proxy
  const debtCat = categories.find((c) => /^debt payments$/i.test(c.name));
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
  expenseTotal: number,
): StatementHighlight[] {
  const highlights: StatementHighlight[] = [];
  const committed   = buckets.find((b) => b.key === "committed");
  const savings_bucket = buckets.find((b) => b.key === "transfers_savings");
  const discretionary = buckets.find((b) => b.key === "discretionary");

  // 1. Debt / committed obligation share
  if (committed && committed.amount > 0 && expenseTotal > 0) {
    const pct = committed.pct;
    highlights.push({
      icon: "💸",
      text: `Debt & housing obligations make up ${pct}% of your outflows — ${fmtAmt(committed.amount)}/mo`,
      type: pct > 40 ? "warning" : "neutral",
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

  // 3. Top discretionary category
  const discCats = categories.filter((c) => bucketFor(c.name) === "discretionary" && c.amount > 0);
  discCats.sort((a, b) => b.amount - a.amount);
  if (discCats.length > 0) {
    const top = discCats[0];
    highlights.push({
      icon: "🛍️",
      text: `${top.name} was your #1 discretionary expense at ${fmtAmt(top.amount)}`,
      type: "neutral",
    });
  }

  // 4. Grocery / food spend (informational if not already top)
  if (discCats.length > 1) {
    const grocery = categories.find((c) => /^groceries$/i.test(c.name));
    if (grocery && grocery.amount > 0 && grocery.name !== discCats[0].name) {
      highlights.push({
        icon: "🛒",
        text: `Grocery spend: ${fmtAmt(grocery.amount)} this month`,
        type: "neutral",
      });
    }
  }

  // 5. Transfers dominating (signal that this might not be a primary chequing account)
  const tfr = savings_bucket;
  if (tfr && tfr.amount > 0 && expenseTotal > 0 && tfr.pct > 30) {
    highlights.push({
      icon: "🔄",
      text: `${tfr.pct}% of outflows are transfers or savings moves — not counted as spending`,
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
  /** Expenses excluding CORE_EXCLUDE_RE (transfers, debt payments, interest).
   *  Matches the financial profile's coreExpensesTotal — use this for savings rate. */
  coreExpenses:         number;
  /** Discretionary bucket only (excl. transfers, debt, investments, housing).
   *  Used for the "Where your money went" visualisation only. */
  discretionaryTotal:   number;
  minDebtPayments:      number;
  hasIncome:            boolean;
  hasExpenses:          boolean;

  // Why income/savings is unavailable (null = available)
  incomeUnavailableReason:   string | null;
  expenseUnavailableReason:  string | null;
  savingsUnavailableReason:  string | null;

  // Savings rate variants (null = cannot compute)
  /** Core savings rate: excl. transfers AND debt payments */
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

  // ── Raw totals ───────────────────────────────────────────────────────────
  const incomeTotal  = data.income?.total  ?? 0;
  const expenseTotal = data.expenses?.total ?? 0;
  const categories   = data.expenses?.categories ?? [];

  // ── Buckets ──────────────────────────────────────────────────────────────
  const buckets = buildBuckets(categories, expenseTotal);
  const discretionaryTotal = buckets.find((b) => b.key === "discretionary")?.amount ?? 0;

  // ── Core expenses — matches financial profile's coreExpensesTotal exactly ─
  // Uses CORE_EXCLUDE_RE (single source of truth) instead of bucket heuristics.
  // This is what produces the same savings rate as the logged-in dashboard.
  const coreExpenses = categories
    .filter((c) => !CORE_EXCLUDE_RE.test(c.name.trim()))
    .reduce((sum, c) => sum + c.amount, 0);

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
  const highlights = buildHighlights(categories, buckets, incomeTotal, expenseTotal);

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
    discretionaryTotal,
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
