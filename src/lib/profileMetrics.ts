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
  /** Assets − Liabilities (the headline figure) */
  total: number;
  /** Sum of all asset-side account balances + manual assets */
  totalAssets: number;
  /** Sum of all liability-side account balances */
  totalDebts: number;
  /**
   * Asset accounts + manual assets consolidated by canonical label,
   * sorted by value descending.
   */
  accounts: NetWorthAccount[];
  /**
   * Liability accounts (mortgage, credit cards, loans) sorted by value descending.
   * Values are positive — they represent what is owed.
   */
  debtAccounts: NetWorthAccount[];
  /** Human-readable freshness string, e.g. "Updated today" or "Last calculated Jan 15" */
  calculatedLabel: string;
  /** True when the most recent account data is older than referenceMonth */
  isStale: boolean;
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

  // ── FX helper: convert a balance in any currency to CAD ─────────────────
  const fxRates = profile.fxRates ?? {};
  function toCAD(amount: number, currency?: string): number {
    if (!currency || currency === "CAD") return amount;
    const rate = fxRates[currency.toUpperCase()];
    return rate ? amount * rate : amount; // fall back to 1:1 if rate missing
  }

  // ── Net worth total (mirrors consolidateStatements logic exactly) ────────
  let totalAssets = 0;
  let totalDebts  = 0;
  for (const snap of (profile.accountSnapshots ?? [])) {
    const cur = snap.currency ?? "CAD";
    if (snap.parsedAssets != null || snap.parsedDebts != null) {
      totalAssets += toCAD(snap.parsedAssets ?? 0, cur);
      totalDebts  += toCAD(snap.parsedDebts  ?? 0, cur);
    } else {
      totalAssets += toCAD(Math.max(0,  snap.balance), cur);
      totalDebts  += toCAD(Math.max(0, -snap.balance), cur);
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
    const cadBalance = toCAD(snap.balance, snap.currency ?? "CAD");
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
    const debtAmt   = toCAD(rawDebt, snap.currency ?? "CAD");
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
    .sort()
    .pop() ?? "";
  const isStale = latestMonth < refMonth;
  const calculatedLabel = isStale
    ? `Last calculated ${new Date(latestMonth + "-01").toLocaleDateString("en-CA", { month: "short", day: "numeric" })}`
    : "Updated today";

  return { total, totalAssets, totalDebts, accounts, debtAccounts, calculatedLabel, isStale };
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

// ── getLatestCompleteMonth ─────────────────────────────────────────────────────

/**
 * Return the most recent YYYY-MM to use for the savings-rate / income-expenses display.
 *
 * Strategy:
 *  1. Start from `profile.latestTxMonth` — this is the last month with ANY transaction.
 *  2. If that month is the current calendar month (always partial), step back to the
 *     previous month.
 *  3. If no history entry is found at all, fall back to latestTxMonth.
 *
 * We intentionally do NOT require both income and expenses — a credit-card-only
 * statement produces expenses without income, which is still a valid complete month.
 */
export function getLatestCompleteMonth(profile: FinancialProfileCache): string {
  const now       = new Date();
  const currentYM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  // All history months sorted descending, excluding the current partial month
  const pastMonths = [...profile.monthlyHistory]
    .map((h) => h.yearMonth)
    .filter((ym) => ym < currentYM)
    .sort((a, b) => b.localeCompare(a));

  if (pastMonths.length > 0) return pastMonths[0];

  // The only data is from the current month — return it as-is
  return profile.latestTxMonth ?? currentYM;
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
 * Total minimum/scheduled debt payments for a given month.
 * Uses the same min/extra split as the Spending page debt card.
 * User tag overrides (min vs extra) are baked into the cache at build time.
 *
 * If the requested month has no debt payment data (e.g. checking account
 * statement not yet uploaded for that month), falls back to the most recent
 * month in history that has debt payments — so the savings rate toggle is
 * always available when the user has any debt obligations.
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


// ── Internal helper ───────────────────────────────────────────────────────────

function todayYearMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}
