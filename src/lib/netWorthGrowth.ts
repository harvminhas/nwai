/**
 * Net Worth Growth — display-only decomposition of a month's (or range's)
 * net-worth change.
 *
 * Formulas (all amounts in one currency; callers convert with the profile FX
 * rates when needed):
 *
 *   Gross savings     = income − spending
 *   Savings rate      = gross savings / income  (null when income is 0)
 *   Net savings       = gross − debt interest & fees
 *                       only when those are identifiable on debt statements;
 *                       otherwise omit net and keep gross
 *   Debt paydown      = payments − new charges  (PR #76 Paid / New charges)
 *                       fallback: signed byAccount delta when a debt account
 *                       has no activity figures for the month
 *   Investment growth = Δ investment value
 *                       split into contributions (deposits − withdrawals) and
 *                       market growth when that account has its own txns;
 *                       otherwise the whole Δ is labelled "unsplit"
 *   Other assets      = Δ manual asset valuations (house, car, …)
 *
 * Reconciliation (never drop the remainder):
 *
 *   savings + debt paydown + investment growth + other assets
 *     + other/unexplained  =  net-worth change
 *
 * "savings" in that identity is net savings when interest/fees are
 * identifiable, otherwise gross. CSV and PDF transactions use the same
 * ExpenseTxnRecord / IncomeTxnRecord shape — there is no source split.
 */

import { getParentCategory } from "./categoryTaxonomy";
import { resolveDebtHeaderActivity } from "./debtHeaderActivity";
import type { DebtPaymentHistoryEntry, ExpenseTxnRecord, IncomeTxnRecord } from "./extractTransactions";
import type { MonthlyHistoryEntry } from "./financialProfile";

const DEBT_TYPES = new Set([
  "credit",
  "credit_card",
  "mortgage",
  "loan",
  "line_of_credit",
  "loc",
]);

const MANUAL_DEBT_CATEGORIES = new Set([
  "mortgage",
  "auto_loan",
  "student_loan",
  "personal_loan",
  "credit_card",
  "line_of_credit",
]);

export type InvestmentSplit = "split" | "unsplit";

export interface GrowthAccountLine {
  slug: string;
  label: string;
  type: string;
  amount: number;
}

export interface DebtGrowthAccount extends GrowthAccountLine {
  paid: number;
  newCharges: number;
  interestAndFees: number;
  /** paid − newCharges (principal reduction; negative = net new borrowing) */
  paydown: number;
  usedActivity: boolean;
}

export interface InvestmentGrowthAccount extends GrowthAccountLine {
  /** End-of-month minus prior month (byAccount, home currency). */
  delta: number;
  contributions: number | null;
  withdrawals: number | null;
  marketGrowth: number | null;
  split: InvestmentSplit;
}

export interface MonthGrowthBreakdown {
  yearMonth: string;
  /** Null on the first history month (same as What Changed). */
  netWorthChange: number | null;
  hasPreviousMonth: boolean;

  income: number;
  spending: number;
  grossSavings: number;
  /** grossSavings / income; null when income is 0 */
  savingsRate: number | null;

  interestAndFees: number;
  /**
   * True when at least one debt-statement txn is categorized Interest/Fees
   * or carries installmentInterestAmount. False means we will not invent a
   * net-savings figure.
   */
  interestAndFeesIdentifiable: boolean;
  /** Set when debt accounts had charges but no interest/fee line items. */
  interestAndFeesMissingNote: boolean;
  /** Null when interest/fees are not identifiable. */
  netSavings: number | null;

  debtPaydown: number;
  debtAccounts: DebtGrowthAccount[];

  investmentDelta: number;
  investmentContributions: number;
  investmentWithdrawals: number;
  investmentMarketGrowth: number;
  investmentUnsplit: number;
  investmentAccounts: InvestmentGrowthAccount[];

  otherAssetChanges: number;
  otherAssets: GrowthAccountLine[];

  /** netSavings if identifiable, else grossSavings */
  savingsForReconciliation: number;
  /**
   * netWorthChange − (savings + debtPaydown + investmentDelta + otherAssetChanges).
   * Always computed when netWorthChange is non-null; never dropped.
   */
  unexplained: number | null;
}

export interface NetWorthGrowthInput {
  monthlyHistory: MonthlyHistoryEntry[];
  expenseTxns: Array<Pick<ExpenseTxnRecord, "txMonth" | "amount" | "category" | "accountSlug" | "installmentInterestAmount" | "currency">>;
  incomeTxns: Array<Pick<IncomeTxnRecord, "txMonth" | "amount" | "accountSlug" | "currency">>;
  debtPaymentHistory: Array<Pick<DebtPaymentHistoryEntry, "accountSlug" | "statementMonth" | "paymentsMade" | "currency">>;
  homeCurrency?: string;
  fxRates?: Record<string, number>;
}

function toHome(
  amount: number,
  currency: string | undefined,
  homeCurrency: string,
  fxRates: Record<string, number>,
): number {
  if (!currency || currency.toUpperCase() === homeCurrency.toUpperCase()) return amount;
  const rate = fxRates[currency.toUpperCase()];
  return rate != null ? amount * rate : amount;
}

export function isDebtAccountType(type: string, value?: number): boolean {
  const t = type.toLowerCase();
  if (DEBT_TYPES.has(t)) return true;
  if (t.startsWith("manual-") && MANUAL_DEBT_CATEGORIES.has(t.slice("manual-".length))) {
    return true;
  }
  return value != null && value < -0.005;
}

export function isInvestmentAccountType(type: string): boolean {
  return type.toLowerCase() === "investment";
}

export function isManualAssetSlug(slug: string, type: string, value: number): boolean {
  return slug.startsWith("manual-") && !isDebtAccountType(type, value) && value >= 0;
}

export function isInterestOrFeeCategory(category: string): boolean {
  const parent = getParentCategory(category);
  return parent === "Interest" || parent === "Fees";
}

function interestAndFeesFromTxn(t: {
  category: string;
  amount: number;
  installmentInterestAmount?: number;
}): number {
  if (isInterestOrFeeCategory(t.category)) return Math.abs(t.amount);
  const installment = t.installmentInterestAmount ?? 0;
  return installment > 0 ? installment : 0;
}

function bySlug(accounts: MonthlyHistoryEntry["byAccount"]): Map<string, NonNullable<MonthlyHistoryEntry["byAccount"]>[number]> {
  return new Map((accounts ?? []).map((a) => [a.slug, a]));
}

/**
 * One month's growth breakdown. `previous` is the prior monthlyHistory entry
 * (any gap); omitted on the first month.
 */
export function computeMonthGrowth(
  current: MonthlyHistoryEntry,
  previous: MonthlyHistoryEntry | null,
  input: Pick<NetWorthGrowthInput, "expenseTxns" | "incomeTxns" | "debtPaymentHistory" | "homeCurrency" | "fxRates">,
): MonthGrowthBreakdown {
  const homeCurrency = input.homeCurrency ?? "CAD";
  const fxRates = input.fxRates ?? {};
  const convert = (amount: number, currency?: string) =>
    toHome(amount, currency, homeCurrency, fxRates);

  const month = current.yearMonth;
  const income = current.incomeTotal ?? 0;
  const spending = current.coreExpensesTotal ?? 0;
  const grossSavings = income - spending;
  const savingsRate = income > 0 ? grossSavings / income : null;

  const currentMap = bySlug(current.byAccount);
  const previousMap = bySlug(previous?.byAccount);
  const allSlugs = new Set([...currentMap.keys(), ...previousMap.keys()]);

  const debtSlugs = new Set<string>();
  const investmentSlugs = new Set<string>();
  for (const slug of allSlugs) {
    const row = currentMap.get(slug) ?? previousMap.get(slug);
    if (!row) continue;
    if (isDebtAccountType(row.type, row.value)) debtSlugs.add(slug);
    if (isInvestmentAccountType(row.type)) investmentSlugs.add(slug);
  }

  const monthExpenses = input.expenseTxns.filter((t) => t.txMonth === month);
  const monthIncome = input.incomeTxns.filter((t) => t.txMonth === month);

  let interestAndFees = 0;
  let identifiableHits = 0;
  for (const t of monthExpenses) {
    if (!debtSlugs.has(t.accountSlug)) continue;
    const part = interestAndFeesFromTxn(t);
    if (part > 0) {
      identifiableHits += 1;
      interestAndFees += convert(part, t.currency);
    }
  }
  const interestAndFeesIdentifiable = identifiableHits > 0;
  const netSavings = interestAndFeesIdentifiable ? grossSavings - interestAndFees : null;
  const savingsForReconciliation = netSavings ?? grossSavings;

  const debtAccounts: DebtGrowthAccount[] = [];
  let debtPaydown = 0;

  for (const slug of [...debtSlugs].sort()) {
    const currentRow = currentMap.get(slug);
    const previousRow = previousMap.get(slug);
    const type = currentRow?.type || previousRow?.type || "credit";
    const label = currentRow?.label || previousRow?.label || slug;
    const isBaseline = previousRow === undefined && currentRow !== undefined;

    const paymentsMade = input.debtPaymentHistory
      .filter((p) => p.accountSlug === slug && p.statementMonth === month)
      .reduce((sum, p) => sum + convert(p.paymentsMade, p.currency), 0);

    const debtExpenses = monthExpenses.filter((t) => t.accountSlug === slug);
    const expensesTotal = debtExpenses.reduce((sum, t) => sum + convert(Math.abs(t.amount), t.currency), 0);
    const incomeTotal = monthIncome
      .filter((t) => t.accountSlug === slug)
      .reduce((sum, t) => sum + convert(Math.abs(t.amount), t.currency), 0);

    const activity = resolveDebtHeaderActivity({
      paymentsMade,
      incomeTotal,
      incomeTxnCount: monthIncome.filter((t) => t.accountSlug === slug).length,
      expensesTotal,
      expensesTxnCount: debtExpenses.length,
    });
    const paid = activity.paid?.amount ?? 0;
    const newCharges = activity.newCharges?.amount ?? 0;
    const usedActivity = paid > 0 || newCharges > 0;

    const accountInterest = debtExpenses.reduce(
      (sum, t) => sum + convert(interestAndFeesFromTxn(t), t.currency),
      0,
    );

    const balanceDelta =
      (currentRow?.value ?? 0) - (previousRow?.value ?? 0); // debts are negative; paydown is positive

    // First appearance is a baseline, not paydown (same idea as What Changed).
    let paydown = 0;
    if (!isBaseline) {
      paydown = usedActivity ? paid - newCharges : balanceDelta;
    }

    debtPaydown += paydown;
    debtAccounts.push({
      slug,
      label,
      type,
      amount: paydown,
      paid,
      newCharges,
      interestAndFees: accountInterest,
      paydown,
      usedActivity,
    });
  }

  const interestAndFeesMissingNote =
    !interestAndFeesIdentifiable && debtAccounts.some((a) => a.usedActivity);

  const investmentAccounts: InvestmentGrowthAccount[] = [];
  let investmentDelta = 0;
  let investmentContributions = 0;
  let investmentWithdrawals = 0;
  let investmentMarketGrowth = 0;
  let investmentUnsplit = 0;

  for (const slug of [...investmentSlugs].sort()) {
    const currentRow = currentMap.get(slug);
    const previousRow = previousMap.get(slug);
    const type = currentRow?.type || previousRow?.type || "investment";
    const label = currentRow?.label || previousRow?.label || slug;
    const isBaseline = previousRow === undefined && currentRow !== undefined;
    const delta = isBaseline ? 0 : (currentRow?.value ?? 0) - (previousRow?.value ?? 0);

    const deposits = monthIncome
      .filter((t) => t.accountSlug === slug)
      .reduce((sum, t) => sum + convert(Math.abs(t.amount), t.currency), 0);
    const withdrawals = monthExpenses
      .filter((t) => t.accountSlug === slug)
      .reduce((sum, t) => sum + convert(Math.abs(t.amount), t.currency), 0);
    const hasOwnTxns = deposits > 0 || withdrawals > 0;

    investmentDelta += delta;

    if (hasOwnTxns) {
      const netContrib = deposits - withdrawals;
      const market = delta - netContrib;
      investmentContributions += deposits;
      investmentWithdrawals += withdrawals;
      investmentMarketGrowth += market;
      investmentAccounts.push({
        slug,
        label,
        type,
        amount: delta,
        delta,
        contributions: deposits,
        withdrawals,
        marketGrowth: market,
        split: "split",
      });
    } else {
      investmentUnsplit += delta;
      investmentAccounts.push({
        slug,
        label,
        type,
        amount: delta,
        delta,
        contributions: null,
        withdrawals: null,
        marketGrowth: null,
        split: "unsplit",
      });
    }
  }

  const otherAssets: GrowthAccountLine[] = [];
  let otherAssetChanges = 0;
  for (const slug of [...allSlugs].sort()) {
    const currentRow = currentMap.get(slug);
    const previousRow = previousMap.get(slug);
    const type = currentRow?.type || previousRow?.type || "";
    const value = currentRow?.value ?? previousRow?.value ?? 0;
    if (!slug.startsWith("manual-")) continue;
    if (isDebtAccountType(type, value)) continue;
    if (!isManualAssetSlug(slug, type, value) && (currentRow?.value ?? 0) < 0) continue;

    const label = currentRow?.label || previousRow?.label || slug;
    // Include first appearance: adding a house/car is an other-asset value change.
    const amount = (currentRow?.value ?? 0) - (previousRow?.value ?? 0);
    if (Math.abs(amount) < 0.005) continue;
    otherAssetChanges += amount;
    otherAssets.push({ slug, label, type, amount });
  }

  const netWorthChange = previous ? current.netWorth - previous.netWorth : null;
  const unexplained =
    netWorthChange === null
      ? null
      : netWorthChange -
        (savingsForReconciliation + debtPaydown + investmentDelta + otherAssetChanges);

  return {
    yearMonth: month,
    netWorthChange,
    hasPreviousMonth: previous != null,
    income,
    spending,
    grossSavings,
    savingsRate,
    interestAndFees,
    interestAndFeesIdentifiable,
    interestAndFeesMissingNote,
    netSavings,
    debtPaydown,
    debtAccounts,
    investmentDelta,
    investmentContributions,
    investmentWithdrawals,
    investmentMarketGrowth,
    investmentUnsplit,
    investmentAccounts,
    otherAssetChanges,
    otherAssets,
    savingsForReconciliation,
    unexplained,
  };
}

export function computeNetWorthGrowth(input: NetWorthGrowthInput): MonthGrowthBreakdown[] {
  const sorted = [...input.monthlyHistory].sort((a, b) => a.yearMonth.localeCompare(b.yearMonth));
  return sorted.map((current, idx) =>
    computeMonthGrowth(current, idx > 0 ? sorted[idx - 1] : null, input),
  );
}

/**
 * Sum monthly breakdowns over a visible chart range. Savings rate is
 * totalGross / totalIncome over the range (not an average of rates).
 */
export function sumGrowthBreakdowns(
  months: MonthGrowthBreakdown[],
  rangeYearMonths?: string[],
): MonthGrowthBreakdown | null {
  const selected = rangeYearMonths
    ? months.filter((m) => rangeYearMonths.includes(m.yearMonth))
    : months;
  if (selected.length === 0) return null;
  if (selected.length === 1) return selected[0];

  const income = selected.reduce((s, m) => s + m.income, 0);
  const spending = selected.reduce((s, m) => s + m.spending, 0);
  const grossSavings = selected.reduce((s, m) => s + m.grossSavings, 0);
  const interestAndFees = selected.reduce((s, m) => s + m.interestAndFees, 0);
  const interestAndFeesIdentifiable = selected.some((m) => m.interestAndFeesIdentifiable);
  const interestAndFeesMissingNote =
    !interestAndFeesIdentifiable && selected.some((m) => m.interestAndFeesMissingNote);
  const netSavings = interestAndFeesIdentifiable ? grossSavings - interestAndFees : null;
  const savingsForReconciliation = netSavings ?? grossSavings;

  const debtBySlug = new Map<string, DebtGrowthAccount>();
  for (const m of selected) {
    for (const acc of m.debtAccounts) {
      const prev = debtBySlug.get(acc.slug);
      if (!prev) {
        debtBySlug.set(acc.slug, { ...acc });
        continue;
      }
      prev.paid += acc.paid;
      prev.newCharges += acc.newCharges;
      prev.interestAndFees += acc.interestAndFees;
      prev.paydown += acc.paydown;
      prev.amount += acc.amount;
      prev.usedActivity = prev.usedActivity || acc.usedActivity;
    }
  }

  const investBySlug = new Map<string, InvestmentGrowthAccount>();
  for (const m of selected) {
    for (const acc of m.investmentAccounts) {
      const prev = investBySlug.get(acc.slug);
      if (!prev) {
        investBySlug.set(acc.slug, { ...acc });
        continue;
      }
      prev.delta += acc.delta;
      prev.amount += acc.amount;
      if (prev.split === "split" && acc.split === "split") {
        prev.contributions = (prev.contributions ?? 0) + (acc.contributions ?? 0);
        prev.withdrawals = (prev.withdrawals ?? 0) + (acc.withdrawals ?? 0);
        prev.marketGrowth = (prev.marketGrowth ?? 0) + (acc.marketGrowth ?? 0);
      } else if (prev.split === "unsplit" && acc.split === "unsplit") {
        // keep unsplit
      } else {
        // Mixed months: don't guess a split for the combined window.
        prev.split = "unsplit";
        prev.contributions = null;
        prev.withdrawals = null;
        prev.marketGrowth = null;
      }
    }
  }

  const otherBySlug = new Map<string, GrowthAccountLine>();
  for (const m of selected) {
    for (const acc of m.otherAssets) {
      const prev = otherBySlug.get(acc.slug);
      if (!prev) {
        otherBySlug.set(acc.slug, { ...acc });
        continue;
      }
      prev.amount += acc.amount;
    }
  }

  const debtPaydown = selected.reduce((s, m) => s + m.debtPaydown, 0);
  const investmentDelta = selected.reduce((s, m) => s + m.investmentDelta, 0);
  const investmentContributions = selected.reduce((s, m) => s + m.investmentContributions, 0);
  const investmentWithdrawals = selected.reduce((s, m) => s + m.investmentWithdrawals, 0);
  const investmentMarketGrowth = selected.reduce((s, m) => s + m.investmentMarketGrowth, 0);
  const investmentUnsplit = selected.reduce((s, m) => s + m.investmentUnsplit, 0);
  const otherAssetChanges = selected.reduce((s, m) => s + m.otherAssetChanges, 0);

  const changes = selected.map((m) => m.netWorthChange);
  const netWorthChange = changes.every((c) => c === null)
    ? null
    : changes.reduce<number>((s, c) => s + (c ?? 0), 0);
  const unexplained =
    netWorthChange === null
      ? null
      : netWorthChange -
        (savingsForReconciliation + debtPaydown + investmentDelta + otherAssetChanges);

  const last = selected[selected.length - 1];

  return {
    yearMonth: last.yearMonth,
    netWorthChange,
    hasPreviousMonth: selected.some((m) => m.hasPreviousMonth),
    income,
    spending,
    grossSavings,
    savingsRate: income > 0 ? grossSavings / income : null,
    interestAndFees,
    interestAndFeesIdentifiable,
    interestAndFeesMissingNote,
    netSavings,
    debtPaydown,
    debtAccounts: [...debtBySlug.values()],
    investmentDelta,
    investmentContributions,
    investmentWithdrawals,
    investmentMarketGrowth,
    investmentUnsplit,
    investmentAccounts: [...investBySlug.values()],
    otherAssetChanges,
    otherAssets: [...otherBySlug.values()],
    savingsForReconciliation,
    unexplained,
  };
}

/** Range caption for the Growth tab, e.g. "Sep 2026 – Nov 2026". */
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
