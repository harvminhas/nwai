/**
 * Commit a consolidated-per-month payload as one month.
 * Label, payments, and statement body must come from the same response —
 * never keep a previous month's totals under a newly selected label.
 */

export type ConsolidatedMonthJson = {
  data?: unknown;
  yearMonth?: string | null;
  paymentsMade?: number;
  previousMonth?: unknown;
};

export type CommittedAccountMonth = {
  yearMonth: string;
  paymentsMade: number;
  data: unknown;
  previousMonth: unknown;
};

export function commitAccountMonth(
  json: ConsolidatedMonthJson,
  requestedYm: string,
  ok: boolean,
): CommittedAccountMonth | null {
  if (!ok || json.data == null || json.data === false) return null;
  const yearMonth = json.yearMonth || requestedYm;
  if (!yearMonth) return null;
  return {
    yearMonth,
    data: json.data,
    paymentsMade: json.paymentsMade ?? 0,
    previousMonth: json.previousMonth,
  };
}
