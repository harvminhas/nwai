/**
 * Net Worth Growth — display-only flow decomposition of a month's (or
 * range's) net-worth change.
 *
 * Spending is `coreExpensesTotal`: transfers and Card Servicing are excluded;
 * installment-loan payments, fees, and card *charges* are included.
 *
 * Flow identity (never drop the remainder):
 *
 *   ΔNW = savings (income − spending)
 *       − interest/fees NOT already in spending   (e.g. CC "Interest")
 *       + principal portion of installment payments already in spending
 *       + investment market growth                (split accounts only)
 *       + other asset revaluation
 *       + new accounts (first statement)
 *       + Other/unexplained
 *
 * Card/LOC paydown and investment contributions are a separate
 * "Where your savings went" allocation (cash kept, debt paid down, invested).
 * They are NOT added into the reconciliation total — savings already holds
 * that money because those outflows are not spending.
 *
 * Fees (Bank / NSF / annual card) and mortgage interest inside an installment
 * payment ARE in spending: do not subtract them again.
 *
 * CSV and PDF transactions use the same ExpenseTxnRecord / IncomeTxnRecord
 * shape — there is no source split.
 */

import { getParentCategory } from "./categoryTaxonomy";
import { resolveDebtHeaderActivity } from "./debtHeaderActivity";
import { isCoreExcluded } from "./spendingMetrics";
import type { DebtPaymentHistoryEntry, ExpenseTxnRecord, IncomeTxnRecord } from "./extractTransactions";
import type { MonthlyHistoryEntry } from "./financialProfile";

const REVOLVING_TYPES = new Set(["credit", "credit_card", "line_of_credit", "loc"]);
const INSTALLMENT_TYPES = new Set([
  "mortgage",
  "loan",
  "auto_loan",
  "student_loan",
  "personal_loan",
]);
const MANUAL_DEBT_CATEGORIES = new Set([
  "mortgage",
  "auto_loan",
  "student_loan",
  "personal_loan",
  "credit_card",
  "line_of_credit",
]);
const REGISTERED_INVESTMENT_RE =
  /\b(tfsa|rrsp|resp|fhsa|rdsp|401k|401\(k\)|ira|roth|hsa|529)\b/i;

export type InvestmentSplit = "split" | "unsplit";
export type DebtKind = "revolving" | "installment";

export interface GrowthAccountLine {
  slug: string;
  label: string;
  type: string;
  amount: number;
}

export interface DebtGrowthAccount extends GrowthAccountLine {
  kind: DebtKind;
  paid: number;
  newCharges: number;
  interestAndFees: number;
  /** paid − new spending charges (interest not in spending is excluded). */
  paydown: number;
  /** Signed byAccount delta — installment principal add-back uses this. */
  principalChange: number;
  usedActivity: boolean;
  isBaseline: boolean;
}

export interface InvestmentGrowthAccount extends GrowthAccountLine {
  delta: number;
  contributions: number | null;
  withdrawals: number | null;
  marketGrowth: number | null;
  split: InvestmentSplit;
  isBaseline: boolean;
}

export interface MonthGrowthBreakdown {
  yearMonth: string;
  netWorthChange: number | null;
  hasPreviousMonth: boolean;

  income: number;
  spending: number;
  grossSavings: number;
  savingsRate: number | null;

  /** Interest (core-excluded) on debt statements — NOT fees already in spending. */
  interestFeesNotInSpending: number;
  interestAndFeesIdentifiable: boolean;
  interestAndFeesMissingNote: boolean;
  /** Gross − interestFeesNotInSpending when that interest is identifiable. */
  netSavings: number | null;

  installmentPrincipalAddBack: number;
  installmentAccounts: DebtGrowthAccount[];

  revolvingPaydown: number;
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

  newAccountsTotal: number;
  newAccounts: GrowthAccountLine[];

  /**
   * Investments & Savings already in spending that also landed as split
   * contributions — added back so those outflows don't open a hole in ΔNW.
   */
  spendingInvestmentAddBack: number;

  /** Residual of gross savings after revolving paydown and invested contributions. */
  cashKept: number;
  investedFromSavings: number;

  /** Gross savings — interest is a separate recon term. */
  savingsForReconciliation: number;
  unexplained: number | null;
}

export type GrowthExpenseTxn = Pick<
  ExpenseTxnRecord,
  "txMonth" | "amount" | "category" | "accountSlug"
> &
  Partial<Pick<ExpenseTxnRecord, "installmentInterestAmount" | "currency" | "debtType" | "merchant">>;

export type GrowthIncomeTxn = Pick<IncomeTxnRecord, "txMonth" | "amount" | "accountSlug"> &
  Partial<Pick<IncomeTxnRecord, "currency" | "category">>;

export interface NetWorthGrowthInput {
  monthlyHistory: MonthlyHistoryEntry[];
  expenseTxns: GrowthExpenseTxn[];
  incomeTxns: GrowthIncomeTxn[];
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

function normalizeType(type: string): string {
  return type.toLowerCase().startsWith("manual-")
    ? type.toLowerCase().slice("manual-".length)
    : type.toLowerCase();
}

/** Debt by declared account type only — an overdrawn chequing account is not debt. */
export function isDebtAccountType(type: string, _value?: number): boolean {
  const t = normalizeType(type);
  if (REVOLVING_TYPES.has(t) || INSTALLMENT_TYPES.has(t)) return true;
  return type.toLowerCase().startsWith("manual-") && MANUAL_DEBT_CATEGORIES.has(t);
}

export function isRevolvingDebtType(type: string): boolean {
  return REVOLVING_TYPES.has(normalizeType(type));
}

export function isInstallmentDebtType(type: string): boolean {
  return INSTALLMENT_TYPES.has(normalizeType(type));
}

/**
 * Investment / registered accounts eligible for contribution vs market split.
 * Bank `savings` counts only when the label is a TFSA/RRSP/etc.
 */
export function isInvestmentAccountType(type: string, label?: string): boolean {
  const t = normalizeType(type);
  if (t === "investment") return true;
  if (t === "savings" && label && REGISTERED_INVESTMENT_RE.test(label)) return true;
  return false;
}

export function isManualAssetSlug(slug: string, type: string): boolean {
  return slug.startsWith("manual-") && !isDebtAccountType(type);
}

export function isInterestOrFeeCategory(category: string): boolean {
  const parent = getParentCategory(category);
  return parent === "Interest" || parent === "Fees";
}

/** Core-excluded interest (not Fees, not installment interest already in the payment). */
export function isInterestNotInSpending(category: string): boolean {
  return isCoreExcluded(category) && getParentCategory(category) === "Interest";
}

function countsAsCoreIncome(category?: string): boolean {
  const c = (category ?? "Other").trim().toLowerCase();
  return c !== "transfer" && c !== "transfer in" && c !== "other";
}

function bySlug(accounts: MonthlyHistoryEntry["byAccount"]): Map<string, NonNullable<MonthlyHistoryEntry["byAccount"]>[number]> {
  return new Map((accounts ?? []).map((a) => [a.slug, a]));
}

export function flowExplained(b: Pick<
  MonthGrowthBreakdown,
  | "savingsForReconciliation"
  | "interestFeesNotInSpending"
  | "installmentPrincipalAddBack"
  | "spendingInvestmentAddBack"
  | "investmentMarketGrowth"
  | "otherAssetChanges"
  | "newAccountsTotal"
  | "unexplained"
>): number {
  return (
    b.savingsForReconciliation -
    b.interestFeesNotInSpending +
    b.installmentPrincipalAddBack +
    b.spendingInvestmentAddBack +
    b.investmentMarketGrowth +
    b.otherAssetChanges +
    b.newAccountsTotal +
    (b.unexplained ?? 0)
  );
}

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
  const currentMap = bySlug(current.byAccount);
  const previousMap = bySlug(previous?.byAccount);
  const allSlugs = new Set([...currentMap.keys(), ...previousMap.keys()]);

  const debtSlugs = new Set<string>();
  const investmentSlugs = new Set<string>();
  for (const slug of allSlugs) {
    const row = currentMap.get(slug) ?? previousMap.get(slug);
    if (!row) continue;
    if (isDebtAccountType(row.type)) debtSlugs.add(slug);
    if (isInvestmentAccountType(row.type, row.label)) investmentSlugs.add(slug);
  }

  const monthExpenses = input.expenseTxns.filter((t) => t.txMonth === month);
  const monthIncome = input.incomeTxns.filter((t) => t.txMonth === month);

  const investmentCoreIncome = monthIncome
    .filter((t) => investmentSlugs.has(t.accountSlug) && countsAsCoreIncome(t.category))
    .reduce((sum, t) => sum + convert(Math.abs(t.amount), t.currency), 0);
  const income = Math.max(0, (current.incomeTotal ?? 0) - investmentCoreIncome);
  const spending = current.coreExpensesTotal ?? 0;
  const grossSavings = income - spending;
  const savingsRate = income > 0 ? grossSavings / income : null;

  let interestFeesNotInSpending = 0;
  let identifiableHits = 0;
  for (const t of monthExpenses) {
    const onDebt = debtSlugs.has(t.accountSlug);
    if (onDebt && isInterestNotInSpending(t.category)) {
      identifiableHits += 1;
      interestFeesNotInSpending += convert(Math.abs(t.amount), t.currency);
    } else if (isInterestOrFeeCategory(t.category) || (t.installmentInterestAmount ?? 0) > 0) {
      // Fees and installment interest are already in spending — do not subtract,
      // but they count as itemized so we don't show the "missing interest" note.
      identifiableHits += 1;
    }
  }
  const interestAndFeesIdentifiable = identifiableHits > 0;
  const netSavings =
    interestFeesNotInSpending > 0 ? grossSavings - interestFeesNotInSpending : null;

  const debtAccounts: DebtGrowthAccount[] = [];
  let revolvingPaydown = 0;
  let installmentPrincipalAddBack = 0;
  let debtPaydown = 0;

  for (const slug of [...debtSlugs].sort()) {
    const currentRow = currentMap.get(slug);
    const previousRow = previousMap.get(slug);
    const type = currentRow?.type || previousRow?.type || "credit";
    const label = currentRow?.label || previousRow?.label || slug;
    const isBaseline = previousRow === undefined && currentRow !== undefined;
    const kind: DebtKind = isRevolvingDebtType(type) ? "revolving" : "installment";

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

    const accountInterest = debtExpenses.reduce((sum, t) => {
      if (isInterestOrFeeCategory(t.category)) return sum + convert(Math.abs(t.amount), t.currency);
      const inst = t.installmentInterestAmount ?? 0;
      return inst > 0 ? sum + convert(inst, t.currency) : sum;
    }, 0);
    const accountInterestNotInSpending = debtExpenses.reduce((sum, t) => {
      if (isInterestNotInSpending(t.category)) return sum + convert(Math.abs(t.amount), t.currency);
      return sum;
    }, 0);

    const balanceDelta = (currentRow?.value ?? 0) - (previousRow?.value ?? 0);
    const principalChange = isBaseline ? 0 : balanceDelta;
    // Interest not in spending is a separate recon term — don't treat it as a
    // new charge that savings "paid for".
    const newChargesInSpending = Math.max(0, newCharges - accountInterestNotInSpending);

    let paydown = 0;
    if (!isBaseline) {
      paydown = usedActivity ? paid - newChargesInSpending : balanceDelta;
    }

    debtPaydown += paydown;
    if (!isBaseline && kind === "revolving") revolvingPaydown += paydown;
    if (!isBaseline && kind === "installment") installmentPrincipalAddBack += principalChange;

    debtAccounts.push({
      slug,
      label,
      type,
      amount: kind === "installment" ? principalChange : paydown,
      kind,
      paid,
      newCharges,
      interestAndFees: accountInterest,
      paydown,
      principalChange,
      usedActivity,
      isBaseline,
    });
  }

  const installmentAccounts = debtAccounts.filter((a) => a.kind === "installment" && !a.isBaseline);
  const interestAndFeesMissingNote =
    !interestAndFeesIdentifiable && debtAccounts.some((a) => a.usedActivity && !a.isBaseline);

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

    if (isBaseline) {
      investmentAccounts.push({
        slug,
        label,
        type,
        amount: 0,
        delta: 0,
        contributions: null,
        withdrawals: null,
        marketGrowth: null,
        split: "unsplit",
        isBaseline: true,
      });
      continue;
    }

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
        isBaseline: false,
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
        isBaseline: false,
      });
    }
  }

  const contributionsAlreadyInSpending = monthExpenses
    .filter((t) => {
      if (investmentSlugs.has(t.accountSlug) || debtSlugs.has(t.accountSlug)) return false;
      if (isCoreExcluded(t.category, { debtType: t.debtType, merchant: t.merchant })) return false;
      return getParentCategory(t.category) === "Investments & Savings";
    })
    .reduce((sum, t) => sum + convert(Math.abs(t.amount), t.currency), 0);
  const netSplitContributions = investmentContributions - investmentWithdrawals;
  const investedFromSavings = Math.max(0, netSplitContributions - contributionsAlreadyInSpending);
  // Only add back when the same dollars also appear as split contributions;
  // unsplit accounts leave the remainder in Other/unexplained.
  const spendingInvestmentAddBack = Math.min(
    contributionsAlreadyInSpending,
    Math.max(0, netSplitContributions),
  );

  const newAccounts: GrowthAccountLine[] = [];
  const otherAssets: GrowthAccountLine[] = [];
  let newAccountsTotal = 0;
  let otherAssetChanges = 0;

  for (const slug of [...allSlugs].sort()) {
    const currentRow = currentMap.get(slug);
    const previousRow = previousMap.get(slug);
    const type = currentRow?.type || previousRow?.type || "";
    const label = currentRow?.label || previousRow?.label || slug;
    const isBaseline = previousRow === undefined && currentRow !== undefined;

    if (isBaseline && currentRow) {
      newAccountsTotal += currentRow.value;
      newAccounts.push({ slug, label, type, amount: currentRow.value });
      continue;
    }

    if (!isManualAssetSlug(slug, type)) continue;
    const amount = (currentRow?.value ?? 0) - (previousRow?.value ?? 0);
    if (Math.abs(amount) < 0.005) continue;
    otherAssetChanges += amount;
    otherAssets.push({ slug, label, type, amount });
  }

  const cashKept = grossSavings - revolvingPaydown - investedFromSavings;
  const savingsForReconciliation = grossSavings;
  const netWorthChange = previous ? current.netWorth - previous.netWorth : null;
  const unexplained =
    netWorthChange === null
      ? null
      : netWorthChange -
        (savingsForReconciliation -
          interestFeesNotInSpending +
          installmentPrincipalAddBack +
          spendingInvestmentAddBack +
          investmentMarketGrowth +
          otherAssetChanges +
          newAccountsTotal);

  return {
    yearMonth: month,
    netWorthChange,
    hasPreviousMonth: previous != null,
    income,
    spending,
    grossSavings,
    savingsRate,
    interestFeesNotInSpending,
    interestAndFeesIdentifiable,
    interestAndFeesMissingNote,
    netSavings,
    installmentPrincipalAddBack,
    installmentAccounts,
    revolvingPaydown,
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
    newAccountsTotal,
    newAccounts,
    spendingInvestmentAddBack,
    cashKept,
    investedFromSavings,
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

function mergeDebt(into: Map<string, DebtGrowthAccount>, acc: DebtGrowthAccount) {
  const prev = into.get(acc.slug);
  if (!prev) {
    into.set(acc.slug, { ...acc });
    return;
  }
  prev.paid += acc.paid;
  prev.newCharges += acc.newCharges;
  prev.interestAndFees += acc.interestAndFees;
  prev.paydown += acc.paydown;
  prev.principalChange += acc.principalChange;
  prev.amount += acc.amount;
  prev.usedActivity = prev.usedActivity || acc.usedActivity;
  prev.isBaseline = prev.isBaseline && acc.isBaseline;
}

export function sumGrowthBreakdowns(
  months: MonthGrowthBreakdown[],
  rangeYearMonths?: string[],
): MonthGrowthBreakdown | null {
  const inRange = rangeYearMonths
    ? months.filter((m) => rangeYearMonths.includes(m.yearMonth))
    : months;
  if (inRange.length === 0) return null;
  // First history month has no ΔNW — it's the chart baseline, not a growth month.
  const selected = inRange.filter((m) => m.hasPreviousMonth);
  if (selected.length === 0) return inRange[0];
  if (selected.length === 1) return selected[0];

  const income = selected.reduce((s, m) => s + m.income, 0);
  const spending = selected.reduce((s, m) => s + m.spending, 0);
  const grossSavings = selected.reduce((s, m) => s + m.grossSavings, 0);
  const interestFeesNotInSpending = selected.reduce((s, m) => s + m.interestFeesNotInSpending, 0);
  const interestAndFeesIdentifiable = selected.some((m) => m.interestAndFeesIdentifiable);
  const interestAndFeesMissingNote =
    !interestAndFeesIdentifiable && selected.some((m) => m.interestAndFeesMissingNote);
  const netSavings = interestFeesNotInSpending > 0 ? grossSavings - interestFeesNotInSpending : null;

  const debtBySlug = new Map<string, DebtGrowthAccount>();
  for (const m of selected) {
    for (const acc of m.debtAccounts) mergeDebt(debtBySlug, acc);
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
      prev.isBaseline = prev.isBaseline && acc.isBaseline;
      if (prev.split === "split" && acc.split === "split") {
        prev.contributions = (prev.contributions ?? 0) + (acc.contributions ?? 0);
        prev.withdrawals = (prev.withdrawals ?? 0) + (acc.withdrawals ?? 0);
        prev.marketGrowth = (prev.marketGrowth ?? 0) + (acc.marketGrowth ?? 0);
      } else if (prev.split === "unsplit" && acc.split === "unsplit") {
        // keep
      } else {
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
      if (!prev) otherBySlug.set(acc.slug, { ...acc });
      else prev.amount += acc.amount;
    }
  }
  const newBySlug = new Map<string, GrowthAccountLine>();
  for (const m of selected) {
    for (const acc of m.newAccounts) {
      const prev = newBySlug.get(acc.slug);
      if (!prev) newBySlug.set(acc.slug, { ...acc });
      else prev.amount += acc.amount;
    }
  }

  const installmentPrincipalAddBack = selected.reduce((s, m) => s + m.installmentPrincipalAddBack, 0);
  const revolvingPaydown = selected.reduce((s, m) => s + m.revolvingPaydown, 0);
  const debtPaydown = selected.reduce((s, m) => s + m.debtPaydown, 0);
  const investmentDelta = selected.reduce((s, m) => s + m.investmentDelta, 0);
  const investmentContributions = selected.reduce((s, m) => s + m.investmentContributions, 0);
  const investmentWithdrawals = selected.reduce((s, m) => s + m.investmentWithdrawals, 0);
  const investmentMarketGrowth = selected.reduce((s, m) => s + m.investmentMarketGrowth, 0);
  const investmentUnsplit = selected.reduce((s, m) => s + m.investmentUnsplit, 0);
  const otherAssetChanges = selected.reduce((s, m) => s + m.otherAssetChanges, 0);
  const newAccountsTotal = selected.reduce((s, m) => s + m.newAccountsTotal, 0);
  const investedFromSavings = selected.reduce((s, m) => s + m.investedFromSavings, 0);
  const cashKept = selected.reduce((s, m) => s + m.cashKept, 0);
  const spendingInvestmentAddBack = selected.reduce((s, m) => s + m.spendingInvestmentAddBack, 0);
  const savingsForReconciliation = grossSavings;

  const changes = selected.map((m) => m.netWorthChange);
  const netWorthChange = changes.every((c) => c === null)
    ? null
    : changes.reduce<number>((s, c) => s + (c ?? 0), 0);
  const unexplained =
    netWorthChange === null
      ? null
      : netWorthChange -
        (savingsForReconciliation -
          interestFeesNotInSpending +
          installmentPrincipalAddBack +
          spendingInvestmentAddBack +
          investmentMarketGrowth +
          otherAssetChanges +
          newAccountsTotal);

  const last = selected[selected.length - 1];
  const debtAccounts = [...debtBySlug.values()];

  return {
    yearMonth: last.yearMonth,
    netWorthChange,
    hasPreviousMonth: selected.some((m) => m.hasPreviousMonth),
    income,
    spending,
    grossSavings,
    savingsRate: income > 0 ? grossSavings / income : null,
    interestFeesNotInSpending,
    interestAndFeesIdentifiable,
    interestAndFeesMissingNote,
    netSavings,
    installmentPrincipalAddBack,
    installmentAccounts: debtAccounts.filter((a) => a.kind === "installment" && !a.isBaseline),
    revolvingPaydown,
    debtPaydown,
    debtAccounts,
    investmentDelta,
    investmentContributions,
    investmentWithdrawals,
    investmentMarketGrowth,
    investmentUnsplit,
    investmentAccounts: [...investBySlug.values()],
    otherAssetChanges,
    otherAssets: [...otherBySlug.values()],
    newAccountsTotal,
    newAccounts: [...newBySlug.values()],
    spendingInvestmentAddBack,
    cashKept,
    investedFromSavings,
    savingsForReconciliation,
    unexplained,
  };
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
