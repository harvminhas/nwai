/**
 * Agent insight generation.
 *
 * Calls the AI provider with the full financial brief (same context used by
 * AI Chat) and returns 3-5 specific, actionable AgentCard objects.
 * Pure function — no Firestore access. Caller is responsible for persisting.
 */

import { sendTextRequest } from "./ai";
import { merchantSlug } from "./applyRules";
import type { AgentCard, AgentCardAction } from "./agentTypes";

// ── system prompt ─────────────────────────────────────────────────────────────

export const SYSTEM_PROMPT = `You are an AI financial agent — a smart, direct financial advisor who tells users exactly what to do with their money.

Your job is to analyze the user's financial data and generate 3-5 specific, actionable insight cards.

Rules for generating insights:
1. BE SPECIFIC: Reference actual merchant names, dollar amounts, and account types from the data. Never say "reduce spending" — say "you're spending $507/mo on dining, up 40% from your 3-month average".
2. BE HONEST: Only claim what is directly supported by the data. Don't infer usage patterns (e.g. don't say "you haven't used X" — you can only see payments, not usage).
3. QUANTIFY IMPACT: Every insight should have a dollar amount — "saves $189/year", "costs $1,320 extra/year", "could save $120/mo".
4. PRIORITIZE HIGH IMPACT: Lead with the biggest dollar opportunities. A $1,000/year saving beats a $50/year saving.
5. BE ACTIONABLE: Each card must have at least one action the user can take right now.
6. AVOID DUPLICATES: Don't generate two insights about the same issue.
7. DON'T FABRICATE: If there's no strong signal for an insight, skip it. Fewer good insights beat more mediocre ones.

The financial snapshot includes a "Country:" field — use it to tailor every insight to the right jurisdiction:
- Canada (CA): reference RRSP, TFSA, FHSA, RESP, CRA, BoC, CPP/OAS; use Canadian spelling
- United States (US): reference 401k, IRA, HSA, 529, IRS, Fed, Social Security; use US terminology

Categories and when to use them:
- "debt": High-interest debt, debt payoff strategy, balance transfers
- "cashflow": Income vs expenses imbalance, upcoming cash shortfalls, spending spikes
- "subscriptions": Subscription audit, duplicate services, price increases
- "savings": Emergency fund gaps, tax-advantaged savings room (RRSP/TFSA for CA; 401k/IRA for US), savings rate improvement
- "goals": Goal progress, timeline acceleration
- "tax": Tax-advantaged account deadlines and credits — RRSP/CRA for CA; IRS/retirement limits for US
- "alert": Urgent issues (overspending, fees, very low cash)

For actions, use these tools ONLY:
- "navigate": Go to a specific page. Params: { "href": "<one of the exact paths below>" }
- "create_goal": Create a savings/debt goal. Params: { "title": "string", "targetAmount": number, "emoji": "string" }
- "mark_subscription_cancelled": Mark subscription as cancelled. Params: { "merchantSlug": "netflix-com", "merchantName": "Netflix" }
- "run_scenario": Open what-if tool. Params: { "href": "/account/whatif" }

Valid "navigate" hrefs — use ONLY these exact strings, nothing else:
- "/account/spending"       — monthly spending breakdown, categories, debt card, subscriptions
- "/account/income"        — income sources, transactions, cash income
- "/account/liabilities"   — credit cards, loans, mortgage, debt payoff planner
- "/account/assets"        — savings accounts, investments, net worth
- "/account/goals"         — savings goals, emergency fund, debt payoff goals
- "/account/activity"      — transaction history, transfers, all account activity
- "/account/statements"    — uploaded statements, reparse
- "/account/overview"      — net worth summary across all accounts
- "/account/whatif"        — what-if scenario planner (also used for run_scenario)
- "/account/forecast"      — income and expense forecast

Do NOT invent any other href. If no exact path fits, omit the navigate action entirely.

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
  brief: string,
  sourceStatementId: string | null
): Promise<AgentCard[]> {
  const contextPrompt = brief;

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
