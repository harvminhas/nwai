/**
 * Tests for calculateNetWorthForMonths - core authoritative calculation.
 * 
 * Tests with RAW inputs (assets, debts, manual assets) proving actual calculation,
 * not precomputed mocks. Covers add/edit/remove, FX, activation, deduplication.
 */

import { describe, it, expect } from "vitest";
import { calculateNetWorthForMonths, type AccountBalanceHistory, type MonthNetWorthHistory } from "../lib/netWorthCalculationCore";
import type { ManualAsset } from "../lib/types";
import type { AccountStatusRecord } from "../lib/accountStatus";

describe("calculateNetWorthForMonths - Core Authoritative Calculation", () => {
  const toHomeCAD = (balance: number, currency: string) => {
    if (currency === "USD") return balance * 1.35; // Mock FX rate
    return balance; // CAD
  };

  it("should calculate net worth from raw account balances + manual car asset", () => {
    const monthlyHistory: MonthNetWorthHistory[] = [
      { yearMonth: "2026-10", netWorth: 0, totalAssets: 0, totalDebts: 0, byAccount: [] },
      { yearMonth: "2026-11", netWorth: 0, totalAssets: 0, totalDebts: 0, byAccount: [] },
    ];

    const accountBalanceHistory: AccountBalanceHistory[] = [
      {
        slug: "td-checking-1234",
        label: "TD Checking",
        accountType: "checking",
        currency: "CAD",
        entries: [
          { yearMonth: "2026-10", balance: 5000 },
          { yearMonth: "2026-11", balance: 5500 },
        ],
      },
      {
        slug: "td-mortgage-5678",
        label: "TD Mortgage",
        accountType: "mortgage",
        currency: "CAD",
        entries: [
          { yearMonth: "2026-10", balance: -250000 },
          { yearMonth: "2026-11", balance: -249000 },
        ],
      },
    ];

    const manualAssets: ManualAsset[] = [
      {
        id: "car-1",
        label: "2020 Honda Civic",
        category: "vehicle",
        value: 50000, // $50k car added
        updatedAt: "2026-11-07",
      },
    ];

    calculateNetWorthForMonths(
      monthlyHistory,
      accountBalanceHistory,
      manualAssets,
      [],
      toHomeCAD,
      new Map()
    );

    // Oct: $5k checking + $50k car - $250k mortgage = -$195k net worth
    expect(monthlyHistory[0].totalAssets).toBe(55000); // 5000 + 50000
    expect(monthlyHistory[0].totalDebts).toBe(250000);
    expect(monthlyHistory[0].netWorth).toBe(-195000); // 55000 - 250000

    // Nov: $5.5k checking + $50k car - $249k mortgage = -$193.5k net worth
    expect(monthlyHistory[1].totalAssets).toBe(55500); // 5500 + 50000
    expect(monthlyHistory[1].totalDebts).toBe(249000);
    expect(monthlyHistory[1].netWorth).toBe(-193500); // 55500 - 249000
  });

  it("should handle manual asset edit (car value change)", () => {
    const monthlyHistory: MonthNetWorthHistory[] = [
      { yearMonth: "2026-11", netWorth: 0, totalAssets: 0, totalDebts: 0, byAccount: [] },
    ];

    const accountBalanceHistory: AccountBalanceHistory[] = [
      {
        slug: "td-checking-1234",
        label: "TD Checking",
        accountType: "checking",
        currency: "CAD",
        entries: [{ yearMonth: "2026-11", balance: 10000 }],
      },
    ];

    // User edits car value from $50k to $45k (depreciation)
    const manualAssets: ManualAsset[] = [
      {
        id: "car-1",
        label: "2020 Honda Civic",
        category: "vehicle",
        value: 45000, // Updated value
        updatedAt: "2026-11-15",
      },
    ];

    calculateNetWorthForMonths(
      monthlyHistory,
      accountBalanceHistory,
      manualAssets,
      [],
      toHomeCAD,
      new Map()
    );

    // $10k + $45k = $55k total assets
    expect(monthlyHistory[0].totalAssets).toBe(55000);
    expect(monthlyHistory[0].netWorth).toBe(55000);
  });

  it("should handle manual asset removal (car sold)", () => {
    const monthlyHistory: MonthNetWorthHistory[] = [
      { yearMonth: "2026-11", netWorth: 0, totalAssets: 0, totalDebts: 0, byAccount: [] },
    ];

    const accountBalanceHistory: AccountBalanceHistory[] = [
      {
        slug: "td-checking-1234",
        label: "TD Checking",
        accountType: "checking",
        currency: "CAD",
        entries: [{ yearMonth: "2026-11", balance: 60000 }], // +50k from sale
      },
    ];

    const manualAssets: ManualAsset[] = []; // Car removed

    calculateNetWorthForMonths(
      monthlyHistory,
      accountBalanceHistory,
      manualAssets,
      [],
      toHomeCAD,
      new Map()
    );

    // $60k only (car sold, proceeds in checking)
    expect(monthlyHistory[0].totalAssets).toBe(60000);
    expect(monthlyHistory[0].netWorth).toBe(60000);
  });

  it("should apply FX conversion correctly", () => {
    const monthlyHistory: MonthNetWorthHistory[] = [
      { yearMonth: "2026-11", netWorth: 0, totalAssets: 0, totalDebts: 0, byAccount: [] },
    ];

    const accountBalanceHistory: AccountBalanceHistory[] = [
      {
        slug: "us-checking-9999",
        label: "US Checking",
        accountType: "checking",
        currency: "USD",
        entries: [{ yearMonth: "2026-11", balance: 1000 }], // $1000 USD
      },
    ];

    const manualAssets: ManualAsset[] = [
      {
        id: "car-1",
        label: "Car",
        category: "vehicle",
        value: 50000, // CAD (manual assets in home currency)
        updatedAt: "2026-11-01",
      },
    ];

    calculateNetWorthForMonths(
      monthlyHistory,
      accountBalanceHistory,
      manualAssets,
      [],
      toHomeCAD, // 1 USD = 1.35 CAD
      new Map()
    );

    // $1000 USD * 1.35 = $1350 CAD + $50k car = $51,350 CAD
    expect(monthlyHistory[0].totalAssets).toBe(51350);
    expect(monthlyHistory[0].netWorth).toBe(51350);
  });

  it("should use EXACT original isAccountActive logic (closure mid-month parity)", () => {
    const monthlyHistory: MonthNetWorthHistory[] = [
      { yearMonth: "2026-11", netWorth: 0, totalAssets: 0, totalDebts: 0, byAccount: [] },
    ];

    const accountBalanceHistory: AccountBalanceHistory[] = [
      {
        slug: "mortgage-1",
        label: "Mortgage",
        accountType: "mortgage",
        currency: "CAD",
        entries: [{ yearMonth: "2026-11", balance: -100000 }],
      },
    ];

    // Account closed mid-month on 2026-11-15
    const accountStatusMap = new Map<string, AccountStatusRecord>([
      [
        "mortgage-1",
        {
          accountSlug: "mortgage-1",
          status: "paid_off",
          statusDate: "2026-11-15", // Closed on the 15th
          statusSource: "auto",
          updatedAt: "2026-11-15T00:00:00Z",
        },
      ],
    ]);

    calculateNetWorthForMonths(
      monthlyHistory,
      accountBalanceHistory,
      [],
      [],
      toHomeCAD,
      accountStatusMap
    );

    // ORIGINAL LOGIC: "2026-11" < "2026-11-15" → TRUE → ACTIVE for month 2026-11
    // Account closed mid-month is ACTIVE for the whole month
    expect(monthlyHistory[0].totalDebts).toBe(100000); // Debt counted
    expect(monthlyHistory[0].netWorth).toBe(-100000);
  });

  it("should exclude closed accounts from net worth", () => {
    const monthlyHistory: MonthNetWorthHistory[] = [
      { yearMonth: "2026-10", netWorth: 0, totalAssets: 0, totalDebts: 0, byAccount: [] },
      { yearMonth: "2026-11", netWorth: 0, totalAssets: 0, totalDebts: 0, byAccount: [] },
    ];

    const accountBalanceHistory: AccountBalanceHistory[] = [
      {
        slug: "td-mortgage-5678",
        label: "TD Mortgage",
        accountType: "mortgage",
        currency: "CAD",
        entries: [
          { yearMonth: "2026-10", balance: -100000 },
          { yearMonth: "2026-11", balance: 0 }, // Paid off
        ],
      },
    ];

    const accountStatusMap = new Map<string, AccountStatusRecord>([
      [
        "td-mortgage-5678",
        {
          accountSlug: "td-mortgage-5678",
          status: "paid_off",
          statusDate: "2026-11-15", // Paid off mid-November
          statusSource: "auto",
          updatedAt: "2026-11-15T00:00:00Z",
        },
      ],
    ]);

    calculateNetWorthForMonths(
      monthlyHistory,
      accountBalanceHistory,
      [],
      [],
      toHomeCAD,
      accountStatusMap
    );

    // Oct: Mortgage active, -$100k debt
    expect(monthlyHistory[0].totalDebts).toBe(100000);
    expect(monthlyHistory[0].netWorth).toBe(-100000);

    // Nov: Mortgage paid off, excluded from net worth (even though balance = 0)
    expect(monthlyHistory[1].totalDebts).toBe(0);
    expect(monthlyHistory[1].netWorth).toBe(0);
  });

  it("should NOT double-count manual assets across months", () => {
    const monthlyHistory: MonthNetWorthHistory[] = [
      { yearMonth: "2026-09", netWorth: 0, totalAssets: 0, totalDebts: 0, byAccount: [] },
      { yearMonth: "2026-10", netWorth: 0, totalAssets: 0, totalDebts: 0, byAccount: [] },
      { yearMonth: "2026-11", netWorth: 0, totalAssets: 0, totalDebts: 0, byAccount: [] },
    ];

    const manualAssets: ManualAsset[] = [
      { id: "car-1", label: "Car", category: "vehicle", value: 50000, updatedAt: "2026-11-01" },
      { id: "house-1", label: "House", category: "property", value: 500000, updatedAt: "2026-11-01" },
    ];

    calculateNetWorthForMonths(
      monthlyHistory,
      [],
      manualAssets,
      [],
      toHomeCAD,
      new Map()
    );

    // Each month gets $550k total (not $550k per asset)
    expect(monthlyHistory[0].totalAssets).toBe(550000);
    expect(monthlyHistory[1].totalAssets).toBe(550000);
    expect(monthlyHistory[2].totalAssets).toBe(550000);
  });

  it("should classify assets vs debts correctly (account with negative balance)", () => {
    const monthlyHistory: MonthNetWorthHistory[] = [
      { yearMonth: "2026-11", netWorth: 0, totalAssets: 0, totalDebts: 0, byAccount: [] },
    ];

    const accountBalanceHistory: AccountBalanceHistory[] = [
      {
        slug: "checking-overdraft",
        label: "Checking",
        accountType: "checking", // Asset type
        currency: "CAD",
        entries: [{ yearMonth: "2026-11", balance: -500 }], // Overdraft
      },
    ];

    calculateNetWorthForMonths(
      monthlyHistory,
      accountBalanceHistory,
      [],
      [],
      toHomeCAD,
      new Map()
    );

    // Negative balance in checking → treated as debt (per code logic)
    expect(monthlyHistory[0].totalAssets).toBe(0); // No positive asset value
    expect(monthlyHistory[0].totalDebts).toBe(500); // Counted as debt
    expect(monthlyHistory[0].netWorth).toBe(-500);
  });

  it("should include byAccount contributions for detail page", () => {
    const monthlyHistory: MonthNetWorthHistory[] = [
      { yearMonth: "2026-11", netWorth: 0, totalAssets: 0, totalDebts: 0, byAccount: [] },
    ];

    const accountBalanceHistory: AccountBalanceHistory[] = [
      {
        slug: "checking-1",
        label: "Checking",
        accountType: "checking",
        currency: "CAD",
        entries: [{ yearMonth: "2026-11", balance: 10000 }],
      },
      {
        slug: "mortgage-1",
        label: "Mortgage",
        accountType: "mortgage",
        currency: "CAD",
        entries: [{ yearMonth: "2026-11", balance: -200000 }],
      },
    ];

    const manualAssets: ManualAsset[] = [
      { id: "car-1", label: "Car", category: "vehicle", value: 50000, updatedAt: "2026-11-01" },
    ];

    calculateNetWorthForMonths(
      monthlyHistory,
      accountBalanceHistory,
      manualAssets,
      [],
      toHomeCAD,
      new Map()
    );

    // byAccount should have checking (+10k), mortgage (-200k), AND car (+50k)
    // Manual assets are now included in byAccount for detail page breakdown
    expect(monthlyHistory[0].byAccount).toHaveLength(3);
    
    const checking = monthlyHistory[0].byAccount.find(a => a.slug === "checking-1");
    expect(checking?.value).toBe(10000);
    
    const mortgage = monthlyHistory[0].byAccount.find(a => a.slug === "mortgage-1");
    expect(mortgage?.value).toBe(-200000);
    
    const car = monthlyHistory[0].byAccount.find(a => a.slug === "manual-car-1");
    expect(car?.value).toBe(50000);
    expect(car?.label).toBe("Car");
    expect(car?.type).toBe("manual-vehicle");
  });

  it("should handle no data gracefully", () => {
    const monthlyHistory: MonthNetWorthHistory[] = [
      { yearMonth: "2026-11", netWorth: 0, totalAssets: 0, totalDebts: 0, byAccount: [] },
    ];

    calculateNetWorthForMonths(
      monthlyHistory,
      [], // No accounts
      [], // No manual assets
      [], // No manual liabilities
      toHomeCAD,
      new Map()
    );

    expect(monthlyHistory[0].totalAssets).toBe(0);
    expect(monthlyHistory[0].totalDebts).toBe(0);
    expect(monthlyHistory[0].netWorth).toBe(0);
    expect(monthlyHistory[0].byAccount).toEqual([]);
  });

  it("includes manual liabilities from known-from month and does not invent earlier balances", () => {
    const monthlyHistory: MonthNetWorthHistory[] = [
      { yearMonth: "2026-01", netWorth: 0, totalAssets: 0, totalDebts: 0, byAccount: [] },
      { yearMonth: "2026-02", netWorth: 0, totalAssets: 0, totalDebts: 0, byAccount: [] },
      { yearMonth: "2026-03", netWorth: 0, totalAssets: 0, totalDebts: 0, byAccount: [] },
    ];

    calculateNetWorthForMonths(
      monthlyHistory,
      [],
      [],
      [{ id: "student-1", label: "Federal Student Loan", category: "student_loan", balance: 15000, updatedAt: "2026-02-15T00:00:00Z" }],
      toHomeCAD,
      new Map()
    );

    expect(monthlyHistory[0].totalDebts).toBe(0);
    expect(monthlyHistory[0].byAccount?.find(a => a.slug === "manual-student-1")).toBeUndefined();

    expect(monthlyHistory[1].totalDebts).toBe(15000);
    expect(monthlyHistory[1].byAccount?.find(a => a.slug === "manual-student-1")?.value).toBe(-15000);

    expect(monthlyHistory[2].totalDebts).toBe(15000);
    expect(monthlyHistory[2].netWorth).toBe(-15000);
  });

  it("linked manual counts in Feb when imported first contributes in March, then skips in March", () => {
    const monthlyHistory: MonthNetWorthHistory[] = [
      { yearMonth: "2026-02", netWorth: 0, totalAssets: 0, totalDebts: 0, byAccount: [] },
      { yearMonth: "2026-03", netWorth: 0, totalAssets: 0, totalDebts: 0, byAccount: [] },
    ];

    const accountBalanceHistory: AccountBalanceHistory[] = [
      {
        slug: "osap-loan",
        label: "OSAP Student Loan",
        accountType: "loan",
        currency: "CAD",
        entries: [{ yearMonth: "2026-03", balance: -8000 }],
      },
    ];

    calculateNetWorthForMonths(
      monthlyHistory,
      accountBalanceHistory,
      [],
      [{
        id: "osap-manual",
        label: "OSAP Student Loan",
        category: "student_loan",
        balance: 7500,
        startDate: "2026-02-01",
        linkedAccountSlug: "osap-loan",
        updatedAt: "2026-02-01T00:00:00Z",
      }],
      toHomeCAD,
      new Map()
    );

    // Feb: imported has no statement yet — keep the manual once
    expect(monthlyHistory[0].totalDebts).toBe(7500);
    expect(monthlyHistory[0].byAccount?.map(a => a.slug)).toEqual(["manual-osap-manual"]);

    // March: imported contributes — skip the linked manual
    expect(monthlyHistory[1].totalDebts).toBe(8000);
    expect(monthlyHistory[1].byAccount?.map(a => a.slug)).toEqual(["osap-loan"]);
  });

  it("distinct same-label imported and manual loans both count when not linked", () => {
    const monthlyHistory: MonthNetWorthHistory[] = [
      { yearMonth: "2026-03", netWorth: 0, totalAssets: 0, totalDebts: 0, byAccount: [] },
    ];

    const accountBalanceHistory: AccountBalanceHistory[] = [
      {
        slug: "osap-imported",
        label: "OSAP Student Loan",
        accountType: "loan",
        currency: "CAD",
        entries: [{ yearMonth: "2026-03", balance: -8000 }],
      },
    ];

    calculateNetWorthForMonths(
      monthlyHistory,
      accountBalanceHistory,
      [],
      [{
        id: "osap-other",
        label: "OSAP Student Loan",
        category: "student_loan",
        balance: 5000,
        updatedAt: "2026-01-01T00:00:00Z",
      }],
      toHomeCAD,
      new Map()
    );

    expect(monthlyHistory[0].totalDebts).toBe(13000);
    const slugs = monthlyHistory[0].byAccount?.map(a => a.slug).sort();
    expect(slugs).toEqual(["manual-osap-other", "osap-imported"]);
  });
});
