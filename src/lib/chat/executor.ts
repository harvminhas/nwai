/**
 * Tool executor — orchestration only: each handler delegates to shared `src/lib/**`
 * rules (same filters as UI/API). No duplicate business logic here.
 *
 * Adding a tool:
 *   1. `FunctionDeclaration` in tools.ts (+ `TOOL_NAMES` entry — drives Gemini schema)
 *   2. Execute function here that calls shared modules only
 *   3. Register in `TOOL_HANDLERS` — TypeScript requires every `ToolName` have a handler
 */

import type { FinancialProfileCache } from "@/lib/financialProfile";
import type { UserReviewContext } from "@/lib/userReviewContext";
import { FREQ_MONTHLY } from "@/app/api/user/cash-commitments/route";
import { isCoreExcluded } from "@/lib/spendingMetrics";
import { getParentCategory } from "@/lib/categoryTaxonomy";
import { getHomeCurrency, toHome as toHomeCurrency } from "@/lib/currencyUtils";
import type { ToolName } from "@/lib/chat/tools";
import { TOOL_NAMES } from "@/lib/chat/tools";

// ── helpers ─────────────────────────────────────────────────────────────────

function normalizeForMatch(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Merchant match: true when the normalized needle appears as a substring of
 * the normalized haystack. Simple and predictable — no token splitting.
 *
 * Examples:
 *   "costco"  → "COSTCO BUSINESS CTR 17"   ✓
 *   "barber"  → "KING'S CHAIR BARBERSHOP"  ✓ ("barbershop" contains "barber")
 *   "amazon"  → "AMAZON.CA *MKTP CA"       ✓
 *   "king"    → "ONE KING WEST HOTEL R"    ✓  ← intentional; user should use category search for type queries
 */
function fuzzyMatch(needle: string, haystack: string): boolean {
  const n = normalizeForMatch(needle);
  const h = normalizeForMatch(haystack);
  if (!n || !h) return false;
  return h.includes(n);
}

function makeFmt(currency: string) {
  return (v: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(v);
}

/** Expand YYYY-MM to a date range [YYYY-MM-01, YYYY-MM-31] for comparison. */
function expandDateParam(d: string, end: boolean): string {
  if (d.length === 7) return end ? `${d}-31` : `${d}-01`;
  return d;
}

// ── tool result types ────────────────────────────────────────────────────────

export interface ToolResult {
  ok: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data?: any;
  error?: string;
}

export type ToolParams = Record<string, unknown>;

// ── search_transactions ──────────────────────────────────────────────────────

export function executeSearchTransactions(
  profile: FinancialProfileCache,
  params: ToolParams,
  context: UserReviewContext,
): ToolResult {
  const home = getHomeCurrency(profile);
  const fxRates = profile.fxRates ?? {};
  const fmt = makeFmt(home);

  const merchant   = params.merchant   as string | undefined;
  const categories = (params.categories as string[] | undefined)?.filter(Boolean) ?? [];
  const account    = params.account    as string | undefined;
  const fromDate = params.from_date as string | undefined;
  const toDate = params.to_date as string | undefined;
  const includeIncome = params.include_income as boolean | undefined;
  const limit = Math.min((params.limit as number | undefined) ?? 200, 500);

  const fromNorm = fromDate ? expandDateParam(fromDate, false) : undefined;
  const toNorm   = toDate   ? expandDateParam(toDate,   true)  : undefined;

  // ── expense transactions ──────────────────────────────────────────────────
  let expenses = profile.expenseTxns; // newest-first

  const matchesMerchant = (t: (typeof expenses)[0]) =>
    merchant ? fuzzyMatch(merchant, t.merchant) : false;

  /** True if the transaction's category (or its parent) matches any of the requested categories. */
  const matchesCategories = (t: (typeof expenses)[0]) => {
    if (categories.length === 0) return false;
    const txCat    = (t.category ?? "").toLowerCase().trim();
    const txParent = getParentCategory(t.category ?? "").toLowerCase();
    return categories.some((cat) => {
      const c = cat.toLowerCase().trim();
      return (
        txCat    === c ||
        txParent === c ||
        txCat.includes(c) ||
        c.includes(txCat)
      );
    });
  };

  if (merchant || categories.length > 0) {
    expenses = expenses.filter((t) => matchesMerchant(t) || matchesCategories(t));
  }
  if (account) {
    expenses = expenses.filter(
      (t) =>
        fuzzyMatch(account, t.accountLabel ?? "") ||
        fuzzyMatch(account, t.accountSlug ?? ""),
    );
  }
  if (fromNorm) expenses = expenses.filter((t) => t.date >= fromNorm);
  if (toNorm)   expenses = expenses.filter((t) => t.date <= toNorm);

  const expenseRows = expenses.slice(0, limit).map((t) => ({
    date:     t.date,
    merchant: t.merchant,
    amount:   fmt(toHomeCurrency(t.amount, t.currency, profile)),
    category: t.category,
    account:  t.accountLabel ?? t.accountSlug,
    type:     "expense",
  }));

  // ── income transactions (optional) ───────────────────────────────────────
  const incomeRows: typeof expenseRows = [];
  if (includeIncome) {
    let income = profile.incomeTxns; // newest-first
    if (merchant) {
      income = income.filter(
        (t) => fuzzyMatch(merchant, t.source) || fuzzyMatch(merchant, t.description ?? ""),
      );
    }
    if (account) {
      income = income.filter((t) => fuzzyMatch(account, t.accountSlug ?? ""));
    }
    if (fromNorm) income = income.filter((t) => t.date >= fromNorm);
    if (toNorm)   income = income.filter((t) => t.date <= toNorm);

    incomeRows.push(
      ...income.slice(0, limit).map((t) => ({
        date:     t.date,
        merchant: t.source,
        amount:   fmt(toHomeCurrency(t.amount, t.currency, profile)),
        category: "Income",
        account:  t.accountSlug ?? "",
        type:     "income",
      })),
    );
  }

  const rows = [...expenseRows, ...incomeRows].sort((a, b) =>
    b.date.localeCompare(a.date),
  );

  if (rows.length === 0) {
    return {
      ok: true,
      data: {
        count: 0,
        rows: [],
        message: "No transactions found matching these filters.",
      },
    };
  }

  // Compute summary stats for the caller
  const expSliced   = expenses.slice(0, limit);
  const totalAmount = expSliced.reduce((s, t) => s + toHomeCurrency(t.amount, t.currency, profile), 0);

  // Per-merchant occurrence counts so the model can see duplicates clearly
  const merchantCounts: Record<string, number> = {};
  for (const r of rows) {
    merchantCounts[r.merchant] = (merchantCounts[r.merchant] ?? 0) + 1;
  }
  const merchantSummary = Object.entries(merchantCounts)
    .sort(([, a], [, b]) => b - a)
    .map(([m, n]) => `${m}: ${n} visit${n !== 1 ? "s" : ""}`)
    .join(", ");

  return {
    ok: true,
    data: {
      total_rows: rows.length,
      merchant_summary: merchantSummary,
      note: "List every row below individually — do not merge rows with the same merchant.",
      currency: home,
      total_amount: fmt(totalAmount),
      rows,
    },
  };
}

// ── get_monthly_breakdown ────────────────────────────────────────────────────

export function executeGetMonthlyBreakdown(
  profile: FinancialProfileCache,
  params: ToolParams,
  context: UserReviewContext,
): ToolResult {
  const home = getHomeCurrency(profile);
  const fxRates = profile.fxRates ?? {};
  const fmt = makeFmt(home);

  const fromMonth = params.from_month as string | undefined;
  const toMonth   = params.to_month   as string | undefined;
  const byCategory = params.by_category as boolean | undefined;

  let history = profile.monthlyHistory;
  if (fromMonth) history = history.filter((h) => h.yearMonth >= fromMonth);
  if (toMonth)   history = history.filter((h) => h.yearMonth <= toMonth);

  if (history.length === 0) {
    return {
      ok: true,
      data: { months: [], message: "No monthly data in this range." },
    };
  }

  const months = history.map((h) => {
    const net        = h.incomeTotal - h.coreExpensesTotal;
    const savingsRate =
      h.incomeTotal > 0
        ? `${((net / h.incomeTotal) * 100).toFixed(1)}%`
        : "0.0%";

    const entry: Record<string, unknown> = {
      month:        h.yearMonth,
      income:       fmt(h.incomeTotal),
      expenses:     fmt(h.coreExpensesTotal),
      net:          fmt(net),
      savings_rate: savingsRate,
    };

    if ((h.debtPaymentsTotal ?? 0) > 0) {
      entry.debt_payments     = fmt(h.debtPaymentsTotal);
      entry.min_debt_payments = fmt(h.minDebtPaymentsTotal ?? 0);
    }

    if (byCategory) {
      const catTotals: Record<string, number> = {};
      for (const t of profile.expenseTxns) {
        if (t.txMonth !== h.yearMonth) continue;
        if (
          isCoreExcluded(t.category ?? "", {
            debtType: (t as { debtType?: string }).debtType,
            merchant: t.merchant,
          })
        ) {
          continue;
        } // skip transfers + revolving settlement + interest
        const homeAmt = toHomeCurrency(t.amount, t.currency, profile);
        catTotals[t.category] = (catTotals[t.category] ?? 0) + homeAmt;
      }
      entry.by_category = Object.entries(catTotals)
        .sort(([, a], [, b]) => b - a)
        .map(([cat, amt]) => ({ category: cat, amount: fmt(amt) }));
    }

    return entry;
  });

  return { ok: true, data: { months, currency: home } };
}

// ── rollup_categories ────────────────────────────────────────────────────────

export function executeRollupCategories(
  profile: FinancialProfileCache,
  params: ToolParams,
  context: UserReviewContext,
): ToolResult {
  const home = getHomeCurrency(profile);
  const fxRates = profile.fxRates ?? {};
  const fmt = makeFmt(home);

  let fromMonth =
    (params.from_month as string | undefined) ?? profile.allTxMonths[0] ?? "";
  let toMonth =
    (params.to_month as string | undefined) ?? profile.latestTxMonth ?? "";
  if (fromMonth && toMonth && fromMonth > toMonth) {
    const t = fromMonth;
    fromMonth = toMonth;
    toMonth = t;
  }
  const parentOnly = params.parent_category_only === true;

  if (!fromMonth || !toMonth) {
    return {
      ok: true,
      data: {
        categories: [],
        currency: home,
        message: "No transaction months available.",
      },
    };
  }

  const catTotals = new Map<string, { total: number; count: number }>();

  for (const t of profile.expenseTxns) {
    const ym = t.txMonth;
    if (ym < fromMonth || ym > toMonth) continue;
    if (
      isCoreExcluded(t.category ?? "", {
        debtType: (t as { debtType?: string }).debtType,
        merchant: t.merchant,
      })
    ) {
      continue;
    }
    const label = parentOnly
      ? getParentCategory(t.category ?? "Other").trim() || "Other"
      : (t.category ?? "Uncategorized").trim() || "Uncategorized";
    const homeAmt = toHomeCurrency(t.amount, t.currency, profile);
    const prev = catTotals.get(label) ?? { total: 0, count: 0 };
    catTotals.set(label, { total: prev.total + homeAmt, count: prev.count + 1 });
  }

  const categories = [...catTotals.entries()]
    .sort(([, a], [, b]) => b.total - a.total)
    .map(([category, { total, count }]) => ({
      category,
      total: fmt(total),
      transaction_count: count,
    }));

  return {
    ok: true,
    data: {
      from_month: fromMonth,
      to_month: toMonth,
      parent_category_only: parentOnly,
      currency: home,
      categories,
      note:
        "Totals are core spending only (excludes transfers, interest, card/LOC servicing). Installment servicing stays included.",
    },
  };
}

// ── rollup_merchants ─────────────────────────────────────────────────────────

export function executeRollupMerchants(
  profile: FinancialProfileCache,
  params: ToolParams,
  context: UserReviewContext,
): ToolResult {
  const home = getHomeCurrency(profile);
  const fxRates = profile.fxRates ?? {};
  const fmt = makeFmt(home);

  let fromMonth =
    (params.from_month as string | undefined) ?? profile.allTxMonths[0] ?? "";
  let toMonth =
    (params.to_month as string | undefined) ?? profile.latestTxMonth ?? "";
  if (fromMonth && toMonth && fromMonth > toMonth) {
    const t = fromMonth;
    fromMonth = toMonth;
    toMonth = t;
  }
  const limit = Math.min((params.limit as number | undefined) ?? 25, 50);

  if (!fromMonth || !toMonth) {
    return {
      ok: true,
      data: { merchants: [], currency: home, message: "No transaction months available." },
    };
  }

  const merchantTotals = new Map<string, { total: number; count: number }>();

  for (const t of profile.expenseTxns) {
    const ym = t.txMonth;
    if (ym < fromMonth || ym > toMonth) continue;
    if (
      isCoreExcluded(t.category ?? "", {
        debtType: (t as { debtType?: string }).debtType,
        merchant: t.merchant,
      })
    ) {
      continue;
    }
    const name = (t.merchant ?? "Unknown").trim() || "Unknown";
    const homeAmt = toHomeCurrency(t.amount, t.currency, profile);
    const prev = merchantTotals.get(name) ?? { total: 0, count: 0 };
    merchantTotals.set(name, { total: prev.total + homeAmt, count: prev.count + 1 });
  }

  const merchants = [...merchantTotals.entries()]
    .sort(([, a], [, b]) => b.total - a.total)
    .slice(0, limit)
    .map(([merchant, { total, count }]) => ({
      merchant,
      total: fmt(total),
      transaction_count: count,
    }));

  return {
    ok: true,
    data: {
      from_month: fromMonth,
      to_month: toMonth,
      currency: home,
      merchants,
      note:
        "Core spending only (excludes transfers, interest, card/LOC servicing). For line-item detail call search_transactions.",
    },
  };
}

// ── list_recurring_charges ────────────────────────────────────────────────────

export function executeListRecurringCharges(profile: FinancialProfileCache): ToolResult {
  const home = getHomeCurrency(profile);
  const fxRates = profile.fxRates ?? {};
  const fmt = makeFmt(home);

  const subscriptions = profile.confirmedSubscriptions.map((s) => {
    const raw =
      s.amount ?? s.suggestedAmount ?? 0;
    const ccy = (s.currency ?? home).toUpperCase();
    const amtHome = toHomeCurrency(raw, ccy, profile);
    const freq = s.frequency ?? s.suggestedFrequency ?? "monthly";
    return {
      name: s.name,
      status: s.status,
      amount: fmt(amtHome),
      frequency: freq,
      currency: home,
      merchant_slug: s.merchantSlug,
      last_seen: s.lastSeenAt,
    };
  });

  const cash_commitments = profile.cashCommitmentEntries.map((c) => {
    const monthlyEquiv =
      c.frequency === "once" ? null : c.amount * FREQ_MONTHLY[c.frequency];
    return {
      name: c.name,
      frequency: c.frequency,
      amount: fmt(c.amount),
      approximate_monthly: monthlyEquiv != null ? fmt(monthlyEquiv) : null,
    };
  });

  return {
    ok: true,
    data: {
      currency: home,
      subscriptions,
      cash_commitments,
      counts: {
        subscriptions: subscriptions.length,
        cash_commitments: cash_commitments.length,
      },
    },
  };
}

// ── get_debt_payment_trend ───────────────────────────────────────────────────

export function executeGetDebtPaymentTrend(
  profile: FinancialProfileCache,
  params: ToolParams,
  context: UserReviewContext,
): ToolResult {
  const home = getHomeCurrency(profile);
  const fmt = makeFmt(home);
  const cap = Math.min(Math.max((params.months as number | undefined) ?? 12, 1), 36);

  const sortedDesc = [...profile.monthlyHistory].sort((a, b) =>
    b.yearMonth.localeCompare(a.yearMonth),
  );
  const slice = sortedDesc.slice(0, cap).reverse();

  const months = slice.map((h) => {
    const debt = h.debtPaymentsTotal ?? 0;
    const card = h.cardServicingPaymentsTotal ?? 0;
    const installmentStyle = Math.max(0, debt - card);
    return {
      month: h.yearMonth,
      all_debt_payments: fmt(debt),
      card_loc_servicing: fmt(card),
      installment_and_similar: fmt(installmentStyle),
      min_scheduled_payments: fmt(h.minDebtPaymentsTotal ?? 0),
    };
  });

  return {
    ok: true,
    data: {
      currency: home,
      months,
      note:
        "card_loc_servicing pays revolving balances already reflected in card spending; installment_and_similar is an approximation (all debt payments minus card servicing).",
    },
  };
}

// ── get_income_summary ────────────────────────────────────────────────────────

export function executeGetIncomeSummary(
  profile: FinancialProfileCache,
  params: ToolParams,
  context: UserReviewContext,
): ToolResult {
  const { buildIncomeSummary } = require("@/lib/incomeSummary");
  const { getRangeMonths } = require("@/lib/rangeUtils");
  
  const home = getHomeCurrency(profile);
  const fmt = makeFmt(home);
  
  const rangeParam = (params.range as string | undefined) ?? "3mo";
  let rangeMonths: string[];
  
  if (rangeParam === "3mo" || rangeParam === "12mo" || rangeParam === "ytd") {
    const availableMonths = profile.allTxMonths.sort();
    rangeMonths = getRangeMonths(rangeParam, availableMonths);
  } else {
    rangeMonths = rangeParam.split(",").map(m => m.trim()).filter(Boolean);
  }
  
  // Use incomeDepositReviews from context (loaded from Firestore by caller)
  const summary = buildIncomeSummary(
    profile.incomeTxns,
    profile.accountSnapshots,
    home,
    context.incomeDepositReviews,
    rangeMonths,
  );
  
  const bySource = summary.sources.map((s: any) => ({
    source: s.description || s.canonicalName,
    total: fmt(s.total),
    monthly_average: fmt(s.total / rangeMonths.length),
    transaction_count: s.count,
  }));
  
  const bonuses = summary.bonusTransactions.map((b: any) => ({
    date: b.date,
    source: b.source,
    description: b.description,
    amount: fmt(b.amount),
  }));
  
  return {
    ok: true,
    data: {
      typical_monthly: fmt(summary.typicalMonthly),
      range_months: rangeMonths,
      currency: home,
      by_source: bySource,
      bonuses: bonuses.length > 0 ? bonuses : undefined,
    },
  };
}

// ── get_spending_summary ──────────────────────────────────────────────────────

export function executeGetSpendingSummary(
  profile: FinancialProfileCache,
  params: ToolParams,
  context: UserReviewContext,
): ToolResult {
  const { buildSpendingSummary } = require("@/lib/spendingSummary");
  const { getRangeMonths } = require("@/lib/rangeUtils");
  
  const home = getHomeCurrency(profile);
  const fmt = makeFmt(home);
  
  const rangeParam = (params.range as string | undefined) ?? "3mo";
  let rangeMonths: string[];
  
  if (rangeParam === "3mo" || rangeParam === "12mo" || rangeParam === "ytd") {
    const availableMonths = profile.allTxMonths.sort();
    rangeMonths = getRangeMonths(rangeParam, availableMonths);
  } else {
    rangeMonths = rangeParam.split(",").map(m => m.trim()).filter(Boolean);
  }
  
  // Use debtPaymentReviews from context (loaded from Firestore by caller)
  const summary = buildSpendingSummary(
    profile.expenseTxns,
    profile.accountSnapshots,
    profile.debtPaymentHistory ?? [],
    context.debtPaymentReviews,
    profile.fxRates ?? {},
    home,
    rangeMonths,
  );
  
  // Convert buckets array to structured object
  const bucketObj: Record<string, any> = {};
  for (const bucket of summary.buckets) {
    bucketObj[bucket.bucket] = {
      label: bucket.label,
      total: fmt(bucket.total),
      monthly_average: fmt(bucket.averageMonthly),
      categories: bucket.categories.map((c: any) => ({
        category: c.category,
        total: fmt(c.total),
        monthly_average: fmt(c.averageMonthly),
      })),
    };
  }
  
  return {
    ok: true,
    data: {
      typical_monthly: fmt(summary.typicalMonthly),
      range_months: rangeMonths,
      currency: home,
      buckets: bucketObj,
    },
  };
}

// ── list_cash_expenses ────────────────────────────────────────────────────────

export function executeListCashExpenses(profile: FinancialProfileCache): ToolResult {
  const home = getHomeCurrency(profile);
  const fmt = makeFmt(home);
  
  if (!profile.cashCommitmentEntries || profile.cashCommitmentEntries.length === 0) {
    return {
      ok: true,
      data: {
        cash_expenses: [],
        total_monthly: fmt(0),
        currency: home,
        message: "No recurring cash expenses found.",
      },
    };
  }
  
  const now = new Date();
  const expenses = profile.cashCommitmentEntries.map(c => {
    const monthlyEquiv = c.frequency === "once" ? 0 : c.amount * FREQ_MONTHLY[c.frequency];
    
    // Simple next due calculation
    let nextDue = "One-time";
    if (c.status === "paused") {
      nextDue = "Paused";
    } else if (c.frequency !== "once") {
      const floor = new Date(c.startDate || c.createdAt);
      let next = new Date(floor);
      while (next < now) {
        switch (c.frequency) {
          case "weekly": next.setDate(next.getDate() + 7); break;
          case "biweekly": next.setDate(next.getDate() + 14); break;
          case "monthly": next.setMonth(next.getMonth() + 1); break;
          case "quarterly": next.setMonth(next.getMonth() + 3); break;
          case "yearly": next.setFullYear(next.getFullYear() + 1); break;
        }
      }
      nextDue = next.toISOString().slice(0, 10);
    }
    
    return {
      name: c.name,
      amount: fmt(c.amount),
      frequency: c.frequency,
      monthly_equivalent: monthlyEquiv > 0 ? fmt(monthlyEquiv) : null,
      next_due: nextDue,
      category: c.category,
      status: c.status || "active",
      skipped_months: c.skippedMonths || [],
      notes: c.notes,
    };
  });
  
  const totalMonthly = profile.cashCommitmentEntries
    .filter(c => c.status !== "paused" && c.frequency !== "once")
    .reduce((sum, c) => sum + c.amount * FREQ_MONTHLY[c.frequency], 0);
  
  return {
    ok: true,
    data: {
      cash_expenses: expenses,
      total_monthly: fmt(totalMonthly),
      count: expenses.length,
      currency: home,
      note: "Recurring expenses paid by cash or not captured in bank statements. Monthly equivalent shown for recurring items.",
    },
  };
}

// ── get_savings_summary ───────────────────────────────────────────────────────

export function executeGetSavingsSummary(
  profile: FinancialProfileCache,
  params: ToolParams,
  context: UserReviewContext,
): ToolResult {
  const { computeWindowSavings } = require("@/lib/savingsCalculations");
  const { getRangeMonths } = require("@/lib/rangeUtils");
  
  const home = getHomeCurrency(profile);
  const fmt = makeFmt(home);
  
  const rangeParam = (params.range as string | undefined) ?? "3mo";
  let rangeMonths: string[];
  
  if (rangeParam === "3mo" || rangeParam === "12mo" || rangeParam === "ytd") {
    const availableMonths = profile.allTxMonths.sort();
    rangeMonths = getRangeMonths(rangeParam, availableMonths);
  } else {
    rangeMonths = rangeParam.split(",").map(m => m.trim()).filter(Boolean);
  }
  
  // Use savingsConfirmedItems from context (loaded from Firestore by caller)
  const savings = computeWindowSavings(
    profile.monthlyHistory,
    profile.accountBalanceHistory ?? [],
    profile.expenseTxns,
    rangeMonths,
    context.savingsConfirmedItems,
  );
  
  return {
    ok: true,
    data: {
      typical_monthly: fmt(savings.monthlyAverage.total),
      range_months: rangeMonths,
      currency: home,
      breakdown: {
        cash_change: fmt(savings.monthlyAverage.netCashChange),
        debt_paydown: fmt(savings.monthlyAverage.netDebtChange),
        contributions: fmt(savings.monthlyAverage.contributionsToOutside),
      },
    },
  };
}

// ── get_net_worth ─────────────────────────────────────────────────────────────

export function executeGetNetWorth(profile: FinancialProfileCache): ToolResult {
  const { getNetWorth } = require("@/lib/profileMetrics");
  
  const home = getHomeCurrency(profile);
  const fmt = makeFmt(home);
  
  const month = profile.latestTxMonth ?? "";
  const nw = getNetWorth(profile, month);
  
  // Calculate monthly change
  const sortedHistory = [...profile.monthlyHistory].sort((a, b) => 
    b.yearMonth.localeCompare(a.yearMonth)
  );
  const currentMonthData = sortedHistory[0];
  const lastMonthData = sortedHistory[1];
  
  let monthlyChange = 0;
  if (currentMonthData && lastMonthData) {
    const currentNW = currentMonthData.incomeTotal - currentMonthData.coreExpensesTotal;
    const lastNW = lastMonthData.incomeTotal - lastMonthData.coreExpensesTotal;
    monthlyChange = currentNW - lastNW;
  }
  
  return {
    ok: true,
    data: {
      net_worth: fmt(nw.total),
      total_assets: fmt(nw.totalAssets),
      total_debts: fmt(nw.totalDebts),
      monthly_change: fmt(monthlyChange),
      as_of_month: month,
      currency: home,
    },
  };
}

// ── list_accounts ─────────────────────────────────────────────────────────────

export function executeListAccounts(profile: FinancialProfileCache): ToolResult {
  const home = getHomeCurrency(profile);
  const fmt = makeFmt(home);
  
  const assets = profile.accountSnapshots
    .filter(a => 
      a.accountType === "checking" || 
      a.accountType === "savings" ||
      a.accountType === "investment" ||
      a.accountType === "property"
    )
    .map(a => {
      const acctCcy = (a.currency ?? home).toUpperCase();
      const nativeFmt = makeFmt(acctCcy);
      
      // Get recent balance history
      const history = (profile.accountBalanceHistory ?? [])
        .find(h => h.slug === a.slug)
        ?.entries
        .sort((a, b) => b.yearMonth.localeCompare(a.yearMonth))
        .slice(0, 6)
        .reverse()
        .map(h => ({
          month: h.yearMonth,
          balance: nativeFmt(h.balance),
        })) ?? [];
      
      return {
        bank_name: a.bankName,
        account_type: a.accountType,
        balance: nativeFmt(a.balance),
        balance_home: fmt(toHomeCurrency(a.balance, acctCcy, profile)),
        currency: acctCcy,
        last_4: a.accountId ? `••••${a.accountId.slice(-4)}` : undefined,
        recent_history: history.length > 0 ? history : undefined,
      };
    });
  
  const debts = profile.accountSnapshots
    .filter(a => 
      a.accountType === "credit" || 
      a.accountType === "credit_card" ||
      a.accountType === "loan" ||
      a.accountType === "mortgage"
    )
    .map(a => {
      const acctCcy = (a.currency ?? home).toUpperCase();
      const nativeFmt = makeFmt(acctCcy);
      
      const history = (profile.accountBalanceHistory ?? [])
        .find(h => h.slug === a.slug)
        ?.entries
        .sort((a, b) => b.yearMonth.localeCompare(a.yearMonth))
        .slice(0, 6)
        .reverse()
        .map(h => ({
          month: h.yearMonth,
          balance: nativeFmt(h.balance),
        })) ?? [];
      
      const rateInfo = profile.accountRates.find(r => r.accountKey === a.slug);
      
      return {
        bank_name: a.bankName,
        account_type: a.accountType,
        balance: nativeFmt(a.balance),
        balance_home: fmt(toHomeCurrency(a.balance, acctCcy, profile)),
        currency: acctCcy,
        apr: rateInfo?.rate,
        last_4: a.accountId ? `••••${a.accountId.slice(-4)}` : undefined,
        recent_history: history.length > 0 ? history : undefined,
      };
    });
  
  return {
    ok: true,
    data: {
      currency: home,
      assets: {
        count: assets.length,
        accounts: assets,
      },
      debts: {
        count: debts.length,
        accounts: debts,
      },
    },
  };
}

// ── list_subscriptions ────────────────────────────────────────────────────────

export function executeListSubscriptions(profile: FinancialProfileCache): ToolResult {
  const home = getHomeCurrency(profile);
  const fmt = makeFmt(home);
  
  if (!profile.confirmedSubscriptions || profile.confirmedSubscriptions.length === 0) {
    return {
      ok: true,
      data: {
        subscriptions: [],
        count: 0,
        currency: home,
        message: "No confirmed subscriptions found.",
      },
    };
  }
  
  const subscriptions = profile.confirmedSubscriptions.map(s => {
    const raw = s.amount ?? s.suggestedAmount ?? 0;
    const ccy = (s.currency ?? home).toUpperCase();
    const amtHome = toHomeCurrency(raw, ccy, profile);
    const freq = s.frequency ?? s.suggestedFrequency ?? "monthly";
    
    return {
      name: s.name,
      amount: fmt(amtHome),
      frequency: freq,
      status: s.status,
      last_seen: s.lastSeenAt,
      merchant_slug: s.merchantSlug,
    };
  });
  
  return {
    ok: true,
    data: {
      subscriptions,
      count: subscriptions.length,
      currency: home,
      note: "Confirmed subscriptions only (detected from recurring transactions).",
    },
  };
}

// ── list_plans ────────────────────────────────────────────────────────────────

export function executeListPlans(profile: FinancialProfileCache): ToolResult {
  const home = getHomeCurrency(profile);
  const fmt = makeFmt(home);
  
  // Plans are not in the financialProfile cache yet, return empty for now
  // This would need to be added to the profile builder if plans become part of the core data
  return {
    ok: true,
    data: {
      plans: [],
      count: 0,
      currency: home,
      message: "Plans data not yet available in chat context. Check the Planner page.",
    },
  };
}

// ── dispatcher (handlers keyed by ToolName — compile-time sync with tools.ts) ─

type ToolHandler = (
  profile: FinancialProfileCache,
  params: ToolParams,
  context: UserReviewContext,
) => ToolResult;

const TOOL_HANDLERS = {
  search_transactions:    executeSearchTransactions,
  get_monthly_breakdown:  executeGetMonthlyBreakdown,
  rollup_categories:      executeRollupCategories,
  rollup_merchants:       executeRollupMerchants,
  list_recurring_charges: (profile, _params, ctx) => executeListRecurringCharges(profile),
  get_debt_payment_trend: executeGetDebtPaymentTrend,
  get_income_summary:     executeGetIncomeSummary,
  get_spending_summary:   executeGetSpendingSummary,
  list_cash_expenses:     (profile, _params, ctx) => executeListCashExpenses(profile),
  get_savings_summary:    executeGetSavingsSummary,
  get_net_worth:          (profile, _params, ctx) => executeGetNetWorth(profile),
  list_accounts:          (profile, _params, ctx) => executeListAccounts(profile),
  list_subscriptions:     (profile, _params, ctx) => executeListSubscriptions(profile),
  list_plans:             (profile, _params, ctx) => executeListPlans(profile),
} satisfies Record<ToolName, ToolHandler>;

function isToolName(name: string): name is ToolName {
  return (TOOL_NAMES as readonly string[]).includes(name);
}

export function executeTool(
  name: string,
  params: ToolParams,
  profile: FinancialProfileCache,
  context: UserReviewContext,
): ToolResult {
  if (!isToolName(name)) {
    return { ok: false, error: `Unknown tool: ${name}` };
  }
  return TOOL_HANDLERS[name](profile, params, context);
}
