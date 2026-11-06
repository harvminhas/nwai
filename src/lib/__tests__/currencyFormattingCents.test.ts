/**
 * Regression tests for exact-cents transaction formatting.
 * 
 * Individual transactions should show two decimal places (including .00).
 * Aggregates/totals/charts should remain dollar-rounded.
 */

import { 
  fmt, 
  fmtWithCents, 
  formatCurrency, 
  formatCurrencyWithCents 
} from "../currencyUtils";

describe("Currency formatting with cents", () => {
  describe("fmtWithCents - basic formatting", () => {
    test("formats dollars with cents", () => {
      expect(fmtWithCents(1234.56, "USD")).toBe("US$1,234.56");
      expect(fmtWithCents(1234.56, "CAD")).toBe("CA$1,234.56");
    });

    test("shows .00 for whole dollar amounts", () => {
      expect(fmtWithCents(1234, "USD")).toBe("US$1,234.00");
      expect(fmtWithCents(500, "CAD")).toBe("CA$500.00");
      expect(fmtWithCents(0, "USD")).toBe("US$0.00");
    });

    test("handles negative amounts", () => {
      expect(fmtWithCents(-500.99, "USD")).toBe("-US$500.99");
      expect(fmtWithCents(-1234.56, "CAD")).toBe("-CA$1,234.56");
      expect(fmtWithCents(-100, "GBP")).toBe("-£100.00");
    });

    test("formats various currencies correctly", () => {
      expect(fmtWithCents(999.99, "USD")).toBe("US$999.99");
      expect(fmtWithCents(999.99, "CAD")).toBe("CA$999.99");
      expect(fmtWithCents(999.99, "GBP")).toBe("£999.99");
      expect(fmtWithCents(999.99, "EUR")).toBe("€999.99");
    });

    test("rounds to two decimal places", () => {
      expect(fmtWithCents(1234.567, "USD")).toBe("US$1,234.57");
      expect(fmtWithCents(1234.564, "USD")).toBe("US$1,234.56");
      expect(fmtWithCents(99.995, "CAD")).toBe("CA$100.00");
    });

    test("handles small amounts", () => {
      expect(fmtWithCents(0.99, "USD")).toBe("US$0.99");
      expect(fmtWithCents(0.01, "CAD")).toBe("CA$0.01");
      expect(fmtWithCents(-0.50, "USD")).toBe("-US$0.50");
    });
  });

  describe("formatCurrencyWithCents - with currency selection", () => {
    test("respects originalCurrency when isConsolidated = false", () => {
      // Individual transaction: show in account's native currency
      expect(formatCurrencyWithCents(1464.56, "USD", "CAD", false)).toBe("CA$1,464.56");
      expect(formatCurrencyWithCents(500.25, "CAD", "USD", false)).toBe("US$500.25");
    });

    test("uses homeCurrency when isConsolidated = true", () => {
      // Aggregate: show in home currency
      expect(formatCurrencyWithCents(14731.89, "USD", "CAD", true)).toBe("US$14,731.89");
      expect(formatCurrencyWithCents(5000.00, "CAD", "USD", true)).toBe("CA$5,000.00");
    });

    test("falls back to homeCurrency when originalCurrency is null", () => {
      expect(formatCurrencyWithCents(1234.56, "USD", null, false)).toBe("US$1,234.56");
      expect(formatCurrencyWithCents(1234.56, "CAD", undefined, false)).toBe("CA$1,234.56");
    });

    test("preserves negative amounts with currency selection", () => {
      expect(formatCurrencyWithCents(-99.99, "USD", "CAD", false)).toBe("-CA$99.99");
      expect(formatCurrencyWithCents(-1142.25, "CAD", "CAD", false)).toBe("-CA$1,142.25");
    });
  });

  describe("Dollar-rounded aggregates remain unchanged", () => {
    test("fmt still rounds to dollars (no cents)", () => {
      expect(fmt(1234.56, "USD")).toBe("US$1,235");
      expect(fmt(1234.49, "USD")).toBe("US$1,234");
      expect(fmt(500, "CAD")).toBe("CA$500");
    });

    test("formatCurrency still rounds to dollars for aggregates", () => {
      expect(formatCurrency(14731.89, "USD", undefined, true)).toBe("US$14,732");
      expect(formatCurrency(5000.50, "CAD", undefined, true)).toBe("CA$5,001");
      expect(formatCurrency(999.49, "USD", "CAD", true)).toBe("US$999");
    });

    test("formatCurrency rounds individual tx when using old formatter", () => {
      // This confirms we didn't break existing behavior
      expect(formatCurrency(1464.56, "USD", "CAD", false)).toBe("CA$1,465");
      expect(formatCurrency(500.99, "CAD", "USD", false)).toBe("US$501");
    });
  });

  describe("Real-world transaction scenarios", () => {
    test("Scotia Plan Loan payment CA$1,142.25", () => {
      expect(formatCurrencyWithCents(1142.25, "CAD", "CAD", false)).toBe("CA$1,142.25");
    });

    test("FlexLine median payment ~CA$3,291.00", () => {
      expect(formatCurrencyWithCents(3291, "CAD", "CAD", false)).toBe("CA$3,291.00");
      expect(formatCurrencyWithCents(3291.45, "CAD", "CAD", false)).toBe("CA$3,291.45");
    });

    test("Otter.ai annual CA$164.00 / 12 = CA$13.67/month", () => {
      const annualAmount = 164.00;
      const monthlyAmount = annualAmount / 12;
      expect(formatCurrencyWithCents(monthlyAmount, "CAD", "CAD", false)).toBe("CA$13.67");
    });

    test("Small coffee purchase US$4.75", () => {
      expect(formatCurrencyWithCents(4.75, "USD", "USD", false)).toBe("US$4.75");
    });

    test("Gas station charge CA$67.89", () => {
      expect(formatCurrencyWithCents(67.89, "CAD", "CAD", false)).toBe("CA$67.89");
    });
  });
});
