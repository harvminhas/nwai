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
import { FREQ_MONTHLY } from "@/app/api/user/cash-commitments/route";
import { isCoreExcluded } from "@/lib/spendingMetrics";
import { getParentCategory } from "@/lib/categoryTaxonomy";
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

function toHome(
  amount: number,
  currency: string | undefined,
  home: string,
  fxRates: Record<string, number>,
): number {
  const cur = (currency ?? home).toUpperCase();
  if (cur === home) return amount;
  const rate = fxRates[cur];
  return rate ? amount * rate : amount;
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
): ToolResult {
  const home = (profile.homeCurrency ?? "USD").toUpperCase();
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
    amount:   fmt(toHome(t.amount, t.currency, home, fxRates)),
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
        amount:   fmt(toHome(t.amount, t.currency, home, fxRates)),
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
  const totalAmount = expSliced.reduce((s, t) => s + toHome(t.amount, t.currency, home, fxRates), 0);

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
): ToolResult {
  const home = (profile.homeCurrency ?? "USD").toUpperCase();
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
        const homeAmt = toHome(t.amount, t.currency, home, fxRates);
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
): ToolResult {
  const home = (profile.homeCurrency ?? "USD").toUpperCase();
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
    const homeAmt = toHome(t.amount, t.currency, home, fxRates);
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
): ToolResult {
  const home = (profile.homeCurrency ?? "USD").toUpperCase();
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
    const homeAmt = toHome(t.amount, t.currency, home, fxRates);
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
  const home = (profile.homeCurrency ?? "USD").toUpperCase();
  const fxRates = profile.fxRates ?? {};
  const fmt = makeFmt(home);

  const subscriptions = profile.confirmedSubscriptions.map((s) => {
    const raw =
      s.amount ?? s.suggestedAmount ?? 0;
    const ccy = (s.currency ?? home).toUpperCase();
    const amtHome = toHome(raw, ccy, home, fxRates);
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
): ToolResult {
  const home = (profile.homeCurrency ?? "USD").toUpperCase();
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

// ── dispatcher (handlers keyed by ToolName — compile-time sync with tools.ts) ─

type ToolHandler = (profile: FinancialProfileCache, params: ToolParams) => ToolResult;

const TOOL_HANDLERS = {
  search_transactions:    executeSearchTransactions,
  get_monthly_breakdown:  executeGetMonthlyBreakdown,
  rollup_categories:      executeRollupCategories,
  rollup_merchants:       executeRollupMerchants,
  list_recurring_charges: (profile, _params) => executeListRecurringCharges(profile),
  get_debt_payment_trend: executeGetDebtPaymentTrend,
} satisfies Record<ToolName, ToolHandler>;

function isToolName(name: string): name is ToolName {
  return (TOOL_NAMES as readonly string[]).includes(name);
}

export function executeTool(
  name: string,
  params: ToolParams,
  profile: FinancialProfileCache,
): ToolResult {
  if (!isToolName(name)) {
    return { ok: false, error: `Unknown tool: ${name}` };
  }
  return TOOL_HANDLERS[name](profile, params);
}
