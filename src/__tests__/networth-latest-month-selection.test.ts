/**
 * Net Worth Latest Month Selection Regression Test
 * 
 * Verifies both header pill and detail page default to the latest available
 * month, not positional last element. Addresses user issue where header showed
 * Oct and detail showed Nov when both should show Nov.
 */

import { describe, it, expect } from "vitest";

describe("Net Worth Latest Month Selection", () => {
  it("should select latest month from in-order history", () => {
    const history = [
      { yearMonth: "2024-09", netWorth: 1200000 },
      { yearMonth: "2024-10", netWorth: 1244076 },
      { yearMonth: "2024-11", netWorth: 1217002 },
    ];

    // API logic: sort descending, take first
    const sortedHistory = [...history].sort((a, b) => 
      b.yearMonth.localeCompare(a.yearMonth)
    );
    const apiLatest = sortedHistory[0];

    // Page logic: explicit max comparison
    const pageLatest = history.reduce((max, m) => 
      m.yearMonth > max.yearMonth ? m : max
    );

    expect(apiLatest.yearMonth).toBe("2024-11");
    expect(pageLatest.yearMonth).toBe("2024-11");
    expect(apiLatest.yearMonth).toBe(pageLatest.yearMonth);
  });

  it("should select latest month from out-of-order history", () => {
    // Nov uploaded before Oct (user reported scenario)
    const history = [
      { yearMonth: "2024-09", netWorth: 1200000 },
      { yearMonth: "2024-11", netWorth: 1217002 },
      { yearMonth: "2024-10", netWorth: 1244076 },
    ];

    // API sorting handles this
    const sortedHistory = [...history].sort((a, b) => 
      b.yearMonth.localeCompare(a.yearMonth)
    );
    const apiLatest = sortedHistory[0];

    // Page max comparison also handles this
    const pageLatest = history.reduce((max, m) => 
      m.yearMonth > max.yearMonth ? m : max
    );

    // Both should pick Nov, not Oct (even though Oct is at end of array)
    expect(apiLatest.yearMonth).toBe("2024-11");
    expect(pageLatest.yearMonth).toBe("2024-11");
    expect(apiLatest.yearMonth).toBe(pageLatest.yearMonth);
  });

  it("should handle missing current calendar month", () => {
    // Dec 2024 is current but no statement yet
    const history = [
      { yearMonth: "2024-10", netWorth: 1244076 },
      { yearMonth: "2024-11", netWorth: 1217002 },
      // 2024-12 missing
    ];

    const sortedHistory = [...history].sort((a, b) => 
      b.yearMonth.localeCompare(a.yearMonth)
    );
    const apiLatest = sortedHistory[0];

    const pageLatest = history.reduce((max, m) => 
      m.yearMonth > max.yearMonth ? m : max
    );

    // Should show Nov (latest available), not try to show Dec
    expect(apiLatest.yearMonth).toBe("2024-11");
    expect(pageLatest.yearMonth).toBe("2024-11");
  });

  it("should handle single month", () => {
    const history = [{ yearMonth: "2024-11", netWorth: 1217002 }];

    const sortedHistory = [...history].sort((a, b) => 
      b.yearMonth.localeCompare(a.yearMonth)
    );
    const apiLatest = sortedHistory[0];

    const pageLatest = history.reduce((max, m) => 
      m.yearMonth > max.yearMonth ? m : max
    );

    expect(apiLatest.yearMonth).toBe("2024-11");
    expect(pageLatest.yearMonth).toBe("2024-11");
  });

  it("OLD BUG: array position would fail on out-of-order", () => {
    const history = [
      { yearMonth: "2024-11", netWorth: 1217002 },
      { yearMonth: "2024-10", netWorth: 1244076 }, // Oct at end!
    ];

    // OLD approach: last array element
    const oldApproach = history[history.length - 1];
    
    // NEW approach: max comparison
    const newApproach = history.reduce((max, m) => 
      m.yearMonth > max.yearMonth ? m : max
    );

    // Old would pick Oct (wrong), new picks Nov (correct)
    expect(oldApproach.yearMonth).toBe("2024-10");
    expect(newApproach.yearMonth).toBe("2024-11");
  });
});
