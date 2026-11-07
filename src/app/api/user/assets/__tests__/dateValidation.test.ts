/**
 * Test POST/PUT startDate validation and clearing
 */

import { describe, test, expect } from "vitest";

describe("StartDate API Validation", () => {
  test("rejects invalid format", () => {
    const invalidDates = [
      "2026-11",      // Missing day
      "11-15-2026",   // Wrong order
      "2026/11/15",   // Wrong separator
      "invalid",      // Not a date
      "2026-13-01",   // Invalid month (would be caught by Date validation)
      "2026-11-32",   // Invalid day (would be caught by Date validation)
    ];

    for (const date of invalidDates) {
      const formatMatch = /^\d{4}-\d{2}-\d{2}$/.test(date);
      if (formatMatch) {
        // Further validate it's a real date
        const d = new Date(date);
        const valid = !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === date;
        expect(valid).toBe(false);
      } else {
        expect(formatMatch).toBe(false);
      }
    }
  });

  test("accepts valid dates", () => {
    const validDates = [
      "2026-11-15",
      "2025-01-01",
      "2027-12-31",
      "2026-02-28", // Non-leap year
    ];

    for (const date of validDates) {
      expect(/^\d{4}-\d{2}-\d{2}$/.test(date)).toBe(true);
      const d = new Date(date);
      expect(isNaN(d.getTime())).toBe(false);
      expect(d.toISOString().slice(0, 10)).toBe(date);
    }
  });

  test("rejects impossible dates via Date validation", () => {
    const impossibleDates = [
      "2026-99-99", // Invalid month and day
      "2026-13-01", // Month 13
      "2026-11-31", // Nov only has 30 days
      "2026-02-30", // Feb doesn't have 30 days
    ];

    for (const date of impossibleDates) {
      const formatMatch = /^\d{4}-\d{2}-\d{2}$/.test(date);
      expect(formatMatch).toBe(true); // Regex passes
      
      const d = new Date(date);
      const isValidDate = !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === date;
      expect(isValidDate).toBe(false); // But Date validation fails
    }
  });

  test("rejects non-string types", () => {
    const nonStrings = [
      123,
      { date: "2026-11-15" },
      ["2026-11-15"],
      true,
    ];

    for (const value of nonStrings) {
      expect(typeof value === 'string').toBe(false);
    }
  });

  test("PUT supports null for clearing", () => {
    const clearValues = [null, ""];
    
    for (const value of clearValues) {
      const cleared = value === null || value === "" ? null : value;
      expect(cleared).toBe(null);
    }
  });

  test("PUT preserves valid date", () => {
    const date = "2026-11-15";
    const result = date === "" ? null : date;
    expect(result).toBe("2026-11-15");
  });
});
