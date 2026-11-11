/**
 * Header activity figures for a debt account's statement month.
 *
 * Payments that reduce a debt are stored as `paymentsMade` (parser + CSV),
 * not as `income`. Income is checking/savings only; on debt accounts it is a
 * legacy fallback when paymentsMade is missing.
 *
 * Figures are for the loaded statement month (headerYm / the month selected
 * on Balance Over Time). The chart 3M/6M/All range only changes which points
 * are visible — it does not aggregate these totals.
 */

export function txnCountLabel(count: number): string {
  return count === 1 ? "1 transaction" : `${count} transactions`;
}

const AMOUNT_EPS = 0.01;

export function monthAbbrev(yearMonth: string): string {
  const [y, m] = yearMonth.split("-");
  if (!m) return yearMonth;
  return new Date(parseInt(y, 10), parseInt(m, 10) - 1, 1)
    .toLocaleDateString("en-US", { month: "short" });
}

export type DebtHeaderFigure = {
  amount: number;
  count: number;
};

export function resolveDebtHeaderActivity(input: {
  paymentsMade: number;
  incomeTotal: number;
  incomeTxnCount: number;
  expensesTotal: number;
  expensesTxnCount: number;
}): {
  paid: DebtHeaderFigure | null;
  newCharges: DebtHeaderFigure | null;
} {
  const paymentsMade = input.paymentsMade > 0 ? input.paymentsMade : 0;
  const incomeTotal = input.incomeTotal > 0 ? input.incomeTotal : 0;
  const paidAmount = paymentsMade > 0 ? paymentsMade : incomeTotal;

  // Itemized payment rows only exist when credits were stored as income
  // (legacy). The canonical paymentsMade field is a period total, so we show
  // a count only when income transactions clearly represent that same total.
  const incomeMatchesPaid =
    paidAmount > 0 &&
    incomeTotal > 0 &&
    Math.abs(incomeTotal - paidAmount) < AMOUNT_EPS;
  const paidCount = incomeMatchesPaid ? input.incomeTxnCount : 0;

  return {
    paid: paidAmount > 0 ? { amount: paidAmount, count: paidCount } : null,
    newCharges:
      input.expensesTotal > 0
        ? { amount: input.expensesTotal, count: input.expensesTxnCount }
        : null,
  };
}
