/**
 * What-If Scenario Workspace — shared types.
 *
 * Architecture: Rule 14 — this feature is an isolated consumer of the financial
 * engine. Scenarios are stored in users/{uid}/whatIfScenarios/{id} and read
 * baseline numbers from getFinancialProfile() via the consolidated API.
 */

// ── Scenario color ─────────────────────────────────────────────────────────────

export type ScenarioColor =
  | "purple" | "blue" | "green" | "amber" | "red" | "indigo" | "teal";

export const SCENARIO_COLORS: {
  id: ScenarioColor;
  bg: string;
  text: string;
  border: string;
  dot: string;
  line: string; // hex for SVG sparkline
}[] = [
  { id: "purple", bg: "bg-purple-100", text: "text-purple-700", border: "border-purple-200", dot: "bg-purple-500", line: "#7c3aed" },
  { id: "blue",   bg: "bg-blue-100",   text: "text-blue-700",   border: "border-blue-200",   dot: "bg-blue-500",   line: "#2563eb" },
  { id: "green",  bg: "bg-green-100",  text: "text-green-700",  border: "border-green-200",  dot: "bg-green-500",  line: "#16a34a" },
  { id: "amber",  bg: "bg-amber-100",  text: "text-amber-700",  border: "border-amber-200",  dot: "bg-amber-500",  line: "#d97706" },
  { id: "red",    bg: "bg-red-100",    text: "text-red-700",    border: "border-red-200",    dot: "bg-red-500",    line: "#dc2626" },
  { id: "indigo", bg: "bg-indigo-100", text: "text-indigo-700", border: "border-indigo-200", dot: "bg-indigo-500", line: "#4f46e5" },
  { id: "teal",   bg: "bg-teal-100",   text: "text-teal-700",   border: "border-teal-200",   dot: "bg-teal-500",   line: "#0d9488" },
];

export function colorForIndex(index: number): ScenarioColor {
  return SCENARIO_COLORS[index % SCENARIO_COLORS.length].id;
}

// ── Template IDs ───────────────────────────────────────────────────────────────

export type TemplateId =
  | "purchase" | "buyrent" | "car" | "levers" | "salary" | "payoff";

// ── Firestore document: users/{uid}/whatIfScenarios/{id} ──────────────────────

export interface WhatIfScenario {
  id: string;
  name: string;
  templateId: TemplateId;
  /** Flexible bag of inputs — keys match the template's defaultInputs */
  inputs: Record<string, number | string | boolean>;
  /** Whether this scenario is stacked into the combined impact view */
  enabled: boolean;
  color: ScenarioColor;
  createdAt: string;
  updatedAt: string;
}

// ── Impact types ───────────────────────────────────────────────────────────────

/**
 * What a single scenario does to monthly cash flow.
 * The stacking engine sums these across all enabled scenarios.
 */
export interface ScenarioImpact {
  /** Positive = higher monthly spending */
  monthlyExpenseDelta: number;
  /** Positive = higher monthly income */
  monthlyIncomeDelta: number;
  /** One-time lump sum outflow applied in month 1 (e.g., down payment) */
  oneTimeCost: number;
  /** Short display string for the scenario card, e.g. "−$55/mo" */
  summaryLine: string;
}

/**
 * Combined effect of all currently enabled scenarios stacked on the baseline.
 */
export interface CombinedImpact {
  newMonthlySavings: number;
  newSavingsRate: number;
  savingsRateDelta: number;
  newNetWorth12: number;
  netWorthDelta: number;
  totalOneTimeCost: number;
  /** False when no scenarios are enabled */
  hasImpact: boolean;
}

// ── Baseline snapshot ──────────────────────────────────────────────────────────

/**
 * Real baseline numbers derived from the user's uploaded statements.
 * Loaded once from /api/user/statements/consolidated.
 */
export interface FinancialSnapshot {
  netWorth: number;
  monthlyIncome: number;
  monthlyExpenses: number;
  monthlySavings: number;
  savingsRate: number;
  totalDebt: number;
  liquidAssets: number;
  emergencyFundTarget: number;
}

// ── Template definition ────────────────────────────────────────────────────────

export interface TemplateDefinition {
  id: TemplateId;
  label: string;
  description: string;
  free: boolean;
  defaultInputs: (snap: FinancialSnapshot) => Record<string, number | string | boolean>;
  impact: (
    inputs: Record<string, number | string | boolean>,
    snap: FinancialSnapshot,
  ) => ScenarioImpact;
  defaultName: (inputs: Record<string, number | string | boolean>) => string;
}
