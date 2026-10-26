/**
 * Shared types for dashboard drawer API contract.
 * Used by both /api/user/dashboard-drawers route and Drawer component.
 */

import type { BucketDetailedBreakdown } from "./bucketBreakdown";
import type { DetailedIncomeMetrics } from "./incomeMetrics";
import type { MonthlySavingsResult, AccountBalanceDetail, SavingsConfirmation } from "./savingsCalculations";

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
}

export interface SavingsDrawerData {
  type: "savings";
  window: DrawerTimeWindow;
  monthlyBreakdown: {
    month: string;
    total: number;
    netCashChange: number;
    netDebtChange: number;
    contributionsToOutside: number;
    isInWindow: boolean;
  }[];
  periodBreakdown: {
    cashAccounts: AccountBalanceDetail[];
    debtAccounts: AccountBalanceDetail[];
    contributions: Array<{ merchant: string; amount: number; category: string; needsConfirmation: boolean }>;
  };
  monthlyAverage: number;
  needsConfirmation: SavingsConfirmation[];
  homeCurrency: string;
  basisLabel: string;
}

export type DrawerData = IncomeDrawerData | BucketDrawerData | SavingsDrawerData;

export interface DrawerErrorResponse {
  error: string;
}
