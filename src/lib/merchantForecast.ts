/**
 * Merchant spending forecast — user assumptions only (not statement data).
 * Used on the merchant detail page for estimated yearly spend.
 */

export type RecurringFrequency =
  | "weekly"
  | "biweekly"
  | "monthly"
  | "quarterly"
  | "yearly"
  /** Single one-time cost; estimated yearly = that amount */
  | "oneoff";

export type VisitsPeriod = "week" | "biweek" | "month" | "quarter" | "year";

export type ForecastMode = "recurring" | "estimated";

/** UI labels for time period — shared by merchant header (real cadence) and Pro calculator (estimate basis). */
export const FORECAST_FREQUENCY_OPTIONS: { id: RecurringFrequency; label: string }[] = [
  { id: "oneoff", label: "One-off" },
  { id: "weekly", label: "Weekly" },
  { id: "biweekly", label: "Biweekly" },
  { id: "monthly", label: "Monthly" },
  { id: "quarterly", label: "Quarterly" },
  { id: "yearly", label: "Yearly" },
];

export interface MerchantForecastDoc {
  mode: ForecastMode;
  recurringFrequency: RecurringFrequency;
  /** Amount per recurring period (CAD, positive) */
  recurringAmount: number;
  /** Non-recurring: cost per visit */
  perVisitAmount: number;
  /** Non-recurring: how many visits per period */
  visitsPerPeriod: number;
  visitsPeriod: VisitsPeriod;
  updatedAt?: string;
}

const RECURRING_TO_YEARLY: Record<RecurringFrequency, number> = {
  weekly: 52,
  biweekly: 26,
  monthly: 12,
  quarterly: 4,
  yearly: 1,
  oneoff: 1,
};

const VISIT_PERIOD_TO_YEARLY: Record<VisitsPeriod, number> = {
  week: 52,
  biweek: 26,
  month: 12,
  quarter: 4,
  year: 1,
};

export function annualFromRecurring(amount: number, freq: RecurringFrequency): number {
  if (!Number.isFinite(amount) || amount < 0) return 0;
  return amount * RECURRING_TO_YEARLY[freq];
}

export function annualFromEstimated(
  perVisit: number,
  visitsPerPeriod: number,
  period: VisitsPeriod,
): number {
  if (!Number.isFinite(perVisit) || perVisit < 0) return 0;
  if (!Number.isFinite(visitsPerPeriod) || visitsPerPeriod < 0) return 0;
  return perVisit * visitsPerPeriod * VISIT_PERIOD_TO_YEARLY[period];
}

/** Round to cents for display / inputs (avoids float noise from averages). */
export function roundMoney(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

/** Map recurring cadence (except oneoff) to visit-counting period. */
export function recurringToVisitsPeriod(
  freq: Exclude<RecurringFrequency, "oneoff">,
): VisitsPeriod {
  const m: Record<Exclude<RecurringFrequency, "oneoff">, VisitsPeriod> = {
    weekly: "week",
    biweekly: "biweek",
    monthly: "month",
    quarterly: "quarter",
    yearly: "year",
  };
  return m[freq];
}

export function defaultForecastDoc(defaultAmount: number): MerchantForecastDoc {
  const raw = Number.isFinite(defaultAmount) && defaultAmount > 0 ? defaultAmount : 0;
  const amt = roundMoney(raw);
  return {
    mode: "recurring",
    recurringFrequency: "monthly",
    recurringAmount: amt,
    perVisitAmount: amt,
    visitsPerPeriod: 1,
    visitsPeriod: "month",
  };
}
