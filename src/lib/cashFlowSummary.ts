/**
 * Cash flow page view — presentation on top of {@link getMonthlyCashFlow}.
 *
 * Totals come from the shared monthly function. This file does not re-filter
 * income or spending.
 */

import { fmt } from "./currencyUtils";
import { formatMonthYear } from "./dateFormatting";
import {
  computeMonthlyCashFlowSeries,
  type MonthlyCashFlow,
  type MonthlyCashFlowInput,
} from "./monthlyCashFlow";
import { sliceMonthsByTrendRange, type TrendRangeKey } from "./trendRange";

export {
  computeSavingsRate,
  getMonthlyCashFlow,
  getMonthlyCashFlowForMonths,
  computeMonthlyCashFlowSeries,
  averageMonthlyCashFlow,
} from "./monthlyCashFlow";
export type {
  MonthlyCashFlow,
  MonthlyCashFlowInput,
} from "./monthlyCashFlow";

export const CASH_FLOW_TRANSFER_NOTE =
  "Transfers between your own accounts, credit card payments, and investments are left out, so this is what actually came in and went out — the same numbers as Income and Spending.";

const TOP_CATEGORY_COUNT = 6;
const TOP_SOURCE_COUNT = 8;
const OTHER_COLOR = "#9ca3af";
const LEFTOVER_COLOR = "#10b981";
const OVERSPEND_COLOR = "#f43f5e";

export type CashFlowAccountSnap = {
  slug: string;
  accountName?: string | null;
  bankName?: string | null;
};

export type CashFlowCategory = {
  name: string;
  amount: number;
  share: number;
  color: string;
  vsAvgPct: number | null;
};

export type CashFlowSource = {
  name: string;
  amount: number;
  share: number;
  accountLabel?: string;
};

export type CashFlowGlanceSegment = {
  name: string;
  amount: number;
  share: number;
  color: string;
  isLeftover: boolean;
};

export type CashFlowMonth = MonthlyCashFlow;

export type CashFlowSummary = {
  currency: string;
  months: CashFlowMonth[];
};

export type CashFlowSelectedView = {
  visibleMonths: CashFlowMonth[];
  selected: CashFlowMonth | null;
  savingsRateSentence: string | null;
  summarySentence: string;
  categories: CashFlowCategory[];
  sources: CashFlowSource[];
  glance: CashFlowGlanceSegment[];
};

export type CashFlowBuildInput = MonthlyCashFlowInput;

export function formatSavingsRateSentence(rate: number | null): string | null {
  if (rate === null || !Number.isFinite(rate)) return null;
  const pct = Math.round(rate * 100);
  if (pct >= 0) return `You kept ${pct}% of what you earned`;
  return `You spent ${Math.abs(pct)}% more than you earned`;
}

export function formatCashFlowSummarySentence(
  yearMonth: string,
  moneyIn: number,
  moneyOut: number,
  leftover: number,
  currency: string,
): string {
  const month = formatMonthYear(yearMonth);
  const inAmt = fmt(moneyIn, currency);
  const outAmt = fmt(moneyOut, currency);
  if (moneyIn <= 0 && moneyOut <= 0) {
    return `No money in or out in ${month}.`;
  }
  if (moneyIn <= 0) {
    return `In ${month} you spent ${outAmt} and had no earnings recorded.`;
  }
  if (leftover >= 0) {
    return `In ${month} you brought in ${inAmt} and spent ${outAmt}. That left ${fmt(leftover, currency)}.`;
  }
  return `In ${month} you brought in ${inAmt} and spent ${outAmt}. You spent ${fmt(-leftover, currency)} more than you earned.`;
}

/** Keep the click if it is still in range; otherwise the latest visible month. */
export function selectCashFlowMonth(
  months: Array<{ yearMonth: string }>,
  selectedYm: string | null | undefined,
): string | null {
  if (months.length === 0) return null;
  const sorted = [...months].sort((a, b) => a.yearMonth.localeCompare(b.yearMonth));
  if (selectedYm && sorted.some((m) => m.yearMonth === selectedYm)) return selectedYm;
  return sorted[sorted.length - 1].yearMonth;
}

type NamedAmount = { name: string; amount: number; color?: string; accountLabel?: string };

/** Top N rows; remaining rows become a true Other sum — not a plug to a target. */
function topNamedAmounts(rows: NamedAmount[], limit: number): NamedAmount[] {
  const kept = rows
    .filter((r) => Math.abs(r.amount) >= 0.005)
    .sort((a, b) => b.amount - a.amount);
  if (kept.length <= limit) return kept;
  const displayed = kept.slice(0, limit);
  const rest = kept.slice(limit).reduce((s, r) => s + r.amount, 0);
  if (Math.abs(rest) < 0.005) return displayed;
  const other = displayed.find((r) => r.name === "Other");
  if (other) {
    other.amount += rest;
    return displayed;
  }
  displayed.push({ name: "Other", amount: rest, color: OTHER_COLOR });
  return displayed;
}

export function buildCashFlowSummary(input: CashFlowBuildInput): CashFlowSummary {
  return {
    currency: input.homeCurrency,
    months: computeMonthlyCashFlowSeries(input),
  };
}

function withShares<T extends { amount: number }>(
  rows: T[],
  total: number,
): Array<T & { share: number }> {
  const denom = total > 0 ? total : rows.reduce((s, r) => s + r.amount, 0);
  return rows.map((r) => ({
    ...r,
    share: denom > 0 ? r.amount / denom : 0,
  }));
}

function categoryVsAvg(
  name: string,
  amount: number,
  selectedYm: string,
  visible: CashFlowMonth[],
): number | null {
  const others = visible.filter((m) => m.yearMonth !== selectedYm);
  if (others.length === 0) return null;
  const avg =
    others.reduce((s, m) => {
      const hit = m.categories.find((c) => c.name === name);
      return s + (hit?.amount ?? 0);
    }, 0) / others.length;
  if (avg <= 0) return amount > 0 ? null : 0;
  return ((amount - avg) / avg) * 100;
}

function glanceForMonth(month: CashFlowMonth): CashFlowGlanceSegment[] {
  if (month.moneyIn <= 0.005) return [];
  const rows: Array<{ name: string; amount: number; color: string; isLeftover: boolean }> =
    topNamedAmounts(month.categories, TOP_CATEGORY_COUNT).map((c) => ({
      name: c.name,
      amount: c.amount,
      color: c.color ?? OTHER_COLOR,
      isLeftover: false,
    }));
  if (Math.abs(month.leftover) > 0.005) {
    rows.push({
      name: "Left over",
      amount: month.leftover,
      color: month.leftover < 0 ? OVERSPEND_COLOR : LEFTOVER_COLOR,
      isLeftover: true,
    });
  }
  return withShares(rows, month.moneyIn);
}

export function buildCashFlowView(
  summary: CashFlowSummary,
  range: TrendRangeKey,
  selectedYm: string | null | undefined,
): CashFlowSelectedView {
  const visibleMonths = sliceMonthsByTrendRange(
    summary.months.map((m) => ({ ...m, month: m.yearMonth })),
    range,
  );
  const selectedId = selectCashFlowMonth(visibleMonths, selectedYm);
  const selected = visibleMonths.find((m) => m.yearMonth === selectedId) ?? null;

  if (!selected) {
    return {
      visibleMonths,
      selected: null,
      savingsRateSentence: null,
      summarySentence: "Upload some statements to see how money comes in and goes out.",
      categories: [],
      sources: [],
      glance: [],
    };
  }

  const categoryRows = topNamedAmounts(selected.categories, TOP_CATEGORY_COUNT);
  const sourceRows = topNamedAmounts(selected.sources, TOP_SOURCE_COUNT);

  const categories = withShares(
    categoryRows.map((c) => ({
      name: c.name,
      amount: c.amount,
      color: c.color ?? OTHER_COLOR,
      vsAvgPct: categoryVsAvg(c.name, c.amount, selected.yearMonth, visibleMonths),
    })),
    selected.moneyOut,
  );

  const sources = withShares(
    sourceRows.map((s) => ({
      name: s.name,
      amount: s.amount,
      accountLabel: s.accountLabel,
    })),
    selected.moneyIn,
  );

  return {
    visibleMonths,
    selected,
    savingsRateSentence: formatSavingsRateSentence(selected.savingsRate),
    summarySentence: formatCashFlowSummarySentence(
      selected.yearMonth,
      selected.moneyIn,
      selected.moneyOut,
      selected.leftover,
      summary.currency,
    ),
    categories,
    sources,
    glance: glanceForMonth(selected),
  };
}
