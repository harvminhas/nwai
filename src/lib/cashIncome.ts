/**
 * Shared types, constants, and pure functions for cash income entries.
 * Imported by both the API route (server) and the income page (client).
 * Must NOT import firebase-admin or any server-only module.
 */

export type CashIncomeFrequency = "weekly" | "biweekly" | "monthly" | "quarterly" | "annual" | "once";
export type CashIncomeCategory  = "Salary" | "Freelance" | "Rent" | "Business" | "Government" | "Investment" | "Gift" | "Other";

export interface CashIncomeEntry {
  id: string;
  name: string;
  amount: number;
  frequency: CashIncomeFrequency;
  category: CashIncomeCategory;
  notes?: string;
  /** ISO date "YYYY-MM-DD" — next expected date for recurring; the date for one-offs */
  nextDate?: string;
  /**
   * ISO date "YYYY-MM-DD" — when this income actually started.
   * occurrencesInMonth returns 0 for any month before this date.
   * If omitted, income is counted for all months (legacy behaviour).
   */
  startDate?: string;
  createdAt: string;
  updatedAt: string;
}

/** Monthly multiplier for projecting annual totals */
export const CASH_INCOME_FREQ_MONTHLY: Record<CashIncomeFrequency, number> = {
  weekly:    52 / 12,
  biweekly:  26 / 12,
  monthly:   1,
  quarterly: 1 / 3,
  annual:    1 / 12,
  once:      0,
};

/**
 * Given a CashIncomeEntry and a YYYY-MM string, returns the number of times
 * this entry is expected to land in that month.
 *
 * Rules:
 *  - Only counts months on or after the entry's startDate month (no retroactive backfill).
 *  - For "once": counts 1 only if nextDate falls within yearMonth.
 *  - For recurring: uses the day-of-month from nextDate and the frequency cadence.
 */
export function occurrencesInMonth(entry: CashIncomeEntry, yearMonth: string): number {
  // Respect the user-specified start date. If none set, count all months (backwards compat).
  if (entry.startDate && yearMonth < entry.startDate.slice(0, 7)) return 0;

  if (entry.frequency === "once") {
    if (!entry.nextDate) return 0;
    return entry.nextDate.slice(0, 7) === yearMonth ? 1 : 0;
  }

  if (!entry.nextDate) {
    return entry.frequency === "monthly" ? 1 : 0;
  }

  const anchorDate  = new Date(entry.nextDate + "T12:00:00");
  const anchorMonth = entry.nextDate.slice(0, 7);
  const [ay, am]    = anchorMonth.split("-").map(Number);
  const [ty, tm]    = yearMonth.split("-").map(Number);
  const monthDiff   = (ty - ay) * 12 + (tm - am);

  switch (entry.frequency) {
    case "monthly":
      return 1;

    case "biweekly": {
      const anchorMs   = anchorDate.getTime();
      const monthStart = new Date(ty, tm - 1, 1).getTime();
      const monthEnd   = new Date(ty, tm, 0).getTime();
      const step       = 14 * 86_400_000;
      const stepsNeeded = Math.ceil((monthStart - anchorMs) / step);
      let cursor = anchorMs + stepsNeeded * step;
      let count  = 0;
      while (cursor <= monthEnd) { if (cursor >= monthStart) count++; cursor += step; }
      return count;
    }

    case "weekly": {
      const anchorMs   = anchorDate.getTime();
      const monthStart = new Date(ty, tm - 1, 1).getTime();
      const monthEnd   = new Date(ty, tm, 0).getTime();
      const step       = 7 * 86_400_000;
      const stepsNeeded = Math.ceil((monthStart - anchorMs) / step);
      let cursor = anchorMs + stepsNeeded * step;
      let count  = 0;
      while (cursor <= monthEnd) { if (cursor >= monthStart) count++; cursor += step; }
      return count;
    }

    case "quarterly":
      return monthDiff >= 0 && monthDiff % 3 === 0 ? 1 : 0;

    case "annual":
      return monthDiff >= 0 && monthDiff % 12 === 0 ? 1 : 0;

    default:
      return 0;
  }
}

/**
 * Returns the ISO YYYY-MM-DD dates on which a cash income entry lands in a
 * given month.  Mirrors occurrencesInMonth but yields actual dates instead of
 * a count — used to build synthetic income transactions.
 */
export function datesInMonth(entry: CashIncomeEntry, yearMonth: string): string[] {
  if (entry.startDate && yearMonth < entry.startDate.slice(0, 7)) return [];

  const [ty, tm] = yearMonth.split("-").map(Number);
  const monthStart = new Date(ty, tm - 1, 1).getTime();
  const monthEnd   = new Date(ty, tm, 0).getTime();

  const clampDay = (day: number) => {
    const maxDay = new Date(ty, tm, 0).getDate();
    const d = new Date(ty, tm - 1, Math.min(day, maxDay));
    return d.toISOString().slice(0, 10);
  };

  if (entry.frequency === "once") {
    if (!entry.nextDate) return [];
    return entry.nextDate.slice(0, 7) === yearMonth ? [entry.nextDate] : [];
  }

  if (!entry.nextDate) {
    // No anchor — place on the 1st for monthly, skip otherwise
    return entry.frequency === "monthly" ? [`${yearMonth}-01`] : [];
  }

  const anchorDate  = new Date(entry.nextDate + "T12:00:00");
  const anchorMonth = entry.nextDate.slice(0, 7);
  const [ay, am]    = anchorMonth.split("-").map(Number);
  const monthDiff   = (ty - ay) * 12 + (tm - am);

  switch (entry.frequency) {
    case "monthly":
      return [clampDay(anchorDate.getDate())];

    case "quarterly":
      return monthDiff >= 0 && monthDiff % 3 === 0 ? [entry.nextDate] : [];

    case "annual":
      return monthDiff >= 0 && monthDiff % 12 === 0 ? [entry.nextDate] : [];

    case "biweekly": {
      const step = 14 * 86_400_000;
      const anchorMs = anchorDate.getTime();
      const stepsNeeded = Math.ceil((monthStart - anchorMs) / step);
      let cursor = anchorMs + stepsNeeded * step;
      const dates: string[] = [];
      while (cursor <= monthEnd) {
        if (cursor >= monthStart) dates.push(new Date(cursor).toISOString().slice(0, 10));
        cursor += step;
      }
      return dates;
    }

    case "weekly": {
      const step = 7 * 86_400_000;
      const anchorMs = anchorDate.getTime();
      const stepsNeeded = Math.ceil((monthStart - anchorMs) / step);
      let cursor = anchorMs + stepsNeeded * step;
      const dates: string[] = [];
      while (cursor <= monthEnd) {
        if (cursor >= monthStart) dates.push(new Date(cursor).toISOString().slice(0, 10));
        cursor += step;
      }
      return dates;
    }

    default:
      return [];
  }
}
