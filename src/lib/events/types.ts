/**
 * Events — app-layer types (Rule 14: isolated from financial engine)
 *
 * One user-facing model: an **Event** has a name, optional **budget**, and **timeframe**
 * (start/end dates). Optional **kind: "service"** adds cadence/season for recurring
 * work (lawn, cleaning); otherwise `kind` is `"project"` or omitted (one-time / dated).
 *
 * Transactions are tagged to events via TxTag overlays stored separately
 * from parsedData — the engine is never touched.
 */

export type ServiceCadence = "weekly" | "biweekly" | "monthly" | "quarterly";
export type BillingMethod  = "per-visit" | "monthly";

/** Off-statement spend for projects — stored in events/{id}/ledger subcollection */
export interface ProjectLedgerEntry {
  id: string;
  /** YYYY-MM-DD */
  date: string;
  /** Amount counted toward project budget (always positive spend) */
  amount: number;
  note?: string;
  /** Expense category label (e.g. Dining, Travel) — optional manual-entry metadata */
  category?: string;
  /** How the user thinks of this line (labels only — all count the same toward budget) */
  entryType: "cash" | "manual";
  createdAt: string;
}

/** A single logged event entry — stored in events/{id}/visits subcollection */
export interface VisitLog {
  id: string;
  /** YYYY-MM-DD */
  date: string;
  note?: string;
  /**
   * How this visit was paid.
   * "cash"      — confirmed cash; amount stored here + written to cashCommitments.
   * "card"      — card payment logged manually; pending reconciliation via statement.
   * "statement" — tagged via a bank statement transaction.
   * absent      — unbilled / not yet recorded.
   */
  paymentMethod?: "cash" | "card" | "statement";
  /** Payment amount (set for cash and card manual entries) */
  amount?: number;
  createdAt: string;
}

export interface UserEvent {
  id: string;
  name: string;
  /** UI kind — defaults to "project" for legacy events without this field */
  kind?: "project" | "service";
  budget?: number;
  /** Project: start date (ISO). Legacy single-date stored as startDate or date. */
  startDate?: string;
  /** Project: end date (ISO) */
  endDate?: string;
  /** Legacy single target date — kept for backward compat */
  date?: string;
  /** "one-off" = project, "annual" = repeating (used for service events) */
  type: "one-off" | "annual";
  /** Tailwind color name used for the event chip */
  color: EventColor;
  createdAt: string;
  /** Soft-delete — archived events are hidden but tag history is preserved */
  archivedAt?: string;

  // ── Service-specific ──────────────────────────────────────────────────────
  cadence?: ServiceCadence;
  /** Season start month 1-12 (inclusive). Absent = year-round. */
  seasonStart?: number;
  /** Season end month 1-12 (inclusive). Absent = year-round. */
  seasonEnd?: number;
  billingMethod?: BillingMethod;
  /** User-supplied expected cost per visit (display only) */
  avgPerVisit?: number;
  /** Vendor / provider name (e.g. "John's Lawn Care") */
  vendor?: string;
  /** User-defined category label (e.g. "Trip", "Home", "Medical") */
  category?: string;
  /** Free-text notes / description */
  notes?: string;

  // ── Denormalized from visit logs (maintained by visits API) ───────────────
  /** Total logged events (all time) */
  visitCount?: number;
  /** ISO date of the most recent logged event */
  lastVisitDate?: string;
  /** All-time YYYY-MM → event count (filtered to current year in display) */
  visitsByMonth?: Record<string, number>;
  /** Sum of cash payments recorded on event logs */
  cashTotal?: number;
  /** Count of cash-paid event logs */
  cashVisitCount?: number;
  /** Count of card-paid (pending reconciliation) event logs */
  cardVisitCount?: number;
  /** YYYY-MM → payment count (cash + tagged transactions). Used for timeline color split. */
  paymentsByMonth?: Record<string, number>;

  // ── Project ledger (maintained by ledger API) ───────────────────────────────
  /** Sum of project ledger entries (cash / manual — not bank-tagged transactions) */
  ledgerTotal?: number;
  /** Number of ledger rows */
  ledgerEntryCount?: number;
}

export type EventColor =
  | "purple"
  | "blue"
  | "green"
  | "amber"
  | "red"
  | "pink"
  | "indigo"
  | "teal";

export const EVENT_COLORS: {
  id: EventColor;
  label: string;
  bg: string;
  solidBg: string;
  text: string;
  border: string;
}[] = [
  { id: "purple", label: "Purple", bg: "bg-purple-100", solidBg: "bg-purple-500", text: "text-purple-700", border: "border-purple-200" },
  { id: "blue",   label: "Blue",   bg: "bg-blue-100",   solidBg: "bg-blue-500",   text: "text-blue-700",   border: "border-blue-200"   },
  { id: "green",  label: "Green",  bg: "bg-green-100",  solidBg: "bg-green-500",  text: "text-green-700",  border: "border-green-200"  },
  { id: "amber",  label: "Amber",  bg: "bg-amber-100",  solidBg: "bg-amber-500",  text: "text-amber-700",  border: "border-amber-200"  },
  { id: "red",    label: "Red",    bg: "bg-red-100",    solidBg: "bg-red-500",    text: "text-red-700",    border: "border-red-200"    },
  { id: "pink",   label: "Pink",   bg: "bg-pink-100",   solidBg: "bg-pink-500",   text: "text-pink-700",   border: "border-pink-200"   },
  { id: "indigo", label: "Indigo", bg: "bg-indigo-100", solidBg: "bg-indigo-500", text: "text-indigo-700", border: "border-indigo-200" },
  { id: "teal",   label: "Teal",   bg: "bg-teal-100",   solidBg: "bg-teal-500",   text: "text-teal-700",   border: "border-teal-200"   },
];

/** Tag overlay — one doc per transaction fingerprint, stores event associations */
export interface TxTag {
  txFingerprint: string;
  eventIds: string[];
  note?: string;
  taggedAt: string;
  updatedAt: string;
}

/** A transaction enriched with its tag overlay — used in API responses */
export interface TaggedTransaction {
  fingerprint: string;
  date: string;
  description: string;
  amount: number;
  category: string;
  accountLabel: string;
  eventIds: string[];
  note?: string;
}

/**
 * Service tracker list card — one merged timeline row (visit log and/or statement payment).
 */
export type ServiceRecentActivity =
  | {
      kind: "visit";
      /** visits subcollection doc id */
      id: string;
      date: string;
      visit: VisitLog;
    }
  | {
      kind: "statement";
      /** transaction fingerprint */
      id: string;
      date: string;
      amount: number;
      merchant: string;
    };

/**
 * Budget tracker list card — statement tag or manual/cash ledger row.
 */
export type ProjectRecentExpense =
  | {
      kind: "statement";
      id: string;
      date: string;
      amount: number;
      merchant: string;
    }
  | {
      kind: "ledger";
      id: string;
      date: string;
      amount: number;
      note?: string;
      category?: string;
      entryType: "cash" | "manual";
    };

/** Summary returned alongside event data on the list endpoint */
export interface EventSummary extends UserEvent {
  /** Statement txns total + cash payments total */
  totalSpent: number;
  /** Statement-tagged transaction count */
  txCount: number;
  /** txCount + cashVisitCount (visits paid either via statement or cash) */
  paidCount?: number;
  /** visitCount - paidCount (logged but no payment recorded yet) */
  unbilledCount?: number;
  /** Service trackers only — last 3 activities (visits + statement payments), most recent first */
  recentActivities?: ServiceRecentActivity[];
  /** Budget / project trackers only — last 3 expenses (statement + ledger), most recent first */
  recentProjectExpenses?: ProjectRecentExpense[];
}
