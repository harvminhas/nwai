/**
 * Net Worth Growth — plain start-vs-end balance changes for cash, investments,
 * and debts. Display-only; uses the same monthlyHistory.byAccount balances as
 * What Changed.
 */

import { accountGroup } from "./assetsSummary";
import { getParentCategory } from "./categoryTaxonomy";
import { fmt } from "./currencyUtils";
import type { ExpenseTxnRecord, IncomeTxnRecord } from "./extractTransactions";
import type { MonthlyHistoryEntry } from "./financialProfile";

const DEBT_TYPES = new Set([
  "credit",
  "credit_card",
  "line_of_credit",
  "loc",
  "mortgage",
  "loan",
  "auto_loan",
  "student_loan",
  "personal_loan",
]);

export type GrowthBucket = "cash" | "investments" | "debts";

export interface GrowthAccountLine {
  slug: string;
  label: string;
  type: string;
  start: number;
  end: number;
  change: number;
}

export interface GrowthNewAccount {
  slug: string;
  label: string;
  type: string;
  bucket: GrowthBucket;
  amount: number;
}

export interface GrowthSection {
  start: number;
  end: number;
  change: number;
  changePercent: number | null;
  accounts: GrowthAccountLine[];
  /** Investments only: net deposits this period. Null if some accounts have no deposit/withdrawal lines. */
  putIn: number | null;
  /** Investments only: balance change minus put-in. Null when putIn is null. */
  marketChange: number | null;
}

export interface PeriodGrowth {
  yearMonth: string;
  startMonth: string | null;
  endMonth: string;
  hasPrevious: boolean;
  cash: GrowthSection;
  investments: GrowthSection;
  debts: GrowthSection;
  newAccounts: GrowthNewAccount[];
  startAccounts: GrowthAccountLine[];
  endAccounts: GrowthAccountLine[];
  investmentFlows: Array<{ slug: string; deposits: number; withdrawals: number }>;
}

export type GrowthExpenseTxn = Pick<ExpenseTxnRecord, "txMonth" | "amount" | "category" | "accountSlug">;
export type GrowthIncomeTxn = Pick<IncomeTxnRecord, "txMonth" | "amount" | "accountSlug" | "category">;

export interface NetWorthGrowthInput {
  monthlyHistory: MonthlyHistoryEntry[];
  expenseTxns: GrowthExpenseTxn[];
  incomeTxns: GrowthIncomeTxn[];
}

function normalizeType(type: string): string {
  return type.toLowerCase().startsWith("manual-")
    ? type.toLowerCase().slice("manual-".length)
    : type.toLowerCase();
}

export function isDebtAccountType(type: string): boolean {
  return DEBT_TYPES.has(normalizeType(type));
}

/** Cash / investments / debts using the same grouping as the Assets and Debts pages. */
export function growthBucket(type: string, label?: string): GrowthBucket | null {
  if (isDebtAccountType(type)) return "debts";
  const group = accountGroup(normalizeType(type), label);
  if (group === "cash") return "cash";
  if (group === "investments" || group === "registered") return "investments";
  return null;
}

/** Amount owed for debts (negative = credit / overpaid). Assets keep their signed value. */
function displayValue(type: string, label: string | undefined, signed: number): number {
  return growthBucket(type, label) === "debts" ? -signed : signed;
}

/** Dividends, interest, and distributions in an investment account are market growth, not deposits. */
export function isInvestmentMarketIncome(category?: string | null): boolean {
  if (!category) return false;
  const raw = category.trim().toLowerCase().replace(/^income\s*[-—]\s*/, "");
  return (
    raw === "dividend" ||
    raw === "dividends" ||
    raw === "interest" ||
    raw === "distribution" ||
    raw === "distributions" ||
    raw.includes("dividend") ||
    raw.includes("distribution")
  );
}

function changePercent(start: number, change: number): number | null {
  if (Math.abs(start) < 0.005) return null;
  return change / Math.abs(start);
}

function sortByChangeSize(accounts: GrowthAccountLine[]): GrowthAccountLine[] {
  return [...accounts].sort((a, b) => {
    const diff = Math.abs(b.change) - Math.abs(a.change);
    return diff !== 0 ? diff : a.slug.localeCompare(b.slug);
  });
}

function snapshotLines(
  accounts: NonNullable<MonthlyHistoryEntry["byAccount"]> | GrowthAccountLine[],
): Map<string, GrowthAccountLine> {
  const map = new Map<string, GrowthAccountLine>();
  for (const row of accounts ?? []) {
    const signed = "value" in row ? (row as { value: number }).value : (row as GrowthAccountLine).end;
    map.set(row.slug, {
      slug: row.slug,
      label: row.label,
      type: row.type,
      start: signed,
      end: signed,
      change: 0,
    });
  }
  return map;
}

function flowsForPeriod(
  slugs: Set<string>,
  months: Set<string>,
  input: Pick<NetWorthGrowthInput, "expenseTxns" | "incomeTxns">,
): Map<string, { deposits: number; withdrawals: number }> {
  const flows = new Map<string, { deposits: number; withdrawals: number }>();
  const ensure = (slug: string) => {
    const prev = flows.get(slug) ?? { deposits: 0, withdrawals: 0 };
    flows.set(slug, prev);
    return prev;
  };
  for (const t of input.incomeTxns) {
    if (!months.has(t.txMonth) || !slugs.has(t.accountSlug)) continue;
    if (isInvestmentMarketIncome(t.category)) {
      ensure(t.accountSlug);
      continue;
    }
    ensure(t.accountSlug).deposits += Math.abs(t.amount);
  }
  for (const t of input.expenseTxns) {
    if (!months.has(t.txMonth) || !slugs.has(t.accountSlug)) continue;
    const parent = getParentCategory(t.category);
    if (parent === "Interest" || parent === "Fees") continue;
    ensure(t.accountSlug).withdrawals += Math.abs(t.amount);
  }
  return flows;
}

export function buildPeriodGrowth(
  startAccounts: NonNullable<MonthlyHistoryEntry["byAccount"]> | GrowthAccountLine[],
  endAccounts: NonNullable<MonthlyHistoryEntry["byAccount"]> | GrowthAccountLine[],
  opts: {
    startMonth: string | null;
    endMonth: string;
    periodMonths: string[];
    expenseTxns: GrowthExpenseTxn[];
    incomeTxns: GrowthIncomeTxn[];
    investmentFlows?: Array<{ slug: string; deposits: number; withdrawals: number }>;
  },
): PeriodGrowth {
  const startMap = snapshotLines(startAccounts);
  const endMap = snapshotLines(endAccounts);
  const startSlugs = new Set(startMap.keys());
  const endSlugs = new Set(endMap.keys());

  const sections: Record<GrowthBucket, GrowthAccountLine[]> = {
    cash: [],
    investments: [],
    debts: [],
  };
  const newAccounts: GrowthNewAccount[] = [];

  for (const slug of endSlugs) {
    const endRow = endMap.get(slug)!;
    const bucket = growthBucket(endRow.type, endRow.label);
    if (!bucket) continue;
    const startRow = startMap.get(slug);
    const endDisplay = displayValue(endRow.type, endRow.label, endRow.end);
    if (!startRow || !startSlugs.has(slug)) {
      newAccounts.push({
        slug,
        label: endRow.label,
        type: endRow.type,
        bucket,
        amount: endDisplay,
      });
      continue;
    }
    const startDisplay = displayValue(startRow.type, startRow.label, startRow.end);
    sections[bucket].push({
      slug,
      label: endRow.label || startRow.label,
      type: endRow.type,
      start: startDisplay,
      end: endDisplay,
      change: endDisplay - startDisplay,
    });
  }

  // Closed or paid-off: present at the start, gone by the end. Count as going to $0,
  // not as "new". (New accounts are the opposite — first seen this period.)
  for (const slug of startSlugs) {
    if (endSlugs.has(slug)) continue;
    const startRow = startMap.get(slug)!;
    const bucket = growthBucket(startRow.type, startRow.label);
    if (!bucket) continue;
    const startDisplay = displayValue(startRow.type, startRow.label, startRow.end);
    sections[bucket].push({
      slug,
      label: startRow.label,
      type: startRow.type,
      start: startDisplay,
      end: 0,
      change: 0 - startDisplay,
    });
  }

  const investmentSlugs = new Set<string>();
  for (const row of [...startMap.values(), ...endMap.values()]) {
    if (growthBucket(row.type, row.label) === "investments") investmentSlugs.add(row.slug);
  }
  const flowMap = opts.investmentFlows
    ? new Map(opts.investmentFlows.map((f) => [f.slug, f]))
    : flowsForPeriod(investmentSlugs, new Set(opts.periodMonths), opts);

  let putIn: number | null = null;
  let marketChange: number | null = null;
  if (sections.investments.length > 0) {
    const unknown = sections.investments.some((a) => !flowMap.has(a.slug));
    if (!unknown) {
      putIn = 0;
      for (const a of sections.investments) {
        const f = flowMap.get(a.slug)!;
        putIn += f.deposits - f.withdrawals;
      }
      const investedChange = sections.investments.reduce((s, a) => s + a.change, 0);
      marketChange = investedChange - putIn;
    }
  }

  const makeSection = (bucket: GrowthBucket): GrowthSection => {
    const accounts = sortByChangeSize(sections[bucket]);
    const start = accounts.reduce((s, a) => s + a.start, 0);
    const end = accounts.reduce((s, a) => s + a.end, 0);
    const change = end - start;
    return {
      start,
      end,
      change,
      changePercent: changePercent(start, change),
      accounts,
      putIn: bucket === "investments" ? putIn : null,
      marketChange: bucket === "investments" ? marketChange : null,
    };
  };

  const startAccountList = [...startMap.values()].map((a) => ({
    ...a,
    start: a.end,
    change: 0,
  }));
  const endAccountList = [...endMap.values()].map((a) => ({
    ...a,
    start: a.end,
    change: 0,
  }));

  return {
    yearMonth: opts.endMonth,
    startMonth: opts.startMonth,
    endMonth: opts.endMonth,
    hasPrevious: opts.startMonth != null,
    cash: makeSection("cash"),
    investments: makeSection("investments"),
    debts: makeSection("debts"),
    newAccounts: newAccounts.sort((a, b) => a.label.localeCompare(b.label)),
    startAccounts: startAccountList,
    endAccounts: endAccountList,
    investmentFlows: [...flowMap.entries()].map(([slug, f]) => ({ slug, ...f })),
  };
}

export function computeMonthGrowth(
  current: MonthlyHistoryEntry,
  previous: MonthlyHistoryEntry | null,
  input: Pick<NetWorthGrowthInput, "expenseTxns" | "incomeTxns">,
): PeriodGrowth {
  return buildPeriodGrowth(previous?.byAccount ?? [], current.byAccount ?? [], {
    startMonth: previous?.yearMonth ?? null,
    endMonth: current.yearMonth,
    periodMonths: [current.yearMonth],
    expenseTxns: input.expenseTxns,
    incomeTxns: input.incomeTxns,
  });
}

export function computeNetWorthGrowth(
  input: NetWorthGrowthInput,
  opts?: { windowMonths?: number },
): PeriodGrowth[] {
  const sorted = [...input.monthlyHistory].sort((a, b) => a.yearMonth.localeCompare(b.yearMonth));
  const windowMonths = opts?.windowMonths;
  const startIdx =
    windowMonths != null && windowMonths > 0 ? Math.max(0, sorted.length - windowMonths) : 0;
  const window = sorted.slice(startIdx);
  return window.map((current, idx) => {
    const previous = idx > 0 ? window[idx - 1] : startIdx > 0 ? sorted[startIdx - 1] : null;
    return computeMonthGrowth(current, previous, input);
  });
}

function mergeFlows(
  months: PeriodGrowth[],
): Array<{ slug: string; deposits: number; withdrawals: number }> {
  const map = new Map<string, { deposits: number; withdrawals: number }>();
  for (const m of months) {
    for (const f of m.investmentFlows) {
      const prev = map.get(f.slug) ?? { deposits: 0, withdrawals: 0 };
      prev.deposits += f.deposits;
      prev.withdrawals += f.withdrawals;
      map.set(f.slug, prev);
    }
  }
  return [...map.entries()].map(([slug, f]) => ({ slug, ...f }));
}

export function sumGrowthBreakdowns(
  months: PeriodGrowth[],
  rangeYearMonths?: string[],
): PeriodGrowth | null {
  const inRange = rangeYearMonths
    ? months.filter((m) => rangeYearMonths.includes(m.yearMonth))
    : months;
  if (inRange.length === 0) return null;
  if (inRange.length === 1) return inRange[0];
  const first = inRange[0];
  const last = inRange[inRange.length - 1];
  // Earliest month with no prior: use that month's own ending balances as the
  // range start. Accounts already on the books that month are not "new".
  const startFromFirstEnd = !first.hasPrevious;
  const startAccounts = startFromFirstEnd ? first.endAccounts : first.startAccounts;
  const startMonth = startFromFirstEnd ? first.endMonth : first.startMonth;

  const startSlugs = new Set(startAccounts.map((a) => a.slug));
  const comparableInvestments = last.endAccounts
    .filter((a) => startSlugs.has(a.slug) && growthBucket(a.type, a.label) === "investments")
    .map((a) => a.slug);
  const flowsKnown =
    comparableInvestments.length === 0 ||
    inRange.every((m) => {
      const known = new Set(m.investmentFlows.map((f) => f.slug));
      return comparableInvestments.every((slug) => known.has(slug));
    });

  return buildPeriodGrowth(startAccounts, last.endAccounts, {
    startMonth,
    endMonth: last.endMonth,
    periodMonths: inRange.map((m) => m.yearMonth),
    expenseTxns: [],
    incomeTxns: [],
    investmentFlows: flowsKnown ? mergeFlows(inRange) : [],
  });
}

export function formatGrowthRangeLabel(yearMonths: string[]): string {
  if (yearMonths.length === 0) return "";
  if (yearMonths.length === 1) return formatGrowthMonthLabel(yearMonths[0]);
  const sorted = [...yearMonths].sort();
  return `${formatGrowthMonthLabel(sorted[0])} – ${formatGrowthMonthLabel(sorted[sorted.length - 1])}`;
}

export function formatGrowthMonthLabel(yearMonth: string): string {
  const [year, monthNum] = yearMonth.split("-");
  const date = new Date(parseInt(year, 10), parseInt(monthNum, 10) - 1);
  return date.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

export function formatGrowthChartTitle(rangeMonths: number): string {
  if (rangeMonths === 3) return "3-Month Trend";
  if (rangeMonths === 6) return "6-Month Trend";
  return "All-time Trend";
}

function money(n: number, currency: string): string {
  return fmt(Math.abs(n), currency);
}

function pctLabel(percent: number | null): string {
  if (percent == null) return "";
  const rounded = Math.round(Math.abs(percent) * 100);
  if (rounded === 0) return "";
  return ` (${rounded}%)`;
}

export function describeCashChange(section: GrowthSection, currency: string): string {
  if (Math.abs(section.change) < 0.5) return "Your savings stayed about the same.";
  if (section.change > 0) {
    return `Your savings went up ${money(section.change, currency)}${pctLabel(section.changePercent)}.`;
  }
  return `Your savings went down ${money(section.change, currency)}${pctLabel(section.changePercent)}.`;
}

export function describeInvestmentChange(section: GrowthSection, currency: string): string {
  if (Math.abs(section.change) < 0.5) return "Your investments stayed about the same.";
  if (section.change > 0) {
    return `Your investments grew ${money(section.change, currency)}${pctLabel(section.changePercent)}.`;
  }
  return `Your investments fell ${money(section.change, currency)}${pctLabel(section.changePercent)}.`;
}

export function describeInvestmentPutIn(section: GrowthSection, currency: string): string | null {
  if (section.putIn == null || section.marketChange == null) return null;
  const put =
    section.putIn >= 0
      ? `You put in ${money(section.putIn, currency)}`
      : `You took out ${money(section.putIn, currency)}`;
  const market =
    section.marketChange >= 0
      ? `markets added ${money(section.marketChange, currency)}`
      : `markets lost ${money(section.marketChange, currency)}`;
  return `${put}; ${market}.`;
}

export function describeDebtChange(section: GrowthSection, currency: string): string {
  if (Math.abs(section.change) < 0.5) return "Your debt stayed about the same.";
  if (section.change < 0) return `You paid down ${money(section.change, currency)}.`;
  return `Your debt grew by ${money(section.change, currency)}.`;
}
