/**
 * Test that manual assets appear in byAccount breakdown
 * 
 * Root cause: manualAssetsTotal was added to totalAssets but manual assets
 * were omitted from byAccount array, so they appeared in totals but not in
 * itemized breakdowns (Assets tab, What Moved It, etc.)
 */

import { describe, test, expect } from "vitest";
import { calculateNetWorthForMonths } from "../netWorthCalculationCore";
import type { ManualAsset } from "../types";
import type { AccountStatusRecord } from "../accountStatus";

describe("Net Worth byAccount includes manual assets", () => {
  test("manual assets appear individually in byAccount", () => {
    const monthlyHistory = [
      { yearMonth: "2026-10", netWorth: 0, totalAssets: 0, totalDebts: 0, byAccount: [] },
      { yearMonth: "2026-11", netWorth: 0, totalAssets: 0, totalDebts: 0, byAccount: [] },
    ];

    const accountBalanceHistory = [
      {
        slug: "td-checking-1234",
        label: "TD Chequing",
        accountType: "checking",
        currency: "CAD",
        entries: [
          { yearMonth: "2026-10", balance: 5000 },
          { yearMonth: "2026-11", balance: 5500 },
        ],
      },
    ];

    const manualAssets: ManualAsset[] = [
      {
        id: "car-1",
        label: "2022 Honda Civic",
        category: "vehicle",
        value: 25000,
        updatedAt: "2026-10-01T00:00:00Z",
      },
      {
        id: "house-1",
        label: "Primary Residence",
        category: "property",
        value: 750000,
        updatedAt: "2026-10-01T00:00:00Z",
      },
    ];

    const toHome = (balance: number) => balance;
    const accountStatusMap = new Map<string, AccountStatusRecord>();

    calculateNetWorthForMonths(
      monthlyHistory as any,
      accountBalanceHistory,
      manualAssets,
      toHome,
      accountStatusMap
    );

    // Nov 2026: totalAssets should include checking + car + house
    expect(monthlyHistory[1].totalAssets).toBe(5500 + 25000 + 750000);

    // byAccount should include ALL items: checking account + 2 manual assets
    expect(monthlyHistory[1].byAccount).toHaveLength(3);

    // Find each item
    const checking = monthlyHistory[1].byAccount!.find((a) => a.slug === "td-checking-1234");
    const car = monthlyHistory[1].byAccount!.find((a) => a.slug === "manual-car-1");
    const house = monthlyHistory[1].byAccount!.find((a) => a.slug === "manual-house-1");

    expect(checking).toEqual({
      slug: "td-checking-1234",
      label: "TD Chequing",
      type: "checking",
      value: 5500,
    });

    expect(car).toEqual({
      slug: "manual-car-1",
      label: "2022 Honda Civic",
      type: "manual-vehicle",
      value: 25000,
    });

    expect(house).toEqual({
      slug: "manual-house-1",
      label: "Primary Residence",
      type: "manual-property",
      value: 750000,
    });
  });

  test("totals reconcile: assets - debts = netWorth, byAccount sums match", () => {
    const monthlyHistory = [
      { yearMonth: "2026-11", netWorth: 0, totalAssets: 0, totalDebts: 0, byAccount: [] },
    ];

    const accountBalanceHistory = [
      {
        slug: "td-checking-1234",
        label: "TD Chequing",
        accountType: "checking",
        currency: "CAD",
        entries: [{ yearMonth: "2026-11", balance: 10000 }],
      },
      {
        slug: "td-visa-5678",
        label: "TD Visa",
        accountType: "credit",
        currency: "CAD",
        entries: [{ yearMonth: "2026-11", balance: -2500 }],
      },
    ];

    const manualAssets: ManualAsset[] = [
      {
        id: "car-1",
        label: "Car",
        category: "vehicle",
        value: 30000,
        updatedAt: "2026-11-01T00:00:00Z",
      },
    ];

    const toHome = (balance: number) => balance;
    const accountStatusMap = new Map<string, AccountStatusRecord>();

    calculateNetWorthForMonths(
      monthlyHistory as any,
      accountBalanceHistory,
      manualAssets,
      toHome,
      accountStatusMap
    );

    // Check totals
    expect(monthlyHistory[0].totalAssets).toBe(10000 + 30000); // 40,000
    expect(monthlyHistory[0].totalDebts).toBe(2500);
    expect(monthlyHistory[0].netWorth).toBe(40000 - 2500); // 37,500

    // byAccount should have 3 items
    expect(monthlyHistory[0].byAccount).toHaveLength(3);

    // Sum byAccount values
    const byAccountSum = monthlyHistory[0].byAccount!.reduce((sum, item) => sum + item.value, 0);
    
    // byAccount sum should equal netWorth (assets positive, debts negative)
    expect(byAccountSum).toBe(monthlyHistory[0].netWorth);

    // Assets sum (positive values)
    const assetsSum = monthlyHistory[0].byAccount!
      .filter((item) => item.value > 0)
      .reduce((sum, item) => sum + item.value, 0);
    expect(assetsSum).toBe(monthlyHistory[0].totalAssets);

    // Debts sum (absolute of negative values)
    const debtsSum = Math.abs(
      monthlyHistory[0].byAccount!
        .filter((item) => item.value < 0)
        .reduce((sum, item) => sum + item.value, 0)
    );
    expect(debtsSum).toBe(monthlyHistory[0].totalDebts);
  });
});
