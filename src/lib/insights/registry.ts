/**
 * Detector registry.
 *
 * To add a new detector: import it here and add it to ALL_DETECTORS.
 * Nothing else in the codebase needs to change.
 */

import type { InsightDetector, InsightEventType } from "./types";
import { subscriptionsDetector } from "./detectors/subscriptions";
import { cashflowDetector }      from "./detectors/cashflow";
import { alertDetector }         from "./detectors/alert";
import { savingsDetector }       from "./detectors/savings";

const ALL_DETECTORS: InsightDetector[] = [
  subscriptionsDetector,
  cashflowDetector,
  alertDetector,
  savingsDetector,
];

export function getDetectorsForEvent(eventType: InsightEventType): InsightDetector[] {
  return ALL_DETECTORS.filter((d) => d.handles.includes(eventType));
}
