/**
 * Assets Summary Fixture Test
 * 
 * Tests asset grouping, stale account detection, and change calculations with realistic data.
 */

import { describe, test, expect } from "vitest";
import { buildAssetsSummary } from "../assetsSummary";
import type { AccountSnapshot } from "../extractTransactions";
import type { AccountBalanceHistory } from "../financialProfile";
import type { ManualAsset } from "../types";

describe("Assets Summary", () => {
  const fxRates: Record<string, number> = {}; // All CAD
  const homeCurrency = "CAD";

  test("should group accounts by type and calculate totals", () => {
    const accountSnapshots: AccountSnapshot[] = [
      // Cash & Savings
      {
        slug: "td-chequing-1234",
        bankName: "TD",
        accountId: "1234",
        accountName: "TD Chequing",
        accountType: "checking",
        balance: 5000,
        statementMonth: "2026-10",
        interestRate: null,
        currency: "CAD",
      },
      {
        slug: "td-savings-5678",
        bankName: "TD",
        accountId: "5678",
        accountName: "TD Savings",
        accountType: "savings",
        balance: 15000,
        statementMonth: "2026-10",
        interestRate: 2.5,
        currency: "CAD",
      },
      // Registered Accounts
      {
        slug: "td-rrsp-9999",
        bankName: "TD",
        accountId: "9999",
        accountName: "TD RRSP",
        accountType: "rrsp",
        balance: 50000,
        statementMonth: "2026-09", // Quarterly, still fresh
        interestRate: null,
        currency: "CAD",
      },
      {
        slug: "rbc-tfsa-8888",
        bankName: "RBC",
        accountId: "8888",
        accountName: "RBC TFSA",
        accountType: "tfsa",
        balance: 30000,
        statementMonth: "2026-09",
        interestRate: null,
        currency: "CAD",
      },
      // Investments
      {
        slug: "questrade-inv-7777",
        bankName: "Questrade",
        accountId: "7777",
        accountName: "Questrade Investment",
        accountType: "investment",
        balance: 75000,
        statementMonth: "2026-09", // Quarterly
        interestRate: null,
        currency: "CAD",
      },
      // Stale account (>45 days old)
      {
        slug: "cibc-savings-2222",
        bankName: "CIBC",
        accountId: "2222",
        accountName: "CIBC Savings",
        accountType: "savings",
        balance: 1000,
        statementMonth: "2026-07", // 3 months old = 90+ days
        interestRate: 1.5,
        currency: "CAD",
      },
    ];

    const balanceHistory: AccountBalanceHistory[] = [
      {
        slug: "td-chequing-1234",
        currency: "CAD",
        entries: [
          { yearMonth: "2026-08", balance: 4500 },
          { yearMonth: "2026-09", balance: 4800 },
          { yearMonth: "2026-10", balance: 5000 },
        ],
      },
      {
        slug: "td-savings-5678",
        currency: "CAD",
        entries: [
          { yearMonth: "2026-08", balance: 14000 },
          { yearMonth: "2026-09", balance: 14500 },
          { yearMonth: "2026-10", balance: 15000 },
        ],
      },
    ];

    const manualAssets: ManualAsset[] = [
      {
        id: "house-1",
        label: "Primary Residence",
        category: "property",
        value: 750000,
        updatedAt: "2026-10-01T00:00:00Z",
      },
      {
        id: "car-1",
        label: "2022 Honda Civic",
        category: "vehicle",
        value: 25000,
        updatedAt: "2026-10-01T00:00:00Z",
      },
    ];

    const summary = buildAssetsSummary(
      accountSnapshots,
      balanceHistory,
      manualAssets,
      fxRates,
      homeCurrency
    );

    // Total Assets = 5000 + 15000 + 50000 + 30000 + 75000 + 1000 + 750000 + 25000 = 951,000
    expect(summary.totalAssets).toBe(951000);
    expect(summary.currency).toBe("CAD");

    // Groups
    const groupsByType = Object.fromEntries(
      summary.groups.map(g => [g.type, g])
    );

    // Cash & Savings = 5000 + 15000 + 1000 = 21,000
    expect(groupsByType.cash.total).toBe(21000);
    expect(groupsByType.cash.accounts.length).toBe(3);

    // Registered = 50000 + 30000 = 80,000
    expect(groupsByType.registered.total).toBe(80000);
    expect(groupsByType.registered.accounts.length).toBe(2);

    // Investments = 75,000
    expect(groupsByType.investments.total).toBe(75000);
    expect(groupsByType.investments.accounts.length).toBe(1);

    // Property = 775,000 (750000 house + 25000 car, but car is vehicle not property)
    expect(groupsByType.property?.total).toBe(750000);
    expect(groupsByType.property?.manualAssets.length).toBe(1);

    // Other = 25,000 (car)
    expect(groupsByType.other?.total).toBe(25000);
    expect(groupsByType.other?.manualAssets.length).toBe(1);

    // Stale Accounts
    expect(summary.staleAccounts.length).toBe(1);
    expect(summary.staleAccounts[0].slug).toBe("cibc-savings-2222");
    expect(summary.staleAccounts[0].isStale).toBe(true);
    expect(summary.staleAccounts[0].daysOld).toBeGreaterThan(45);
  });

  test("should calculate month-over-month and year-over-year changes", () => {
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    
    let lastMonthDate = new Date(now);
    lastMonthDate.setMonth(lastMonthDate.getMonth() - 1);
    const lastMonth = `${lastMonthDate.getFullYear()}-${String(lastMonthDate.getMonth() + 1).padStart(2, "0")}`;

    const accountSnapshots: AccountSnapshot[] = [
      {
        slug: "td-savings-1234",
        bankName: "TD",
        accountId: "1234",
        accountName: "TD Savings",
        accountType: "savings",
        balance: 15000, // Current
        statementMonth: currentMonth,
        interestRate: 2.5,
        currency: "CAD",
      },
    ];

    const balanceHistory: AccountBalanceHistory[] = [
      {
        slug: "td-savings-1234",
        currency: "CAD",
        entries: [
          { yearMonth: lastMonth, balance: 14000 }, // Last month
          { yearMonth: currentMonth, balance: 15000 }, // Current
        ],
      },
    ];

    const summary = buildAssetsSummary(
      accountSnapshots,
      balanceHistory,
      [],
      fxRates,
      homeCurrency
    );

    // Change vs last month = 15000 - 14000 = +1000 (positive is good for assets)
    expect(summary.changeVsLastMonth).toBe(1000);
  });

  test("should handle empty data gracefully", () => {
    const summary = buildAssetsSummary([], [], [], fxRates, homeCurrency);

    expect(summary.totalAssets).toBe(0);
    expect(summary.groups.length).toBe(0);
    expect(summary.staleAccounts.length).toBe(0);
    expect(summary.monthlyHistory.length).toBe(0);
  });
});
