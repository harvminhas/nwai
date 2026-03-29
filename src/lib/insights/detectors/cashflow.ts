/**
 * Cashflow detector — STUB.
 *
 * Planned signals:
 *   - income < expenses this month (alert)
 *   - spending spike: current month >20% above rolling 3-month average
 *   - savings rate below user's historical average
 *   - month-over-month income drop >15%
 *
 * Requires: minMonths: 3 for trend signals; 1 for point-in-time alerts.
 */

import type { InsightDetector, DetectorContext, DetectedSignal, InsightEvent } from "../types";

export const cashflowDetector: InsightDetector = {
  name: "cashflow",
  handles: ["statement.parsed", "full.refresh"],
  minMonths: 1,

  async run(_ctx: DetectorContext, _event: InsightEvent): Promise<DetectedSignal[]> {
    // TODO: implement cashflow signal detection
    return [];
  },
};
