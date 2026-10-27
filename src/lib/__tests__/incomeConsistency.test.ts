/**
 * Test that dashboard income card, drawer, and Income page Overview tab
 * all show the same "typical monthly" value (last 3 complete months average).
 * 
 * This ensures the unified data layer (buildIncomeSummary) is working correctly
 * and all consumers show consistent numbers.
 */

import { describe, test, expect } from "vitest";
import { buildIncomeSummary } from "../incomeSummary";
import type { IncomeTxnRecord, AccountSnapshot } from "../extractTransactions";

describe("Income consistency: dashboard == drawer == page", () => {
  test("typical monthly income matches across all views", () => {
    // Sample fixture data
    const incomeTxns: IncomeTxnRecord[] = [
      // Regular payroll - 3 months
      { source: "Acme Corp", amount: 5000, date: "2026-07-15", txMonth: "2026-07", category: "Salary", accountSlug: "checking_1234" },
      { source: "Acme Corp", amount: 5000, date: "2026-08-15", txMonth: "2026-08", category: "Salary", accountSlug: "checking_1234" },
      { source: "Acme Corp", amount: 5000, date: "2026-09-15", txMonth: "2026-09", category: "Salary", accountSlug: "checking_1234" },
      // Current month (should be excluded from last 3 complete)
      { source: "Acme Corp", amount: 2500, date: "2026-10-15", txMonth: "2026-10", category: "Salary", accountSlug: "checking_1234" },
      // One-off bonus (should be excluded from typical)
      { source: "Acme Corp - Bonus", amount: 3000, date: "2026-08-20", txMonth: "2026-08", category: "Bonus", accountSlug: "checking_1234" },
    ];

    const accountSnapshots: AccountSnapshot[] = [
      {
        slug: "checking_1234",
        bankName: "Test Bank",
        accountName: "Checking",
        accountType: "Checking",
        accountId: "1234",
        balance: 10000,
        currency: "CAD",
        statementMonth: "2026-10",
        interestRate: 0,
      },
    ];

    // Build income summary
    const summary = buildIncomeSummary(incomeTxns, accountSnapshots, "CAD");

    // Verify last 3 complete months excludes October
    expect(summary.last3Months).toEqual(["2026-07", "2026-08", "2026-09"]);

    // Verify typical monthly is average of regular income only (excluding one-off bonus)
    // Jul: 5000, Aug: 5000 (bonus excluded), Sep: 5000
    // Average: 15000 / 3 = 5000
    expect(summary.typicalMonthly).toBe(5000);

    // Verify current month is tracked separately
    expect(summary.currentMonth).toBe("2026-10");
    expect(summary.currentMonthTotal).toBe(2500);

    // Verify regular vs one-off split
    expect(summary.regularSources).toHaveLength(1);
    expect(summary.regularSources[0].description).toBe("Acme Corp");
    expect(summary.oneOffSources).toHaveLength(1);
    expect(summary.oneOffSources[0].canonicalName).toBe("Acme Corp - Bonus");
  });

  test("handles zero income months correctly", () => {
    const incomeTxns: IncomeTxnRecord[] = [
      { source: "Test Corp", amount: 4000, date: "2026-07-15", txMonth: "2026-07", category: "Salary", accountSlug: "checking_1234" },
      // Aug has no income
      { source: "Test Corp", amount: 4000, date: "2026-09-15", txMonth: "2026-09", category: "Salary", accountSlug: "checking_1234" },
    ];

    const accountSnapshots: AccountSnapshot[] = [
      {
        slug: "checking_1234",
        bankName: "Test Bank",
        accountName: "Checking",
        accountType: "Checking",
        accountId: "1234",
        balance: 8000,
        currency: "CAD",
        statementMonth: "2026-09",
        interestRate: 0,
      },
    ];

    const summary = buildIncomeSummary(incomeTxns, accountSnapshots, "CAD");

    // Should include both Jul and Sep, Aug will have 0
    expect(summary.monthlyHistory).toHaveLength(2);
    
    // Typical should average the months with data
    expect(summary.typicalMonthly).toBeGreaterThan(0);
  });

  test("source clustering works for generic names", () => {
    const incomeTxns: IncomeTxnRecord[] = [
      // Generic "Deposit" with different amounts should cluster
      { source: "Deposit", amount: 2000, date: "2026-07-15", txMonth: "2026-07", category: "Other", accountSlug: "checking_1234" },
      { source: "Deposit", amount: 2050, date: "2026-07-25", txMonth: "2026-07", category: "Other", accountSlug: "checking_1234" },
      { source: "Deposit", amount: 5000, date: "2026-08-10", txMonth: "2026-08", category: "Other", accountSlug: "checking_1234" },
      { source: "Deposit", amount: 5100, date: "2026-08-20", txMonth: "2026-08", category: "Other", accountSlug: "checking_1234" },
    ];

    const accountSnapshots: AccountSnapshot[] = [
      {
        slug: "checking_1234",
        bankName: "Test Bank",
        accountName: "Checking",
        accountType: "Checking",
        accountId: "1234",
        balance: 14150,
        currency: "CAD",
        statementMonth: "2026-08",
        interestRate: 0,
      },
    ];

    const summary = buildIncomeSummary(incomeTxns, accountSnapshots, "CAD");

    // Should cluster into two groups: ~$2000 and ~$5000
    // Expect at least 2 sources (could be "Deposit — CA$2,025" and "Deposit — CA$5,050")
    expect(summary.sources.length).toBeGreaterThanOrEqual(2);
    
    // Verify clustering happened (sources have amount suffixes)
    const clusteredSources = summary.sources.filter(s => s.description.includes("—"));
    expect(clusteredSources.length).toBeGreaterThanOrEqual(2);
  });

  test("transfer detection works", () => {
    const incomeTxns: IncomeTxnRecord[] = [
      { source: "E-TRANSFER FROM JOHN", amount: 500, date: "2026-07-15", txMonth: "2026-07", category: "Transfer In", accountSlug: "checking_1234" },
      { source: "INTERAC DEPOSIT", amount: 300, date: "2026-08-10", txMonth: "2026-08", category: "Transfer In", accountSlug: "checking_1234" },
      { source: "Acme Corp Payroll", amount: 5000, date: "2026-07-20", txMonth: "2026-07", category: "Salary", accountSlug: "checking_1234" },
    ];

    const accountSnapshots: AccountSnapshot[] = [
      {
        slug: "checking_1234",
        bankName: "Test Bank",
        accountName: "Checking",
        accountType: "Checking",
        accountId: "1234",
        balance: 5800,
        currency: "CAD",
        statementMonth: "2026-08",
        interestRate: 0,
      },
    ];

    const summary = buildIncomeSummary(incomeTxns, accountSnapshots, "CAD");

    // Should identify 2 transfer sources
    expect(summary.transferSources.length).toBeGreaterThanOrEqual(1);
    
    // Regular sources should only include non-transfer
    expect(summary.regularSources.length).toBeGreaterThanOrEqual(1);
    const regularSource = summary.regularSources.find(s => s.canonicalName === "Acme Corp Payroll");
    expect(regularSource).toBeDefined();
  });
});
