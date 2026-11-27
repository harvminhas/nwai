/**
 * Shared types for dashboard drawer API contract.
 * Used by both /api/user/dashboard-drawers route and Drawer component.
 */

import type { BucketDetailedBreakdown } from "./bucketBreakdown";
import type { DetailedIncomeMetrics } from "./incomeMetrics";
import type { MonthSavingsBreakdown } from "./savingsCalculations";
import type { TimeRange } from "./rangeUtils";

export interface IncomeDrawerData {
  type: "income";
  range: TimeRange;
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
  range: TimeRange;
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
  range: TimeRange;
  /** Average monthly Net savings (balance change) over measured months — same as the card */
  monthlyAverage: number;
  /** Average change in bank / cash / savings balances */
  netCashChange: number;
  /** Average debt paid down (cards, lines of credit, loans, mortgages) */
  netDebtChange: number;
  /** One row per window month, with per-account changes */
  monthlyBreakdown: MonthSavingsBreakdown[];
  /** Months included in the average (have balances to compare) */
  measuredMonths: string[];
  homeCurrency: string;
  basisLabel: string;
  /** Optional note like "2 of 3 months" when data is sparse */
  windowNote?: string;
}

export type DrawerData = IncomeDrawerData | BucketDrawerData | SavingsDrawerData;

export interface DrawerErrorResponse {
  error: string;
}
