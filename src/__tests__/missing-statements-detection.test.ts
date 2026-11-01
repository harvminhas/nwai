/**
 * Tests for missing statements detection in getLatestCompleteMonth
 * Now based on actual coverage dates, not month labels.
 */

import { getLatestCompleteMonth } from "../lib/rangeUtils";

describe("Missing statements detection (coverage-based)", () => {
  it("should use coverage dates: CIBC card closing Sept 24, checking through Oct 31", () => {
    // Realistic scenario:
    // - CIBC credit card last statement period ended Sept 24 (within 7-day grace of Sept 30)
    // - TD checking account has statement through Oct 31
    // - Both also have complete Aug coverage
    // Expected: anchor is Sept (complete), modal asks for October statements for CIBC
    
    const accountSnapshots = [
      // CIBC credit card - closes on the 24th, last statement Sept 24
      {
        accountType: "Credit",
        statementMonth: "2026-09",
        statementDate: "2026-09-24", // Within 7-day grace of Sept 30
        accountName: "CIBC Dividend Visa",
        slug: "cibc-credit-0773",
      },
      // TD checking - complete through Oct 31
      {
        accountType: "Checking",
        statementMonth: "2026-10",
        statementDate: "2026-10-31",
        accountName: "TD Chequing Account",
        slug: "td-checking-1234",
      },
      // Earlier CIBC statements (Aug)
      {
        accountType: "Credit",
        statementMonth: "2026-08",
        statementDate: "2026-08-24",
        accountName: "CIBC Dividend Visa",
        slug: "cibc-credit-0773",
      },
      // Earlier TD statements (Aug, Sept)
      {
        accountType: "Checking",
        statementMonth: "2026-08",
        statementDate: "2026-08-31",
        accountName: "TD Chequing Account",
        slug: "td-checking-1234",
      },
      {
        accountType: "Checking",
        statementMonth: "2026-09",
        statementDate: "2026-09-30",
        accountName: "TD Chequing Account",
        slug: "td-checking-1234",
      },
    ];

    const result = getLatestCompleteMonth(accountSnapshots);

    expect(result.latestCompleteMonth).toBe("2026-09");
    expect(result.missingAccounts).toHaveLength(1);
    expect(result.missingAccounts[0]).toContain("CIBC");
    expect(result.missingAccounts[0]).toContain("Credit");
    expect(result.missingAccounts[0]).toContain("0773");
    expect(result.missingAccounts[0]).toContain("through Sep 24"); // Coverage info
    expect(result.missingMonth).toBe("2026-10");
  });

  it("should never ask for a month that isn't finished yet", () => {
    // Today is Nov 1, 2026 - November is not complete yet
    // Accounts have coverage through Oct 31
    // Should NOT ask for November statements
    
    const accountSnapshots = [
      // Oct statements
      {
        accountType: "Checking",
        statementMonth: "2026-10",
        statementDate: "2026-10-31",
        accountName: "TD Checking Account",
        slug: "td-checking-1234",
      },
      {
        accountType: "Credit",
        statementMonth: "2026-10",
        statementDate: "2026-10-24", // Card closes mid-month, within grace
        accountName: "CIBC Visa",
        slug: "cibc-credit-5678",
      },
      // Sept statements (for coverage history)
      {
        accountType: "Checking",
        statementMonth: "2026-09",
        statementDate: "2026-09-30",
        accountName: "TD Checking Account",
        slug: "td-checking-1234",
      },
      {
        accountType: "Credit",
        statementMonth: "2026-09",
        statementDate: "2026-09-24",
        accountName: "CIBC Visa",
        slug: "cibc-credit-5678",
      },
    ];

    const result = getLatestCompleteMonth(accountSnapshots);

    // October should be complete (both accounts cover through Oct with 7-day grace)
    expect(result.latestCompleteMonth).toBe("2026-10");
    // Should NOT have November in missingMonth (it's not finished)
    expect(result.missingMonth).toBeUndefined();
    expect(result.missingAccounts).toEqual([]);
  });

  it("should not include savings accounts in blocking types", () => {
    // Scenario: Checking and credit have Oct coverage, savings only through Sep
    // Oct should still be considered complete (savings doesn't block)
    const accountSnapshots = [
      // Oct statements for checking and credit
      {
        accountType: "Checking",
        statementMonth: "2026-10",
        statementDate: "2026-10-31",
        accountName: "TD Checking Account",
        slug: "td-checking-1234",
      },
      {
        accountType: "Credit",
        statementMonth: "2026-10",
        statementDate: "2026-10-24",
        accountName: "TD Visa Card",
        slug: "td-credit-5678",
      },
      // Sept statements
      {
        accountType: "Checking",
        statementMonth: "2026-09",
        statementDate: "2026-09-30",
        accountName: "TD Checking Account",
        slug: "td-checking-1234",
      },
      {
        accountType: "Credit",
        statementMonth: "2026-09",
        statementDate: "2026-09-24",
        accountName: "TD Visa Card",
        slug: "td-credit-5678",
      },
      // Savings only through Sep (should NOT block Oct)
      {
        accountType: "Savings",
        statementMonth: "2026-09",
        statementDate: "2026-09-30",
        accountName: "TD Savings Account",
        slug: "td-savings-9012",
      },
    ];

    const result = getLatestCompleteMonth(accountSnapshots);

    expect(result.latestCompleteMonth).toBe("2026-10");
    expect(result.missingAccounts).toEqual([]);
    expect(result.missingMonth).toBeUndefined();
  });

  it("should account for 7-day grace period for mid-month card closings", () => {
    // Card closing on Sept 23 should count as covering September
    // (last day is Sept 30, minus 7 days grace = Sept 23)
    const accountSnapshots = [
      {
        accountType: "Credit",
        statementMonth: "2026-09",
        statementDate: "2026-09-23", // Within 7 days of month end
        accountName: "RBC Visa",
        slug: "rbc-credit-5678",
      },
      {
        accountType: "Checking",
        statementMonth: "2026-09",
        statementDate: "2026-09-30",
        accountName: "TD Checking",
        slug: "td-checking-1234",
      },
    ];

    const result = getLatestCompleteMonth(accountSnapshots);

    // September should be complete (both within grace)
    expect(result.latestCompleteMonth).toBe("2026-09");
  });

  it("should filter dormant accounts (no statement in last 60 days)", () => {
    // Old credit card hasn't had a statement in 90 days - should be ignored
    const accountSnapshots = [
      {
        accountType: "Checking",
        statementMonth: "2026-10",
        statementDate: "2026-10-31",
        accountName: "TD Checking",
        slug: "td-checking-1234",
      },
      // Dormant card - last statement was July (90+ days ago relative to Oct 31)
      {
        accountType: "Credit",
        statementMonth: "2026-07",
        statementDate: "2026-07-20",
        accountName: "Old Visa",
        slug: "old-credit-5678",
      },
    ];

    const result = getLatestCompleteMonth(accountSnapshots);

    // October should be complete (dormant card doesn't block)
    expect(result.latestCompleteMonth).toBe("2026-10");
    expect(result.missingAccounts).toEqual([]);
  });

  it("should handle loan-only accounts without blocking", () => {
    // Only have loan accounts, no checking/credit
    // Should return latest loan month as anchor
    const accountSnapshots = [
      {
        accountType: "Loan",
        statementMonth: "2026-10",
        statementDate: "2026-10-31",
        accountName: "TD Mortgage",
        slug: "td-loan-1234",
      },
    ];

    const result = getLatestCompleteMonth(accountSnapshots);

    expect(result.latestCompleteMonth).toBe("2026-10");
    expect(result.missingAccounts).toEqual([]);
    expect(result.missingMonth).toBeUndefined();
  });
});
