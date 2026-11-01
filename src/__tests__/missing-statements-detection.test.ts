/**
 * Tests for missing statements detection in getLatestCompleteMonth
 */

import { getLatestCompleteMonth } from "../lib/rangeUtils";

describe("Missing statements detection", () => {
  it("should detect missing accounts when skipping an incomplete latest month", () => {
    // Scenario: User has uploaded Oct for checking but not for credit
    // Oct is incomplete, so anchor falls back to Sep (which is complete)
    // Should return Sep as anchor with Oct accounts missing
    const accountSnapshots = [
      // Checking accounts - both have Oct
      {
        accountType: "Checking",
        statementMonth: "2026-10",
        accountName: "TD Checking Account",
        slug: "td-checking-1234",
      },
      {
        accountType: "Checking",
        statementMonth: "2026-10",
        accountName: "RBC Chequing Account",
        slug: "rbc-chequing-5678",
      },
      // Credit card - only has Sep, missing Oct
      {
        accountType: "Credit",
        statementMonth: "2026-09",
        accountName: "TD Visa Card",
        slug: "td-credit-9012",
      },
      // All accounts also have Sep (complete month)
      {
        accountType: "Checking",
        statementMonth: "2026-09",
        accountName: "TD Checking Account",
        slug: "td-checking-1234",
      },
      {
        accountType: "Checking",
        statementMonth: "2026-09",
        accountName: "RBC Chequing Account",
        slug: "rbc-chequing-5678",
      },
    ];

    const result = getLatestCompleteMonth(accountSnapshots);

    expect(result.latestCompleteMonth).toBe("2026-09");
    expect(result.missingAccounts).toHaveLength(1);
    expect(result.missingAccounts[0]).toContain("TD"); // Should contain bank name
    expect(result.missingAccounts[0]).toContain("Credit"); // Should contain account type
    expect(result.missingAccounts[0]).toContain("9012"); // Should contain last 4
    expect(result.missingMonth).toBe("2026-10");
  });

  it("should detect missing accounts when calendar has moved past the anchor", () => {
    // Scenario: Today is Nov 1, 2026
    // User has complete statements through Sep
    // Oct (last full calendar month) is missing for all accounts
    // Should return Sep as anchor with all Oct accounts missing
    
    // Mock getCurrentMonth to return Nov 2026
    const originalGetCurrentMonth = global.Date;
    global.Date = class extends originalGetCurrentMonth {
      constructor(...args: any[]) {
        if (args.length === 0) {
          super(2026, 10, 1); // Nov 1, 2026
        } else {
          super(...args);
        }
      }
      static now() {
        return new originalGetCurrentMonth(2026, 10, 1).getTime();
      }
    } as any;

    const accountSnapshots = [
      // All accounts have Sep (complete and anchor)
      {
        accountType: "Checking",
        statementMonth: "2026-09",
        accountName: "TD Checking Account",
        slug: "td-checking-1234",
      },
      {
        accountType: "Credit",
        statementMonth: "2026-09",
        accountName: "TD Visa Card",
        slug: "td-credit-5678",
      },
      // Also have Aug
      {
        accountType: "Checking",
        statementMonth: "2026-08",
        accountName: "TD Checking Account",
        slug: "td-checking-1234",
      },
      {
        accountType: "Credit",
        statementMonth: "2026-08",
        accountName: "TD Visa Card",
        slug: "td-credit-5678",
      },
    ];

    const result = getLatestCompleteMonth(accountSnapshots);

    // Restore Date
    global.Date = originalGetCurrentMonth;

    expect(result.latestCompleteMonth).toBe("2026-09");
    expect(result.missingAccounts).toHaveLength(2);
    expect(result.missingMonth).toBe("2026-10");
    
    // Should have both accounts in the missing list
    const missingAccountsStr = result.missingAccounts.join(" ");
    expect(missingAccountsStr).toContain("TD");
    expect(missingAccountsStr).toContain("Checking");
    expect(missingAccountsStr).toContain("Credit");
  });

  it("should not include savings accounts in blocking types", () => {
    // Scenario: Checking and credit have Oct, savings only has Sep
    // Oct should still be considered complete (savings doesn't block)
    const accountSnapshots = [
      // Checking has Oct
      {
        accountType: "Checking",
        statementMonth: "2026-10",
        accountName: "TD Checking Account",
        slug: "td-checking-1234",
      },
      {
        accountType: "Checking",
        statementMonth: "2026-09",
        accountName: "TD Checking Account",
        slug: "td-checking-1234",
      },
      // Credit has Oct
      {
        accountType: "Credit",
        statementMonth: "2026-10",
        accountName: "TD Visa Card",
        slug: "td-credit-5678",
      },
      {
        accountType: "Credit",
        statementMonth: "2026-09",
        accountName: "TD Visa Card",
        slug: "td-credit-5678",
      },
      // Savings only has Sep (should NOT block Oct)
      {
        accountType: "Savings",
        statementMonth: "2026-09",
        accountName: "TD Savings Account",
        slug: "td-savings-9012",
      },
    ];

    const result = getLatestCompleteMonth(accountSnapshots);

    expect(result.latestCompleteMonth).toBe("2026-10");
    expect(result.missingAccounts).toEqual([]);
    expect(result.missingMonth).toBeUndefined();
  });

  it("should format account names as Bank Type •••1234", () => {
    const accountSnapshots = [
      {
        accountType: "Checking",
        statementMonth: "2026-10",
        accountName: "TD Checking Account",
        slug: "td-checking-1234",
      },
      {
        accountType: "Checking",
        statementMonth: "2026-09",
        accountName: "TD Checking Account",
        slug: "td-checking-1234",
      },
      // Credit missing Oct
      {
        accountType: "Credit",
        statementMonth: "2026-09",
        accountName: "RBC Visa Infinite Card",
        slug: "rbc-credit-5678",
      },
    ];

    const result = getLatestCompleteMonth(accountSnapshots);

    expect(result.latestCompleteMonth).toBe("2026-09");
    expect(result.missingAccounts).toHaveLength(1);
    // Format should be "RBC Credit •••5678"
    expect(result.missingAccounts[0]).toMatch(/RBC.*Credit.*•••5678/);
  });

  it("should handle loan-only accounts without blocking", () => {
    // Scenario: Only have loan accounts, no checking/credit
    // Should return latest loan month as anchor
    const accountSnapshots = [
      {
        accountType: "Loan",
        statementMonth: "2026-10",
        accountName: "TD Mortgage",
        slug: "td-loan-1234",
      },
      {
        accountType: "Loan",
        statementMonth: "2026-09",
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
