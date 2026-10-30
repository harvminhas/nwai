/**
 * Debt Plan types for saved payoff plans
 */

export type DebtPlanMode = "extra" | "targetDate";
export type DebtPlanStrategy = "avalanche" | "snowball";

export interface DebtPlanBaseline {
  /** Balances by debt slug at plan creation time */
  balances: Record<string, number>;
  /** Projected total balance by month (YYYY-MM) for the entire plan */
  monthlyProjection: Array<{
    month: string; // YYYY-MM
    totalBalance: number;
  }>;
}

export interface DebtPlan {
  id: string;
  name: string;
  mode: DebtPlanMode;
  /** Array of debt slugs included in this plan */
  debtSlugs: string[];
  strategy: DebtPlanStrategy;
  /** Extra monthly payment above minimums (for 'extra' mode, or computed for 'targetDate' mode) */
  extraMonthly?: number;
  /** Target debt-free date (YYYY-MM format, for 'targetDate' mode) */
  targetDate?: string;
  /** Total monthly budget (minimums + extra) */
  monthlyBudget: number;
  /** Baseline snapshot at plan creation */
  baseline: DebtPlanBaseline;
  /** Interest saved vs minimum-only (computed at creation for display) */
  interestSaved?: number;
  /** Months saved vs minimum-only (computed at creation for display) */
  monthsSaved?: number;
  createdAt: Date | { toDate(): Date };
}

export interface DebtPlanDocument extends Omit<DebtPlan, "id"> {
  // Firestore document (id is the doc key)
}
