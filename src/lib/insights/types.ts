/**
 * Core types for the event-driven insights layer.
 *
 * Architecture:
 *   Data change → InsightEvent → detectors run → DetectedSignals → cards persisted
 *
 * Rules:
 *   - Detectors may write to insights-owned Firestore collections
 *     (users/{uid}/subscriptions, users/{uid}/agentInsights, users/{uid}.financialDNA).
 *   - Detectors MUST NEVER read or write parsedData on any statement document.
 *   - Adding a new detector = add file in detectors/, register in registry.ts. Nothing else changes.
 */

import type * as Firestore from "firebase-admin/firestore";
import type { ExpenseTxnRecord, IncomeTxnRecord, AccountSnapshot } from "@/lib/extractTransactions";

// ── constants ─────────────────────────────────────────────────────────────────

/** Maximum months of transaction history used for any insight calculation. */
export const INSIGHTS_MAX_MONTHS = 12;

/** Minimum occurrences of a merchant before it is promoted to "confirmed" subscription. */
export const SUB_CONFIRM_THRESHOLD = 2;

// ── events ────────────────────────────────────────────────────────────────────

export type InsightEventType =
  | "statement.parsed"       // new statement successfully ingested
  | "subscription.confirmed" // subscription status → confirmed or user_confirmed
  | "subscription.changed"   // subscription amount or frequency changed
  | "goal.created"
  | "goal.updated"
  | "liability.added"
  | "balance.low"
  | "full.refresh";          // explicit full regeneration (e.g. user taps Refresh)

export interface InsightEvent {
  type: InsightEventType;
  /** Optional metadata relevant to the event (e.g. statementId, goalId). */
  meta?: Record<string, unknown>;
}

// ── detector interface ────────────────────────────────────────────────────────

export interface DetectorContext {
  uid: string;
  db: Firestore.Firestore;
  /** All expense transactions across all completed statements, sorted newest-first. */
  expenseTxns: ExpenseTxnRecord[];
  /** All income transactions across all completed statements, sorted newest-first. */
  incomeTxns: IncomeTxnRecord[];
  accountSnapshots: AccountSnapshot[];
  /** All distinct transaction months, sorted ascending. */
  allTxMonths: string[];
  /** Months capped to INSIGHTS_MAX_MONTHS, sorted ascending (oldest → newest). */
  relevantMonths: string[];
}

/**
 * A signal is a fact the code has detected — a specific, quantified observation.
 * Signals drive card generation. No signal = no card.
 */
export interface DetectedSignal {
  category: string;
  /** Stable key used to deduplicate cards across runs. */
  key: string;
  priority: "high" | "medium" | "low";
  /** The numbers and facts behind this signal (used to write the card body). */
  data: Record<string, unknown>;
}

/**
 * A detector is responsible for one domain (subscriptions, cashflow, etc.).
 * It may read from and write to insights-owned Firestore collections.
 * It returns signals; a separate writer step turns signals into AgentCards.
 */
export interface InsightDetector {
  /** Human-readable name for logging. */
  name: string;
  /** Event types that should trigger this detector. */
  handles: InsightEventType[];
  /** Minimum months of transaction data required. Skip silently if not met. */
  minMonths?: number;
  run(ctx: DetectorContext, event: InsightEvent): Promise<DetectedSignal[]>;
}

// ── subscription record (users/{uid}/subscriptions/{merchantSlug}) ────────────

export type SubscriptionStatus = "suggested" | "confirmed" | "user_confirmed";

export type SubscriptionFrequency = "weekly" | "biweekly" | "monthly" | "quarterly" | "annual";

export interface SubscriptionRecord {
  merchantSlug: string;
  name: string;
  /** Lifecycle status. Only insights or user can promote/change this. */
  status: SubscriptionStatus;
  /** Latest values inferred from transaction history. */
  suggestedAmount: number;
  suggestedFrequency: SubscriptionFrequency;
  /**
   * Confirmed values — set when status becomes confirmed/user_confirmed.
   * Insights will not overwrite fields listed in lockedFields.
   */
  amount: number | null;
  frequency: SubscriptionFrequency | null;
  /** Fields the user has explicitly set. Insights will never overwrite these. */
  lockedFields: string[];
  /** Present on docs seeded from statement `parsedData.subscriptions` (insights pipeline). */
  statementAiTagged?: boolean;
  /** User dismissed recurring (frequency "never" rule) — hide from upcoming until cleared. */
  upcomingSuppressed?: boolean;
  firstSeenAt: string;   // ISO date of earliest transaction
  lastSeenAt: string;    // ISO date of most recent transaction
  occurrenceCount: number;
  confirmedBy: "insights" | "user" | null;
  confirmedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
