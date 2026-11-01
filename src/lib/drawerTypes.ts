/**
 * Shared types for dashboard drawer API contract.
 * Used by both /api/user/dashboard-drawers route and Drawer component.
 */

import type { BucketDetailedBreakdown } from "./bucketBreakdown";
import type { DetailedIncomeMetrics } from "./incomeMetrics";
import type { WindowSavingsResult, SavingsConfirmation } from "./savingsCalculations";

export type DrawerTimeWindow = "last3" | "12month" | "ytd";

export interface IncomeDrawerData {
  type: "income";
  window: DrawerTimeWindow;
  metrics: DetailedIncomeMetrics;
  chartData: {
    month: string;
    regularIncome: number;
    oneOffIncome: number;
    isInWindow: boolean;
    isCurrentMonth: boolean;
    hasData: boolean;
  }[];
  homeCurrency: string;
  /** Optional note like "2 of 3 months" when data is sparse */
  windowNote?: string;
}

export interface BucketDrawerData {
  type: "bucket";
  bucket: string;
  window: DrawerTimeWindow;
  breakdown: BucketDetailedBreakdown;
  trend: {
    months: string[];
    values: number[];
  };
  homeCurrency: string;
  basisLabel: string;
  /** Optional note like "2 of 3 months" when data is sparse */
  windowNote?: string;
}

export interface SavingsDrawerData {
  type: "savings";
  window: DrawerTimeWindow;
  /** Window-period reconciliation with per-month breakdown */
  windowSavings: WindowSavingsResult;
  homeCurrency: string;
  basisLabel: string;
  /** Optional note like "2 of 3 months" when data is sparse */
  windowNote?: string;
}

export type DrawerData = IncomeDrawerData | BucketDrawerData | SavingsDrawerData;

export interface DrawerErrorResponse {
  error: string;
}
