/**
 * Regression test for bug where dashboard showed "CA$0/mo avg · Last 0 months"
 * Root causes:
 * (a) statementDate parsing failed when field was missing/empty or already ISO timestamp
 * (b) When completeMonths was empty, missing info wasn't returned
 * (c) Empty window showed $0 instead of falling back to available data
 */

import { resolveWindowMonths } from "../lib/rangeUtils";

describe("Real Firestore data regression tests", () => {
  it("should handle missing statementDate by falling back to end of statementMonth", () => {
    // Real scenario: old statements don't have statementDate field
    const monthlyHistory = [
      { yearMonth: "2026-08" },
      { yearMonth: "2026-09" },
      { yearMonth: "2026-10" },
    ];
    
    const accountSnapshots = [
      // Old statement without statementDate
      { 
        accountType: "Checking", 
        statementMonth: "2026-08", 
        statementDate: undefined as any,
        slug: "td-checking-1234" 
      },
      { 
        accountType: "Credit", 
        statementMonth: "2026-08", 
        // @ts-ignore - simulating Firestore missing field
        statementDate: undefined, 
        slug: "cibc-credit-5678" 
      },
      // Newer statement with statementDate
      { 
        accountType: "Checking", 
        statementMonth: "2026-09", 
        statementDate: "2026-09-30", 
        slug: "td-checking-1234" 
      },
      { 
        accountType: "Credit", 
        statementMonth: "2026-09", 
        statementDate: "2026-09-24", 
        slug: "cibc-credit-5678" 
      },
    ];

    const result = resolveWindowMonths("3mo", monthlyHistory, accountSnapshots);

    // Should NOT return 0 months
    expect(result.months.length).toBeGreaterThan(0);
    expect(result.actualCount).toBeGreaterThan(0);
  });

  it("should handle ISO timestamp in statementDate field", () => {
    // Real scenario: some parsers return full ISO timestamps
    const monthlyHistory = [
      { yearMonth: "2026-09" },
      { yearMonth: "2026-10" },
    ];
    
    const accountSnapshots = [
      { 
        accountType: "Checking", 
        statementMonth: "2026-09", 
        statementDate: "2026-09-30T23:59:59.000Z", // Full ISO timestamp
        slug: "td-checking-1234" 
      },
      { 
        accountType: "Credit", 
        statementMonth: "2026-09", 
        statementDate: "2026-09-24T00:00:00Z", // ISO with time
        slug: "cibc-credit-5678" 
      },
      { 
        accountType: "Checking", 
        statementMonth: "2026-10", 
        statementDate: "2026-10-31T23:59:59.000Z",
        slug: "td-checking-1234" 
      },
      { 
        accountType: "Credit", 
        statementMonth: "2026-10", 
        statementDate: "2026-10-24T00:00:00Z",
        slug: "cibc-credit-5678" 
      },
    ];

    const result = resolveWindowMonths("3mo", monthlyHistory, accountSnapshots);

    // Should parse dates correctly and return complete months
    expect(result.months).toContain("2026-09");
    expect(result.months).toContain("2026-10");
    expect(result.actualCount).toBeGreaterThan(0);
  });

  it("should return missing info even when no complete months exist", () => {
    // Real scenario: user uploaded only partial data (credit but not checking)
    const monthlyHistory = [
      { yearMonth: "2026-09" },
      { yearMonth: "2026-10" },
    ];
    
    const accountSnapshots = [
      // Only credit card has statements (checking missing)
      { 
        accountType: "Checking", 
        statementMonth: "2026-08", 
        statementDate: "2026-08-31", 
        slug: "td-checking-1234" 
      },
      { 
        accountType: "Credit", 
        statementMonth: "2026-09", 
        statementDate: "2026-09-24", 
        slug: "cibc-credit-5678" 
      },
      { 
        accountType: "Credit", 
        statementMonth: "2026-10", 
        statementDate: "2026-10-24", 
        slug: "cibc-credit-5678" 
      },
    ];

    const result = resolveWindowMonths("3mo", monthlyHistory, accountSnapshots);

    // Should fall back to available months (not return 0)
    expect(result.months.length).toBeGreaterThan(0);
    expect(result.actualCount).toBeGreaterThan(0);
    
    // Should still return missing info so icon/modal can show
    expect(result.missingAccounts).toBeDefined();
    expect(result.missingAccounts!.length).toBeGreaterThan(0);
  });

  it("should never show empty window with $0", () => {
    // Real scenario: no complete months due to incomplete coverage
    const monthlyHistory = [
      { yearMonth: "2026-09" },
    ];
    
    const accountSnapshots = [
      // Partial coverage - only one account type
      { 
        accountType: "Checking", 
        statementMonth: "2026-09", 
        statementDate: "2026-09-30", 
        slug: "td-checking-1234" 
      },
      // Credit card is dormant (60+ days old)
      { 
        accountType: "Credit", 
        statementMonth: "2026-07", 
        statementDate: "2026-07-24", 
        slug: "cibc-credit-5678" 
      },
    ];

    const result = resolveWindowMonths("3mo", monthlyHistory, accountSnapshots);

    // Should fall back to showing Sep even if incomplete
    expect(result.months).toContain("2026-09");
    expect(result.actualCount).toBe(1);
    
    // Should flag as incomplete
    expect(result.missingAccounts).toBeDefined();
  });

  it("should handle empty string in statementDate", () => {
    // Real scenario: field exists but is empty string
    const monthlyHistory = [
      { yearMonth: "2026-09" },
    ];
    
    const accountSnapshots = [
      { 
        accountType: "Checking", 
        statementMonth: "2026-09", 
        statementDate: "", // Empty string
        slug: "td-checking-1234" 
      },
      { 
        accountType: "Credit", 
        statementMonth: "2026-09", 
        statementDate: "",
        slug: "cibc-credit-5678" 
      },
    ];

    const result = resolveWindowMonths("3mo", monthlyHistory, accountSnapshots);

    // Should fall back to end of statementMonth
    expect(result.months).toContain("2026-09");
    expect(result.actualCount).toBe(1);
  });

  it("should handle invalid date strings gracefully", () => {
    // Real scenario: corrupted or malformed date data
    const monthlyHistory = [
      { yearMonth: "2026-09" },
    ];
    
    const accountSnapshots = [
      { 
        accountType: "Checking", 
        statementMonth: "2026-09", 
        statementDate: "invalid-date", // Invalid format
        slug: "td-checking-1234" 
      },
      { 
        accountType: "Credit", 
        statementMonth: "2026-09", 
        statementDate: "2026-13-45", // Invalid date
        slug: "cibc-credit-5678" 
      },
    ];

    const result = resolveWindowMonths("3mo", monthlyHistory, accountSnapshots);

    // Should fall back to end of statementMonth for invalid dates
    expect(result.months).toContain("2026-09");
    expect(result.actualCount).toBe(1);
  });
});
