/**
 * Alert detector — STUB.
 *
 * Planned signals:
 *   - liquid cash < 1 month of average expenses (low emergency fund)
 *   - account balance below a threshold
 *   - large unexpected charge (>2x merchant's historical average)
 *   - high credit utilisation inferred from balance vs. limit
 *
 * Requires: minMonths: 1 (point-in-time alerts, no history needed).
 */

import type { InsightDetector, DetectorContext, DetectedSignal, InsightEvent } from "../types";

export const alertDetector: InsightDetector = {
  name: "alert",
  handles: ["statement.parsed", "balance.low", "full.refresh"],
  minMonths: 1,

  async run(_ctx: DetectorContext, _event: InsightEvent): Promise<DetectedSignal[]> {
    // TODO: implement alert signal detection
    return [];
  },
};
