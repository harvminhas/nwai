/**
 * Payment Projection Engine
 *
 * Given a last-known payment date and a median gap (days), projects future
 * payment dates with optional Canadian business-day adjustment.
 *
 * Used by computeRadarItems to power:
 *   - "When is the next paycheck / mortgage payment?"
 *   - "How many payments land in the current/next month?" (3-payment-month warning)
 */

// ── Canadian federal holidays 2024–2028 ───────────────────────────────────────

const CA_HOLIDAYS = new Set<string>([
  // New Year's Day
  "2024-01-01", "2025-01-01", "2026-01-01", "2027-01-01", "2028-01-01",
  // Good Friday
  "2024-03-29", "2025-04-18", "2026-04-03", "2027-03-26", "2028-04-14",
  // Victoria Day (Monday before May 25)
  "2024-05-20", "2025-05-19", "2026-05-18", "2027-05-24", "2028-05-22",
  // Canada Day
  "2024-07-01", "2025-07-01", "2026-07-01", "2027-07-01", "2028-07-03",
  // Labour Day (first Monday of September)
  "2024-09-02", "2025-09-01", "2026-09-07", "2027-09-06", "2028-09-04",
  // Thanksgiving (second Monday of October)
  "2024-10-14", "2025-10-13", "2026-10-12", "2027-10-11", "2028-10-09",
  // Remembrance Day
  "2024-11-11", "2025-11-11", "2026-11-11", "2027-11-11", "2028-11-13",
  // Christmas Day
  "2024-12-25", "2025-12-25", "2026-12-25", "2027-12-27", "2028-12-25",
  // Boxing Day
  "2024-12-26", "2025-12-26", "2026-12-28", "2027-12-28", "2028-12-26",
]);

// ── types ─────────────────────────────────────────────────────────────────────

export interface ProjectedDate {
  dateStr: string;           // "YYYY-MM-DD"
  daysFromToday: number;     // positive = future, 0 = today, negative = past
  isToday: boolean;
  isTomorrow: boolean;
  isThisWeek: boolean;       // within next 7 days (inclusive of today)
  isThisMonth: boolean;      // same calendar month as today
  monthKey: string;          // "YYYY-MM" — for grouping
}

// ── helpers ───────────────────────────────────────────────────────────────────

export function toDateStr(d: Date): string {
  const y  = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
  const da = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${mo}-${da}`;
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setUTCDate(r.getUTCDate() + n);
  return r;
}

/**
 * Shift forward to the next Canadian business day if `date` lands on a
 * weekend or federal holiday. Caps at 5 tries (should never need more than 3).
 */
function adjustForBusinessDay(date: Date): Date {
  let d = new Date(date);
  for (let i = 0; i < 5; i++) {
    const dow = d.getUTCDay();
    if (dow === 0) { d = addDays(d, 1); continue; }
    if (dow === 6) { d = addDays(d, 2); continue; }
    if (CA_HOLIDAYS.has(toDateStr(d))) { d = addDays(d, 1); continue; }
    break;
  }
  return d;
}

// ── core API ──────────────────────────────────────────────────────────────────

/**
 * Project the next `count` payment dates, stepping forward by `medianGapDays`
 * from `lastDateStr`.
 *
 * @param lastDateStr        Most recent confirmed date "YYYY-MM-DD"
 * @param medianGapDays      Median days between payments (from detectFrequency)
 * @param count              How many future dates to project (default 8)
 * @param adjustBusinessDay  Shift weekend/holiday dates to next business day
 */
export function projectNextDates(
  lastDateStr: string,
  medianGapDays: number,
  count = 8,
  adjustBusinessDay = true,
): ProjectedDate[] {
  if (!lastDateStr || medianGapDays < 1) return [];

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const todayStr  = toDateStr(today);
  const nowYM     = todayStr.slice(0, 7);

  const results: ProjectedDate[] = [];
  let base = new Date(lastDateStr + "T00:00:00Z");

  for (let i = 0; i < count; i++) {
    base = addDays(base, medianGapDays);
    const raw       = new Date(base);
    const projected = adjustBusinessDay ? adjustForBusinessDay(raw) : raw;
    const dStr      = toDateStr(projected);
    const daysFromToday = Math.round(
      (projected.getTime() - today.getTime()) / 86_400_000,
    );
    results.push({
      dateStr:      dStr,
      daysFromToday,
      isToday:      dStr === todayStr,
      isTomorrow:   daysFromToday === 1,
      isThisWeek:   daysFromToday >= 0 && daysFromToday <= 6,
      isThisMonth:  dStr.slice(0, 7) === nowYM,
      monthKey:     dStr.slice(0, 7),
    });
  }
  return results;
}

/**
 * Count how many projected dates fall in `year`/`month`, combining:
 * - `confirmedInMonth`: transactions already recorded this month
 * - projections forward from `lastDateStr`
 *
 * @param month  1-indexed (1–12)
 */
export function countInMonth(
  lastDateStr: string,
  medianGapDays: number,
  year: number,
  month: number,
  confirmedInMonth = 0,
): number {
  if (!lastDateStr || medianGapDays < 1) return confirmedInMonth;
  const targetYM = `${year}-${String(month).padStart(2, "0")}`;
  const projections = projectNextDates(lastDateStr, medianGapDays, 12, true);
  return confirmedInMonth + projections.filter((p) => p.monthKey === targetYM).length;
}

/**
 * Return the first projected date that is today or in the future (daysFromToday >= 0).
 */
export function nextUpcoming(projections: ProjectedDate[]): ProjectedDate | null {
  return projections.find((p) => p.daysFromToday >= 0) ?? null;
}

/**
 * Get all dates that fall in the given "YYYY-MM" month key from a projection list.
 */
export function datesInMonth(projections: ProjectedDate[], monthKey: string): ProjectedDate[] {
  return projections.filter((p) => p.monthKey === monthKey);
}
