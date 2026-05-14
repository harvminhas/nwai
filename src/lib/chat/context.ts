/**
 * Compact system context for AI chat.
 *
 * Provides just enough grounding (balances, monthly totals, subscriptions,
 * goals, data range) for the model to answer summary questions directly.
 * Transaction-level detail is intentionally omitted — the model requests
 * it on demand via the search_transactions / get_monthly_breakdown tools.
 */

import type { FinancialProfileCache } from "@/lib/financialProfile";
import { getNetWorth, getEmergencyFundMetrics } from "@/lib/profileMetrics";
import { buildCategoryPromptLines } from "@/lib/categoryTaxonomy";

// ── helpers ─────────────────────────────────────────────────────────────────

function makeFmt(currency: string) {
  return (v: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
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

// ── builder ──────────────────────────────────────────────────────────────────

export function buildChatContext(profile: FinancialProfileCache): string {
  const home    = (profile.homeCurrency ?? "USD").toUpperCase();
  const fxRates = profile.fxRates ?? {};
  const fmt     = makeFmt(home);

  const month   = profile.latestTxMonth ?? "";
  const oldest  = profile.allTxMonths[0] ?? month;
  const total   = profile.allTxMonths.length;

  const nw      = getNetWorth(profile, month);

  // ── accounts ──────────────────────────────────────────────────────────────
  const rateMap = new Map(
    profile.accountRates
      .filter((r) => r.rate != null)
      .map((r) => [r.accountKey, r.rate]),
  );

  const accountLines = profile.accountSnapshots.map((a) => {
    const id      = a.accountId ? ` (*${a.accountId.slice(-4)})` : "";
    const acctCcy = (a.currency ?? home).toUpperCase();
    const native  = makeFmt(acctCcy)(a.balance);
    const homeEq  = acctCcy !== home
      ? ` (≈ ${fmt(toHome(a.balance, acctCcy, home, fxRates))} ${home})`
      : "";
    const apr     = rateMap.get(a.slug);
    const aprStr  = apr != null ? ` at ${apr}% APR` : "";
    return `  ${a.bankName}${id} [${a.accountType}, ${acctCcy}]: ${native}${homeEq}${aprStr}`;
  });

  // ── latest month ──────────────────────────────────────────────────────────
  const latestH = profile.monthlyHistory.find((h) => h.yearMonth === month);
  const income   = latestH?.incomeTotal       ?? 0;
  const expenses = latestH?.coreExpensesTotal ?? 0;
  const net      = income - expenses;
  const sr       = income > 0 ? `${((net / income) * 100).toFixed(1)}%` : "n/a";

  // ── monthly trend (newest first, compact) ─────────────────────────────────
  const trendLines = [...profile.monthlyHistory]
    .sort((a, b) => b.yearMonth.localeCompare(a.yearMonth))
    .map((h) => {
      const n  = h.incomeTotal - h.coreExpensesTotal;
      const sr = h.incomeTotal > 0
        ? `${((n / h.incomeTotal) * 100).toFixed(0)}% savings`
        : "n/a";
      return `  ${h.yearMonth}: Income ${fmt(h.incomeTotal)}, Expenses ${fmt(h.coreExpensesTotal)}, Net ${fmt(n)} (${sr})`;
    });

  // ── subscriptions ─────────────────────────────────────────────────────────
  const subLines = profile.confirmedSubscriptions.map((s) => {
    const amt  = toHome(s.amount ?? s.suggestedAmount ?? 0, s.currency, home, fxRates);
    const freq = s.frequency ?? s.suggestedFrequency ?? "monthly";
    return `  ${s.name}: ${fmt(amt)}/${freq}`;
  });

  // ── goals ─────────────────────────────────────────────────────────────────
  const goalLines = profile.goals.map((g) => {
    const pct =
      (g.targetAmount ?? 0) > 0
        ? Math.round(((g.currentAmount ?? 0) / g.targetAmount!) * 100)
        : 0;
    return `  ${g.emoji ?? "🎯"} ${g.title}: ${fmt(g.currentAmount ?? 0)} / ${fmt(g.targetAmount ?? 0)} (${pct}%)`;
  });

  // ── cash commitments ──────────────────────────────────────────────────────
  const freqPerYear: Record<string, number> = {
    weekly: 52, biweekly: 26, monthly: 12, quarterly: 4, once: 0,
  };
  const cashLines = profile.cashCommitmentEntries.map((c) => {
    const perYear  = freqPerYear[c.frequency] ?? 12;
    const monthly  = c.amount * perYear / 12;
    const mthStr   = c.frequency === "once" ? "one-time" : `~${fmt(monthly)}/mo`;
    return `  ${c.name} (${c.frequency}): ${fmt(c.amount)} = ${mthStr}`;
  });

  const efMeta = getEmergencyFundMetrics(profile);
  const efDefinitionLine = efMeta
    ? `Emergency fund target = ${fmt(efMeta.targetAmount)} (${efMeta.targetMonths} × median monthly core spend ${fmt(efMeta.baselineMonthlyCoreExpenses)}${efMeta.isVariableIncome ? "; volatile income uses longer runway" : ""}).`
    : "Emergency fund target = not yet defined (need median core expense history).";

  // ── assemble ──────────────────────────────────────────────────────────────
  return `You are a knowledgeable, friendly personal finance assistant.
You have access to the user's real financial data shown below AND two tools to look up transaction details.

CRITICAL RULES:
- Always ground answers in actual numbers from the data or tool results. Cite specific figures and dates.
- NEVER fabricate transaction lists — always call search_transactions first.
- If asked about a specific merchant, category, account, or time period: use the tools.
- When reporting tool results: list EVERY individual transaction row returned. Never skip, consolidate, or omit any row — even if two rows share the same merchant name.
- If a merchant appears multiple times in the results, list each occurrence separately with its own date and amount.
- Note which time period data is from.
- This is financial analysis only, not regulated financial advice.

SEARCH STRATEGY:
- TYPE queries (barber, salon, dining, groceries, gas, gym, etc.):
    Use the "categories" array with the parent AND all relevant subtypes so every possible tag is covered.
    Example — barber/hair: categories=["Personal Care","Barber","Salon & Haircare"]
    Example — eating out:  categories=["Dining","Restaurants","Fast Food","Food Delivery","Coffee & Drinks"]
    Example — fitness:     categories=["Healthcare","Fitness"]
    Example — transit:     categories=["Transportation","Transit","Rideshare"]
    Never guess at one category when several could apply — include all plausible ones.
- MERCHANT queries (Costco, Amazon, specific bank, etc.) → use the "merchant" field only.
- TIME queries ("last month", "in January") → add from_date / to_date.

FORMATTING:
- Lead key metrics with a bolded line: e.g. **Savings Rate: 17.3%**
- Follow with 1-2 supporting figures, then explanation.
- Use bullet points for short lists (3 or fewer items) when not showing a table.

WHEN YOU LIST TRANSACTIONS (after search_transactions or any tool that returns rows):
Use this exact layout every time:

1) **Opening** — 1-3 sentences answering the question (counts, date range, filters).
2) A blank line.
3) Section heading: ## Transactions
4) A **markdown pipe table** with columns: Date | Merchant | Amount | Category | Account
   - First row = header labels.
   - Second row = separator: |------|----------|--------|----------|---------| (dashes between pipes).
   - One data row per transaction — never merge or skip rows. Use the tool's rows in date order (newest first is fine).
   - Truncate very long merchant names with "…" if needed so the table stays readable.
5) A blank line.
6) Section heading: ## Total
7) One line: **{currency total}** across **{N}** transaction(s). Mirror the tool's total_amount and total_rows when provided.

If there are zero rows, skip the table and briefly say nothing matched.

Do not mix the narrative and the table on the same line — narrative first, then ## Transactions, then the table, then ## Total.

DEFINITIONS:
- Core expenses = spending excluding Transfers, Interest, and Card Servicing (CC/LOC payments from checking). Installment Servicing (mortgage, auto, student, installment loans) counts in core.
- Transfers = inter-account or e-transfers — excluded from core expense totals.
- Debt: Installment Servicing vs Card Servicing — see category taxonomy (Debt parent).
- Savings rate = (income − core expenses) / income × 100
- ${efDefinitionLine}

EXPENSE CATEGORY TAXONOMY (parent categories and their subtypes):
${buildCategoryPromptLines()}

== NET WORTH (${month}) ==
Assets: ${fmt(nw.totalAssets)} | Debt: ${fmt(nw.totalDebts)} | Net worth: ${fmt(nw.total)}

== ACCOUNTS ==
${accountLines.join("\n") || "  No accounts found"}

== LATEST MONTH (${month}) ==
Income: ${fmt(income)} | Expenses: ${fmt(expenses)} | Net: ${fmt(net)} | Savings rate: ${sr}

== MONTHLY TREND (${oldest} → ${month}, ${total} month${total !== 1 ? "s" : ""} of data) ==
${trendLines.join("\n") || "  No history yet"}
${subLines.length > 0 ? `\n== CONFIRMED SUBSCRIPTIONS ==\n${subLines.join("\n")}` : ""}
${cashLines.length > 0 ? `\n== CASH COMMITMENTS ==\n${cashLines.join("\n")}` : ""}
${goalLines.length > 0 ? `\n== GOALS ==\n${goalLines.join("\n")}` : ""}
== TOOL GUIDANCE ==
- For any question about specific merchants, categories, or accounts → call search_transactions
- For trend/comparison questions → call get_monthly_breakdown (optionally with by_category: true)
- For high-level summaries (savings rate, net worth) → answer directly from the data above`;
}
