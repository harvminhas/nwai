import { describe, it, expect } from "vitest";
import { resolveWindowMonths, type TimeRange } from "@/lib/rangeUtils";

/**
 * Unit tests for resolveWindowMonths — the shared window resolution helper.
 * 
 * Ensures:
 * 1. All windows end at the latest uploaded statement month
 * 2. Missing middle months are skipped (not filled with zeros)
 * 3. A note is displayed when fewer months are used than requested
 */
describe("Window Resolution Consistency", () => {
  it("3-month window: uses latest 3 calendar months ending at most recent statement", () => {
    const monthlyHistory = [
      { yearMonth: "2024-07" },
      { yearMonth: "2024-08" },
      { yearMonth: "2024-09" },
      { yearMonth: "2024-10" },
    ];

    const result = resolveWindowMonths("3mo", monthlyHistory);

    // Should use Aug-Sep-Oct (last 3 months ending at latest statement Oct)
    expect(result.months).toEqual(["2024-08", "2024-09", "2024-10"]);
    expect(result.actualCount).toBe(3);
    expect(result.requestedCount).toBe(3);
    expect(result.note).toBeUndefined(); // No note when all months present
  });

  it("12-month window: uses latest 12 calendar months ending at most recent statement", () => {
    const monthlyHistory = [
      { yearMonth: "2023-11" },
      { yearMonth: "2023-12" },
      { yearMonth: "2024-01" },
      { yearMonth: "2024-02" },
      { yearMonth: "2024-03" },
      { yearMonth: "2024-04" },
      { yearMonth: "2024-05" },
      { yearMonth: "2024-06" },
      { yearMonth: "2024-07" },
      { yearMonth: "2024-08" },
      { yearMonth: "2024-09" },
      { yearMonth: "2024-10" },
    ];

    const result = resolveWindowMonths("12mo", monthlyHistory);

    expect(result.months).toEqual([
      "2023-11", "2023-12", "2024-01", "2024-02", "2024-03", "2024-04",
      "2024-05", "2024-06", "2024-07", "2024-08", "2024-09", "2024-10"
    ]);
    expect(result.actualCount).toBe(12);
    expect(result.requestedCount).toBe(12);
    expect(result.note).toBeUndefined();
  });

  it("YTD window: uses Jan through latest statement month in current year", () => {
    // Mock Date to be in 2024
    const monthlyHistory = [
      { yearMonth: "2024-01" },
      { yearMonth: "2024-02" },
      { yearMonth: "2024-03" },
      { yearMonth: "2024-04" },
      { yearMonth: "2024-05" },
    ];

    const result = resolveWindowMonths("ytd", monthlyHistory);

    expect(result.months).toEqual([
      "2024-01", "2024-02", "2024-03", "2024-04", "2024-05"
    ]);
    expect(result.actualCount).toBe(5);
    expect(result.requestedCount).toBe(5);
    expect(result.note).toBeUndefined();
  });

  it("missing middle month: skips the gap and shows note", () => {
    // User has Jul and Sep statements, but Aug is missing
    const monthlyHistory = [
      { yearMonth: "2024-07" },
      // 2024-08 missing
      { yearMonth: "2024-09" },
    ];

    const result = resolveWindowMonths("3mo", monthlyHistory);

    // Target window is Jul-Aug-Sep, but Aug is missing
    // Should return only Jul and Sep (2 months)
    expect(result.months).toEqual(["2024-07", "2024-09"]);
    expect(result.actualCount).toBe(2);
    expect(result.requestedCount).toBe(3);
    expect(result.note).toBe("2 of 3 months");
  });

  it("multiple missing months: uses only available months and shows note", () => {
    // User has only Sep statement in the last 3 months
    const monthlyHistory = [
      { yearMonth: "2024-06" },
      // Jul and Aug missing
      { yearMonth: "2024-09" },
    ];

    const result = resolveWindowMonths("3mo", monthlyHistory);

    // Target window is Jul-Aug-Sep, only Sep has data
    expect(result.months).toEqual(["2024-09"]);
    expect(result.actualCount).toBe(1);
    expect(result.requestedCount).toBe(3);
    expect(result.note).toBe("1 of 3 months");
  });

  it("no data: returns empty result", () => {
    const monthlyHistory: Array<{ yearMonth: string }> = [];

    const result = resolveWindowMonths("3mo", monthlyHistory);

    expect(result.months).toEqual([]);
    expect(result.actualCount).toBe(0);
    expect(result.requestedCount).toBe(0);
    expect(result.note).toBeUndefined();
  });

  it("less data than window size: uses all available and shows note", () => {
    // User only has 2 months of data for a 3-month window
    const monthlyHistory = [
      { yearMonth: "2024-09" },
      { yearMonth: "2024-10" },
    ];

    const result = resolveWindowMonths("3mo", monthlyHistory);

    // Target window would be Aug-Sep-Oct, but only Sep-Oct exist
    expect(result.months).toEqual(["2024-09", "2024-10"]);
    expect(result.actualCount).toBe(2);
    expect(result.requestedCount).toBe(3);
    expect(result.note).toBe("2 of 3 months");
  });

  it("sparse 12-month data: uses only available months", () => {
    // User has quarterly statements only
    const monthlyHistory = [
      { yearMonth: "2024-01" },
      { yearMonth: "2024-04" },
      { yearMonth: "2024-07" },
      { yearMonth: "2024-10" },
    ];

    const result = resolveWindowMonths("12mo", monthlyHistory);

    // Should request 12 months from Nov 2023 to Oct 2024
    // But only 4 are available: Jan, Apr, Jul, Oct
    expect(result.months).toEqual([
      "2024-01", "2024-04", "2024-07", "2024-10"
    ]);
    expect(result.actualCount).toBe(4);
    expect(result.requestedCount).toBe(12);
    expect(result.note).toBe("4 of 12 months");
  });

  it("anchor month is correctly identified", () => {
    // Latest statement is Sep 2024
    const monthlyHistory = [
      { yearMonth: "2024-06" },
      { yearMonth: "2024-07" },
      { yearMonth: "2024-08" },
      { yearMonth: "2024-09" },
    ];

    const result = resolveWindowMonths("3mo", monthlyHistory);

    // Window should be Jul-Aug-Sep (ending at latest = Sep)
    expect(result.months).toEqual(["2024-07", "2024-08", "2024-09"]);
    expect(result.actualCount).toBe(3);
  });

  it("YTD with missing months in middle of year", () => {
    // User has Jan, Feb, missing Mar-May, then Jun
    const monthlyHistory = [
      { yearMonth: "2024-01" },
      { yearMonth: "2024-02" },
      // Mar, Apr, May missing
      { yearMonth: "2024-06" },
    ];

    const result = resolveWindowMonths("ytd", monthlyHistory);

    // Target is Jan-Jun, but Mar-May are missing
    expect(result.months).toEqual(["2024-01", "2024-02", "2024-06"]);
    expect(result.actualCount).toBe(3);
    expect(result.requestedCount).toBe(6);
    expect(result.note).toBe("3 of 6 months");
  });

  it("year boundary crossing for 3-month window", () => {
    // Latest statement is Jan 2025
    const monthlyHistory = [
      { yearMonth: "2024-11" },
      { yearMonth: "2024-12" },
      { yearMonth: "2025-01" },
    ];

    const result = resolveWindowMonths("3mo", monthlyHistory);

    // Window: Nov 2024 - Dec 2024 - Jan 2025
    expect(result.months).toEqual(["2024-11", "2024-12", "2025-01"]);
    expect(result.actualCount).toBe(3);
    expect(result.requestedCount).toBe(3);
    expect(result.note).toBeUndefined();
  });

  it("year boundary crossing for 12-month window", () => {
    // Latest statement is Mar 2025
    const monthlyHistory = [
      { yearMonth: "2024-04" },
      { yearMonth: "2024-05" },
      { yearMonth: "2024-06" },
      { yearMonth: "2024-07" },
      { yearMonth: "2024-08" },
      { yearMonth: "2024-09" },
      { yearMonth: "2024-10" },
      { yearMonth: "2024-11" },
      { yearMonth: "2024-12" },
      { yearMonth: "2025-01" },
      { yearMonth: "2025-02" },
      { yearMonth: "2025-03" },
    ];

    const result = resolveWindowMonths("12mo", monthlyHistory);

    // Window: Apr 2024 through Mar 2025
    expect(result.months).toEqual([
      "2024-04", "2024-05", "2024-06", "2024-07", "2024-08", "2024-09",
      "2024-10", "2024-11", "2024-12", "2025-01", "2025-02", "2025-03"
    ]);
    expect(result.actualCount).toBe(12);
    expect(result.requestedCount).toBe(12);
    expect(result.note).toBeUndefined();
  });
});
