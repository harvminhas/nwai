/**
 * Tests for non-consecutive complete months in window resolution
 */

import { resolveWindowMonths, formatMonthList } from "../lib/rangeUtils";

describe("Window resolution with non-consecutive months", () => {
  it("should take last 3 complete months even if non-consecutive (Feb, Mar, Aug)", () => {
    const monthlyHistory = [
      { yearMonth: "2026-02" },
      { yearMonth: "2026-03" },
      { yearMonth: "2026-08" },
    ];
    
    // All accounts have complete coverage for these months
    const accountSnapshots = [
      { accountType: "Checking", statementMonth: "2026-02", statementDate: "2026-02-28", slug: "td-checking-1234" },
      { accountType: "Credit", statementMonth: "2026-02", statementDate: "2026-02-24", slug: "cibc-credit-5678" },
      { accountType: "Checking", statementMonth: "2026-03", statementDate: "2026-03-31", slug: "td-checking-1234" },
      { accountType: "Credit", statementMonth: "2026-03", statementDate: "2026-03-24", slug: "cibc-credit-5678" },
      { accountType: "Checking", statementMonth: "2026-08", statementDate: "2026-08-31", slug: "td-checking-1234" },
      { accountType: "Credit", statementMonth: "2026-08", statementDate: "2026-08-24", slug: "cibc-credit-5678" },
    ];

    const result = resolveWindowMonths("3mo", monthlyHistory, accountSnapshots);

    // Should return Feb, Mar, Aug (last 3 complete months with data)
    expect(result.months).toEqual(["2026-02", "2026-03", "2026-08"]);
    expect(result.actualCount).toBe(3);
    expect(result.requestedCount).toBe(3);
  });

  it("should return fewer months when only 2 complete months exist for 3mo", () => {
    const monthlyHistory = [
      { yearMonth: "2026-02" },
      { yearMonth: "2026-08" },
    ];
    
    const accountSnapshots = [
      { accountType: "Checking", statementMonth: "2026-02", statementDate: "2026-02-28", slug: "td-checking-1234" },
      { accountType: "Credit", statementMonth: "2026-02", statementDate: "2026-02-24", slug: "cibc-credit-5678" },
      { accountType: "Checking", statementMonth: "2026-08", statementDate: "2026-08-31", slug: "td-checking-1234" },
      { accountType: "Credit", statementMonth: "2026-08", statementDate: "2026-08-24", slug: "cibc-credit-5678" },
    ];

    const result = resolveWindowMonths("3mo", monthlyHistory, accountSnapshots);

    expect(result.months).toEqual(["2026-02", "2026-08"]);
    expect(result.actualCount).toBe(2);
    expect(result.requestedCount).toBe(3);
  });

  it("should list missing months AFTER newest complete month (injected now = 2026-11-01)", () => {
    // Inject "now" as Nov 1, 2026
    (globalThis as any).__TEST_NOW__ = new Date('2026-11-01T00:00:00');
    
    // Complete months: Jun, Jul, Aug
    // Latest finished month: Oct 2026 (Nov is current, unfinished)
    // Missing: Sep, Oct (finished months AFTER newest complete Aug)
    const monthlyHistory = [
      { yearMonth: "2026-06" },
      { yearMonth: "2026-07" },
      { yearMonth: "2026-08" },
    ];
    
    const accountSnapshots = [
      { accountType: "Checking", statementMonth: "2026-06", statementDate: "2026-06-30", slug: "td-checking-1234" },
      { accountType: "Credit", statementMonth: "2026-06", statementDate: "2026-06-24", slug: "cibc-credit-5678" },
      { accountType: "Checking", statementMonth: "2026-07", statementDate: "2026-07-31", slug: "td-checking-1234" },
      { accountType: "Credit", statementMonth: "2026-07", statementDate: "2026-07-24", slug: "cibc-credit-5678" },
      { accountType: "Checking", statementMonth: "2026-08", statementDate: "2026-08-31", slug: "td-checking-1234" },
      { accountType: "Credit", statementMonth: "2026-08", statementDate: "2026-08-24", slug: "cibc-credit-5678" },
    ];

    const result = resolveWindowMonths("3mo", monthlyHistory, accountSnapshots);

    // Should return Jun, Jul, Aug as window
    expect(result.months).toEqual(["2026-06", "2026-07", "2026-08"]);
    
    // Missing months should be Sep and Oct (AFTER newest complete, up to latest finished)
    expect(result.missingMonths).toBeDefined();
    expect(result.missingMonths).toEqual(["2026-09", "2026-10"]);
    
    // Clean up
    delete (globalThis as any).__TEST_NOW__;
  });

  it("should return no missing months when complete through latest finished month", () => {
    // Inject "now" as Nov 1, 2026
    (globalThis as any).__TEST_NOW__ = new Date('2026-11-01T00:00:00');
    
    // Complete months: Aug, Sep, Oct (through latest finished month)
    // Latest finished month: Oct 2026
    // Missing: none
    const monthlyHistory = [
      { yearMonth: "2026-08" },
      { yearMonth: "2026-09" },
      { yearMonth: "2026-10" },
    ];
    
    const accountSnapshots = [
      { accountType: "Checking", statementMonth: "2026-08", statementDate: "2026-08-31", slug: "td-checking-1234" },
      { accountType: "Credit", statementMonth: "2026-08", statementDate: "2026-08-24", slug: "cibc-credit-5678" },
      { accountType: "Checking", statementMonth: "2026-09", statementDate: "2026-09-30", slug: "td-checking-1234" },
      { accountType: "Credit", statementMonth: "2026-09", statementDate: "2026-09-24", slug: "cibc-credit-5678" },
      { accountType: "Checking", statementMonth: "2026-10", statementDate: "2026-10-31", slug: "td-checking-1234" },
      { accountType: "Credit", statementMonth: "2026-10", statementDate: "2026-10-24", slug: "cibc-credit-5678" },
    ];

    const result = resolveWindowMonths("3mo", monthlyHistory, accountSnapshots);

    // Should return Aug, Sep, Oct as window
    expect(result.months).toEqual(["2026-08", "2026-09", "2026-10"]);
    
    // No missing months (newest complete IS latest finished)
    expect(result.missingMonths).toBeUndefined();
    
    // Clean up
    delete (globalThis as any).__TEST_NOW__;
  });

  it("should take last 12 complete months even if sparse", () => {
    // Months with data: Jan, Feb, Jun, Sep, Dec
    const monthlyHistory = [
      { yearMonth: "2025-01" },
      { yearMonth: "2025-02" },
      { yearMonth: "2025-06" },
      { yearMonth: "2025-09" },
      { yearMonth: "2025-12" },
    ];
    
    const accountSnapshots = monthlyHistory.flatMap(m => [
      { accountType: "Checking", statementMonth: m.yearMonth, statementDate: `${m.yearMonth}-28`, slug: "td-checking-1234" },
      { accountType: "Credit", statementMonth: m.yearMonth, statementDate: `${m.yearMonth}-24`, slug: "cibc-credit-5678" },
    ]);

    const result = resolveWindowMonths("12mo", monthlyHistory, accountSnapshots);

    // Should return all 5 available months (fewer than 12 requested)
    expect(result.months).toEqual(["2025-01", "2025-02", "2025-06", "2025-09", "2025-12"]);
    expect(result.actualCount).toBe(5);
    expect(result.requestedCount).toBe(12);
  });

  it("should handle YTD with non-consecutive months", () => {
    const monthlyHistory = [
      { yearMonth: "2026-01" },
      { yearMonth: "2026-03" },
      { yearMonth: "2026-05" },
      { yearMonth: "2026-08" },
    ];
    
    const accountSnapshots = monthlyHistory.flatMap(m => [
      { accountType: "Checking", statementMonth: m.yearMonth, statementDate: `${m.yearMonth}-28`, slug: "td-checking-1234" },
      { accountType: "Credit", statementMonth: m.yearMonth, statementDate: `${m.yearMonth}-24`, slug: "cibc-credit-5678" },
    ]);

    const result = resolveWindowMonths("ytd", monthlyHistory, accountSnapshots);

    // Should return all months from Jan through Aug that have data
    expect(result.months).toEqual(["2026-01", "2026-03", "2026-05", "2026-08"]);
    expect(result.actualCount).toBe(4);
    expect(result.requestedCount).toBe(8); // Jan-Aug = 8 months requested
    expect(result.note).toBe("4 of 8 months");
  });
});

describe("Month list formatting for cross-year cases", () => {
  it("should format single month", () => {
    expect(formatMonthList(["2026-08"])).toBe("Aug 2026");
  });

  it("should format consecutive months in same year", () => {
    expect(formatMonthList(["2026-06", "2026-07", "2026-08"])).toBe("Jun, Jul and Aug 2026");
  });

  it("should format non-consecutive months in same year", () => {
    expect(formatMonthList(["2026-02", "2026-03", "2026-08"])).toBe("Feb, Mar and Aug 2026");
  });

  it("should format cross-year months", () => {
    expect(formatMonthList(["2025-12", "2026-01", "2026-02"])).toBe("Dec 2025, Jan and Feb 2026");
  });

  it("should format multiple months across two years", () => {
    expect(formatMonthList(["2025-11", "2025-12", "2026-01"])).toBe("Nov and Dec 2025, Jan 2026");
  });

  it("should format two months", () => {
    expect(formatMonthList(["2026-07", "2026-08"])).toBe("Jul and Aug 2026");
  });
});
