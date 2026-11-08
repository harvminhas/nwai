/**
 * Production fixture for Trends month composition.
 * Builds summaries through calculateNetWorthForMonths → buildAssetsSummary / buildDebtsSummary
 * (the same path the Assets and Liabilities pages use).
 */

import { calculateNetWorthForMonths, type AccountBalanceHistory, type MonthNetWorthHistory } from "../netWorthCalculationCore";
import { buildAssetsSummary } from "../assetsSummary";
import { buildDebtsSummary } from "../debtsSummary";
import type { AccountSnapshot } from "../extractTransactions";
import type { ManualAsset, ManualLiability } from "../types";
import type { AccountBalanceHistory as ProfileBalanceHistory } from "../financialProfile";

const HOME = "CAD";
const FX: Record<string, number> = { USD: 1.35 };

function toHome(balance: number, currency: string): number {
  if (currency === HOME) return balance;
  const rate = FX[currency];
  return rate && Number.isFinite(rate) ? balance * rate : balance;
}

function snapshot(partial: {
  slug: string;
  bankName: string;
  accountName: string;
  accountType: string;
  balance: number;
  statementMonth: string;
  currency: string;
}): AccountSnapshot {
  return {
    slug: partial.slug,
    bankName: partial.bankName,
    accountId: partial.slug,
    accountName: partial.accountName,
    accountType: partial.accountType,
    balance: partial.balance,
    statementMonth: partial.statementMonth,
    statementDate: `${partial.statementMonth}-28`,
    interestRate: null,
    currency: partial.currency,
  };
}

export function buildProductionTrendsFixture() {
  const accountBalanceHistory: AccountBalanceHistory[] = [
    {
      slug: "us-checking",
      label: "US Checking",
      accountType: "checking",
      currency: "USD",
      entries: [
        { yearMonth: "2026-01", balance: 1000 },
        { yearMonth: "2026-02", balance: 1100 },
        { yearMonth: "2026-03", balance: 1200 },
      ],
    },
    {
      slug: "cad-investment",
      label: "CAD Investment",
      accountType: "investment",
      currency: "CAD",
      // Only January — later months must carry this value forward
      entries: [{ yearMonth: "2026-01", balance: 5000 }],
    },
    {
      slug: "cad-visa",
      label: "CAD Visa",
      accountType: "credit",
      currency: "CAD",
      entries: [
        { yearMonth: "2026-01", balance: -2000 },
        { yearMonth: "2026-02", balance: -1800 },
        { yearMonth: "2026-03", balance: -1600 },
      ],
    },
    {
      slug: "osap-imported",
      label: "OSAP Student Loan",
      accountType: "loan",
      currency: "CAD",
      entries: [
        { yearMonth: "2026-01", balance: -8000 },
        { yearMonth: "2026-02", balance: -7900 },
        { yearMonth: "2026-03", balance: -7800 },
      ],
    },
  ];

  const profileBalanceHistory: ProfileBalanceHistory[] = accountBalanceHistory.map((h) => ({
    ...h,
    entries: h.entries.map((e) => ({ ...e })),
  }));

  const manualAssets: ManualAsset[] = [
    {
      id: "car-1",
      label: "2022 Honda Civic",
      category: "vehicle",
      value: 25000,
      startDate: "2026-02-01",
      updatedAt: "2026-02-01T00:00:00Z",
    },
  ];

  const manualLiabilities: ManualLiability[] = [
    {
      id: "student-1",
      label: "Federal Student Loan",
      category: "student_loan",
      balance: 15000,
      updatedAt: "2026-02-15T00:00:00Z",
    },
  ];

  const monthlyHistory: MonthNetWorthHistory[] = [
    { yearMonth: "2026-01", netWorth: 0, totalAssets: 0, totalDebts: 0 },
    { yearMonth: "2026-02", netWorth: 0, totalAssets: 0, totalDebts: 0 },
    { yearMonth: "2026-03", netWorth: 0, totalAssets: 0, totalDebts: 0 },
  ];

  calculateNetWorthForMonths(
    monthlyHistory,
    accountBalanceHistory,
    manualAssets,
    manualLiabilities,
    toHome,
    new Map()
  );

  const profileMonths = monthlyHistory.map((h) => ({
    yearMonth: h.yearMonth,
    totalAssets: h.totalAssets,
    totalDebts: h.totalDebts,
    debtPaymentsTotal: 0,
    byAccount: h.byAccount,
  }));

  const accountSnapshots: AccountSnapshot[] = [
    snapshot({
      slug: "us-checking",
      bankName: "Chase",
      accountName: "US Checking",
      accountType: "checking",
      balance: 1200,
      statementMonth: "2026-03",
      currency: "USD",
    }),
    snapshot({
      slug: "cad-investment",
      bankName: "TD",
      accountName: "CAD Investment",
      accountType: "investment",
      balance: 5000,
      statementMonth: "2026-01",
      currency: "CAD",
    }),
    snapshot({
      slug: "cad-visa",
      bankName: "TD",
      accountName: "CAD Visa",
      accountType: "credit",
      balance: -1600,
      statementMonth: "2026-03",
      currency: "CAD",
    }),
    snapshot({
      slug: "osap-imported",
      bankName: "OSAP",
      accountName: "OSAP Student Loan",
      accountType: "loan",
      balance: -7800,
      statementMonth: "2026-03",
      currency: "CAD",
    }),
  ];

  const assetsSummary = buildAssetsSummary(
    accountSnapshots,
    profileBalanceHistory,
    manualAssets,
    FX,
    HOME,
    profileMonths
  );

  const debtsSummary = buildDebtsSummary(
    accountSnapshots,
    profileBalanceHistory,
    [],
    manualLiabilities,
    FX,
    HOME,
    profileMonths
  );

  return { assetsSummary, debtsSummary, monthlyHistory, profileMonths };
}

export function installChartResizeObserver(width = 800, height = 340) {
  global.ResizeObserver = class MockResizeObserver {
    private callback: ResizeObserverCallback;
    constructor(callback: ResizeObserverCallback) {
      this.callback = callback;
    }
    observe(target: Element) {
      this.callback(
        [
          {
            target,
            contentRect: { width, height, top: 0, left: 0, bottom: height, right: width, x: 0, y: 0 },
            borderBoxSize: [],
            contentBoxSize: [],
            devicePixelContentBoxSize: [],
          },
        ] as unknown as ResizeObserverEntry[],
        this as unknown as ResizeObserver
      );
    }
    unobserve() {}
    disconnect() {}
  };
}
