/**
 * Compact system context for AI chat.
 *
 * Provides enough grounding (balances, monthly totals, subscriptions,
 * goals, application emergency-fund metric vs user Goals, data range) for the model.
 * Transaction-level detail is intentionally omitted — the model requests
 * it on demand via tools. Emergency fund numbers use {@link buildEmergencyFundSnapshot}
 * (same as consolidated `emergencyFund` + `liquidAssets`).
 */

import type { FinancialProfileCache } from "@/lib/financialProfile";
import { getNetWorth, buildEmergencyFundSnapshot } from "@/lib/profileMetrics";
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

  const efSnap = buildEmergencyFundSnapshot(profile);
  let efSection = "";
  if (efSnap.metrics && efSnap.liquidMetrics) {
    const efMeta = efSnap.metrics;
    const liq = efSnap.liquidMetrics;
    const liquidCashHome = efSnap.liquidAssetsHome;
    const cvPct = (efMeta.incomeCoefficientOfVariation * 100).toFixed(0);
    efSection = `== EMERGENCY FUND — APPLICATION METRIC (same logic as consolidated JSON: emergencyFund + liquidAssets; canonical for “what target does the app recommend?”) ==
Liquid cash counted here: ${fmt(liquidCashHome)} (${home}) — checking, savings, and cash-type accounts only (positive balances); excludes investments, property, and credit cards.

Recommended savings target: ${fmt(efMeta.targetAmount)} = ${efMeta.targetMonths} months × median monthly core spend ${fmt(efMeta.baselineMonthlyCoreExpenses)}.
Runway rule: ${efMeta.isVariableIncome ? `income treated as volatile (CV ${cvPct}% ≥ 25% threshold → ${efMeta.targetMonths}-month target)` : `income treated as stable (${efMeta.targetMonths}-month target)`}.

Vs that recommendation: ${Math.round(liq.pctFunded * 100)}% funded; ~${liq.monthsOfCoreCovered.toFixed(1)} months of median core spend held in liquid cash; gap ${fmt(liq.gap)}.

When the user asks for their emergency fund target, lead with THIS block’s recommended target and liquid progress — do not substitute dollar figures from == GOALS == unless they explicitly ask about a named goal.`;
  } else {
    efSection = `== EMERGENCY FUND — APPLICATION METRIC ==
Not available yet (need enough history to compute median monthly core spending).`;
  }

  // ── assemble ──────────────────────────────────────────────────────────────
  return `You are a knowledgeable, friendly personal finance assistant.
You have access to the user's real financial data shown below AND tools to look up details.

CRITICAL RULES:
- Always ground answers in actual numbers from the data or tool results. Cite specific figures and dates.
- NEVER fabricate transaction lists — for individual charges call search_transactions. Aggregate tools (rollup_*, list_recurring_charges, get_debt_payment_trend) return summaries, not line items.
- If asked about a specific merchant, category, account, or time period: use the tools.
- When reporting tool results: list EVERY individual transaction row returned. Never skip, consolidate, or omit any row — even if two rows share the same merchant name.
- If a merchant appears multiple times in the results, list each occurrence separately with its own date and amount.
- Note which time period data is from.
- Emergency fund: use == EMERGENCY FUND — APPLICATION METRIC == for the app’s recommended target and liquid progress; == GOALS == are separate user-named savings targets (even if titled “emergency fund”).
- “What am I tracking?” / “What do I have set up?”: Answer from THIS PROMPT first — list CONFIRMED SUBSCRIPTIONS, CASH COMMITMENTS, and GOALS when those sections appear below (with amounts/names from the lines given). If those sections are absent, say none are in context and offer list_recurring_charges for subscription-style recurring charges. Only after that, explain Trackers (Events) per == TRACKERS (EVENTS) — NOT LOADED IN THIS CHAT ==. Do not reply with only a Trackers disclaimer; the user expects an inventory of what you can actually see.
- Trackers (Events): Project/service trackers, per-tracker budgets, spend-to-tracker, visits, and ledger lines live only under Account → Trackers — not in this prompt. Do not pretend Goals or subscription lists are Tracker rows; see == TRACKERS (EVENTS) — NOT LOADED IN THIS CHAT ==.
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
- Emergency fund (app recommendation): see the dedicated block below — median core × 6 or 9 months. User Goals are separate named targets (titles may overlap); do not merge them into one answer unless the user asks to compare.
- Trackers (same as the Events feature in the app) are distinct from Goals and from Subscriptions.

${efSection}

== TRACKERS (EVENTS) — NOT LOADED IN THIS CHAT ==
Trackers are the same feature as Events in the app (Account → Trackers). They are separate from Goals (savings targets) and from Confirmed Subscriptions / Cash Commitments (recurring merchants or manual recurring payments listed below).

This chat has no per-tracker budgets, no spend attributed to individual trackers, and no visit or ledger lines for Trackers. When the user asks specifically about Trackers, say that clearly and point them to Account → Trackers in the app.

Do not use Goals or subscription/cash-commitment data as if it were Tracker detail. There is no tracker-specific tool yet.

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
${goalLines.length > 0 ? `\n== GOALS (USER-NAMED TARGETS — INDEPENDENT OF APP EF LINE ABOVE) ==\n${goalLines.join("\n")}` : ""}
== TOOL GUIDANCE ==
- Specific merchants, categories, accounts, or dated transaction lines → search_transactions
- Month-by-month income / core expenses / savings → get_monthly_breakdown (by_category: true splits each month)
- Category spending totals over a range (rankings, quarter/year) → rollup_categories (parent_category_only collapses subtypes into parents)
- Top merchants by spend over a range → rollup_merchants
- Subscriptions + manual recurring cash commitments → list_recurring_charges
- Monthly debt cashflows (totals, card servicing vs installment-style, minimums) → get_debt_payment_trend
- Trackers / Events → no chat tool; see == TRACKERS (EVENTS) — NOT LOADED IN THIS CHAT ==. For “what am I tracking?” still list subscriptions/commitments/goals from context first.
- Brief net worth / savings already in context → answer without tools when enough`;
}
