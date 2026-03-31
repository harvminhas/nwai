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
   * ordered for display in the Net Worth card.
   */
  accounts: NetWorthAccount[];
  /** Human-readable freshness string, e.g. "Updated today" or "Last calculated Jan 15" */
  calculatedLabel: string;
  /** True when the most recent account data is older than referenceMonth */
  isStale: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const ASSET_TYPES = new Set(["checking", "savings", "cash", "investment"]);

const LABEL_ORDER: Record<string, number> = {
  Chequing: 0, Savings: 1, Cash: 2, FHSA: 3, TFSA: 4, RRSP: 5, RESP: 6, Investments: 7,
};

function accountLabel(snap: FinancialProfileCache["accountSnapshots"][0]): string {
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

  // ── Net worth total (mirrors consolidateStatements logic exactly) ────────
  let totalAssets = 0;
  let totalDebts  = 0;
  for (const snap of profile.accountSnapshots) {
    if (snap.parsedAssets != null || snap.parsedDebts != null) {
      totalAssets += snap.parsedAssets ?? 0;
      totalDebts  += snap.parsedDebts  ?? 0;
    } else {
      totalAssets += Math.max(0,  snap.balance);
      totalDebts  += Math.max(0, -snap.balance);
    }
  }
  const manualTotal = (profile.manualAssets ?? []).reduce((s, a) => s + a.value, 0);
  totalAssets += manualTotal;
  const total = totalAssets - totalDebts;

  // ── Account breakdown rows (display only — asset accounts + manual assets) ─
  const rowMap = new Map<string, { value: number; isEstimated: boolean }>();

  for (const snap of profile.accountSnapshots) {
    if (!ASSET_TYPES.has((snap.accountType ?? "").toLowerCase())) continue;
    if (snap.balance <= 0) continue;
    const label     = accountLabel(snap);
    const estimated = snap.statementMonth < refMonth;
    const existing  = rowMap.get(label);
    if (existing) {
      existing.value      += snap.balance;
      existing.isEstimated = existing.isEstimated && estimated;
    } else {
      rowMap.set(label, { value: snap.balance, isEstimated: estimated });
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
    .sort((a, b) => {
      const oa = LABEL_ORDER[a.label] ?? 10;
      const ob = LABEL_ORDER[b.label] ?? 10;
      return oa !== ob ? oa - ob : b.value - a.value;
    });

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

  return { total, totalAssets, totalDebts, accounts, calculatedLabel, isStale };
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
  return Math.round(((entry.incomeTotal - entry.expensesTotal) / entry.incomeTotal) * 100);
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

// ── getTypicalMonthlySpend ─────────────────────────────────────────────────────

/**
 * Typical (median) monthly core spend from the profile cache.
 * Pre-computed during cache build — same figure used by the spending page.
 */
export function getTypicalMonthlySpend(profile: FinancialProfileCache): number {
  return profile.typicalMonthly?.median ?? 0;
}

// ── Internal helper ───────────────────────────────────────────────────────────

function todayYearMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}
