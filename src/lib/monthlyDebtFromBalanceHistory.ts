import type { AccountBalanceHistory } from "@/lib/financialProfile";

export type DebtTotalByMonthPoint = {
  yearMonth: string;
  debtTotal: number;
};

/** Debt account types consolidated into debt totals (+ negative-balance fallback). */
const DEBT_HISTORY_TYPES = new Set(["credit", "mortgage", "loan", "line_of_credit"]);

/**
 * Same rollup as Liabilities · Debt Growth: per-account last-known balance (carry‑forward),
 * summed in home currency. Matches `debts`/snapshots better than `consolidated.history[].debtTotal`
 * when early months lacked full statement coverage.
 *
 * When `slugFilter` is non-null non-empty, only those liability slugs are included.
 */
export function monthlyDebtTotalsFromBalanceHistory(
  rows: AccountBalanceHistory[] | undefined,
  fxRates: Record<string, number>,
  homeCurrency: string,
  slugFilter: Set<string> | null,
): DebtTotalByMonthPoint[] {
  let debtBalHist = (rows ?? []).filter(
    (h) => DEBT_HISTORY_TYPES.has(h.accountType) || h.entries.some((e) => e.balance < 0),
  );
  if (slugFilter !== null && slugFilter.size > 0) {
    debtBalHist = debtBalHist.filter((h) => slugFilter.has(h.slug));
  }
  const homeU = homeCurrency.toUpperCase();
  function toHome(amount: number, ccy?: string): number {
    const cur = (ccy ?? homeU).toUpperCase();
    if (cur === homeU) return amount;
    const rate = fxRates[cur];
    return rate != null ? amount * rate : amount;
  }
  const months = Array.from(new Set(debtBalHist.flatMap((h) => h.entries.map((e) => e.yearMonth))))
    .sort();

  const out: DebtTotalByMonthPoint[] = [];
  for (const ym of months) {
    let total = 0;
    for (const acct of debtBalHist) {
      const pts = acct.entries.filter((e) => e.yearMonth <= ym);
      if (pts.length > 0) {
        total += toHome(Math.abs(pts[pts.length - 1].balance), acct.currency);
      }
    }
    if (total > 0) out.push({ yearMonth: ym, debtTotal: total });
  }
  return out;
}
