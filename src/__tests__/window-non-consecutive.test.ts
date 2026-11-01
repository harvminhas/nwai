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

  it("should list missing months within the window", () => {
    // Complete months: Feb, Mar, Aug
    // Window for 3mo: Jun-Aug (3 months before Aug)
    // Missing: Jun, Jul
    const monthlyHistory = [
      { yearMonth: "2026-02" },
      { yearMonth: "2026-03" },
      { yearMonth: "2026-08" },
    ];
    
    const accountSnapshots = [
      { accountType: "Checking", statementMonth: "2026-02", statementDate: "2026-02-28", slug: "td-checking-1234" },
      { accountType: "Credit", statementMonth: "2026-02", statementDate: "2026-02-24", slug: "cibc-credit-5678" },
      { accountType: "Checking", statementMonth: "2026-03", statementDate: "2026-03-31", slug: "td-checking-1234" },
      { accountType: "Credit", statementMonth: "2026-03", statementDate: "2026-03-24", slug: "cibc-credit-5678" },
      { accountType: "Checking", statementMonth: "2026-08", statementDate: "2026-08-31", slug: "td-checking-1234" },
      { accountType: "Credit", statementMonth: "2026-08", statementDate: "2026-08-24", slug: "cibc-credit-5678" },
    ];

    const result = resolveWindowMonths("3mo", monthlyHistory, accountSnapshots);

    // Missing months should be listed
    expect(result.missingMonths).toBeDefined();
    expect(result.missingMonths).toContain("2026-06");
    expect(result.missingMonths).toContain("2026-07");
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
