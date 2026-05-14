/**
 * Deterministic cashflow recommendation — the LLM often omits category "cashflow"
 * when debt/subscription cards have larger dollarImpact (see agentInsights rule #4).
 */

import type { AgentCard } from "./agentTypes";
import { fmt } from "./currencyUtils";

export interface CashflowInsightParams {
  latestMonth: string;
  homeCurrency: string;
  incomeTotal: number;
  coreExpensesTotal: number;
  cardServicingTotal?: number;
}

export function buildCashflowInsightCard(p: CashflowInsightParams): AgentCard {
  const now = new Date().toISOString();
  const home = (p.homeCurrency || "USD").toUpperCase();
  const inc = p.incomeTotal;
  const core = p.coreExpensesTotal;
  const net = inc - core;
  const cardSvc = p.cardServicingTotal ?? 0;

  const title =
    inc <= 0 && core > 0
      ? "Recorded income is missing or zero vs core expenses"
      : net < 0
        ? "Negative monthly cash flow (core)"
        : "Thin cushion after core expenses";

  const parts: string[] = [
    `For ${p.latestMonth}, income ${fmt(inc, home)} vs core expenses ${fmt(core, home)} → net ${fmt(net, home)} per month (income minus core only).`,
    "Core includes installment servicing (mortgage, loans); card and line-of-credit payments from checking are excluded from core because they pay revolving balances already counted on-card.",
  ];
  if (cardSvc > 0) {
    parts.push(`This month, card/LOC servicing from checking was ${fmt(cardSvc, home)} — keep cash aside beyond the core figure above.`);
  }
  parts.push(
    "Use Spending to trim categories or Income to confirm deposits and cash income so this month reflects reality.",
  );

  return {
    id: `cashflow-core-net-${p.latestMonth}`,
    createdAt: now,
    category: "cashflow",
    priority: net < 0 || (inc <= 0 && core > 0) ? "high" : "medium",
    emoji: "📊",
    title: title.slice(0, 80),
    body: parts.join(" ").slice(0, 400),
    dollarImpact: net === 0 ? null : net,
    impactLabel: "per month",
    actions: [
      {
        id: "cf-nav-spending",
        label: "View spending",
        tool: "navigate",
        params: { href: "/account/spending" },
        tier: 1,
        requiresApproval: false,
      },
      {
        id: "cf-nav-income",
        label: "View income",
        tool: "navigate",
        params: { href: "/account/income" },
        tier: 1,
        requiresApproval: false,
      },
    ],
    dismissed: false,
    completedAt: null,
    sourceStatementId: null,
  };
}
