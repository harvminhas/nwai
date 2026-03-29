/**
 * Public API for the insights layer.
 *
 * All callers outside src/lib/insights/ should use only this file.
 * Internal modules (detectors, pipeline, registry) are private.
 */

import type * as Firestore from "firebase-admin/firestore";
import type { InsightEvent, InsightEventType } from "./types";
import { runInsightsPipeline } from "./pipeline";

export type { InsightEvent, InsightEventType };
export type { SubscriptionRecord, SubscriptionStatus, SubscriptionFrequency } from "./types";

/**
 * Fire an insight event. The pipeline determines which detectors to run
 * based on the event type and available data.
 *
 * Safe to call fire-and-forget:
 *   fireInsightEvent({ type: "statement.parsed" }, uid, db).catch(console.error)
 */
export async function fireInsightEvent(
  event: InsightEvent,
  uid: string,
  db: Firestore.Firestore
): Promise<void> {
  await runInsightsPipeline(uid, db, event);
}
