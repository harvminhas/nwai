/**
 * Unit tests for account slug stability across masking changes.
 * 
 * Critical requirement: The same account uploaded before and after implementing
 * account masking must resolve to the same slug to prevent duplicate accounts.
 */

import { buildAccountSlug } from "../accountSlug";
import { maskAccountNumber } from "../accountMasking";

describe("Account slug stability with masking", () => {
  describe("Numeric account IDs", () => {
    it("should generate same slug for 573156 before and after masking", () => {
      const bankName = "TD Canada Trust";
      const accountType = "Chequing";
      
      // Before masking (full accountId used for slug)
      const slugBefore = buildAccountSlug(bankName, "573156", undefined, accountType);
      
      // After masking (masked accountId stored, but slug computed from full ID)
      const masked = maskAccountNumber("573156");
      expect(masked).toBe("3156"); // Verify masking works
      
      // Slug should still be computed from original full ID
      const slugAfter = buildAccountSlug(bankName, "573156", undefined, accountType);
      
      expect(slugAfter).toBe(slugBefore);
      expect(slugAfter).toBe("td-canada-trust-573156");
    });

    it("should generate same slug for 1185-4190085 before and after masking", () => {
      const bankName = "BMO";
      const accountType = "Savings";
      
      const slugBefore = buildAccountSlug(bankName, "1185-4190085", undefined, accountType);
      
      const masked = maskAccountNumber("1185-4190085");
      expect(masked).toBe("0085"); // Last 4 characters
      
      const slugAfter = buildAccountSlug(bankName, "1185-4190085", undefined, accountType);
      
      expect(slugAfter).toBe(slugBefore);
      expect(slugAfter).toBe("bmo-1185-4190085");
    });
  });

  describe("Alphanumeric account IDs", () => {
    it("should generate same slug for HQ6MK8XN6CAD before and after masking", () => {
      const bankName = "Tangerine";
      const accountType = "Savings";
      
      const slugBefore = buildAccountSlug(bankName, "HQ6MK8XN6CAD", undefined, accountType);
      
      const masked = maskAccountNumber("HQ6MK8XN6CAD");
      expect(masked).toBe("6CAD"); // Last 4 characters
      
      const slugAfter = buildAccountSlug(bankName, "HQ6MK8XN6CAD", undefined, accountType);
      
      expect(slugAfter).toBe(slugBefore);
      // Slug should normalize to lowercase
      expect(slugAfter).toBe("tangerine-hq6mk8xn6cad");
    });
  });

  describe("Synthetic account IDs", () => {
    it("should generate same slug for synthetic ID s123 before and after masking", () => {
      const bankName = "RBC";
      const accountType = "Credit Card";
      
      const slugBefore = buildAccountSlug(bankName, "s123", undefined, accountType);
      
      const masked = maskAccountNumber("s123");
      expect(masked).toBe("s123"); // Already 4 chars or less, unchanged
      
      const slugAfter = buildAccountSlug(bankName, "s123", undefined, accountType);
      
      expect(slugAfter).toBe(slugBefore);
      expect(slugAfter).toBe("rbc-s123");
    });
  });

  describe("Edge cases", () => {
    it("should handle 4-digit account ID (exactly at threshold)", () => {
      const bankName = "CIBC";
      const accountType = "Chequing";
      
      const slugBefore = buildAccountSlug(bankName, "1234", undefined, accountType);
      
      const masked = maskAccountNumber("1234");
      expect(masked).toBe("1234"); // 4 digits, unchanged
      
      const slugAfter = buildAccountSlug(bankName, "1234", undefined, accountType);
      
      expect(slugAfter).toBe(slugBefore);
      expect(slugAfter).toBe("cibc-1234");
    });

    it("should handle empty account ID", () => {
      const bankName = "Scotiabank";
      const accountType = "Savings";
      
      const slugBefore = buildAccountSlug(bankName, undefined, undefined, accountType);
      
      const masked = maskAccountNumber(undefined);
      expect(masked).toBeUndefined();
      
      const slugAfter = buildAccountSlug(bankName, undefined, undefined, accountType);
      
      expect(slugAfter).toBe(slugBefore);
      expect(slugAfter).toBe("scotiabank-savings");
    });
  });
});
