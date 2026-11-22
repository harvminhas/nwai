import { formatCurrency } from "@/lib/currencyUtils";

/** Fields the planner list needs. Compatible with the Plan API model. */
export interface PlanListItem {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  budget: number;
  completedAt?: string | null;
}

export interface FutureYearGroup<T extends PlanListItem = PlanListItem> {
  year: number;
  plans: T[];
  budgetTotal: number;
}

export interface GroupedPlans<T extends PlanListItem = PlanListItem> {
  inProgress: T[];
  futureByYear: FutureYearGroup<T>[];
  past: T[];
}

export const PLAN_DATE_RANGE_ERROR =
  "The end date must be on or after the start date.";

export function todayISO(now = new Date()): string {
  return now.toISOString().split("T")[0];
}

export function isPlanCompleted(plan: { completedAt?: string | null }): boolean {
  return typeof plan.completedAt === "string" && plan.completedAt.length > 0;
}

export function validatePlanDates(startDate: string, endDate: string): string | null {
  if (!startDate || !endDate) return null;
  if (endDate < startDate) return PLAN_DATE_RANGE_ERROR;
  return null;
}

function compareByStartThenName(a: PlanListItem, b: PlanListItem): number {
  const start = a.startDate.localeCompare(b.startDate);
  if (start !== 0) return start;
  const end = a.endDate.localeCompare(b.endDate);
  if (end !== 0) return end;
  return a.name.localeCompare(b.name);
}

function comparePastNewestFirst(a: PlanListItem, b: PlanListItem): number {
  const end = b.endDate.localeCompare(a.endDate);
  if (end !== 0) return end;
  const start = b.startDate.localeCompare(a.startDate);
  if (start !== 0) return start;
  return a.name.localeCompare(b.name);
}

function startYear(plan: PlanListItem): number {
  const year = Number(plan.startDate.slice(0, 4));
  return Number.isFinite(year) ? year : 0;
}

/**
 * In progress first (when non-empty), then future plans by start-date year
 * (soonest first, no "Upcoming" bucket), then past (newest first).
 */
export function groupPlans<T extends PlanListItem>(
  plans: T[],
  today: string,
): GroupedPlans<T> {
  const inProgress: T[] = [];
  const future: T[] = [];
  const past: T[] = [];

  for (const plan of plans) {
    if (plan.startDate <= today && plan.endDate >= today) {
      inProgress.push(plan);
    } else if (plan.startDate > today) {
      future.push(plan);
    } else {
      past.push(plan);
    }
  }

  inProgress.sort(compareByStartThenName);
  future.sort(compareByStartThenName);
  past.sort(comparePastNewestFirst);

  const byYear = new Map<number, T[]>();
  for (const plan of future) {
    const year = startYear(plan);
    const list = byYear.get(year);
    if (list) list.push(plan);
    else byYear.set(year, [plan]);
  }

  const futureByYear: FutureYearGroup<T>[] = [...byYear.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([year, yearPlans]) => ({
      year,
      plans: yearPlans,
      budgetTotal: yearPlans.reduce((sum, p) => sum + p.budget, 0),
    }));

  return { inProgress, futureByYear, past };
}

function parseLocalDate(iso: string): Date {
  return new Date(`${iso}T00:00:00`);
}

function formatMonthDay(date: Date, includeYear: boolean): string {
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(includeYear ? { year: "numeric" as const } : {}),
  });
}

/**
 * Single date if start == end. Same calendar year omits the year on the start
 * side: "May 3 – May 15, 2027". Different years keep both years.
 */
export function formatPlanDateRange(startDate: string, endDate: string): string {
  const start = parseLocalDate(startDate);
  const end = parseLocalDate(endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return startDate === endDate ? startDate : `${startDate} – ${endDate}`;
  }
  if (startDate === endDate) {
    return formatMonthDay(start, true);
  }
  const sameYear = start.getFullYear() === end.getFullYear();
  if (sameYear) {
    return `${formatMonthDay(start, false)} – ${formatMonthDay(end, true)}`;
  }
  return `${formatMonthDay(start, true)} – ${formatMonthDay(end, true)}`;
}

export function formatYearSubtotal(
  count: number,
  budgetTotal: number,
  currency: string,
): string {
  const word = count === 1 ? "plan" : "plans";
  return `${count} ${word} · ${formatCurrency(budgetTotal, currency)}`;
}

export function monthlySetAside(
  plan: PlanListItem,
  spent: number,
  today: string,
): number | null {
  if (plan.startDate <= today) return null;
  const remaining = plan.budget - spent;
  if (remaining <= 0) return null;
  const msPerMonth = 30 * 24 * 60 * 60 * 1000;
  const monthsUntilStart = Math.max(
    1,
    Math.ceil(
      (parseLocalDate(plan.startDate).getTime() - parseLocalDate(today).getTime()) /
        msPerMonth,
    ),
  );
  return remaining / monthsUntilStart;
}
