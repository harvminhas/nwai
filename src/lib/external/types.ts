/**
 * External Data Layer — types.
 *
 * This layer is orthogonal to all other layers. Its only dependency on the
 * rest of the system is getFinancialProfile() from src/lib/financialProfile.ts.
 *
 * Data flow:
 *   Scheduled job → fetch external data → store globally → pipeline runs per user
 *                                                           ↓
 *                                          getFinancialProfile() → relevance check
 *                                                           ↓
 *                                          emit signal → users/{uid}/agentInsights
 */

import type { FinancialProfileCache } from "@/lib/financialProfile";

// ── External data document (externalData/{dataType}) ──────────────────────────

export type ExternalDataType =
  | "canada-overnight-rate"    // Bank of Canada overnight rate
  | "canada-prime-rate"        // Canadian prime lending rate
  | "canada-cpi"               // Canada CPI inflation (all-items)
  | "canada-food-cpi"          // Canada CPI food purchased from stores
  | "us-federal-funds-rate"    // US federal funds rate
  | "us-cpi"                   // US CPI inflation (all-items)
  | "us-food-cpi"              // US CPI food at home
  | "cad-usd-rate";            // CAD/USD exchange rate (reference data, no insight card)

export type Country = "CA" | "US";

export interface ExternalDataPoint {
  /** Identifier — matches the Firestore document ID */
  dataType: ExternalDataType;
  /** ISO-3166-1 alpha-2 country this data applies to */
  country: Country;
  /** Current value (e.g. 5.0 for 5.0%) */
  value: number;
  /** Previous value — used to compute direction of change */
  previousValue: number | null;
  /** Human-readable label for the value (e.g. "5.00%") */
  displayValue: string;
  /** ISO-8601 date of the official release */
  releaseDate: string;
  /** Human-readable name (e.g. "Bank of Canada Overnight Rate") */
  label: string;
  /** Brief plain-English description of what this data point means */
  description: string;
  /** URL to the official source */
  sourceUrl: string;
  /** ISO-8601 when this document was last fetched and written */
  updatedAt: string;
  /** ISO-8601 when the next fetch should run */
  nextRefreshAt: string;
}

// ── Relevance descriptor (registered per dataType) ────────────────────────────

export interface ExternalDataDescriptor {
  dataType: ExternalDataType;
  country: Country;
  /** Human-readable label */
  label: string;
  /** How often to refresh (in hours) */
  refreshIntervalHours: number;
  /**
   * Returns true if this data point is relevant to the given user's profile.
   * Called at pipeline time — cheap, no async.
   */
  relevant(profile: FinancialProfileCache, country?: "CA" | "US"): boolean;
}

// ── Signal emitted when external data is relevant to a user ───────────────────

export interface ExternalSignal {
  dataType: ExternalDataType;
  /** Stable key for deduplication across runs */
  key: string;
  priority: "high" | "medium" | "low";
  /** Facts used to write the insight card body */
  data: Record<string, unknown>;
}
