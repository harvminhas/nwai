/**
 * Agent insight generation.
 *
 * Calls the AI provider with a rich financial context and returns
 * 3-5 specific, actionable AgentCard objects.
 * Pure function — no Firestore access. Caller is responsible for persisting.
 */

import { sendTextRequest } from "./ai";
import { merchantSlug } from "./applyRules";
import type { FinancialDNA } from "./agentTypes";
import type { AgentCard, AgentCardAction } from "./agentTypes";

// ── helpers ───────────────────────────────────────────────────────────────────

function fmt(v: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD",
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(v);
}

// ── context builder ───────────────────────────────────────────────────────────

export interface AgentContext {
  dna: FinancialDNA;
  currentMonth: string; // "YYYY-MM" — most recent month with any data
  /** Month the spending breakdown actually covers. null = no current-month statements uploaded yet (data is carried forward from a prior month). */
  spendingMonth: string | null;
  netWorth: number;
  monthlyIncome: number;
  monthlyExpenses: number;
  topExpenseCategories: { name: string; amount: number }[];
  subscriptions: { name: string; amount: number; frequency: string }[];
  goalsProgress: { title: string; targetAmount: number; currentAmount: number; emoji: string }[];
  /** Recent months for trend analysis: newest first */
  history: { yearMonth: string; income: number; expenses: number }[];
  /** All current account balances */
  accounts: { label: string; type: string; balance: number; apr?: number }[];
}

function buildContextPrompt(ctx: AgentContext): string {
  const { dna } = ctx;
  const monthStr = new Date(ctx.currentMonth + "-15").toLocaleDateString("en-US", {
    month: "long", year: "numeric",
  });

  const lines: string[] = [
    `## User Financial Profile — ${monthStr}`,
    "",
    "### Current Snapshot",
    `Net worth: ${fmt(ctx.netWorth)}`,
    `Monthly income: ${fmt(ctx.monthlyIncome)}`,
    `Monthly expenses: ${fmt(ctx.monthlyExpenses)}`,
    `Savings rate: ${ctx.monthlyIncome > 0 ? Math.round(((ctx.monthlyIncome - ctx.monthlyExpenses) / ctx.monthlyIncome) * 100) : 0}%`,
    `Liquid cash: ${fmt(dna.liquidCash)}`,
    "",
    "### Debt Profile",
  ];

  if (dna.hasMortgage) lines.push(`Mortgage: ${fmt(dna.mortgageBalance)} (${dna.mortgageType} rate)`);
  if (dna.hasCreditCard) lines.push(`Credit card debt: ${fmt(dna.totalCreditCardDebt)}${dna.highestCreditCardAPR ? ` at up to ${dna.highestCreditCardAPR}% APR` : ""}`);
  if (dna.hasLoan) lines.push(`Loans: ${fmt(dna.totalLoanDebt)}`);
  if (!dna.hasMortgage && !dna.hasCreditCard && !dna.hasLoan) lines.push("No significant debt detected.");
  if (dna.debtToIncomeRatio != null) lines.push(`Debt-to-income: ${dna.debtToIncomeRatio.toFixed(1)}x monthly income`);

  lines.push("", "### Accounts");
  for (const acct of ctx.accounts) {
    lines.push(`${acct.label} [${acct.type}]: ${fmt(acct.balance)}${acct.apr ? ` @ ${acct.apr}% APR` : ""}`);
  }

  const spendLabel = ctx.spendingMonth
    ? new Date(ctx.spendingMonth + "-15").toLocaleDateString("en-US", { month: "long", year: "numeric" })
    : null;

  if (ctx.topExpenseCategories.length > 0 && spendLabel) {
    lines.push(``, `### Spending Breakdown (${spendLabel})`);
    for (const cat of ctx.topExpenseCategories) {
      lines.push(`${cat.name}: ${fmt(cat.amount)}`);
    }
  } else if (ctx.topExpenseCategories.length > 0) {
    lines.push(``, `### Spending Breakdown (prior month — no current-month statements uploaded yet)`);
    lines.push(`NOTE: This data is from a prior period. Do NOT generate "this month" spending insights — only trend-based or balance-based insights are appropriate.`);
    for (const cat of ctx.topExpenseCategories) {
      lines.push(`${cat.name}: ${fmt(cat.amount)}`);
    }
  }

  if (ctx.subscriptions.length > 0) {
    lines.push("", "### Recurring Subscriptions");
    for (const sub of ctx.subscriptions) {
      lines.push(`${sub.name}: ${fmt(sub.amount)}/${sub.frequency}`);
    }
    const subTotal = ctx.subscriptions.reduce((s, sub) => s + sub.amount, 0);
    lines.push(`Total subscriptions: ${fmt(subTotal)}/mo`);
  }

  if (ctx.history.length >= 2) {
    lines.push("", "### Monthly Trends (recent first)");
    for (const h of ctx.history.slice(0, 4)) {
      lines.push(`${h.yearMonth}: Income ${fmt(h.income)}, Expenses ${fmt(h.expenses)}`);
    }
  }

  if (ctx.goalsProgress.length > 0) {
    lines.push("", "### Goals Progress");
    for (const g of ctx.goalsProgress) {
      const pct = g.targetAmount > 0 ? Math.round((g.currentAmount / g.targetAmount) * 100) : 0;
      lines.push(`${g.emoji} ${g.title}: ${fmt(g.currentAmount)} / ${fmt(g.targetAmount)} (${pct}%)`);
    }
  }

  lines.push("", "### Inferred Profile");
  lines.push(`Income type: ${dna.incomeType}`);
  lines.push(`Province: ${dna.inferredProvince ?? "unknown"}`);
  lines.push(`Has RRSP: ${dna.hasRRSP}, Has TFSA: ${dna.hasTFSA}`);
  lines.push(`Has children (inferred): ${dna.hasChildren}`);
  lines.push(`Months of data: ${dna.statementMonthsCovered}`);

  return lines.join("\n");
}

// ── system prompt ─────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an AI financial agent — a smart, direct financial advisor who tells users exactly what to do with their money.

Your job is to analyze the user's financial data and generate 3-5 specific, actionable insight cards.

Rules for generating insights:
1. BE SPECIFIC: Reference actual merchant names, dollar amounts, and account types from the data. Never say "reduce spending" — say "you're spending $507/mo on dining, up 40% from your 3-month average".
2. BE HONEST: Only claim what is directly supported by the data. Don't infer usage patterns (e.g. don't say "you haven't used X" — you can only see payments, not usage).
3. QUANTIFY IMPACT: Every insight should have a dollar amount — "saves $189/year", "costs $1,320 extra/year", "could save $120/mo".
4. PRIORITIZE HIGH IMPACT: Lead with the biggest dollar opportunities. A $1,000/year saving beats a $50/year saving.
5. BE ACTIONABLE: Each card must have at least one action the user can take right now.
6. AVOID DUPLICATES: Don't generate two insights about the same issue.
7. DON'T FABRICATE: If there's no strong signal for an insight, skip it. Fewer good insights beat more mediocre ones.

Categories and when to use them:
- "debt": High-interest debt, debt payoff strategy, balance transfers
- "cashflow": Income vs expenses imbalance, upcoming cash shortfalls, spending spikes
- "subscriptions": Subscription audit, duplicate services, price increases
- "savings": Emergency fund gaps, RRSP/TFSA room, savings rate improvement
- "goals": Goal progress, timeline acceleration
- "tax": RRSP deadlines, tax credits, installments (Canadian context)
- "alert": Urgent issues (overspending, fees, very low cash)

For actions, use these tools ONLY:
- "navigate": Go to a specific page. Params: { "href": "/account/spending" }
- "create_goal": Create a savings/debt goal. Params: { "title": "string", "targetAmount": number, "emoji": "string" }
- "mark_subscription_cancelled": Mark subscription as cancelled. Params: { "merchantSlug": "netflix-com", "merchantName": "Netflix" }
- "run_scenario": Open what-if tool. Params: { "href": "/account/whatif" }

Return ONLY a valid JSON array. No markdown, no explanation, just the JSON.

Schema:
[
  {
    "id": "unique-id-no-spaces",
    "category": "debt|cashflow|subscriptions|savings|goals|tax|alert",
    "priority": "high|medium|low",
    "emoji": "single emoji",
    "title": "Action headline, max 60 chars",
    "body": "2-3 sentences. Specific amounts and merchants. What to do and why.",
    "dollarImpact": 125,
    "impactLabel": "per month",
    "actions": [
      {
        "id": "action-id",
        "label": "Button text",
        "tool": "navigate|create_goal|mark_subscription_cancelled|run_scenario",
        "params": {},
        "tier": 1,
        "requiresApproval": false
      }
    ]
  }
]

For tier: 1 = read-only/navigate (no approval needed), 2 = modifies data (requiresApproval: true).`;

// ── main function ─────────────────────────────────────────────────────────────

export async function generateAgentInsights(
  ctx: AgentContext,
  sourceStatementId: string | null
): Promise<AgentCard[]> {
  const contextPrompt = buildContextPrompt(ctx);

  let raw: string;
  try {
    raw = await sendTextRequest(SYSTEM_PROMPT, contextPrompt);
  } catch (err) {
    console.error("[agentInsights] AI call failed:", err);
    return [];
  }

  // Extract JSON from response (handle markdown code fences)
  const jsonMatch = raw.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    console.error("[agentInsights] No JSON array found in response:", raw.slice(0, 200));
    return [];
  }

  let parsed: AgentCard[];
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch (err) {
    console.error("[agentInsights] Failed to parse JSON:", err);
    return [];
  }

  if (!Array.isArray(parsed)) return [];

  const now = new Date().toISOString();

  // Normalise and validate each card
  return parsed
    .filter((c) => c && typeof c.title === "string" && c.title.length > 0)
    .slice(0, 5)
    .map((c): AgentCard => ({
      id: String(c.id ?? `card-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`),
      createdAt: now,
      category: c.category ?? "alert",
      priority: c.priority ?? "medium",
      emoji: String(c.emoji ?? "💡"),
      title: String(c.title).slice(0, 80),
      body: String(c.body ?? "").slice(0, 400),
      dollarImpact: typeof c.dollarImpact === "number" ? c.dollarImpact : null,
      impactLabel: c.impactLabel ?? null,
      actions: normaliseActions(c.actions ?? []),
      dismissed: false,
      completedAt: null,
      sourceStatementId,
    }));
}

function normaliseActions(raw: unknown[]): AgentCardAction[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((a) => a && typeof (a as AgentCardAction).tool === "string")
    .map((a): AgentCardAction => {
      const action = a as AgentCardAction;
      // Auto-fix merchantSlug if missing
      if (action.tool === "mark_subscription_cancelled") {
        const p = action.params as { merchantName?: string; merchantSlug?: string };
        if (p.merchantName && !p.merchantSlug) {
          p.merchantSlug = merchantSlug(p.merchantName);
        }
      }
      return {
        id: String(action.id ?? `act-${Math.random().toString(36).slice(2, 7)}`),
        label: String(action.label ?? "Take action"),
        tool: action.tool,
        params: action.params ?? {},
        tier: action.tier === 2 ? 2 : 1,
        requiresApproval: action.tier === 2,
      };
    });
}
