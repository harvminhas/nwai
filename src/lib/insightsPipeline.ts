/**
 * Legacy entry point — delegates to the event-driven insights layer.
 * Kept for backwards compatibility with POST /api/user/insights/generate.
 */

import type * as Firestore from "firebase-admin/firestore";
import { fireInsightEvent } from "./insights/index";

export async function runInsightsPipeline(
  uid: string,
  db: Firestore.Firestore
): Promise<void> {
  await fireInsightEvent({ type: "full.refresh" }, uid, db);
}
