/**
 * Unit tests for account masking.
 */

import { maskAccountNumber } from "../accountMasking";

describe("maskAccountNumber", () => {
  describe("Numeric account IDs with punctuation", () => {
    it("should mask (7780) to 7780", () => {
      expect(maskAccountNumber("(7780)")).toBe("7780");
    });

    it("should mask 4520 88XX XXXX 7035 to 7035", () => {
      expect(maskAccountNumber("4520 88XX XXXX 7035")).toBe("7035");
    });

    it("should mask ••••7035 to 7035", () => {
      expect(maskAccountNumber("••••7035")).toBe("7035");
    });

    it("should mask 1185-4190085 to 0085", () => {
      expect(maskAccountNumber("1185-4190085")).toBe("0085");
    });

    it("should mask 573156 to 3156", () => {
      expect(maskAccountNumber("573156")).toBe("3156");
    });
  });

  describe("Alphanumeric account IDs", () => {
    it("should mask HQ45X5615CAD to 5615 (has 4+ digits, returns last 4 digits)", () => {
      // Has digits "455615" (6 digits ≥ 4) so should return last 4 digits
      expect(maskAccountNumber("HQ45X5615CAD")).toBe("5615");
    });

    it("should mask HQ6MK8XN6CAD to 6cad (has <4 digits, returns last 4 alphanumerics)", () => {
      // Has only 3 digits "686" so falls back to last 4 alphanumerics "6cad"
      expect(maskAccountNumber("HQ6MK8XN6CAD")).toBe("6cad");
    });
  });

  describe("Edge cases", () => {
    it("should return 4-digit ID unchanged", () => {
      expect(maskAccountNumber("1234")).toBe("1234");
    });

    it("should return short ID unchanged", () => {
      expect(maskAccountNumber("123")).toBe("123");
    });

    it("should return undefined for empty string", () => {
      expect(maskAccountNumber("")).toBeUndefined();
    });

    it("should return undefined for null", () => {
      expect(maskAccountNumber(null)).toBeUndefined();
    });

    it("should return undefined for undefined", () => {
      expect(maskAccountNumber(undefined)).toBeUndefined();
    });

    it("should handle only letters", () => {
      expect(maskAccountNumber("ABCDEFGH")).toBe("efgh");
    });
  });
});
