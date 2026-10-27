import { formatMonth, formatMonthYear, formatMonthRange, formatDate, formatDateFull } from "../dateFormatting";

describe("dateFormatting", () => {
  describe("formatMonth", () => {
    it("formats YYYY-MM as short month name", () => {
      expect(formatMonth("2026-01")).toBe("Jan");
      expect(formatMonth("2026-07")).toBe("Jul");
      expect(formatMonth("2026-12")).toBe("Dec");
    });
  });

  describe("formatMonthYear", () => {
    it("formats YYYY-MM as MMM YYYY", () => {
      expect(formatMonthYear("2026-01")).toBe("Jan 2026");
      expect(formatMonthYear("2026-07")).toBe("Jul 2026");
      expect(formatMonthYear("2026-12")).toBe("Dec 2026");
    });
  });

  describe("formatMonthRange", () => {
    it("formats same-year range as MMM – MMM YYYY", () => {
      expect(formatMonthRange("2026-07", "2026-09")).toBe("Jul – Sep 2026");
      expect(formatMonthRange("2026-01", "2026-03")).toBe("Jan – Mar 2026");
    });

    it("formats cross-year range with both years", () => {
      expect(formatMonthRange("2025-11", "2026-01")).toBe("Nov 2025 – Jan 2026");
      expect(formatMonthRange("2025-12", "2026-02")).toBe("Dec 2025 – Feb 2026");
    });
  });

  describe("formatDate", () => {
    it("formats date as MMM D, YYYY", () => {
      expect(formatDate("2026-07-05")).toBe("Jul 5, 2026");
      expect(formatDate("2026-01-15")).toBe("Jan 15, 2026");
      expect(formatDate("2026-12-31")).toBe("Dec 31, 2026");
    });
  });

  describe("formatDateFull", () => {
    it("formats date with full month name", () => {
      expect(formatDateFull("2026-07-05")).toBe("July 5, 2026");
      expect(formatDateFull("2026-01-15")).toBe("January 15, 2026");
      expect(formatDateFull("2026-12-31")).toBe("December 31, 2026");
    });
  });
});
