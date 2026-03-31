/**
 * TypeScript types for the Today page.
 * Consumed by the API route, compute-* libs, and React components.
 */

// ── Freshness ─────────────────────────────────────────────────────────────────

export type FreshnessState = "fresh" | "aging" | "stale";

export interface FreshnessAccount {
  name: string;
  uploadedAt: string; // ISO date string
}

export interface FreshnessData {
  state: FreshnessState;
  daysSinceUpload: number;
  accounts: FreshnessAccount[];
}

// ── Status banners ────────────────────────────────────────────────────────────

export type StatusType = "ok" | "warn" | "alert";

export interface StatusBanner {
  type: StatusType;
  icon: string;   // emoji
  text: string;   // headline
  detail: string; // expanded explanation
}

// ── Radar (calendar collision detection) ─────────────────────────────────────

export type RadarType = "warn" | "windfall" | "neutral";
export type ConfidenceLevel = "high" | "medium" | "low";

export interface RadarBreakdownRow {
  label: string;
  value: string;
}

export interface RadarItem {
  id: string;
  type: RadarType;
  icon: string;
  /** Short pill label e.g. "Cash flow pressure" | "Extra income" | "Bill timing" */
  pill: string;
  /** Human-readable month/date e.g. "April" | "May 14" */
  when: string;
  /** "YYYY-MM" key for sorting / filtering */
  targetMonthKey: string;
  title: string;
  sub: string;
  /** Formatted amount string e.g. "−$1,640" | "+$3,200" */
  amount: string;
  amountLabel: string;
  expand: {
    breakdown: RadarBreakdownRow[];
    note?: string;
    confidence: {
      level: ConfidenceLevel;
      text: string;
    };
    primaryAction: {
      label: string;
      href?: string;
    };
  };
}

// ── Calendar Events (overdue + this month) ────────────────────────────────────

export type EventStatus = "overdue" | "predicted" | "confirmed";
export type EventAmountClass = "income" | "expense";

export interface EventTag {
  type: "overdue" | "confirmed" | "predicted";
  text: string;
}

export interface CalendarEvent {
  id: string;
  icon: string;
  iconBg: string;
  title: string;
  tags: EventTag[];
  sub: string;
  /** e.g. "Predicted from 14-day pattern" shown as a blue pill */
  patternTag?: string;
  amount: string;
  amountClass: EventAmountClass;
  /** e.g. "Expected Mar 28" | "due tomorrow" | "due Apr 1" */
  timing: string;
  status: EventStatus;
  /** ISO date "YYYY-MM-DD" */
  dueDate: string;
  daysFromToday: number;
  href?: string;
}

// ── Signals (right col AI cards) ──────────────────────────────────────────────

export interface Signal {
  id: string;
  title: string;
  body: string;
  href?: string;
}

// ── Net worth snapshot (right col) ────────────────────────────────────────────

export interface NetWorthAccount {
  label: string;
  value: number;
  isEstimated: boolean;
}

export interface NetWorthSnapshot {
  total: number;
  /** "Updated today" | "Last calculated Mar 23" */
  calculatedLabel: string;
  isStale: boolean;
  /** Asset accounts + manual assets, sorted for display */
  accounts: NetWorthAccount[];
  /** Liability accounts (mortgage, credit, loans), sorted by value desc */
  debtAccounts: NetWorthAccount[];
}

// ── Full page data shape ──────────────────────────────────────────────────────

export interface TodayPageData {
  freshness: FreshnessData;
  statuses: StatusBanner[];
  radar: RadarItem[];
  overdueEvents: CalendarEvent[];
  thisMonthEvents: CalendarEvent[];
  thisMonthCollapsedCount: number;
  netWorth: NetWorthSnapshot;
  signals: Signal[];
}
