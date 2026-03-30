/**
 * Agent-layer types: Financial DNA, Agent Cards, and Action Queue.
 * These live here rather than types.ts to keep the agent architecture isolated
 * and easily extensible as new tools/capabilities are added.
 */

// ── Financial DNA ─────────────────────────────────────────────────────────────

/** Persistent inferred profile built from the user's full statement history. */
export interface FinancialDNA {
  updatedAt: string; // ISO timestamp

  // ── Debt & liabilities ────────────────────────────────────────────────────
  hasMortgage: boolean;
  mortgageBalance: number;
  /** "variable" if the interest rate fluctuates across months; "fixed" if stable */
  mortgageType: "variable" | "fixed" | "unknown";
  hasCreditCard: boolean;
  totalCreditCardDebt: number;
  /** Highest APR found across all credit card accounts */
  highestCreditCardAPR: number | null;
  hasHELOC: boolean;
  hasLoan: boolean;
  totalLoanDebt: number;

  // ── Assets & savings ──────────────────────────────────────────────────────
  hasInvestmentAccount: boolean;
  liquidCash: number;
  /** Detected from "RRSP" deposits/transfers in transaction history */
  hasRRSP: boolean;
  hasTFSA: boolean;

  // ── Income ────────────────────────────────────────────────────────────────
  /** "salaried" = consistent single source; "self-employed" = irregular/multiple */
  incomeType: "salaried" | "self-employed" | "mixed" | "unknown";
  estimatedMonthlyIncome: number;

  // ── Spending ──────────────────────────────────────────────────────────────
  estimatedMonthlyExpenses: number;
  /** Top 3 expense categories by amount */
  topSpendingCategories: string[];
  /** Active subscriptions detected across all accounts */
  activeSubscriptions: { name: string; amount: number; frequency: string }[];

  // ── Life signals ──────────────────────────────────────────────────────────
  /** Detected from CCB deposits or child-related expense merchants */
  hasChildren: boolean;
  /** Two-letter province code inferred from merchant/tax data, e.g. "ON" */
  inferredProvince: string | null;

  // ── Derived health metrics ────────────────────────────────────────────────
  highInterestDebt: boolean;
  /** total debt / monthly income — null if income unknown */
  debtToIncomeRatio: number | null;
  /** Number of months with statement data */
  statementMonthsCovered: number;
}

// ── Agent Cards ───────────────────────────────────────────────────────────────

export type AgentCardCategory =
  | "savings"
  | "debt"
  | "subscriptions"
  | "cashflow"
  | "goals"
  | "tax"
  | "alert"
  | "external";

export type AgentActionTool =
  | "navigate"           // Tier 1 — just navigate to a page
  | "create_goal"        // Tier 2 — create a goal in Firestore
  | "mark_subscription_cancelled" // Tier 2 — mark subscription as cancelled
  | "set_budget_limit"   // Tier 2 — set a category budget limit
  | "run_scenario";      // Tier 1 — open what-if with pre-filled params

/** A proposed action the agent can take on behalf of the user. */
export interface AgentCardAction {
  id: string;
  label: string;
  tool: AgentActionTool;
  params: Record<string, unknown>;
  /** 1 = read/navigate (no approval), 2 = write-internal (needs approval) */
  tier: 1 | 2;
  requiresApproval: boolean;
}

/** A single actionable insight card surfaced on the dashboard. */
export interface AgentCard {
  id: string;
  createdAt: string;
  category: AgentCardCategory;
  priority: "high" | "medium" | "low";
  emoji: string;
  title: string;
  body: string;
  /** Monthly or one-time $ benefit if the user acts on this insight. null = not quantifiable */
  dollarImpact: number | null;
  /** Human-readable timeframe for dollarImpact, e.g. "per month", "per year", "one-time" */
  impactLabel: string | null;
  actions: AgentCardAction[];
  dismissed: boolean;
  completedAt: string | null;
  /** Statement ID that triggered generation of this card */
  sourceStatementId: string | null;

  // ── External data cards (source === "external") ──────────────────────────
  /** "agent" for AI-generated cards; "external" for macro/market data cards */
  source?: "agent" | "external";
  /** ExternalDataPoint.dataType, e.g. "canada-overnight-rate" */
  dataType?: string;
  /** Direct link to the source (used instead of actions for external cards) */
  href?: string | null;
  /** ISO date or YYYY-MM string of the data release */
  releaseDate?: string;
}

// ── Action Queue ──────────────────────────────────────────────────────────────

export type ActionStatus = "pending" | "approved" | "rejected" | "completed" | "failed";

/** A queued action awaiting or having received user approval. */
export interface QueuedAction {
  id: string;
  tool: AgentActionTool;
  params: Record<string, unknown>;
  status: ActionStatus;
  createdAt: string;
  completedAt: string | null;
  /** The AgentCard that proposed this action */
  insightId: string;
  source: "agent";
  /** Result message after completion */
  resultMessage?: string;
}
