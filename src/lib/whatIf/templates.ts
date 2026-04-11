/**
 * What-If template definitions.
 *
 * Each template defines:
 *  - defaultInputs(snap): initial slider/input values from the user's baseline
 *  - impact(inputs, snap): pure function → ScenarioImpact for stacking
 *  - defaultName(inputs): suggested scenario name
 *
 * The calculation logic is ported from the original Mode1–Mode6 components.
 * These are pure functions — no React, no Firestore, no side effects.
 */

import { fmt } from "@/lib/currencyUtils";
import type {
  TemplateDefinition,
  TemplateId,
  FinancialSnapshot,
  ScenarioImpact,
  CombinedImpact,
  WhatIfScenario,
} from "./types";

// ── Type coercions ─────────────────────────────────────────────────────────────

export function num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return isNaN(n) ? fallback : n;
}

export function bool(v: unknown): boolean {
  return v === true || v === "true" || v === 1;
}

// ── Impact functions ───────────────────────────────────────────────────────────

function purchaseImpact(
  inputs: Record<string, number | string | boolean>,
  _snap: FinancialSnapshot,
): ScenarioImpact {
  const isOneTime   = bool(inputs.isOneTime);
  const cost        = num(inputs.cost, 55);
  const months      = Math.max(1, num(inputs.months, 24));
  const monthlyCost = isOneTime ? cost / months : cost;
  return {
    monthlyExpenseDelta: monthlyCost,
    monthlyIncomeDelta:  0,
    oneTimeCost:         isOneTime ? cost : 0,
    summaryLine:         isOneTime
      ? `One-time ${fmt(cost)} (${fmt(monthlyCost)}/mo spread)`
      : `+${fmt(monthlyCost)}/mo for ${months} mo`,
  };
}

function buyrentImpact(
  inputs: Record<string, number | string | boolean>,
  snap: FinancialSnapshot,
): ScenarioImpact {
  const price            = Math.max(0, num(inputs.homePrice, 650000));
  const down             = price * Math.max(0, num(inputs.downPct, 10)) / 100;
  const principal        = price - down;
  const r                = num(inputs.mortRate, 5.5) / 100 / 12;
  const n                = num(inputs.amortYears, 25) * 12;
  const monthlyMortgage  = principal > 0 && r > 0
    ? principal * (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1)
    : principal / n;
  const monthlyPropTax   = price * num(inputs.propTaxPct, 1.2) / 100 / 12;
  const monthlyMaint     = price * num(inputs.maintPct,   0.8) / 100 / 12;
  const totalBuying      = monthlyMortgage + monthlyPropTax + monthlyMaint;
  const delta            = totalBuying - snap.monthlyExpenses;
  return {
    monthlyExpenseDelta: delta,
    monthlyIncomeDelta:  0,
    oneTimeCost:         down,
    summaryLine:         `Buy: ${fmt(totalBuying)}/mo (${delta >= 0 ? "+" : ""}${fmt(delta)} vs now)`,
  };
}

function carImpact(
  inputs: Record<string, number | string | boolean>,
  _snap: FinancialSnapshot,
): ScenarioImpact {
  const price     = num(inputs.price,   35000);
  const down      = num(inputs.down,    5000);
  const tradeIn   = num(inputs.tradeIn, 0);
  const termMo    = Math.max(1, num(inputs.termMo, 60));
  const apr       = num(inputs.apr, 6.5);
  const principal = Math.max(0, price - down - tradeIn);
  const r         = apr / 100 / 12;
  const monthlyPmt = principal > 0 && r > 0
    ? principal * (r * Math.pow(1 + r, termMo)) / (Math.pow(1 + r, termMo) - 1)
    : principal / termMo;
  return {
    monthlyExpenseDelta: monthlyPmt,
    monthlyIncomeDelta:  0,
    oneTimeCost:         down,
    summaryLine:         `+${fmt(monthlyPmt)}/mo × ${termMo} mo`,
  };
}

function leversImpact(
  inputs: Record<string, number | string | boolean>,
  _snap: FinancialSnapshot,
): ScenarioImpact {
  const cutSubs      = num(inputs.cutSubs,      0);
  const cutDining    = num(inputs.cutDining,    0);
  const extraSavings = num(inputs.extraSavings, 0);
  const saved        = cutSubs + cutDining + extraSavings;
  return {
    monthlyExpenseDelta: -saved,
    monthlyIncomeDelta:  0,
    oneTimeCost:         0,
    summaryLine:         saved > 0 ? `Save ${fmt(saved)}/mo` : "Adjust levers to see impact",
  };
}

function salaryImpact(
  inputs: Record<string, number | string | boolean>,
  snap: FinancialSnapshot,
): ScenarioImpact {
  const newAnnual  = num(inputs.newAnnual, snap.monthlyIncome * 12);
  const newMonthly = newAnnual / 12;
  const delta      = newMonthly - snap.monthlyIncome;
  return {
    monthlyExpenseDelta: 0,
    monthlyIncomeDelta:  delta,
    oneTimeCost:         0,
    summaryLine:         `${delta >= 0 ? "+" : ""}${fmt(delta)}/mo income`,
  };
}

function payoffImpact(
  inputs: Record<string, number | string | boolean>,
  _snap: FinancialSnapshot,
): ScenarioImpact {
  const lumpSum = num(inputs.lumpSum, 5000);
  return {
    monthlyExpenseDelta: 0,
    monthlyIncomeDelta:  0,
    oneTimeCost:         lumpSum,
    summaryLine:         lumpSum > 0 ? `Pay off ${fmt(lumpSum)} (one-time)` : "Set a lump sum",
  };
}

// ── Template registry ──────────────────────────────────────────────────────────

export const TEMPLATES: TemplateDefinition[] = [
  {
    id:          "purchase",
    label:       "New purchase",
    description: "Monthly subscription, financing plan, or one-time purchase.",
    free:        true,
    defaultInputs: () => ({ name: "iPhone 16 Pro", isOneTime: false, cost: 55, months: 24 }),
    impact:      purchaseImpact,
    defaultName: (inputs) => String(inputs.name || "New purchase"),
  },
  {
    id:          "buyrent",
    label:       "Buy vs rent",
    description: "Compare buying a home versus renting and investing the difference.",
    free:        false,
    defaultInputs: (snap) => ({
      homePrice:   650000,
      downPct:     10,
      mortRate:    5.5,
      amortYears:  25,
      propTaxPct:  1.2,
      maintPct:    0.8,
      rent:        String(Math.round(snap.monthlyExpenses * 0.4 / 100) * 100 || 2400),
      rentIncrPct: 3,
      investRet:   6,
    }),
    impact:      buyrentImpact,
    defaultName: () => "Buy vs rent",
  },
  {
    id:          "car",
    label:       "New car",
    description: "True monthly cost of financing a new or used vehicle.",
    free:        false,
    defaultInputs: () => ({ price: 35000, down: 5000, tradeIn: 0, termMo: 60, apr: 6.5 }),
    impact:      carImpact,
    defaultName: () => "New car",
  },
  {
    id:          "levers",
    label:       "Savings levers",
    description: "See how spending cuts compound into meaningful monthly savings.",
    free:        false,
    defaultInputs: () => ({ cutSubs: 0, cutDining: 0, extraSavings: 0, extraDebt: 0 }),
    impact:      leversImpact,
    defaultName: (inputs) => {
      const saved = num(inputs.cutSubs, 0) + num(inputs.cutDining, 0) + num(inputs.extraSavings, 0);
      return saved > 0 ? `Save ${fmt(saved)}/mo` : "Savings levers";
    },
  },
  {
    id:          "salary",
    label:       "Salary change",
    description: "Model a raise, promotion, or income reduction.",
    free:        false,
    defaultInputs: (snap) => ({
      newAnnual:    Math.round(snap.monthlyIncome * 12 / 1000) * 1000 || 60000,
      effectiveInMo: 0,
    }),
    impact:      salaryImpact,
    defaultName: (inputs) => {
      const a = num(inputs.newAnnual, 0);
      return a > 0 ? `Salary ${fmt(a)}/yr` : "Salary change";
    },
  },
  {
    id:          "payoff",
    label:       "Pay off debt",
    description: "How a lump-sum payment accelerates your debt-free date.",
    free:        false,
    defaultInputs: (snap) => ({
      lumpSum: Math.min(5000, Math.max(0, snap.liquidAssets - snap.emergencyFundTarget)),
      apr:     8,
    }),
    impact:      payoffImpact,
    defaultName: (inputs) => {
      const ls = num(inputs.lumpSum, 0);
      return ls > 0 ? `Pay off ${fmt(ls)}` : "Pay off debt";
    },
  },
];

export function getTemplate(id: TemplateId | string): TemplateDefinition | undefined {
  return TEMPLATES.find((t) => t.id === id);
}

// ── Scenario description lines ─────────────────────────────────────────────────

/** Human-readable description of a saved scenario, shown in the card body. */
export function getScenarioDescription(
  templateId: TemplateId | string,
  inputs: Record<string, number | string | boolean>,
  snap: FinancialSnapshot,
): string {
  switch (templateId) {
    case "purchase": {
      const isOneTime   = bool(inputs.isOneTime);
      const cost        = num(inputs.cost, 55);
      const months      = Math.max(1, num(inputs.months, 24));
      const monthlyCost = isOneTime ? cost / months : cost;
      const totalCost   = isOneTime ? cost : cost * months;
      const name        = String(inputs.name || "item");
      return isOneTime
        ? `One-time ${fmt(cost)} for ${name}, spread at ${fmt(monthlyCost)}/mo over ${months} months. Total: ${fmt(totalCost)}.`
        : `Monthly plan at ${fmt(monthlyCost)}/mo for ${months} months. Total cost ${fmt(totalCost)} including ${name}.`;
    }
    case "buyrent": {
      const price     = Math.max(0, num(inputs.homePrice, 650000));
      const downPct   = num(inputs.downPct, 10);
      const mortRate  = num(inputs.mortRate, 5.5);
      const amortYears = num(inputs.amortYears, 25);
      const rent      = num(inputs.rent, 2400);
      return `Buying a ${fmt(price)} home vs rent ${fmt(rent)}/mo. Mortgage at ${mortRate}% over ${amortYears}yr, ${downPct}% down.`;
    }
    case "car": {
      const price  = num(inputs.price, 35000);
      const down   = num(inputs.down, 5000);
      const apr    = num(inputs.apr, 6.5);
      const termMo = num(inputs.termMo, 60);
      const principal = Math.max(0, price - down - num(inputs.tradeIn, 0));
      const r         = apr / 100 / 12;
      const monthlyPmt = principal > 0 && r > 0
        ? principal * (r * Math.pow(1 + r, termMo)) / (Math.pow(1 + r, termMo) - 1)
        : principal / termMo;
      return `${fmt(price)} vehicle with ${fmt(down)} down, ${apr}% APR. ${fmt(monthlyPmt)}/mo over ${termMo} months.`;
    }
    case "levers": {
      const cutSubs      = num(inputs.cutSubs,      0);
      const cutDining    = num(inputs.cutDining,    0);
      const extraSavings = num(inputs.extraSavings, 0);
      const saved = cutSubs + cutDining + extraSavings;
      const parts: string[] = [];
      if (cutSubs > 0)      parts.push(`cut ${fmt(cutSubs)} in subscriptions`);
      if (cutDining > 0)    parts.push(`reduce dining by ${fmt(cutDining)}`);
      if (extraSavings > 0) parts.push(`save ${fmt(extraSavings)} extra`);
      return saved > 0
        ? `Reclaim ${fmt(saved)}/mo by: ${parts.join(", ")}.`
        : "Adjust the levers to see your reclaimed budget.";
    }
    case "salary": {
      const newAnnual = num(inputs.newAnnual, snap.monthlyIncome * 12);
      const pctChange = snap.monthlyIncome > 0
        ? ((newAnnual / 12 - snap.monthlyIncome) / snap.monthlyIncome) * 100
        : 0;
      const isRaise = pctChange >= 0;
      return `${isRaise ? "Raise" : "Reduction"} to ${fmt(newAnnual)}/yr (${isRaise ? "+" : ""}${pctChange.toFixed(0)}% from current ${fmt(snap.monthlyIncome * 12)}/yr). Modelling impact on savings rate and net worth trajectory.`;
    }
    case "payoff": {
      const lumpSum = num(inputs.lumpSum, 5000);
      const apr     = num(inputs.apr, 8);
      const debtBal = Math.max(snap.totalDebt, 0);
      const r       = apr / 100 / 12;
      const minPayment = Math.max(25, debtBal * 0.02);
      let baseMo = 0, baseInterest = 0, newMo = 0, newInterest = 0;
      if (debtBal > 0) {
        let bal = debtBal;
        while (bal > 0 && baseMo < 600) { baseInterest += bal * r; bal = bal * (1 + r) - minPayment; baseMo++; }
        const newBal = Math.max(0, debtBal - lumpSum);
        if (newBal > 0) {
          let b = newBal;
          while (b > 0 && newMo < 600) { newInterest += b * r; b = b * (1 + r) - minPayment; newMo++; }
        }
      }
      const interestSaved = Math.max(0, baseInterest - newInterest);
      const monthsSaved   = Math.max(0, baseMo - newMo);
      return lumpSum > 0 && debtBal > 0
        ? `Accelerate debt payoff at ${fmt(lumpSum)} extra. Saves ${fmt(interestSaved)} in interest over ${monthsSaved} months.`
        : "Set a lump sum to see your debt payoff acceleration.";
    }
    default:
      return "";
  }
}

// ── Compact metrics for editor preview ────────────────────────────────────────

export interface CompactMetric {
  label: string;
  value: string;
  /** positive = green, negative = red, undefined = neutral */
  positive?: boolean;
}

/** 3–4 key metrics shown in the PROJECTED IMPACT section of the editor. */
export function getCompactMetrics(
  templateId: TemplateId | string,
  inputs: Record<string, number | string | boolean>,
  snap: FinancialSnapshot,
): CompactMetric[] {
  const tmpl = TEMPLATES.find((t) => t.id === templateId);
  if (!tmpl) return [];

  const impact          = tmpl.impact(inputs, snap);
  const monthlyDelta    = impact.monthlyIncomeDelta - impact.monthlyExpenseDelta;
  const newMonthlySav   = snap.monthlySavings + monthlyDelta;
  const newSavRate      = snap.monthlyIncome + impact.monthlyIncomeDelta > 0
    ? (newMonthlySav / (snap.monthlyIncome + impact.monthlyIncomeDelta)) * 100
    : 0;
  const savRateDelta    = newSavRate - snap.savingsRate;
  const nwDelta         = (snap.netWorth + newMonthlySav * 12 - impact.oneTimeCost) - (snap.netWorth + snap.monthlySavings * 12);

  const baseMetrics: CompactMetric[] = [
    {
      label:    "Savings rate impact",
      value:    `${savRateDelta >= 0 ? "+" : ""}${savRateDelta.toFixed(1)} pts`,
      positive: savRateDelta >= 0,
    },
    {
      label:    "Net worth in 12 mo",
      value:    `${nwDelta >= 0 ? "+" : ""}${fmt(Math.round(nwDelta))}`,
      positive: nwDelta >= 0,
    },
  ];

  switch (templateId) {
    case "purchase": {
      const isOneTime   = bool(inputs.isOneTime);
      const cost        = num(inputs.cost, 55);
      const months      = Math.max(1, num(inputs.months, 24));
      const totalCost   = isOneTime ? cost : cost * months;
      return [
        { label: "Total cost", value: fmt(totalCost) },
        ...baseMetrics,
      ];
    }
    case "buyrent": {
      const price     = Math.max(0, num(inputs.homePrice, 650000));
      const downPct   = num(inputs.downPct, 10);
      return [
        { label: "Down payment", value: fmt(price * downPct / 100) },
        ...baseMetrics,
      ];
    }
    case "car": {
      const price     = num(inputs.price, 35000);
      const down      = num(inputs.down, 5000);
      const tradeIn   = num(inputs.tradeIn, 0);
      const termMo    = Math.max(1, num(inputs.termMo, 60));
      const apr       = num(inputs.apr, 6.5);
      const principal = Math.max(0, price - down - tradeIn);
      const r         = apr / 100 / 12;
      const monthlyPmt = principal > 0 && r > 0
        ? principal * (r * Math.pow(1 + r, termMo)) / (Math.pow(1 + r, termMo) - 1)
        : principal / termMo;
      const totalInterest = Math.max(0, monthlyPmt * termMo - principal);
      return [
        { label: "Total cost (incl. interest)", value: fmt(price - tradeIn + totalInterest) },
        ...baseMetrics,
      ];
    }
    case "levers": {
      const saved = num(inputs.cutSubs, 0) + num(inputs.cutDining, 0) + num(inputs.extraSavings, 0);
      return [
        { label: "Monthly reclaimed", value: fmt(saved), positive: saved > 0 },
        ...baseMetrics,
      ];
    }
    case "salary": {
      const newAnnual = num(inputs.newAnnual, snap.monthlyIncome * 12);
      const delta = newAnnual / 12 - snap.monthlyIncome;
      return [
        { label: "Monthly income change", value: `${delta >= 0 ? "+" : ""}${fmt(delta)}`, positive: delta >= 0 },
        ...baseMetrics,
      ];
    }
    case "payoff": {
      const lumpSum = num(inputs.lumpSum, 5000);
      const apr     = num(inputs.apr, 8);
      const debtBal = Math.max(snap.totalDebt, 0);
      const r       = apr / 100 / 12;
      const minPayment = Math.max(25, debtBal * 0.02);
      let baseMo = 0, baseInterest = 0, newMo = 0, newInterest = 0;
      if (debtBal > 0) {
        let bal = debtBal;
        while (bal > 0 && baseMo < 600) { baseInterest += bal * r; bal = bal * (1 + r) - minPayment; baseMo++; }
        const newBal = Math.max(0, debtBal - lumpSum);
        if (newBal > 0) {
          let b = newBal;
          while (b > 0 && newMo < 600) { newInterest += b * r; b = b * (1 + r) - minPayment; newMo++; }
        }
      }
      const interestSaved = Math.max(0, baseInterest - newInterest);
      const monthsSaved   = Math.max(0, baseMo - newMo);
      return [
        { label: "Interest saved",  value: fmt(interestSaved), positive: interestSaved > 0 },
        { label: "Months to debt-free saved", value: `${monthsSaved} mo`, positive: monthsSaved > 0 },
        baseMetrics[1],
      ];
    }
    default:
      return baseMetrics;
  }
}

/** Pre-filled AI question based on the scenario template. */
export function getAiQuestion(templateId: TemplateId | string): string {
  switch (templateId) {
    case "purchase": return "Is this the right time for this purchase?";
    case "buyrent":  return "Should I buy or continue renting?";
    case "car":      return "Can I afford this car right now?";
    case "levers":   return "Where should I cut spending first?";
    case "salary":   return "How does this income change affect my goals?";
    case "payoff":   return "Is now a good time to pay off this debt?";
    default:         return "How does this scenario affect my finances?";
  }
}

// ── Stacking engine ────────────────────────────────────────────────────────────

/**
 * Additively stack all enabled scenarios to compute the combined net impact
 * against the user's real baseline.
 *
 * v1: simple additive deltas. Interaction effects (e.g. paying off debt
 * reduces interest, which lowers monthly expenses) can be addressed in v2.
 */
export function computeCombinedImpact(
  scenarios: Pick<WhatIfScenario, "inputs" | "templateId" | "enabled">[],
  snap: FinancialSnapshot,
): CombinedImpact {
  const enabled = scenarios.filter((s) => s.enabled);

  if (enabled.length === 0) {
    return {
      newMonthlySavings: snap.monthlySavings,
      newSavingsRate:    snap.savingsRate,
      savingsRateDelta:  0,
      newNetWorth12:     snap.netWorth + snap.monthlySavings * 12,
      netWorthDelta:     0,
      totalOneTimeCost:  0,
      hasImpact:         false,
    };
  }

  let totalExpDelta = 0;
  let totalIncDelta = 0;
  let totalOneTime  = 0;

  for (const s of enabled) {
    const tmpl = getTemplate(s.templateId);
    if (!tmpl) continue;
    const imp    = tmpl.impact(s.inputs, snap);
    totalExpDelta += imp.monthlyExpenseDelta;
    totalIncDelta += imp.monthlyIncomeDelta;
    totalOneTime  += imp.oneTimeCost;
  }

  const newMonthlyIncome   = snap.monthlyIncome   + totalIncDelta;
  const newMonthlyExpenses = snap.monthlyExpenses  + totalExpDelta;
  const newMonthlySavings  = newMonthlyIncome - newMonthlyExpenses;
  const newSavingsRate     = newMonthlyIncome > 0
    ? (newMonthlySavings / newMonthlyIncome) * 100
    : 0;
  const savingsRateDelta   = newSavingsRate - snap.savingsRate;
  const baseNW12           = snap.netWorth + snap.monthlySavings * 12;
  const newNW12            = snap.netWorth + newMonthlySavings * 12 - totalOneTime;

  return {
    newMonthlySavings,
    newSavingsRate,
    savingsRateDelta,
    newNetWorth12:    newNW12,
    netWorthDelta:    newNW12 - baseNW12,
    totalOneTimeCost: totalOneTime,
    hasImpact:        true,
  };
}

// ── Sparkline projection ───────────────────────────────────────────────────────

/** 13-point projection of cumulative liquid assets (month 0 → month 12). */
export function buildSparklineData(snap: FinancialSnapshot, combined: CombinedImpact) {
  return Array.from({ length: 13 }, (_, i) => ({
    baseline: snap.liquidAssets + snap.monthlySavings * i,
    scenario: snap.liquidAssets
      + combined.newMonthlySavings * i
      - (i > 0 ? combined.totalOneTimeCost : 0),
  }));
}
