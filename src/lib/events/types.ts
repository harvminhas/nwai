/**
 * Events — app-layer types (Rule 14: isolated from financial engine)
 *
 * Users create named events with an optional budget and date.
 * Transactions are tagged to events via TxTag overlays stored separately
 * from parsedData — the engine is never touched.
 */

export interface UserEvent {
  id: string;
  name: string;
  /** Optional spending budget for this event */
  budget?: number;
  /** Target or due date (ISO string) */
  date?: string;
  /** "one-off" = single occurrence, "annual" = repeats every year */
  type: "one-off" | "annual";
  /** Tailwind color name used for the event chip (e.g. "purple", "blue") */
  color: EventColor;
  createdAt: string;
  /** Soft-delete — archived events are hidden but tag history is preserved */
  archivedAt?: string;
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

export const EVENT_COLORS: { id: EventColor; label: string; bg: string; text: string; border: string }[] = [
  { id: "purple", label: "Purple", bg: "bg-purple-100", text: "text-purple-700", border: "border-purple-200" },
  { id: "blue",   label: "Blue",   bg: "bg-blue-100",   text: "text-blue-700",   border: "border-blue-200"   },
  { id: "green",  label: "Green",  bg: "bg-green-100",  text: "text-green-700",  border: "border-green-200"  },
  { id: "amber",  label: "Amber",  bg: "bg-amber-100",  text: "text-amber-700",  border: "border-amber-200"  },
  { id: "red",    label: "Red",    bg: "bg-red-100",    text: "text-red-700",    border: "border-red-200"    },
  { id: "pink",   label: "Pink",   bg: "bg-pink-100",   text: "text-pink-700",   border: "border-pink-200"   },
  { id: "indigo", label: "Indigo", bg: "bg-indigo-100", text: "text-indigo-700", border: "border-indigo-200" },
  { id: "teal",   label: "Teal",   bg: "bg-teal-100",   text: "text-teal-700",   border: "border-teal-200"   },
];

/** Tag overlay — one doc per transaction fingerprint, stores event associations */
export interface TxTag {
  /** txFingerprint — same key used throughout the app */
  txFingerprint: string;
  /** IDs of events this transaction is tagged to */
  eventIds: string[];
  /** Optional user note on this transaction */
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

/** Summary returned alongside event data */
export interface EventSummary extends UserEvent {
  totalSpent: number;
  txCount: number;
}
