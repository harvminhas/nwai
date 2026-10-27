import { describe, it, expect } from "vitest";
import { getLastCompleteMonth, getCurrentMonth, formatMonthWithStatus } from "../monthAnchor";

describe("monthAnchor", () => {
  describe("getLastCompleteMonth", () => {
    it("should return previous calendar month", () => {
      // Test with Oct 2026 (middle of month)
      const oct2026 = new Date(2026, 9, 15); // Month is 0-indexed
      expect(getLastCompleteMonth(oct2026)).toBe("2026-09");
      
      // Test with Jan 2026 (previous year)
      const jan2026 = new Date(2026, 0, 15);
      expect(getLastCompleteMonth(jan2026)).toBe("2025-12");
      
      // Test with Dec 2026 (end of year)
      const dec2026 = new Date(2026, 11, 15);
      expect(getLastCompleteMonth(dec2026)).toBe("2026-11");
    });

    it("should handle edge cases across year boundaries", () => {
      // January should return December of previous year
      const jan2027 = new Date(2027, 0, 1);
      expect(getLastCompleteMonth(jan2027)).toBe("2026-12");
      
      // February should return January of same year
      const feb2027 = new Date(2027, 1, 1);
      expect(getLastCompleteMonth(feb2027)).toBe("2027-01");
    });

    it("should work without arguments (uses current date)", () => {
      const result = getLastCompleteMonth();
      // Should return a valid YYYY-MM string
      expect(result).toMatch(/^\d{4}-\d{2}$/);
      
      // Should be the previous month
      const now = new Date();
      const prevMonth = new Date(now);
      prevMonth.setMonth(prevMonth.getMonth() - 1);
      const expected = `${prevMonth.getFullYear()}-${String(prevMonth.getMonth() + 1).padStart(2, "0")}`;
      expect(result).toBe(expected);
    });
  });

  describe("getCurrentMonth", () => {
    it("should return current calendar month", () => {
      const oct2026 = new Date(2026, 9, 15);
      expect(getCurrentMonth(oct2026)).toBe("2026-10");
      
      const jan2027 = new Date(2027, 0, 1);
      expect(getCurrentMonth(jan2027)).toBe("2027-01");
      
      const dec2026 = new Date(2026, 11, 31);
      expect(getCurrentMonth(dec2026)).toBe("2026-12");
    });
  });

  describe("formatMonthWithStatus", () => {
    it("should format complete months without status", () => {
      expect(formatMonthWithStatus("2026-09", false)).toBe("Sep 2026");
      expect(formatMonthWithStatus("2026-01", false)).toBe("Jan 2026");
      expect(formatMonthWithStatus("2026-12", false)).toBe("Dec 2026");
    });

    it("should format current month with '(in progress)' status", () => {
      expect(formatMonthWithStatus("2026-10", true)).toBe("Oct 2026 (in progress)");
      expect(formatMonthWithStatus("2027-01", true)).toBe("Jan 2027 (in progress)");
    });

    it("should handle all months correctly", () => {
      const months = [
        ["2026-01", "Jan 2026"],
        ["2026-02", "Feb 2026"],
        ["2026-03", "Mar 2026"],
        ["2026-04", "Apr 2026"],
        ["2026-05", "May 2026"],
        ["2026-06", "Jun 2026"],
        ["2026-07", "Jul 2026"],
        ["2026-08", "Aug 2026"],
        ["2026-09", "Sep 2026"],
        ["2026-10", "Oct 2026"],
        ["2026-11", "Nov 2026"],
        ["2026-12", "Dec 2026"],
      ];

      for (const [input, expected] of months) {
        expect(formatMonthWithStatus(input, false)).toBe(expected);
      }
    });
  });

  describe("integration: window calculations", () => {
    it("should provide consistent anchor for all windows", () => {
      const today = new Date(2026, 9, 27); // Oct 27, 2026
      const lastComplete = getLastCompleteMonth(today);
      const current = getCurrentMonth(today);
      
      expect(lastComplete).toBe("2026-09");
      expect(current).toBe("2026-10");
      
      // All months with data
      const allMonths = [
        "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06",
        "2026-07", "2026-08", "2026-09", "2026-10"
      ];
      
      // Last 3 complete months = [Jul, Aug, Sep]
      const last3Complete = allMonths.filter(m => m <= lastComplete).slice(-3);
      expect(last3Complete).toEqual(["2026-07", "2026-08", "2026-09"]);
      
      // YTD = Jan through Sep (excluding current Oct)
      const ytd = allMonths.filter(m => m >= "2026-01" && m <= lastComplete);
      expect(ytd).toEqual([
        "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06",
        "2026-07", "2026-08", "2026-09"
      ]);
    });
  });
});
