/**
 * Tests for correct missing months calculation:
 * - Missing = finished months AFTER newest complete month
 * - Never list months before the window
 * - Never list current unfinished month
 * - If newest complete = latest finished, no missing months
 */

import { resolveWindowMonths } from "../lib/rangeUtils";

// Helper to inject test date
function withTestDate(dateStr: string, fn: () => void) {
  const originalNow = (globalThis as any).__TEST_NOW__;
  try {
    (globalThis as any).__TEST_NOW__ = new Date(dateStr + 'T12:00:00Z');
    fn();
  } finally {
    if (originalNow) {
      (globalThis as any).__TEST_NOW__ = originalNow;
    } else {
      delete (globalThis as any).__TEST_NOW__;
    }
  }
}

describe("Missing months calculation (after newest complete month)", () => {
  it("today 2026-11-01, complete Jun-Aug → missing Sep and Oct", () => {
    withTestDate('2026-11-01', () => {
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
        { accountType: "Credit", statementMonth: "2026-08", statementDate: "2026-08-31", slug: "cibc-credit-5678" }, // Note: Aug 31 for credit
      ];

      const result = resolveWindowMonths("3mo", monthlyHistory, accountSnapshots);

      // Complete months: Jun, Jul, Aug
      expect(result.months).toEqual(["2026-06", "2026-07", "2026-08"]);
      
      // Missing: Sep and Oct (finished months after Aug)
      expect(result.missingMonths).toEqual(["2026-09", "2026-10"]);
      
      // Should NOT include May (before window) or Nov (current unfinished month)
      expect(result.missingMonths).not.toContain("2026-05");
      expect(result.missingMonths).not.toContain("2026-11");
    });
  });

  it("today 2026-11-01, complete through Oct → no missing months", () => {
    withTestDate('2026-11-01', () => {
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

      // Complete through Oct (latest finished month)
      expect(result.months).toEqual(["2026-08", "2026-09", "2026-10"]);
      
      // No missing months (newest complete = latest finished)
      expect(result.missingMonths).toBeUndefined();
      expect(result.missingAccounts).toBeUndefined();
    });
  });

  it("today 2026-12-15, complete through Sep → missing Oct and Nov", () => {
    withTestDate('2026-12-15', () => {
      const monthlyHistory = [
        { yearMonth: "2026-07" },
        { yearMonth: "2026-08" },
        { yearMonth: "2026-09" },
      ];
      
      const accountSnapshots = [
        { accountType: "Checking", statementMonth: "2026-07", statementDate: "2026-07-31", slug: "td-checking-1234" },
        { accountType: "Credit", statementMonth: "2026-07", statementDate: "2026-07-24", slug: "cibc-credit-5678" },
        { accountType: "Checking", statementMonth: "2026-08", statementDate: "2026-08-31", slug: "td-checking-1234" },
        { accountType: "Credit", statementMonth: "2026-08", statementDate: "2026-08-24", slug: "cibc-credit-5678" },
        { accountType: "Checking", statementMonth: "2026-09", statementDate: "2026-09-30", slug: "td-checking-1234" },
        { accountType: "Credit", statementMonth: "2026-09", statementDate: "2026-09-24", slug: "cibc-credit-5678" },
      ];

      const result = resolveWindowMonths("3mo", monthlyHistory, accountSnapshots);

      // Complete: Jul, Aug, Sep
      expect(result.months).toEqual(["2026-07", "2026-08", "2026-09"]);
      
      // Missing: Oct and Nov (not Dec, it's current)
      expect(result.missingMonths).toEqual(["2026-10", "2026-11"]);
      expect(result.missingMonths).not.toContain("2026-12");
    });
  });

  it("today 2026-09-01, complete through Aug → no missing months", () => {
    withTestDate('2026-09-01', () => {
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

      // Complete through Aug, and Aug is the latest finished month (today is Sep 1)
      expect(result.months).toEqual(["2026-06", "2026-07", "2026-08"]);
      
      // No missing months
      expect(result.missingMonths).toBeUndefined();
    });
  });

  it("never lists months before the window", () => {
    withTestDate('2026-11-01', () => {
      // Window is Jun-Jul-Aug, but May also has data
      const monthlyHistory = [
        { yearMonth: "2026-05" },
        { yearMonth: "2026-06" },
        { yearMonth: "2026-07" },
        { yearMonth: "2026-08" },
      ];
      
      const accountSnapshots = [
        // All months complete
        { accountType: "Checking", statementMonth: "2026-05", statementDate: "2026-05-31", slug: "td-checking-1234" },
        { accountType: "Credit", statementMonth: "2026-05", statementDate: "2026-05-24", slug: "cibc-credit-5678" },
        { accountType: "Checking", statementMonth: "2026-06", statementDate: "2026-06-30", slug: "td-checking-1234" },
        { accountType: "Credit", statementMonth: "2026-06", statementDate: "2026-06-24", slug: "cibc-credit-5678" },
        { accountType: "Checking", statementMonth: "2026-07", statementDate: "2026-07-31", slug: "td-checking-1234" },
        { accountType: "Credit", statementMonth: "2026-07", statementDate: "2026-07-24", slug: "cibc-credit-5678" },
        { accountType: "Checking", statementMonth: "2026-08", statementDate: "2026-08-31", slug: "td-checking-1234" },
        { accountType: "Credit", statementMonth: "2026-08", statementDate: "2026-08-24", slug: "cibc-credit-5678" },
      ];

      const result = resolveWindowMonths("3mo", monthlyHistory, accountSnapshots);

      // Window is last 3 complete: Jun, Jul, Aug
      expect(result.months).toEqual(["2026-06", "2026-07", "2026-08"]);
      
      // Missing: Sep, Oct (NOT May)
      expect(result.missingMonths).toEqual(["2026-09", "2026-10"]);
      expect(result.missingMonths).not.toContain("2026-05");
    });
  });

  it("12mo: lists all missing finished months after newest complete", () => {
    withTestDate('2026-11-01', () => {
      // Sparse data: only Jan, Apr, Jul available
      const monthlyHistory = [
        { yearMonth: "2026-01" },
        { yearMonth: "2026-04" },
        { yearMonth: "2026-07" },
      ];
      
      const accountSnapshots = monthlyHistory.flatMap(m => [
        { accountType: "Checking", statementMonth: m.yearMonth, statementDate: `${m.yearMonth}-28`, slug: "td-checking-1234" },
        { accountType: "Credit", statementMonth: m.yearMonth, statementDate: `${m.yearMonth}-24`, slug: "cibc-credit-5678" },
      ]);

      const result = resolveWindowMonths("12mo", monthlyHistory, accountSnapshots);

      // Last 12 complete: Jan, Apr, Jul (only 3 available)
      expect(result.months).toEqual(["2026-01", "2026-04", "2026-07"]);
      
      // Missing: Aug, Sep, Oct (all finished months after Jul)
      expect(result.missingMonths).toEqual(["2026-08", "2026-09", "2026-10"]);
    });
  });

  it("ytd: lists missing finished months after newest complete in current year", () => {
    withTestDate('2026-11-01', () => {
      // YTD with gaps: Jan, Mar, Jun
      const monthlyHistory = [
        { yearMonth: "2026-01" },
        { yearMonth: "2026-03" },
        { yearMonth: "2026-06" },
      ];
      
      const accountSnapshots = monthlyHistory.flatMap(m => [
        { accountType: "Checking", statementMonth: m.yearMonth, statementDate: `${m.yearMonth}-28`, slug: "td-checking-1234" },
        { accountType: "Credit", statementMonth: m.yearMonth, statementDate: `${m.yearMonth}-24`, slug: "cibc-credit-5678" },
      ]);

      const result = resolveWindowMonths("ytd", monthlyHistory, accountSnapshots);

      // YTD complete months: Jan, Mar, Jun
      expect(result.months).toEqual(["2026-01", "2026-03", "2026-06"]);
      
      // Missing: Jul, Aug, Sep, Oct (finished months after Jun)
      expect(result.missingMonths).toEqual(["2026-07", "2026-08", "2026-09", "2026-10"]);
    });
  });
});
