/**
 * Savings detector — STUB.
 *
 * Planned signals:
 *   - emergency fund coverage < 3 months (liquid cash / avg monthly expenses)
 *   - savings rate below 10% over last 3 months
 *   - TFSA / RRSP not detected in account list (Canadian context)
 *   - high debt-to-income ratio (>40%)
 *
 * Requires: minMonths: 3 for trend-based signals; 1 for balance-based signals.
 */

import type { InsightDetector, DetectorContext, DetectedSignal, InsightEvent } from "../types";

export const savingsDetector: InsightDetector = {
  name: "savings",
  handles: ["statement.parsed", "full.refresh"],
  minMonths: 1,

  async run(_ctx: DetectorContext, _event: InsightEvent): Promise<DetectedSignal[]> {
    // TODO: implement savings signal detection
    return [];
  },
};
