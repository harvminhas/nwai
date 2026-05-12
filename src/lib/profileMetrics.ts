/**
 * Profile Metrics — pure computation functions over FinancialProfileCache.
 *
 * Architecture principle:
 *   • getFinancialProfile()  → central location for DATA  (cache read/write)
 *   • profileMetrics         → central location for LOGIC (derived computations)
 *
 * All API routes and pages that need a financial metric call one of these
 * functions instead of re-implementing the logic inline. This guarantees
 * identical numbers everywhere — the same way the cache guarantees identical
 * raw data everywhere.
 *
 * All functions are pure: they take a FinancialProfileCache and return a value.
 * No Firestore reads, no side effects.
 */

import type { FinancialProfileCache } from "./financialProfile";

// ── Shared types ──────────────────────────────────────────────────────────────

/** A single account row in the Net Worth card breakdown. */
export interface NetWorthAccount {
  label: string;
  /** Positive value (display amount) */
  value: number;
  /** True when the balance comes from a stale statement, not an up-to-date upload */
  isEstimated: boolean;
}

/** Full net worth result — suitable for the card display and the Overview page KPIs. */
export interface NetWorthResult {
  /** Assets − Liabilities (the headline figure), in homeCurrency */
  total: number;
  /** Sum of all asset-side account balances + manual assets, in homeCurrency */
  totalAssets: number;
  /** Sum of all liability-side account balances, in homeCurrency */
  totalDebts: number;
  accounts: NetWorthAccount[];
  debtAccounts: NetWorthAccount[];
  calculatedLabel: string;
  isStale: boolean;
  /** ISO-4217 home currency code — the currency all totals are expressed in */
  homeCurrency: string;
  /**
   * FX rates applied when aggregating: maps foreignCcy → rate.
   * e.g. { "CAD": 0.72 } means 1 CAD = 0.72 USD.
   * Empty when all accounts are already in homeCurrency.
   */
  fxRatesApplied: Record<string, number>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const ASSET_TYPES = new Set(["checking", "savings", "cash", "investment"]);


type Snap = FinancialProfileCache["accountSnapshots"][0];

function accountLabel(snap: Snap): string {
  const name = (snap.accountName ?? snap.bankName ?? "").toLowerCase();
  const type = (snap.accountType ?? "").toLowerCase();
  if (name.includes("tfsa"))  return "TFSA";
  if (name.includes("rrsp"))  return "RRSP";
  if (name.includes("fhsa"))  return "FHSA";
  if (name.includes("resp"))  return "RESP";
  if (type === "checking")    return "Chequing";
  if (type === "savings")     return "Savings";
  if (type === "investment")  return "Investments";
  if (type === "cash")        return "Cash";
  return snap.bankName || "Account";
}

/** Statement period (YYYY-MM) shown as a month name — not a specific calendar day. */
function statementCoverageMonthLabel(yearMonth: string): string {
  if (!/^\d{4}-\d{2}$/.test(yearMonth)) return yearMonth.trim() || "latest statements";
  const y = parseInt(yearMonth.slice(0, 4), 10);
  const m = parseInt(yearMonth.slice(5, 7), 10) - 1;
  const d = new Date(y, m, 1);
  const currentYear = new Date().getFullYear();
  return d.toLocaleDateString("en-CA", currentYear === y ? { month: "long" } : { month: "short", year: "numeric" });
}

/** When the cached profile was last rebuilt (after upload / refresh). */
function profileRefreshedLabel(iso: string | undefined): string {
  if (!iso) return "";
  const refreshed = new Date(iso);
  if (Number.isNaN(refreshed.getTime())) return "";
  const now = new Date();
  const sameCalendarDay =
    refreshed.getFullYear() === now.getFullYear() &&
    refreshed.getMonth() === now.getMonth() &&
    refreshed.getDate() === now.getDate();
  if (sameCalendarDay) return "today";
  return refreshed.toLocaleDateString("en-CA", { month: "short", day: "numeric" });
}

function debtLabel(snap: Snap): string {
  const type = (snap.accountType ?? "").toLowerCase();
  const name = (snap.accountName ?? snap.bankName ?? "").toLowerCase();
  const last4 = snap.accountId?.slice(-4);
  const suffix = last4 ? ` ••••${last4}` : "";
  if (type === "mortgage")                          return `Mortgage${suffix}`;
  if (type === "heloc")                             return `HELOC${suffix}`;
  if (type === "loc" || type === "line of credit")  return `Line of Credit${suffix}`;
  if (type === "loan")                              return `Loan${suffix}`;
  if (type === "credit" || type === "credit card") {
    if (name.includes("visa"))       return `Visa${suffix}`;
    if (name.includes("mastercard")) return `Mastercard${suffix}`;
    if (name.includes("amex"))       return `Amex${suffix}`;
    return `Credit Card${suffix}`;
  }
  if (name.includes("mortgage")) return `Mortgage${suffix}`;
  if (name.includes("visa"))     return `Visa${suffix}`;
  if (name.includes("loan"))     return `Loan${suffix}`;
  return snap.bankName || "Debt";
}

// ── getNetWorth ───────────────────────────────────────────────────────────────

/**
 * Compute net worth from the financial profile cache.
 *
 * Net Worth = Total Assets − Total Liabilities
 *
 * Asset total   = positive-balance checking/savings/investment/cash accounts
 *               + manually added assets (house, car, RESP, etc.)
 * Liability total = all other account snapshots with a negative signed balance
 *                   (or explicit parsedDebts set by the AI parser)
 *
 * This mirrors the consolidateStatements() formula used by the Overview page:
 *   • If the AI parser explicitly set parsedAssets / parsedDebts → use those.
 *   • Otherwise split by sign of balance (the same fallback as consolidateStatements).
 *
 * @param profile       The cached financial profile (from getFinancialProfile).
 * @param referenceMonth YYYY-MM used to determine "stale" status (defaults to today).
 */
export function getNetWorth(
  profile: FinancialProfileCache,
  referenceMonth?: string,
): NetWorthResult {
  const refMonth = referenceMonth ?? todayYearMonth();

  // ── FX helper: convert a balance in any currency to home currency ────────
  const fxRates = profile.fxRates ?? {};
  const home = (profile.homeCurrency ?? "CAD").toUpperCase();
  // Track which foreign currencies were actually encountered during conversion
  const fxRatesApplied: Record<string, number> = {};
  function toHome(amount: number, currency?: string): number {
    const cur = (currency ?? home).toUpperCase();
    if (cur === home) return amount;
    const rate = fxRates[cur];
    if (rate) fxRatesApplied[cur] = rate;
    return rate ? amount * rate : amount; // fall back to 1:1 if rate missing
  }

  // ── Net worth total (mirrors consolidateStatements logic exactly) ────────
  let totalAssets = 0;
  let totalDebts  = 0;
  for (const snap of (profile.accountSnapshots ?? [])) {
    const cur = snap.currency ?? home;
    if (snap.parsedAssets != null || snap.parsedDebts != null) {
      totalAssets += toHome(snap.parsedAssets ?? 0, cur);
      totalDebts  += toHome(snap.parsedDebts  ?? 0, cur);
    } else {
      totalAssets += toHome(Math.max(0,  snap.balance), cur);
      totalDebts  += toHome(Math.max(0, -snap.balance), cur);
    }
  }
  const manualTotal = (profile.manualAssets ?? []).reduce((s, a) => s + a.value, 0);
  totalAssets += manualTotal;
  const total = totalAssets - totalDebts;

  // ── Account breakdown rows (display only — asset accounts + manual assets) ─
  const rowMap = new Map<string, { value: number; isEstimated: boolean }>();

  for (const snap of (profile.accountSnapshots ?? [])) {
    if (!ASSET_TYPES.has((snap.accountType ?? "").toLowerCase())) continue;
    if (snap.balance <= 0) continue;
    const label     = accountLabel(snap);
    const estimated = snap.statementMonth < refMonth;
    const cadBalance = toHome(snap.balance, snap.currency ?? home);
    const existing  = rowMap.get(label);
    if (existing) {
      existing.value      += cadBalance;
      existing.isEstimated = existing.isEstimated && estimated;
    } else {
      rowMap.set(label, { value: cadBalance, isEstimated: estimated });
    }
  }
  for (const asset of (profile.manualAssets ?? [])) {
    if (asset.value <= 0) continue;
    const label    = asset.label || asset.category || "Asset";
    const existing = rowMap.get(label);
    if (existing) { existing.value += asset.value; }
    else           { rowMap.set(label, { value: asset.value, isEstimated: false }); }
  }

  const accounts: NetWorthAccount[] = Array.from(rowMap.entries())
    .map(([label, { value, isEstimated }]) => ({ label, value, isEstimated }))
    .sort((a, b) => b.value - a.value);

  // ── Debt account rows (display only) ────────────────────────────────────
  // Each snapshot contributes its debt portion (parsedDebts when set, otherwise
  // max(0, -balance)) as a named row sorted by value descending.
  const debtRowMap = new Map<string, { value: number; isEstimated: boolean }>();
  for (const snap of (profile.accountSnapshots ?? [])) {
    const rawDebt = snap.parsedDebts != null
      ? snap.parsedDebts
      : Math.max(0, -snap.balance);
    if (rawDebt <= 0) continue;
    const debtAmt   = toHome(rawDebt, snap.currency ?? home);
    const label     = debtLabel(snap);
    const estimated = snap.statementMonth < refMonth;
    const existing  = debtRowMap.get(label);
    if (existing) {
      existing.value      += debtAmt;
      existing.isEstimated = existing.isEstimated && estimated;
    } else {
      debtRowMap.set(label, { value: debtAmt, isEstimated: estimated });
    }
  }
  const debtAccounts: NetWorthAccount[] = Array.from(debtRowMap.entries())
    .map(([label, { value, isEstimated }]) => ({ label, value, isEstimated }))
    .sort((a, b) => b.value - a.value);

  // ── Freshness ─────────────────────────────────────────────────────────────
  const latestMonth = profile.accountSnapshots
    .filter((s) => ASSET_TYPES.has((s.accountType ?? "").toLowerCase()) && s.balance > 0)
    .map((s) => s.statementMonth)
    .filter((m): m is string => typeof m === "string" && /^\d{4}-\d{2}$/.test(m))
    .sort()
    .pop() ?? "";
  // Without coverage, avoid "" < refMonth (always "stale") and bogus labels.
  const isStale = Boolean(latestMonth) && latestMonth < refMonth;
  const coverageLabel = statementCoverageMonthLabel(latestMonth);
  const refreshedPart = profileRefreshedLabel(profile.updatedAt);
  const calculatedLabel = isStale
    ? refreshedPart
      ? `Balances through ${coverageLabel} · refreshed ${refreshedPart}`
      : `Balances through ${coverageLabel}`
    : "Updated today";

  return { total, totalAssets, totalDebts, accounts, debtAccounts, calculatedLabel, isStale, homeCurrency: home, fxRatesApplied };
}

// ── getSavingsRate ─────────────────────────────────────────────────────────────

/**
 * Savings rate for a given month: (income − expenses) / income × 100.
 * Returns 0 if income is 0 or the month has no data.
 *
 * @param yearMonth  YYYY-MM. Defaults to the most recent month in the profile.
 */
export function getSavingsRate(profile: FinancialProfileCache, yearMonth?: string): number {
  const ym     = yearMonth ?? profile.latestTxMonth ?? "";
  const entry  = profile.monthlyHistory.find((h) => h.yearMonth === ym);
  if (!entry || entry.incomeTotal <= 0) return 0;
  // Use coreExpensesTotal (transfers excluded) for a meaningful savings rate,
  // falling back to expensesTotal if the core figure hasn't been computed yet.
  const exp = entry.coreExpensesTotal ?? entry.expensesTotal;
  return Math.round(((entry.incomeTotal - exp) / entry.incomeTotal) * 100);
}

// ── getLiquidAssets ────────────────────────────────────────────────────────────

/**
 * Total liquid balance: sum of positive checking + savings account balances.
 * Excludes investments, loans, and credit accounts.
 */
export function getLiquidAssets(profile: FinancialProfileCache): number {
  const LIQUID = new Set(["checking", "savings"]);
  return profile.accountSnapshots
    .filter((s) => LIQUID.has((s.accountType ?? "").toLowerCase()) && s.balance > 0)
    .reduce((sum, s) => sum + s.balance, 0);
}

// ── getMonthlyIncome ───────────────────────────────────────────────────────────

/**
 * Total income for a given month from the profile's monthly history.
 * @param yearMonth  YYYY-MM. Defaults to the most recent month.
 */
export function getMonthlyIncome(profile: FinancialProfileCache, yearMonth?: string): number {
  const ym    = yearMonth ?? profile.latestTxMonth ?? "";
  const entry = profile.monthlyHistory.find((h) => h.yearMonth === ym);
  return entry?.incomeTotal ?? 0;
}

/**
 * Income for a month including Transfer In / Other-category credits (still excludes
 * inter-account transfer heuristics). Falls back to {@link getMonthlyIncome} when unset.
 */
export function getMonthlyIncomeAllCredits(profile: FinancialProfileCache, yearMonth?: string): number {
  const ym    = yearMonth ?? profile.latestTxMonth ?? "";
  const entry = profile.monthlyHistory.find((h) => h.yearMonth === ym);
  if (entry?.incomeTotalAllCredits != null) return entry.incomeTotalAllCredits;
  return entry?.incomeTotal ?? 0;
}

// ── getMonthlyExpenses ─────────────────────────────────────────────────────────

/**
 * Total expenses for a given month.
 * Pass `core: true` to exclude transfers and debt payments (same as CORE_EXCLUDE_RE).
 */
export function getMonthlyExpenses(
  profile: FinancialProfileCache,
  yearMonth?: string,
  options?: { core?: boolean },
): number {
  const ym    = yearMonth ?? profile.latestTxMonth ?? "";
  const entry = profile.monthlyHistory.find((h) => h.yearMonth === ym);
  if (!entry) return 0;
  return options?.core ? entry.coreExpensesTotal : entry.expensesTotal;
}

// ── Month pickers (Today hero, insights) ─────────────────────────────────────
// Statement periods are usually full calendar months; include the current month
// so a freshly uploaded May statement surfaces May even when "today" is still in May.

function todayYearMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

/** Latest month row with core income, or null. */
export function getLatestMonthWithIncome(profile: FinancialProfileCache): string | null {
  const hit = [...profile.monthlyHistory]
    .filter((h) => h.incomeTotal > 0)
    .sort((a, b) => b.yearMonth.localeCompare(a.yearMonth))[0];
  return hit?.yearMonth ?? null;
}

/** Latest month row with core (non-transfer) spend, or null. */
export function getLatestMonthWithCoreExpenses(profile: FinancialProfileCache): string | null {
  const hit = [...profile.monthlyHistory]
    .filter((h) => h.coreExpensesTotal > 0)
    .sort((a, b) => b.yearMonth.localeCompare(a.yearMonth))[0];
  return hit?.yearMonth ?? null;
}

/**
 * Latest month with both payroll-style income and core spend — ideal single month for savings rate.
 * Uploads are typically full statement months, so this is the common case.
 */
export function getLatestMonthWithIncomeAndCoreExpenses(profile: FinancialProfileCache): string | null {
  const hit = [...profile.monthlyHistory]
    .filter((h) => h.incomeTotal > 0 && h.coreExpensesTotal > 0)
    .sort((a, b) => b.yearMonth.localeCompare(a.yearMonth))[0];
  return hit?.yearMonth ?? null;
}

/**
 * Month to use for “top spending” categories: prefer core spend; else any expense volume.
 */
export function getLatestMonthForTopSpending(profile: FinancialProfileCache): string {
  const core = getLatestMonthWithCoreExpenses(profile);
  if (core) return core;
  const any = [...profile.monthlyHistory]
    .filter((h) => h.expensesTotal > 0)
    .sort((a, b) => b.yearMonth.localeCompare(a.yearMonth))[0];
  if (any) return any.yearMonth;
  return getLatestCompleteMonth(profile);
}

/**
 * One YYYY-MM for callers that cannot split income vs expense months.
 * Prefers a full “statement month” with both income and core spend, else income month, else spend month.
 */
export function getLatestCompleteMonth(profile: FinancialProfileCache): string {
  const both = getLatestMonthWithIncomeAndCoreExpenses(profile);
  if (both) return both;
  const inc = getLatestMonthWithIncome(profile);
  if (inc) return inc;
  const exp = getLatestMonthWithCoreExpenses(profile);
  if (exp) return exp;
  return profile.latestTxMonth ?? todayYearMonth();
}

/**
 * Typical (median) monthly core spend from the profile cache.
 * Pre-computed during cache build — same figure used by the spending page.
 */
export function getTypicalMonthlySpend(profile: FinancialProfileCache): number {
  return profile.typicalMonthly?.median ?? 0;
}

/**
 * Typical (median) monthly income across all historical months.
 * Uses the same monthlyHistory as every other income figure in the app.
 */
export function getTypicalMonthlyIncome(profile: FinancialProfileCache): number {
  const vals = profile.monthlyHistory
    .map((h) => h.incomeTotal)
    .filter((v) => v > 0)
    .sort((a, b) => a - b);
  if (vals.length === 0) return 0;
  const mid = Math.floor(vals.length / 2);
  return vals.length % 2 !== 0 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2;
}

/**
 * Typical (median) monthly minimum debt payments across all historical months.
 * Falls back to the most recent month with debt payments if history is thin.
 */
export function getTypicalMonthlyDebtPayments(profile: FinancialProfileCache): number {
  const vals = profile.monthlyHistory
    .map((h) => h.minDebtPaymentsTotal ?? 0)
    .filter((v) => v > 0)
    .sort((a, b) => a - b);
  if (vals.length === 0) return 0;
  const mid = Math.floor(vals.length / 2);
  return vals.length % 2 !== 0 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2;
}

// ── getMonthlyDebtPayments ─────────────────────────────────────────────────────

/**
 * Minimum/scheduled debt payments for a given month.
 * Used by the SavingsRateCard where "obligated minimum" is the right concept.
 *
 * Falls back to the most recent month with debt payments when the requested
 * month has no data (e.g. checking statement not yet uploaded).
 */
export function getMonthlyDebtPayments(profile: FinancialProfileCache, yearMonth?: string): number {
  const ym    = yearMonth ?? profile.latestTxMonth ?? "";
  const entry = profile.monthlyHistory.find((h) => h.yearMonth === ym);
  if (entry?.minDebtPaymentsTotal) return entry.minDebtPaymentsTotal;

  // Fall back to most recent month with debt payments
  const fallback = [...profile.monthlyHistory]
    .sort((a, b) => b.yearMonth.localeCompare(a.yearMonth))
    .find((h) => (h.minDebtPaymentsTotal ?? 0) > 0);
  return fallback?.minDebtPaymentsTotal ?? 0;
}

/**
 * Total actual debt payments made in a given month (all transactions, not just minimum).
 * Use this for "total spending including debt" KPI figures where you want the real
 * amount paid, not the obligated minimum.
 */
export function getMonthlyAllDebtPayments(profile: FinancialProfileCache, yearMonth?: string): number {
  const ym    = yearMonth ?? profile.latestTxMonth ?? "";
  const entry = profile.monthlyHistory.find((h) => h.yearMonth === ym);
  return entry?.debtPaymentsTotal ?? 0;
}
