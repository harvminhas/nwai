import type {
  ParsedStatementData,
  IncomeSource,
  IncomeTransaction,
  ExpenseCategory,
  Subscription,
  Insight,
} from "./types";

/**
 * Derive year-month (YYYY-MM) from statementDate for grouping.
 * Falls back to first 7 chars of statementDate or empty.
 */
export function getYearMonth(statementDate: string | undefined): string {
  if (!statementDate) return "";
  const parsed = statementDate.slice(0, 7);
  return /^\d{4}-\d{2}$/.test(parsed) ? parsed : "";
}

/**
 * Consolidate multiple statements (same month) into one ParsedStatementData.
 * - Net worth: sum
 * - Income/expenses: merge by normalized name, sum amounts; recalc percentages
 * - Subscriptions: merge by normalized name, sum amount
 * - Savings rate: (income - expenses) / income
 * - Insights: from first statement
 */
export function consolidateStatements(
  statements: ParsedStatementData[],
  monthKey: string
): ParsedStatementData {
  if (statements.length === 0) {
    return emptyParsedData(monthKey);
  }
  if (statements.length === 1) {
    const s = statements[0];
    const nw = s.netWorth ?? 0;
    const txns = (s.expenses?.transactions ?? []).slice().sort((a, b) => {
      if (a.date && b.date) return b.date.localeCompare(a.date);
      return 0;
    });
    const incomeTxns = (s.income?.transactions ?? []).slice().sort((a, b) => {
      if (a.date && b.date) return b.date.localeCompare(a.date);
      return 0;
    });
    return {
      ...s,
      assets: s.assets ?? Math.max(0, nw),
      debts: s.debts ?? Math.max(0, -nw),
      income: { ...s.income, total: s.income?.total ?? 0, sources: s.income?.sources ?? [], transactions: incomeTxns },
      expenses: { ...s.expenses, total: s.expenses?.total ?? 0, categories: s.expenses?.categories ?? [], transactions: txns },
    };
  }

  const first = statements[0];
  const netWorth = statements.reduce((sum, s) => sum + (s.netWorth ?? 0), 0);

  let totalAssets = 0;
  let totalDebts = 0;
  for (const s of statements) {
    const nw = s.netWorth ?? 0;
    if (s.assets != null || s.debts != null) {
      totalAssets += s.assets ?? 0;
      totalDebts += s.debts ?? 0;
    } else {
      totalAssets += Math.max(0, nw);
      totalDebts += Math.max(0, -nw);
    }
  }

  const incomeSourcesMap = new Map<string, { label: string; amount: number }>();
  let incomeTotal = 0;
  const allIncomeTransactions: IncomeTransaction[] = [];
  for (const s of statements) {
    const inc = s.income;
    if (!inc) continue;
    incomeTotal += inc.total ?? 0;
    for (const src of inc.sources ?? []) {
      const key = (src.description || "").trim().toUpperCase() || "OTHER";
      const existing = incomeSourcesMap.get(key);
      if (existing) {
        existing.amount += src.amount ?? 0;
      } else {
        incomeSourcesMap.set(key, {
          label: (src.description || "").trim() || "Other",
          amount: src.amount ?? 0,
        });
      }
    }
    for (const txn of inc.transactions ?? []) {
      allIncomeTransactions.push(txn);
    }
  }
  const incomeSources: IncomeSource[] = Array.from(incomeSourcesMap.values()).map(
    (v) => ({ description: v.label, amount: v.amount })
  );

  const expenseCategoriesMap = new Map<string, { name: string; amount: number }>();
  let expensesTotal = 0;
  const allTransactions: import("./types").ExpenseTransaction[] = [];
  for (const s of statements) {
    const exp = s.expenses;
    if (!exp) continue;
    expensesTotal += exp.total ?? 0;
    for (const cat of exp.categories ?? []) {
      const key = (cat.name || "").trim().toUpperCase() || "OTHER";
      const existing = expenseCategoriesMap.get(key);
      if (existing) {
        existing.amount += cat.amount ?? 0;
      } else {
        expenseCategoriesMap.set(key, {
          name: (cat.name || "").trim() || "Other",
          amount: cat.amount ?? 0,
        });
      }
    }
    for (const txn of exp.transactions ?? []) {
      allTransactions.push(txn);
    }
  }
  const expenseCategories: ExpenseCategory[] = Array.from(
    expenseCategoriesMap.values()
  ).map((v) => ({
    name: v.name,
    amount: v.amount,
    percentage: expensesTotal > 0 ? Math.round((v.amount / expensesTotal) * 100) : 0,
  }));

  const totalPaymentsMade = statements.reduce((sum, s) => sum + (s.paymentsMade ?? 0), 0);

  const subsMap = new Map<string, { name: string; amount: number }>();
  for (const s of statements) {
    for (const sub of s.subscriptions ?? []) {
      const key = (sub.name || "").trim().toUpperCase() || "OTHER";
      const existing = subsMap.get(key);
      if (existing) {
        existing.amount += sub.amount ?? 0;
      } else {
        subsMap.set(key, {
          name: (sub.name || "").trim() || "Other",
          amount: sub.amount ?? 0,
        });
      }
    }
  }
  const subscriptions: Subscription[] = Array.from(subsMap.values()).map(
    (v) => ({ name: v.name, amount: v.amount, frequency: "monthly" })
  );

  const savingsRate =
    incomeTotal > 0
      ? Math.round(((incomeTotal - expensesTotal) / incomeTotal) * 100)
      : 0;

  const statementDate = `${monthKey}-01`;
  const bankName =
    statements.length > 1 ? "Multiple accounts" : (first.bankName || "");

  const insights: Insight[] = first.insights ?? [];

  return {
    netWorth,
    assets: totalAssets,
    debts: totalDebts,
    statementDate,
    bankName,
    accountId: first.accountId,
    accountName: first.accountName,
    accountType: first.accountType,
    paymentsMade: totalPaymentsMade > 0 ? totalPaymentsMade : undefined,
    income: {
      total: incomeTotal,
      sources: incomeSources,
      transactions: allIncomeTransactions.sort((a, b) => {
        if (a.date && b.date) return b.date.localeCompare(a.date);
        return 0;
      }),
    },
    expenses: {
      total: expensesTotal,
      categories: expenseCategories,
      transactions: allTransactions.sort((a, b) => {
        if (a.date && b.date) return b.date.localeCompare(a.date);
        return 0;
      }),
    },
    subscriptions,
    savingsRate,
    insights,
  };
}

function emptyParsedData(monthKey: string): ParsedStatementData {
  const statementDate = `${monthKey}-01`;
  return {
    netWorth: 0,
    assets: 0,
    debts: 0,
    statementDate,
    bankName: "",
    income: { total: 0, sources: [] },
    expenses: { total: 0, categories: [] },
    subscriptions: [],
    savingsRate: 0,
    insights: [],
  };
}
