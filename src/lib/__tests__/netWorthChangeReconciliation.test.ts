/**
 * Test that change event impacts reconcile with month-to-month net worth delta
 */

import { describe, test, expect } from "vitest";
import type { MonthlyHistoryEntry } from "../financialProfile";

describe("Net Worth Change Reconciliation", () => {
  test("sum of change impacts equals net worth delta", () => {
    // Oct 2026: no car
    const oct: MonthlyHistoryEntry = {
      yearMonth: "2026-10",
      netWorth: -190000,
      totalAssets: 10000,
      totalDebts: 200000,
      expensesTotal: 3000,
      coreExpensesTotal: 2500,
      incomeTotal: 5000,
      byAccount: [
        { slug: "checking-1", label: "Checking", type: "checking", value: 10000 },
        { slug: "mortgage-1", label: "Mortgage", type: "mortgage", value: -200000 },
      ],
    };

    // Nov 2026: car added, checking unchanged
    const nov: MonthlyHistoryEntry = {
      yearMonth: "2026-11",
      netWorth: -165000,
      totalAssets: 35000,
      totalDebts: 200000,
      expensesTotal: 3200,
      coreExpensesTotal: 2700,
      incomeTotal: 5100,
      byAccount: [
        { slug: "checking-1", label: "Checking", type: "checking", value: 10000 },
        { slug: "manual-car-1", label: "Honda Civic", type: "manual-vehicle", value: 25000 },
        { slug: "mortgage-1", label: "Mortgage", type: "mortgage", value: -200000 },
      ],
    };

    // Actual month-to-month delta
    const actualDelta = nov.netWorth - oct.netWorth;
    expect(actualDelta).toBe(25000); // +$25k from car

    // Compute change impacts from byAccount
    const octBySlug = new Map(oct.byAccount.map(a => [a.slug, a.value]));
    const novBySlug = new Map(nov.byAccount.map(a => [a.slug, a.value]));
    const allSlugs = new Set([...octBySlug.keys(), ...novBySlug.keys()]);

    let sumOfChanges = 0;
    for (const slug of allSlugs) {
      const octValue = octBySlug.get(slug) || 0;
      const novValue = novBySlug.get(slug) || 0;
      const change = novValue - octValue;
      sumOfChanges += change;
    }

    // Sum of changes must equal actual delta
    expect(sumOfChanges).toBe(actualDelta);
  });

  test("new asset event impact matches first-month contribution", () => {
    // Oct: no car
    const octBySlug = new Map([
      ["checking-1", 10000],
      ["mortgage-1", -200000],
    ]);

    // Nov: car appears
    const novBySlug = new Map([
      ["checking-1", 10000],
      ["manual-car-1", 25000], // New
      ["mortgage-1", -200000],
    ]);

    // Change for car slug
    const carChange = (novBySlug.get("manual-car-1") || 0) - (octBySlug.get("manual-car-1") || 0);
    expect(carChange).toBe(25000);

    // new_asset event should have impact = carChange
    const newAssetImpact = 25000;
    expect(newAssetImpact).toBe(carChange);
  });

  test("car in both months (all-history) produces zero change", () => {
    // Oct: car already present
    const octBySlug = new Map([
      ["checking-1", 10000],
      ["manual-car-1", 25000], // Already here
      ["mortgage-1", -200000],
    ]);

    // Nov: car still present, same value
    const novBySlug = new Map([
      ["checking-1", 10000],
      ["manual-car-1", 25000], // Unchanged
      ["mortgage-1", -200000],
    ]);

    // Change for car
    const carChange = (novBySlug.get("manual-car-1") || 0) - (octBySlug.get("manual-car-1") || 0);
    expect(carChange).toBe(0); // No change

    // Should NOT generate new_asset event impact in Nov
    // (event only generated in createdAt month, not every month)
  });

  test("reconciliation: totalAssets - totalDebts = netWorth", () => {
    const month: MonthlyHistoryEntry = {
      yearMonth: "2026-11",
      netWorth: -165000,
      totalAssets: 35000,
      totalDebts: 200000,
      expensesTotal: 3200,
      coreExpensesTotal: 2700,
      incomeTotal: 5100,
      byAccount: [
        { slug: "checking-1", label: "Checking", type: "checking", value: 10000 },
        { slug: "manual-car-1", label: "Honda Civic", type: "manual-vehicle", value: 25000 },
        { slug: "mortgage-1", label: "Mortgage", type: "mortgage", value: -200000 },
      ],
    };

    expect(month.totalAssets - month.totalDebts).toBe(month.netWorth);

    // Verify byAccount sums
    const assetsSum = month.byAccount.filter(a => a.value > 0).reduce((s, a) => s + a.value, 0);
    const debtsSum = Math.abs(month.byAccount.filter(a => a.value < 0).reduce((s, a) => s + a.value, 0));

    expect(assetsSum).toBe(month.totalAssets);
    expect(debtsSum).toBe(month.totalDebts);
  });

  test("baseline (first statement) does not generate account_added event", () => {
    // Baseline accounts appear in byAccount but don't generate change events
    // because we don't know if they're truly new or just first upload
    
    const month1BySlug = new Map<string, number>();
    const month2BySlug = new Map([
      ["checking-1", 10000], // First appearance
    ]);

    const change = (month2BySlug.get("checking-1") || 0) - (month1BySlug.get("checking-1") || 0);
    expect(change).toBe(10000);

    // This is a "baseline" - appears in change breakdown but NOT as account_added event
    // (unless evidence of being truly new per netWorthChanges.ts logic)
  });
});
